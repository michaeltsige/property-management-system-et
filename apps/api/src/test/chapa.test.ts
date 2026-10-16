/**
 * Chapa adapter unit tests — no database, no network.
 *
 * The sandbox transport is exercised directly (initiate → verify → webhook →
 * refund) and the live transport is exercised against a stubbed `fetch`,
 * asserting the exact documented contract: bearer auth, major-unit amounts,
 * `data.checkout_url`, verify status mapping and the HMAC webhook signature.
 */

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ChapaPaymentProvider,
  majorStringToMinor,
  minorToMajorString,
} from '../providers/payments/chapa.js';

const SECRET = 'CHASECK-test-0000000000000000';
const WEBHOOK_SECRET = 'whsec-chapa-test';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('amount conversions', () => {
  it('converts minor units to Chapa major-unit strings and back without float drift', () => {
    expect(minorToMajorString(150000)).toBe('1500.00');
    expect(minorToMajorString(1)).toBe('0.01');
    expect(minorToMajorString(150055)).toBe('1500.55');
    expect(majorStringToMinor('1500.00')).toBe(150000);
    expect(majorStringToMinor('0.01')).toBe(1);
    expect(majorStringToMinor(400)).toBe(40000);
    expect(majorStringToMinor('1500.5')).toBe(150050);
  });
});

describe('chapa sandbox transport (test mode)', () => {
  it('is configured without any credentials and reports nothing missing', () => {
    const provider = new ChapaPaymentProvider({}, 'test');
    expect(provider.isConfigured()).toBe(true);
    expect(provider.missingCredentials()).toEqual([]);
  });

  it('initiates to the sandbox checkout page and verifies as succeeded', async () => {
    const provider = new ChapaPaymentProvider({}, 'test');
    const initiation = await provider.initiate({
      organizationId: 'org-1',
      reference: 'portal-abc',
      amount: { amountMinor: 150000, currency: 'ETB' },
      description: 'Rent payment for Tenant',
      returnUrl: 'https://pms.example.com/portal/pay/mock',
    });

    expect(initiation.status).toBe('requires_action');
    expect(initiation.providerRef).toMatch(/^PMS-/);
    expect(initiation.redirectUrl).toBe(
      `https://pms.example.com/portal/pay/chapa?tx_ref=${initiation.providerRef}`,
    );

    const verification = await provider.verify(initiation.providerRef);
    expect(verification.status).toBe('succeeded');
    expect(verification.amountMinor).toBe(150000);
    expect(verification.currency).toBe('ETB');
    expect(verification.paidAt).toBeInstanceOf(Date);
  });

  it('verifies an unknown reference as failed', async () => {
    const provider = new ChapaPaymentProvider({}, 'test');
    const verification = await provider.verify('PMS-unknown');
    expect(verification.status).toBe('failed');
  });

  it('accepts a correctly signed webhook and maps the documented events', async () => {
    const provider = new ChapaPaymentProvider({ webhookSecret: WEBHOOK_SECRET }, 'test');
    const body = JSON.stringify({
      event: 'charge.success',
      tx_ref: 'PMS-abc123',
      reference: 'AP634JFwEbxd',
      amount: '400.00',
      currency: 'ETB',
      status: 'success',
      payment_method: 'telebirr',
    });
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    const event = await provider.handleWebhook(body, { 'x-chapa-signature': signature });
    expect(event.signatureValid).toBe(true);
    expect(event.status).toBe('succeeded');
    expect(event.providerRef).toBe('PMS-abc123');
    expect(event.amountMinor).toBe(40000);
    expect(event.currency).toBe('ETB');

    const failedBody = JSON.stringify({ event: 'charge.failed/cancelled', tx_ref: 'PMS-abc123' });
    const failedEvent = await provider.handleWebhook(failedBody, {
      'chapa-signature': createHmac('sha256', WEBHOOK_SECRET).update(failedBody).digest('hex'),
    });
    expect(failedEvent.signatureValid).toBe(true);
    expect(failedEvent.status).toBe('failed');
  });

  it('rejects tampered or unsigned webhooks', async () => {
    const provider = new ChapaPaymentProvider({ webhookSecret: WEBHOOK_SECRET }, 'test');
    const body = JSON.stringify({ event: 'charge.success', tx_ref: 'PMS-abc123' });

    const tampered = await provider.handleWebhook(body, { 'x-chapa-signature': 'deadbeef'.repeat(4) });
    expect(tampered.signatureValid).toBe(false);

    const unsigned = await provider.handleWebhook(body, {});
    expect(unsigned.signatureValid).toBe(false);

    const wrongKey = await provider.handleWebhook(body, {
      'x-chapa-signature': createHmac('sha256', 'other-secret').update(body).digest('hex'),
    });
    expect(wrongKey.signatureValid).toBe(false);
  });

  it('refunds within the refundable amount and refuses more', async () => {
    const provider = new ChapaPaymentProvider({}, 'test');
    const initiation = await provider.initiate({
      organizationId: 'org-1',
      reference: 'portal-abc',
      amount: { amountMinor: 10000, currency: 'ETB' },
    });

    const refund = await provider.refund({
      providerRef: initiation.providerRef,
      amount: { amountMinor: 4000, currency: 'ETB' },
      reason: 'partial goodwill',
    });
    expect(refund.status).toBe('succeeded');

    await expect(
      provider.refund({
        providerRef: initiation.providerRef,
        amount: { amountMinor: 999999, currency: 'ETB' },
        reason: 'too much',
      }),
    ).rejects.toThrow('refundable');
  });
});

