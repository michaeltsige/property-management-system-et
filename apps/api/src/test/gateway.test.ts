/**
 * Organization payment gateway: per-org provider configuration with encrypted
 * credentials, the org-aware adapter resolution, and the mock demo path.
 *
 * The secret rules under test mirror the service docstring: ciphertext at rest,
 * no values (plain or encrypted) in any response or audit row, and masked
 * `••••last4` hints only. The demo rules: a mock org configuration drives the
 * same initiate → complete loop as before, and an org-configured real provider
 * is refused with a clear 502 until its adapter is verified against official
 * documentation.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { civilToUtcDate } from '@pms/calendar';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture, createPortfolio, type Fixture } from './helpers.js';

const app = createApp();
const etStart = civilToUtcDate({ year: 2015, month: 1, day: 1, calendar: 'ethiopian' });

const CHAPA_SECRET = 'chapa-secret-8f2a90cf77b1';
const CHAPA_WEBHOOK = 'whsec-3311aa77dd00bb22';

interface PortalSession {
  organizationId: string;
  tenantId: string;
  leaseId: string;
  header: Record<string, string>;
}

/** Org + portfolio + two generated periods, with the tenant signed in to the portal. */
async function setupPortalTenant(label: string, phone: string, rentMinor = 1_500_000): Promise<{
  fixture: Fixture;
  session: PortalSession;
}> {
  const fixture = await createOrganizationFixture(label);
  const prisma = getPrisma();
  const portfolio = await createPortfolio(prisma, {
    organizationId: fixture.organizationId,
    billingCalendar: 'ethiopian',
    rentAmountMinor: rentMinor,
    startDate: etStart,
    dueDayOfMonth: 5,
    tenantPhone: phone,
  });
  const { generateCharges } = await import('../services/charges.js');
  await generateCharges(prisma, { organizationId: fixture.organizationId, periodKeys: ['2019-01'] });

  await request(app).post(`/api/v1/tenants/${portfolio.tenantId}/portal`).set(authHeader(fixture)).expect(201);
  await request(app).post('/api/v1/portal/request-code').send({ phone: `0${phone.replace('+251', '')}` }).expect(200);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: portfolio.tenantId } });
  const notification = await prisma.notification.findFirstOrThrow({
    where: { recipientUserId: tenant.userId ?? '' },
    orderBy: { createdAt: 'desc' },
  });
  const code = (notification.payload as { code: string }).code;
  const verify = await request(app)
    .post('/api/v1/portal/verify')
    .send({ phone: `0${phone.replace('+251', '')}`, code })
    .expect(200);

  return {
    fixture,
    session: {
      organizationId: fixture.organizationId,
      tenantId: portfolio.tenantId,
      leaseId: portfolio.leaseId,
      header: { Authorization: `Bearer ${verify.body.tokens.accessToken}` },
    },
  };
}

async function readGatewaySettingRow(organizationId: string) {
  return getPrisma().organizationSetting.findUniqueOrThrow({
    where: { organizationId_key: { organizationId, key: 'payment_gateway' } },
  });
}

