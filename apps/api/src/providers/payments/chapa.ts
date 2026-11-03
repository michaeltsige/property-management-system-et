/**
 * Chapa adapter — two transports behind one class:
 *
 * - **Test mode (`test`)**: a faithful in-process simulation of the documented
 *   Chapa flow. No network, no Chapa account needed. It exists so an
 *   organization can select Chapa today, run the whole checkout end to end and
 *   see exactly what tenants will see — then switch to live mode when the real
 *   credentials arrive. The simulation shares one module-level ledger, so
 *   initiate (request 1) and verify/complete (request 2) see the same state.
 * - **Live mode (`live`)**: real HTTP calls with the organization's secret
 *   key. TWO API surfaces exist, picked automatically from the key prefix
 *   (verified against Chapa's docs on 2026-11-02):
 *   - Classic keys — `CHASECK_TEST-…` (test) and `CHASECK-…` (live) → **API
 *     v1**, `https://api.chapa.co/v1`. Chapa's test/live mode is decided by
 *     the key prefix; only the published test cards / mobile numbers succeed
 *     on a test key (developer.chapa.co/test/testing-cards,
 *     /test/testing-mobile).
 *   - Newer dashboard keys — `CHAPA_TEST_…` (labelled "Private Key") → **API
 *     v2**, `https://api.chapa.global/v2`. Sending a v2-format key to the v1
 *     endpoint is rejected with "Invalid API Key or the business can't accept
 *     payments at the moment" — the mismatch this dual-surface support
 *     removes.
 *   Neither surface has a separate sandbox URL.
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
 * V2 CONTRACT — docs.chapa.global ("Hosted Checkout" + "Accept Payment" +
 * "Webhooks", checked 2026-11-02):
 *
 * - `POST {base}/payments/hosted`, `Authorization: Bearer <privateKey>` plus a
 *   REQUIRED `Idempotency-Key` header (we send the merchant reference, so a
 *   transport-level retry of the same payment is deduplicated). Body:
 *   `amount` in INTEGER CENTS, minimum 100 — not v1's major-unit string —
 *   `currency`, `merchant_reference` (max 20 chars; our refs are generated to
 *   fit), `customer` { first_name, last_name, email, phone_number in 251…
 *   international form }, `return_url`, `callback_url`, `customization`,
 *   optional `meta`. Response `{ status: "success", data: { checkout_url } }`.
 * - Return flow: Chapa's own redirect params are undocumented for v2, so the
 *   return_url embeds our `merchant_reference`; the portal return page can
 *   always complete the payment without depending on undocumented params.
 * - `GET {base}/payments/{reference}/verify` accepts either Chapa's reference
 *   or our merchant_reference. Fulfil only when `data.status === "SUCCESS"`
 *   (uppercase on v2); `data.amount` is integer cents.
 * - Webhooks: same `x-chapa-signature` HMAC-SHA256 (hex) over the raw body.
 *   The payload differs from v1: `event: "payment.success" | "payment.failed"
 *   | …`, `merchant_reference` (our reference), `chapa_reference`, `amount`
 *   in integer cents, `mode: "live" | "test"`.
 *
 * Deliberately NOT implemented in live mode: `refund` and `reconcile` — the
 * exact refund/statement endpoints were not confirmed from the docs at the time
 * of writing. They throw a clear `ProviderNotConfiguredError` instead of
 * guessing URLs. Refunds run from the Chapa dashboard until then.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { getConfig } from '../../config.js';
import { logger } from '../../lib/logger.js';

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
const DEFAULT_V2_BASE_URL = 'https://api.chapa.global/v2';
const SANDBOX_WEBHOOK_SECRET = 'chapa-sandbox-webhook-secret';

/** Which documented Chapa API surface a secret key speaks. */
export type ChapaApiSurface = 'v1' | 'v2';

/**
 * Classic keys (CHASECK_TEST-… / CHASECK-…) speak the documented v1 API; the
 * newer dashboard keys (CHAPA_TEST_…, labelled "Private Key") speak v2. This
 * is exactly the split that made a perfectly valid key fail with "Invalid API
 * Key" when it was sent to the wrong surface.
 */
