/**
 * Telebirr adapter — NOT IMPLEMENTED, deliberately.
 *
 * The brief is explicit: build provider adapters **against official documentation
 * and sandbox only**, and never guess an API shape. Telebirr's H5/app payment
 * ("Telebirr SuperApp" / CBE Birr style) integration requires
 * Ethio Telecom to issue merchant credentials and the current public
 * documentation/SDK, including its RSA-signed request/response envelope.
 *
 * The structure around it is finished, though: an organization can already save
 * its Telebirr merchant credentials (encrypted at rest) and the adapter resolves
 * from them. Completing this adapter is then a pure code change inside
 * `initiate/verify/...` — no schema, route or UI work remains.
 *
 * Until the official guide is supplied, this adapter refuses to run rather than
 * sending a made-up request to a live payment endpoint. Every method that must
 * talk to Telebirr throws `ProviderNotConfiguredError` with the missing pieces
 * listed.
 *
 * WHAT IS NEEDED TO FINISH THIS ADAPTER
 * 1. Official integration guide + sandbox base URL and API version.
 * 2. Merchant credentials: app id, short code, app key, public/private key pair —
 *    saveable today via PUT /organizations/payment-gateway.
 * 3. The exact request envelope (field names, ordering and payload signature rules).
 * 4. The async notification (webhook) contract and its signature/verification rules.
 * 5. Refund/reversal API and its rules (partial refunds? deadlines?).
 * 6. Reconciliation: does Ethio Telecom expose a statement endpoint, or is
 *    reconciliation a manual file upload?
 *
 * TODO(payments): implement once (1)-(6) are available; add an integration test
 * against the sandbox and record the doc revision in docs/REFERENCES.md.
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

/** Credential names match `PAYMENT_GATEWAY_CREDENTIAL_FIELDS.telebirr` in @pms/shared. */
export interface TelebirrCredentials {
  appId?: string;
  appKey?: string;
  shortCode?: string;
  publicKey?: string;
  privateKey?: string;
}

export class TelebirrPaymentProvider implements PaymentProviderAdapter {
  readonly name = 'telebirr' as const;

  constructor(private readonly credentials: TelebirrCredentials = {}) {}

  isConfigured(): boolean {
    return Boolean(
      this.credentials.appId &&
        this.credentials.appKey &&
        this.credentials.shortCode &&
        this.credentials.publicKey &&
        this.credentials.privateKey,
    );
  }

  /** Field names an organization still has to save, for clear error messages. */
  missingCredentials(): string[] {
    const missing: string[] = [];
    if (!this.credentials.appId) missing.push('appId');
    if (!this.credentials.appKey) missing.push('appKey');
    if (!this.credentials.shortCode) missing.push('shortCode');
    if (!this.credentials.publicKey) missing.push('publicKey');
    if (!this.credentials.privateKey) missing.push('privateKey');
    return missing;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('telebirr', this.missingCredentials().join(', '));
    }
    // Credentials alone are not enough: the request envelope must come from the
    // official guide. This guard exists so that nobody "fills in the blanks".
    throw new ProviderNotConfiguredError(
      'telebirr',
      'the official integration guide and sandbox documentation (request envelope, webhook contract, refund API)',
    );
  }

  async initiate(_input: InitiatePaymentInput): Promise<PaymentInitiation> {
    this.assertConfigured();
    throw new Error('unreachable');
  }

  async verify(_providerRef: string): Promise<PaymentVerification> {
    this.assertConfigured();
    throw new Error('unreachable');
  }

  async handleWebhook(_rawBody: string, _headers: Record<string, string | undefined>): Promise<WebhookEvent> {
    this.assertConfigured();
    throw new Error('unreachable');
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    this.assertConfigured();
    throw new Error('unreachable');
  }

  async reconcile(_query: ReconciliationQuery): Promise<ReconciliationRow[]> {
    this.assertConfigured();
    throw new Error('unreachable');
  }
}
