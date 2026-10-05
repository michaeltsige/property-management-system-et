/**
 * Mock payment provider — the default in development, testing and CI.
 *
 * It behaves like a real provider (initiate → pending, verify → succeeded,
 * signed webhooks, refunds, reconciliation) so that the whole payment path can be
 * exercised without a sandbox account. It never moves real money.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { money } from '@pms/shared';

import {
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

export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = 'mock' as const;

  /** In-memory ledger of mock transactions so verify/refund can be meaningful. */
  private readonly transactions = new Map<
    string,
    { amountMinor: number; currency: string; paidAt: Date; refunded: number }
  >();

  constructor(private readonly webhookSecret = 'mock-webhook-secret') {}

  isConfigured(): boolean {
    return true;
  }

  async initiate(input: InitiatePaymentInput): Promise<PaymentInitiation> {
    const providerRef = `MOCK-${randomUUID()}`;
    this.transactions.set(providerRef, {
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      paidAt: new Date(),
      refunded: 0,
    });
    return {
      providerRef,
      status: 'requires_action',
      redirectUrl: `${input.returnUrl ?? 'https://example.test/checkout'}?ref=${providerRef}`,
      raw: { simulated: true, reference: input.reference },
    };
  }

  async verify(providerRef: string): Promise<PaymentVerification> {
    const transaction = this.transactions.get(providerRef);
    if (!transaction) {
      return { providerRef, status: 'failed', raw: { reason: 'unknown provider reference' } };
    }
    return {
      providerRef,
      status: 'succeeded',
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      paidAt: transaction.paidAt,
      raw: { simulated: true },
    };
  }

  /** Signs a payload the way a real provider would, so signature handling is tested. */
  signPayload(body: string): string {
    return createHmac('sha256', this.webhookSecret).update(body).digest('hex');
  }

  async handleWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<WebhookEvent> {
    const signature = headers['x-mock-signature'] ?? '';
    const expected = this.signPayload(rawBody);
    const signatureValid =
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));

    const payload = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      providerRef?: string;
      reference?: string;
      status?: string;
      amountMinor?: number;
      currency?: string;
    };

    const status =
      payload.status === 'succeeded' || payload.status === 'failed' || payload.status === 'pending'
        ? payload.status
        : 'pending';

    return {
      eventId: payload.id ?? `evt_${randomUUID()}`,
      type: payload.type ?? 'payment.updated',
      providerRef: payload.providerRef,
      reference: payload.reference,
      status,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      signatureValid,
      raw: payload,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const transaction = this.transactions.get(input.providerRef);
    if (!transaction) throw new Error(`Unknown mock transaction: ${input.providerRef}`);
    const remaining = transaction.amountMinor - transaction.refunded;
    if (input.amount.amountMinor > remaining) throw new Error('Refund exceeds the refundable amount');
    transaction.refunded += input.amount.amountMinor;
    return { refundRef: `MOCKREF-${randomUUID()}`, status: 'succeeded', raw: { simulated: true } };
  }

  async reconcile(query: ReconciliationQuery): Promise<ReconciliationRow[]> {
    void query;
    return [...this.transactions.entries()].map(([providerRef, transaction]) => ({
      providerRef,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      status: 'succeeded' as const,
      paidAt: transaction.paidAt,
    }));
  }
}

export const mockPaymentProvider = new MockPaymentProvider();

/** Helper for tests and the mock checkout page. */
export function mockWebhookBody(params: {
  providerRef: string;
  reference?: string;
  amountMinor: number;
  currency?: string;
  status?: 'succeeded' | 'pending' | 'failed';
}): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: 'payment.updated',
    providerRef: params.providerRef,
    reference: params.reference,
    status: params.status ?? 'succeeded',
    amountMinor: params.amountMinor,
    currency: params.currency ?? 'ETB',
  });
}

export function mockAmount(amountMinor: number, currency = 'ETB') {
  return money(amountMinor, currency);
}