export function chapaApiSurface(secretKey: string | undefined): ChapaApiSurface {
  return secretKey && secretKey.startsWith('CHASECK') ? 'v1' : 'v2';
}

/**
 * A fresh provider reference. v2 caps `merchant_reference` at 20 characters,
 * so v2 references are generated to fit; v1 (and the sandbox) keep the longer
 * historical shape.
 */
function newProviderRef(surface: ChapaApiSurface): string {
  const hex = randomUUID().replaceAll('-', '');
  return surface === 'v2' ? `PMS-${hex.slice(0, 16)}` : `PMS-${hex.slice(0, 20)}`;
}

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

/** v2 wants the international form: 0911234567 → 251911234567. */
function normalizedChapaIntlPhone(phone?: string): string | undefined {
  const local = normalizedChapaPhone(phone);
  return local ? `251${local.slice(1)}` : undefined;
}

/**
 * Chapa (v1 and v2) only accepts https:// for `callback_url` and `return_url`.
 * A plain-http (localhost) value — on EITHER field — is rejected with the
 * misleading message "Callback URL must start with https:// and be a valid
 * URL" (verified against the live v2 API on 2026-11-03: a request with only an
 * http return_url fails with exactly that message). Both fields are optional,
 * so a non-https URL is dropped instead of failing the whole checkout:
 * completion then falls back to the server-side verify path (the portal's
 * pending-payment "check status" button, or the webhook when one is
 * configured). Set API_PUBLIC_URL / PORTAL_RETURN_ORIGIN to https URLs in
 * production to get the redirect and webhook back.
 */
