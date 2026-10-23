/**
 * Chapa adapter — two transports behind one class:
 *
 * - **Test mode (`test`)**: a faithful in-process simulation of the documented
 *   Chapa flow. No network, no Chapa account needed. It exists so an
 *   organization can select Chapa today, run the whole checkout end to end and
 *   see exactly what tenants will see — then switch to live mode when the real
 *   credentials arrive. The simulation shares one module-level ledger, so
 *   initiate (request 1) and verify/complete (request 2) see the same state.
 * - **Live mode (`live`)**: real HTTP calls to api.chapa.co with the
 *   organization's secret key. The key prefix decides what Chapa does with
 *   the request: `CHASECK_TEST-...` runs in Chapa's test mode (real hosted
 *   checkout, real API surface, but the published test cards / test mobile
 *   numbers from developer.chapa.co/integrations/testing-cards), and
 *   `CHASECK-...` is the live key (real money). Both hit the same endpoint —
 *   there is no separate sandbox URL.
 *
 * LIVE CONTRACT — confirmed against the official documentation
 * (developer.chapa.co, "Accept Payment" + "Webhooks", last checked 2026-10-16;
 * recorded in docs/REFERENCES.md):
 *
 * - `POST https://api.chapa.co/v1/transaction/initialize`, `Authorization:
 *   Bearer <secretKey>`; required fields `amount` (MAJOR units, e.g. "1500.00"),
 *   `currency`, `email`, `first_name`, `last_name`, `tx_ref`; useful optional
 *   fields `phone_number` (10 digits, 09xxxxxxxx/07xxxxxxxx), `callback_url`,
 *   `return_url`, `customization[title|description]`. Response
 *   `{ status: "success", data: { checkout_url: "https://checkout.chapa.co/..." } }`.
 * - The payer is redirected to `data.checkout_url`. After payment Chapa
 *   redirects to `return_url` and (documented) appends `trx_ref`, `ref_id` and
 *   `status` query params.
 * - `GET https://api.chapa.co/v1/transaction/verify/{tx_ref}` →
 *   `{ status: "success", data: { status: "success" | "failed" | "pending",
 *   amount: "400.00", currency: "ETB", tx_ref, ... } }`. Verify is the source
 *   of truth; the webhook is only a trigger (Chapa's own guidance).
 * - Webhook: POST from Chapa with a JSON body
 *   `{ event: "charge.success" | "charge.failed/cancelled" | "charge.refunded"
 *   | "charge.reversed", tx_ref, reference, amount: "400.00", currency, status, ... }`
 *   and the HMAC-SHA256 (hex) of the raw body under `x-chapa-signature`
 *   (custom webhooks use `chapa-signature`; either being valid is sufficient
 *   per the docs). Missing/wrong signature → reject before processing.
 * - Webhook acknowledgment: respond 200; Chapa retries every ~10 minutes up to
 *   10 times otherwise.
 *
 * Deliberately NOT implemented in live mode: `refund` and `reconcile` — the
 * exact refund/statement endpoints were not confirmed from the docs at the time
 * of writing. They throw a clear `ProviderNotConfiguredError` instead of
 * guessing URLs. Refunds run from the Chapa dashboard until then.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { getConfig } from '../../config.js';

import {
  ProviderNotConfiguredError,
  type InitiatePaymentInput,
  type PaymentInitiation,
  type PaymentProviderAdapter,
  type PaymentVerification,
  type ReconciliationQuery,
  type ReconciliationRow,
  type RefundInput,
  type RefundResult,
  type WebhookEvent,
} from './types.js';

/** Credential names match `PAYMENT_GATEWAY_CREDENTIAL_FIELDS.chapa` in @pms/shared. */
export interface ChapaCredentials {
  secretKey?: string;
  webhookSecret?: string;
  /** Live API base override (tests/inspector proxies). Defaults to the official API. */
  baseUrl?: string;
}

export type ChapaMode = 'test' | 'live';

const DEFAULT_LIVE_BASE_URL = 'https://api.chapa.co/v1';
const SANDBOX_WEBHOOK_SECRET = 'chapa-sandbox-webhook-secret';

/** Module-level sandbox ledger: shared across adapter instances and requests. */
const sandboxTransactions = new Map<
  string,
  { amountMinor: number; currency: string; paidAt: Date; refunded: number }
>();

/** "150000" minor → "1500.00" major (Chapa expects major-unit decimal strings). */
export function minorToMajorString(amountMinor: number): string {
  const safe = Math.max(0, Math.trunc(amountMinor));
  const birr = Math.floor(safe / 100);
  const santim = safe % 100;
  return `${birr}.${String(santim).padStart(2, '0')}`;
}

/** "1500.00" major (or 1500) → 150000 minor, without float drift. */
export function majorStringToMinor(amount: string | number): number {
  const [whole = '0', fraction = '0'] = String(amount).split('.');
  const santim = fraction.slice(0, 2).padEnd(2, '0');
  return Number(whole) * 100 + Number(santim || '0');
}