describe('organization payment gateway status', () => {
  it('reports the platform default when no organization gateway is configured', async () => {
    const fixture = await createOrganizationFixture('gateway-status');
    const response = await request(app)
      .get('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .expect(200);
    expect(response.body.gateway).toMatchObject({
      provider: 'mock',
      source: 'platform',
      configured: true,
      missing: [],
      credentials: {},
    });
  });

  it('lets a manager read the status but not change the configuration', async () => {
    const fixture = await createOrganizationFixture('gateway-mgr', 'manager');
    await request(app)
      .get('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .expect(200);
    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .send({ provider: 'chapa', mode: 'test', credentials: {} })
      .expect(403);
    await request(app)
      .delete('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .expect(403);
  });
});

describe('saving organization gateway credentials', () => {
  it('encrypts credentials at rest and answers with masked hints only', async () => {
    const fixture = await createOrganizationFixture('gateway-save');
    const header = authHeader(fixture);

    const saved = await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(header)
      .send({
        provider: 'chapa',
        mode: 'test',
        credentials: { secretKey: CHAPA_SECRET },
      })
      .expect(200);

    // Incomplete on purpose: the response names the missing field instead.
    expect(saved.body.gateway).toMatchObject({
      provider: 'chapa',
      source: 'organization',
      mode: 'test',
      configured: false,
      missing: ['webhookSecret'],
    });
    expect(saved.body.gateway.credentials.secretKey).toEqual({
      configured: true,
      hint: `••••${CHAPA_SECRET.slice(-4)}`,
    });

    // Ciphertext at rest, never plaintext.
    const row = await readGatewaySettingRow(fixture.organizationId);
    const value = row.value as { credentials: Record<string, string> };
    expect(value.credentials.secretKey).toMatch(/^v1:/);
    expect(value.credentials.secretKey).not.toContain(CHAPA_SECRET);

    // Neither the plaintext nor the ciphertext may appear in any response.
    const read = await request(app).get('/api/v1/organizations/payment-gateway').set(header).expect(200);
    expect(JSON.stringify(read.body)).not.toContain(CHAPA_SECRET);
    expect(JSON.stringify(read.body)).not.toContain('v1:');

    // The generic settings payload must not ride along either.
    const settings = await request(app).get('/api/v1/organizations/settings').set(header).expect(200);
    expect(JSON.stringify(settings.body)).not.toContain('payment_gateway');
    expect(JSON.stringify(settings.body)).not.toContain(CHAPA_SECRET);
  });

  it('keeps saved values when a field is omitted and completes later', async () => {
    const fixture = await createOrganizationFixture('gateway-merge');
    const header = authHeader(fixture);

    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(header)
      .send({ provider: 'chapa', mode: 'test', credentials: { secretKey: CHAPA_SECRET } })
      .expect(200);

    const completed = await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(header)
      .send({ provider: 'chapa', mode: 'test', credentials: { webhookSecret: CHAPA_WEBHOOK } })
      .expect(200);

    expect(completed.body.gateway).toMatchObject({ configured: true, missing: [] });
    expect(completed.body.gateway.credentials.secretKey.configured).toBe(true);
    expect(completed.body.gateway.credentials.webhookSecret.hint).toBe(`••••${CHAPA_WEBHOOK.slice(-4)}`);
  });

  it('rejects credential keys the provider does not define', async () => {
    const fixture = await createOrganizationFixture('gateway-unknown');
    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .send({ provider: 'chapa', mode: 'test', credentials: { rootKey: 'nope' } })
      .expect(400);
    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .send({ provider: 'chapa', mode: 'urgent', credentials: {} })
      .expect(400);
  });

  it('records the change in the audit log without any credential value', async () => {
    const fixture = await createOrganizationFixture('gateway-audit');
    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .send({
        provider: 'chapa',
        mode: 'test',
        credentials: { secretKey: CHAPA_SECRET, webhookSecret: CHAPA_WEBHOOK },
      })
      .expect(200);

    const audits = await getPrisma().auditLog.findMany({
      where: { organizationId: fixture.organizationId, entityType: 'PaymentGateway' },
    });
    expect(audits.length).toBe(1);
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(CHAPA_SECRET);
    expect(serialized).not.toContain(CHAPA_WEBHOOK);
    expect(serialized).not.toContain('v1:');
    expect(serialized).toContain('secretKey');
    expect(serialized).toContain('webhookSecret');
  });
});

describe('org-aware provider resolution', () => {
  it('routes the portal payment through the configured real provider and refuses live calls until verified', async () => {
    const { fixture, session } = await setupPortalTenant('gateway-route', '+251911000121');

    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .send({
        provider: 'chapa',
        mode: 'test',
        credentials: { secretKey: CHAPA_SECRET, webhookSecret: CHAPA_WEBHOOK },
      })
      .expect(200);

    // The structure is live: the org adapter is resolved from org credentials.
    // Chapa's adapter itself refuses until the official contract is confirmed.
    const intent = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(session.header)
      .send({})
      .expect(502);
    expect(intent.body.error.code).toBe('PROVIDER_ERROR');
    expect(intent.body.error.message).toContain('chapa');
    expect(intent.body.error.message).toContain('official documentation');
  });

  it('runs the mock demo end to end from an explicit org configuration', async () => {
    const { fixture, session } = await setupPortalTenant('gateway-demo', '+251911000122');

    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(authHeader(fixture))
      .send({ provider: 'mock', mode: 'test', credentials: {} })
      .expect(200);

    const intent = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(session.header)
      .send({})
      .expect(201);
    expect(intent.body.provider).toBe('mock');
    expect(intent.body.redirectUrl).toContain('/portal/pay/mock?ref=');

    const completed = await request(app)
      .post(`/api/v1/portal/payments/${intent.body.providerRef}/complete`)
      .set(session.header)
      .send({})
      .expect(200);
    expect(completed.body.status).toBe('succeeded');

    const payment = await getPrisma().payment.findUniqueOrThrow({ where: { id: intent.body.paymentId } });
    expect(payment.method).toBe('mock');
    expect(payment.provider).toBe('mock');
  });
});

describe('resetting the organization gateway', () => {
  it('returns to the platform default and leaves no row behind', async () => {
    const fixture = await createOrganizationFixture('gateway-reset');
    const header = authHeader(fixture);

    await request(app)
      .put('/api/v1/organizations/payment-gateway')
      .set(header)
      .send({
        provider: 'chapa',
        mode: 'test',
        credentials: { secretKey: CHAPA_SECRET, webhookSecret: CHAPA_WEBHOOK },
      })
      .expect(200);

    const reset = await request(app).delete('/api/v1/organizations/payment-gateway').set(header).expect(200);
    expect(reset.body.gateway).toMatchObject({ provider: 'mock', source: 'platform' });

    await expect(readGatewaySettingRow(fixture.organizationId)).rejects.toThrow();

    // Resetting twice is a no-op, not a 404.
    const again = await request(app).delete('/api/v1/organizations/payment-gateway').set(header).expect(200);
    expect(again.body.gateway.source).toBe('platform');
  });
});