describe('chapa live transport (live mode)', () => {
  function stubFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = handler(String(url), init);
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('is unconfigured without a secret key and refuses to call the API', async () => {
    const provider = new ChapaPaymentProvider({ webhookSecret: WEBHOOK_SECRET }, 'live');
    expect(provider.isConfigured()).toBe(false);
    expect(provider.missingCredentials()).toEqual(['secretKey']);
    await expect(
      provider.initiate({
        organizationId: 'org-1',
        reference: 'portal-abc',
        amount: { amountMinor: 100, currency: 'ETB' },
      }),
    ).rejects.toThrow('secretKey');
  });

  it('initializes against the documented endpoint and redirects to data.checkout_url', async () => {
    const fetchMock = stubFetch(() => ({
      status: 'success',
      message: 'Hosted Link',
      data: { checkout_url: 'https://checkout.chapa.co/checkout/payment/test-1' },
    }));
    const provider = new ChapaPaymentProvider({ secretKey: SECRET, baseUrl: 'https://api.chapa.co/v1' }, 'live');

    const initiation = await provider.initiate({
      organizationId: 'org-1',
      reference: 'portal-abc',
      amount: { amountMinor: 150000, currency: 'ETB' },
      description: 'Rent payment for Abebe Kebede',
      returnUrl: 'https://pms.example.com/portal/pay/mock',
      customer: { fullName: 'Abebe Kebede', phone: '+251911234567', email: undefined },
    });

    expect(initiation.redirectUrl).toBe('https://checkout.chapa.co/checkout/payment/test-1');
    expect(initiation.providerRef).toMatch(/^PMS-/);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.chapa.co/v1/transaction/initialize');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);

    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent.amount).toBe('1500.00');
    expect(sent.currency).toBe('ETB');
    expect(sent.first_name).toBe('Abebe');
    expect(sent.last_name).toBe('Kebede');
    expect(sent.phone_number).toBe('0911234567'); // +251… rewritten to the documented local form
    expect(sent.return_url).toBe('https://pms.example.com/portal/pay/chapa');
    expect(String(sent.email)).toContain('@');
  });

  it('maps the verify response statuses and converts the major-unit amount', async () => {
    stubFetch(() => ({
      status: 'success',
      message: 'Verification',
      data: {
        status: 'success',
        amount: '1500.00',
        currency: 'ETB',
        tx_ref: 'PMS-abc',
        created_at: '2026-10-16T09:00:00.000000Z',
        updated_at: '2026-10-16T09:01:30.000000Z',
      },
    }));
    const provider = new ChapaPaymentProvider({ secretKey: SECRET }, 'live');

    const verification = await provider.verify('PMS-abc');
    expect(verification.status).toBe('succeeded');
    expect(verification.amountMinor).toBe(150000);
    expect(verification.currency).toBe('ETB');
    expect(verification.paidAt?.getUTCSeconds()).toBe(30);
  });

  it('surfaces provider errors as thrown errors with the Chapa message', async () => {
    stubFetch(() => ({ status: 'error', message: 'Invalid secret key.' }));
    const provider = new ChapaPaymentProvider({ secretKey: SECRET }, 'live');
    await expect(provider.verify('PMS-abc')).rejects.toThrow('Invalid secret key.');
  });

  it('refunds and reconciliation are refused in live mode until the endpoints are confirmed', async () => {
    const provider = new ChapaPaymentProvider({ secretKey: SECRET }, 'live');
    await expect(
      provider.refund({ providerRef: 'PMS-abc', amount: { amountMinor: 100, currency: 'ETB' }, reason: 'test' }),
    ).rejects.toThrow('refund');
    await expect(
      provider.reconcile({ organizationId: 'org-1', from: new Date(), to: new Date() }),
    ).rejects.toThrow('statement');
  });
});