/**
 * Tenant phones reach Chapa only when they already match the documented local
 * format (10 digits starting 09/07). +2519xxxxxxxx is rewritten; anything else
 * is dropped rather than risking a rejection of the whole initialize call.
 */
function normalizedChapaPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, '');
  const local = digits.startsWith('+251') ? `0${digits.slice(4)}` : digits;
  return /^0(9|7)\d{8}$/.test(local) ? local : undefined;
}

function originOf(returnUrl?: string): string {
  if (returnUrl) {
    try {
      return new URL(returnUrl).origin;
    } catch {
      // Fall through to the default below.
    }
  }
  return getConfig().PORTAL_RETURN_ORIGIN ?? getConfig().CORS_ORIGINS[0] ?? 'http://localhost:3000';
}

/** The checkout page on this app that stands in for Chapa's hosted checkout. */
export function chapaSandboxCheckoutUrl(returnUrl?: string, txRef?: string): string {
  const base = `${originOf(returnUrl).replace(/\/$/, '')}/portal/pay/chapa`;
  return txRef ? `${base}?tx_ref=${encodeURIComponent(txRef)}` : base;
}

interface ChapaWebhookPayload {
  event?: string;
  type?: string;
  tx_ref?: string;
  reference?: string;
  status?: string;
  amount?: string | number;
  currency?: string;
}

function mapChapaStatus(event: string | undefined, status: string | undefined): 'succeeded' | 'pending' | 'failed' {
  if (event === 'charge.success' || status === 'success') return 'succeeded';
  if (event === 'charge.failed/cancelled' || status === 'failed/cancelled' || status === 'failed') {
    return 'failed';
  }
  // Refund/reversal events are not completion states in this system's model;
  // they are surfaced with their raw type and ignored by the ingest route.
  return 'pending';
}

export class ChapaPaymentProvider implements PaymentProviderAdapter {
  readonly name = 'chapa' as const;

  constructor(
    private readonly credentials: ChapaCredentials = {},
    private readonly mode: ChapaMode = credentials.secretKey ? 'live' : 'test',
  ) {}

  get chapaMode(): ChapaMode {
    return this.mode;
  }

  isConfigured(): boolean {
    if (this.mode === 'test') return true; // the sandbox needs no credentials
    return Boolean(this.credentials.secretKey);
  }

  /** Field names an organization still has to save, for clear error messages. */
  missingCredentials(): string[] {
    if (this.mode === 'test') return [];
    return this.credentials.secretKey ? [] : ['secretKey'];
  }

  private assertLiveConfigured(): void {
    if (this.mode !== 'live') {
      throw new ProviderNotConfiguredError(
        'chapa',
        'live mode: the adapter is running as the built-in sandbox simulation',
      );
    }
    if (!this.credentials.secretKey) {
      throw new ProviderNotConfiguredError('chapa', 'secretKey');
    }
  }

  private get liveBaseUrl(): string {
    return this.credentials.baseUrl ?? getConfig().CHAPA_BASE_URL ?? DEFAULT_LIVE_BASE_URL;
  }