export function httpsUrlOrUndefined(url: string | undefined, context: string): string | undefined {
  if (!url) return undefined;
  if (/^https:\/\//i.test(url)) return url;
  logger.warn(
    { context, url },
    'Chapa only accepts https URLs — omitting it; payment completion falls back to server-side verify',
  );
  return undefined;
}

/** v2 reports amounts as integer cents; normalize defensively (integers only). */
function v2AmountToMinor(amount: string | number): number | undefined {
  const parsed = typeof amount === 'number' ? amount : Number(String(amount).trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
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
  // v2 payload names: our reference arrives as merchant_reference, Chapa's as
  // chapa_reference, and amounts are integer cents.
  merchant_reference?: string;
  chapa_reference?: string;
  status?: string;
  amount?: string | number;
  currency?: string;
}

function mapChapaStatus(event: string | undefined, status: string | undefined): 'succeeded' | 'pending' | 'failed' {
  if (event === 'charge.success' || event === 'payment.success' || status === 'success') {
    return 'succeeded';
  }
  if (
    event === 'charge.failed/cancelled' ||
    event === 'payment.failed' ||
    event === 'payment.cancelled' ||
    status === 'failed/cancelled' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
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
    private readonly apiSurface: ChapaApiSurface = chapaApiSurface(credentials.secretKey),
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
    // An explicit override (tests, inspector proxies) wins; then the configured
    // CHAPA_BASE_URL; then the documented default for the key's API surface.
    if (this.credentials.baseUrl) return this.credentials.baseUrl;
    const configured = getConfig().CHAPA_BASE_URL;
    if (configured) return configured;
    return this.apiSurface === 'v2' ? DEFAULT_V2_BASE_URL : DEFAULT_LIVE_BASE_URL;
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
    const txRef = newProviderRef(this.apiSurface);
    const fullName = input.customer?.fullName?.trim() || 'PMS Tenant';
    const [firstName = 'PMS', ...restName] = fullName.split(' ');
    const lastName = restName.join(' ') || 'PMS';
    const email = input.customer?.email || `tenant+${txRef.toLowerCase()}@pms.local`;
    const webhookBase = getConfig().API_PUBLIC_URL;
    const callbackUrl = httpsUrlOrUndefined(
      webhookBase ? `${webhookBase.replace(/\/$/, '')}/api/v1/webhooks/chapa` : undefined,
      'callback_url',
    );
    // Our own reference travels inside the return URL: the portal return page
    // can then always complete the payment, whether or not Chapa appends its
    // own redirect params (undocumented on v2).
    const returnUrl = httpsUrlOrUndefined(
      `${chapaSandboxCheckoutUrl(input.returnUrl)}?merchant_reference=${encodeURIComponent(txRef)}`,
      'return_url',
    );
    const customization: Record<string, unknown> = {
      title: 'Rent payment',
      ...(input.description ? { description: input.description } : {}),
    };
    const phoneLocal = normalizedChapaPhone(input.customer?.phone);
    const phoneIntl = normalizedChapaIntlPhone(input.customer?.phone);

    const response =
      this.apiSurface === 'v2'
        ? await this.liveRequest('/payments/hosted', {
            method: 'POST',
            headers: { 'Idempotency-Key': txRef },
            body: JSON.stringify({
              // v2 amounts are INTEGER CENTS (minimum 100), unlike v1's
              // major-unit decimal string.
              amount: Math.trunc(input.amount.amountMinor),
              currency: input.amount.currency,
              merchant_reference: txRef,
              customer: {
                first_name: firstName,
                last_name: lastName,
                email,
                ...(phoneIntl ? { phone_number: phoneIntl } : {}),
              },
              return_url: returnUrl,
              ...(callbackUrl ? { callback_url: callbackUrl } : {}),
              customization,
              ...(input.reference ? { meta: { pms_reference: input.reference } } : {}),
            }),
          })
        : await this.liveRequest('/transaction/initialize', {
            method: 'POST',
            body: JSON.stringify({
              amount: minorToMajorString(input.amount.amountMinor),
              currency: input.amount.currency,
              // Chapa requires a syntactically valid email even when the tenant has none.
              email,
              first_name: firstName,
              last_name: lastName,
              tx_ref: txRef,
              return_url: returnUrl,
              customization,
              ...(phoneLocal ? { phone_number: phoneLocal } : {}),
              ...(callbackUrl ? { callback_url: callbackUrl } : {}),
            }),
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

    const response =
      this.apiSurface === 'v2'
        ? // v2 verify accepts either Chapa's reference or our merchant_reference
          // (which is what this adapter stores as providerRef).
          await this.liveRequest(`/payments/${encodeURIComponent(providerRef)}/verify`)
        : await this.liveRequest(`/transaction/verify/${encodeURIComponent(providerRef)}`);
    const data = (response.data ?? {}) as {
      status?: string;
      amount?: string | number;
      currency?: string;
      created_at?: string;
      updated_at?: string;
    };
    // v2 reports "SUCCESS"/"PENDING"/… (uppercase); v1 uses lowercase words.
    const status = mapChapaStatus(undefined, data.status?.toLowerCase());
    const paidAtSource = data.updated_at ?? data.created_at;
    const amountMinor =
      data.amount === undefined
        ? undefined
        : this.apiSurface === 'v2'
          ? v2AmountToMinor(data.amount) // integer cents already
          : majorStringToMinor(data.amount); // major-unit decimal string
    return {
      providerRef,
      status,
      amountMinor,
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

    // v2 payloads name our reference `merchant_reference` and report integer
    // cents; v1 uses `tx_ref` and major-unit decimal strings.
    const isV2Payload =
      typeof payload.merchant_reference === 'string' || (payload.event ?? '').startsWith('payment.');
    const amountMinor =
      payload.amount === undefined
        ? undefined
        : isV2Payload
          ? v2AmountToMinor(payload.amount)
          : majorStringToMinor(payload.amount);

    return {
      eventId: payload.chapa_reference ?? payload.reference ?? `evt_${randomUUID()}`,
      type: payload.event ?? 'unknown',
      providerRef: payload.tx_ref ?? payload.merchant_reference,
      reference: payload.chapa_reference ?? payload.reference,
      status: mapChapaStatus(payload.event, payload.status),
      amountMinor,
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
