/**
 * Chapa adapter — NOT IMPLEMENTED, deliberately.
 *
 * Chapa is the most common Ethiopian gateway for card/Telebirr/mobile-money
 * collection, and its documented flow is roughly: initialize a transaction
 * (server-side, with the secret key), send the payer to the returned checkout URL,
 * then verify the transaction by reference and/or handle a signed webhook.
 *
 * We are not writing that code from memory. The brief requires adapters to be
 * written against the official documentation and sandbox, and the exact field
 * names, signature header and webhook payload shape must be confirmed on
 * https://developer.chapa.co (or the current docs) before any code exists that
 * talks to a live endpoint.
 *
 * The structure around it is finished, though: an organization can already save
 * its Chapa credentials (encrypted at rest) and the adapter resolves from them.
 * Completing this adapter is then a pure code change inside `initiate/verify/...`
 * — no schema, route or UI work remains.
 *
 * WHAT IS NEEDED TO FINISH THIS ADAPTER
 * 1. Secret key + webhook secret from the Chapa dashboard (sandbox first) —
 *    saveable today via PUT /organizations/payment-gateway.
 * 2. Confirmation of the initialise endpoint, required fields and the exact
 *    callback/return URL parameters.
 * 3. Confirmation of the verify endpoint and its response fields (status values,
 *    amount units — note that Chapa expects major units in some fields).
 * 4. The webhook signature header name and hashing scheme.
 * 5. Refund/reversal endpoints and their constraints.
 * 6. Statement/export endpoint for reconciliation, if one exists.
 *
 * TODO(payments): implement once (1)-(6) are available, then add a sandbox
 * integration test and note the documentation revision in docs/REFERENCES.md.
 */

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
}

export class ChapaPaymentProvider implements PaymentProviderAdapter {
  readonly name = 'chapa' as const;

  constructor(private readonly credentials: ChapaCredentials = {}) {}

  isConfigured(): boolean {
    return Boolean(this.credentials.secretKey && this.credentials.webhookSecret);
  }

  /** Field names an organization still has to save, for clear error messages. */
  missingCredentials(): string[] {
    const missing: string[] = [];
    if (!this.credentials.secretKey) missing.push('secretKey');
    if (!this.credentials.webhookSecret) missing.push('webhookSecret');
    return missing;
  }

  private assertConfigured(): never {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('chapa', this.missingCredentials().join(', '));
    }
    // Credentials alone are not enough: the request envelope must come from the
    // official documentation. This guard exists so that nobody "fills in the blanks".
    throw new ProviderNotConfiguredError(
      'chapa',
      'confirmation of the initialise/verify/webhook/refund contracts from the official documentation',
    );
  }

  async initiate(_input: InitiatePaymentInput): Promise<PaymentInitiation> {
    this.assertConfigured();
  }

  async verify(_providerRef: string): Promise<PaymentVerification> {
    this.assertConfigured();
  }

  async handleWebhook(_rawBody: string, _headers: Record<string, string | undefined>): Promise<WebhookEvent> {
    this.assertConfigured();
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    this.assertConfigured();
  }

  async reconcile(_query: ReconciliationQuery): Promise<ReconciliationRow[]> {
    this.assertConfigured();
  }
}