  private async liveRequest(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    this.assertLiveConfigured();
    let response: Response;
    try {
      response = await fetch(`${this.liveBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.credentials.secretKey}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`Chapa is unreachable: ${error instanceof Error ? error.message : 'unknown error'}`);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Non-JSON error pages happen on outages; keep the empty body.
    }
    if (!response.ok || body.status === 'error') {
      const message = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;
      throw new Error(`Chapa rejected the request: ${message}`);
    }
    return body;
  }

  async initiate(input: InitiatePaymentInput): Promise<PaymentInitiation> {
    if (this.mode === 'test') return this.initiateSandbox(input);
    return this.initiateLive(input);
  }

  private async initiateSandbox(input: InitiatePaymentInput): Promise<PaymentInitiation> {
    const txRef = `PMS-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    sandboxTransactions.set(txRef, {
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      paidAt: new Date(),
      refunded: 0,
    });
    return {
      providerRef: txRef,
      status: 'requires_action',
      redirectUrl: chapaSandboxCheckoutUrl(input.returnUrl, txRef),
      raw: { simulated: true, tx_ref: txRef, reference: input.reference },
    };
  }

  private async initiateLive(input: InitiatePaymentInput): Promise<PaymentInitiation> {
    this.assertLiveConfigured();
    const txRef = `PMS-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const fullName = input.customer?.fullName?.trim() || 'PMS Tenant';
    const [firstName = 'PMS', ...restName] = fullName.split(' ');
    const webhookBase = getConfig().API_PUBLIC_URL;

    const body: Record<string, unknown> = {
      amount: minorToMajorString(input.amount.amountMinor),
      currency: input.amount.currency,
      // Chapa requires a syntactically valid email even when the tenant has none.
      email: input.customer?.email || `tenant+${txRef.toLowerCase()}@pms.local`,
      first_name: firstName,
      last_name: restName.join(' ') || 'PMS',
      tx_ref: txRef,
      return_url: chapaSandboxCheckoutUrl(input.returnUrl),
      customization: {
        title: 'Rent payment',
        ...(input.description ? { description: input.description } : {}),
      },
    };
    const phone = normalizedChapaPhone(input.customer?.phone);
    if (phone) body.phone_number = phone;
    if (webhookBase) {
      body.callback_url = `${webhookBase.replace(/\/$/, '')}/api/v1/webhooks/chapa`;
    }

    const response = await this.liveRequest('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = (response.data ?? {}) as { checkout_url?: string; url?: string };
    const checkoutUrl = data.checkout_url ?? data.url;
    if (!checkoutUrl) {
      throw new Error('Chapa did not return a checkout URL');
    }
    return {
      providerRef: txRef,
      status: 'requires_action',
      redirectUrl: checkoutUrl,
      raw: response,
    };
  }

  async verify(providerRef: string): Promise<PaymentVerification> {
    if (this.mode === 'test') {
      const transaction = sandboxTransactions.get(providerRef);
      if (!transaction) {
        return { providerRef, status: 'failed', raw: { reason: 'unknown sandbox tx_ref' } };
      }
      return {
        providerRef,
        status: 'succeeded',
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        paidAt: transaction.paidAt,
        raw: { simulated: true, tx_ref: providerRef },
      };
    }

    const response = await this.liveRequest(
      `/transaction/verify/${encodeURIComponent(providerRef)}`,
    );
    const data = (response.data ?? {}) as {
      status?: string;
      amount?: string | number;
      currency?: string;
      created_at?: string;
      updated_at?: string;
    };
    const status = mapChapaStatus(undefined, data.status === 'success' ? 'success' : data.status);
    const paidAtSource = data.updated_at ?? data.created_at;
    return {
      providerRef,
      status,
      amountMinor: data.amount !== undefined ? majorStringToMinor(data.amount) : undefined,
      currency: data.currency,
      paidAt: paidAtSource ? new Date(paidAtSource) : undefined,
      raw: response,
    };
  }

  /** Signs a payload the way Chapa would, so webhook handling is exercised in tests. */
  signPayload(body: string): string {
    const secret = this.credentials.webhookSecret ?? SANDBOX_WEBHOOK_SECRET;
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  async handleWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<WebhookEvent> {
    // Both documented header spellings are accepted; either being valid is
    // sufficient per the official docs ("Verify webhook origin").
    const provided = headers['x-chapa-signature'] ?? headers['chapa-signature'] ?? '';
    const expected = this.signPayload(rawBody);
    const signatureValid =
      provided.length > 0 &&
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));

    let payload: ChapaWebhookPayload = {};
    try {
      payload = JSON.parse(rawBody) as ChapaWebhookPayload;
    } catch {
      payload = {};
    }

    return {
      eventId: payload.reference ?? `evt_${randomUUID()}`,
      type: payload.event ?? 'unknown',
      providerRef: payload.tx_ref,
      reference: payload.reference,
      status: mapChapaStatus(payload.event, payload.status),
      amountMinor: payload.amount !== undefined ? majorStringToMinor(payload.amount) : undefined,
      currency: payload.currency,
      signatureValid,
      raw: payload,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (this.mode === 'test') {
      const transaction = sandboxTransactions.get(input.providerRef);
      if (!transaction) throw new Error(`Unknown sandbox transaction: ${input.providerRef}`);
      const remaining = transaction.amountMinor - transaction.refunded;
      if (input.amount.amountMinor > remaining) throw new Error('Refund exceeds the refundable amount');
      transaction.refunded += input.amount.amountMinor;
      return { refundRef: `CHAPAREF-${randomUUID()}`, status: 'succeeded', raw: { simulated: true } };
    }
    // Live refunds are not implemented on purpose: the refund endpoint contract
    // was not confirmed from the official docs at the time of writing. Refunds
    // run from the Chapa dashboard until this is completed.
    throw new ProviderNotConfiguredError(
      'chapa',
      'the documented refund endpoint (live refunds run from the Chapa dashboard until then)',
    );
  }

  async reconcile(query: ReconciliationQuery): Promise<ReconciliationRow[]> {
    if (this.mode === 'test') {
      void query;
      return [...sandboxTransactions.entries()].map(([providerRef, transaction]) => ({
        providerRef,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        status: 'succeeded' as const,
        paidAt: transaction.paidAt,
      }));
    }
    // No confirmed statement/transactions endpoint for live mode yet.
    throw new ProviderNotConfiguredError(
      'chapa',
      'a confirmed transaction-statement endpoint (export from the Chapa dashboard until then)',
    );
  }
}

/**
 * The default sandbox instance — what organizations get with Chapa selected in
 * test mode. Credentials-free and account-free by design.
 */
export const chapaSandboxPaymentProvider = new ChapaPaymentProvider({}, 'test');
