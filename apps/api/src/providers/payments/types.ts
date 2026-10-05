/**
 * Payment provider interface.
 *
 * Every adapter must implement exactly these five capabilities: initiate, verify,
 * webhook handling, refund/reversal and reconciliation. The rest of the system
 * never imports a provider SDK directly — it goes through this interface, so
 * adding a new Ethiopian provider is a new folder, not surgery.
 *
 * IMPORTANT: adapters for real providers are written against **official
 * documentation and sandboxes only**. Shapes are never guessed; if the docs are
 * unavailable the adapter must throw `PROVIDER_NOT_CONFIGURED` and say so.
 */

import type { Money } from '@pms/shared';

export type ProviderName = 'mock' | 'telebirr' | 'chapa';

export interface InitiatePaymentInput {
  organizationId: string;
  /** Our reference, echoed back by the provider and used for reconciliation. */
  reference: string;
  amount: Money;
  description?: string;
  returnUrl?: string;
  customer?: { fullName?: string; phone?: string; email?: string };
}

export type InitiationStatus = 'requires_action' | 'pending';

export interface PaymentInitiation {
  providerRef: string;
  status: InitiationStatus;
  /** Where to send the payer (Telebirr/Chapa hosted page or USSD push confirmation). */
  redirectUrl?: string;
  /** Raw provider response, stored for audit but never logged. */
  raw?: unknown;
}

export type PaymentResultStatus = 'succeeded' | 'pending' | 'failed';

export interface PaymentVerification {
  providerRef: string;
  status: PaymentResultStatus;
  amountMinor?: number;
  currency?: string;
  paidAt?: Date;
  raw?: unknown;
}

export interface WebhookEvent {
  /** Provider-side event id, used to make handling idempotent. */
  eventId: string;
  type: string;
  providerRef?: string;
  reference?: string;
  status: PaymentResultStatus;
  amountMinor?: number;
  currency?: string;
  /** False when the signature could not be verified: the event must be rejected. */
  signatureValid: boolean;
  raw: unknown;
}

export interface RefundInput {
  providerRef: string;
  amount: Money;
  reason: string;
}

export interface RefundResult {
  refundRef: string;
  status: 'succeeded' | 'pending' | 'failed';
  raw?: unknown;
}

export interface ReconciliationQuery {
  organizationId: string;
  from: Date;
  to: Date;
}

export interface ReconciliationRow {
  providerRef: string;
  reference?: string;
  amountMinor: number;
  currency: string;
  status: PaymentResultStatus;
  paidAt?: Date;
}

export interface PaymentProviderAdapter {
  readonly name: ProviderName;
  /** Whether the adapter has the configuration it needs; surfaced by /ready. */
  isConfigured(): boolean;
  initiate(input: InitiatePaymentInput): Promise<PaymentInitiation>;
  verify(providerRef: string): Promise<PaymentVerification>;
  handleWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<WebhookEvent>;
  refund(input: RefundInput): Promise<RefundResult>;
  reconcile(query: ReconciliationQuery): Promise<ReconciliationRow[]>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, missing: string) {
    super(
      `Payment provider "${provider}" is not configured: ${missing}. ` +
        'Configure it from the official sandbox credentials before use.',
    );
    this.name = 'ProviderNotConfiguredError';
  }
}
