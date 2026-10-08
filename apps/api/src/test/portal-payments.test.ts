/**
 * Tenant portal payments: initiate a provider payment, complete it, and see the
 * money land in the ledger with oldest-first allocation.
 *
 * The mock provider is the active adapter in tests, so the whole loop — intent,
 * redirect, provider confirmation, receipt — runs without external services.
 * The API re-verifies every completion with the provider, so no test can record
 * money by asking twice.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { civilToUtcDate } from '@pms/calendar';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { generateCharges } from '../services/charges.js';
import { authHeader, createOrganizationFixture, createPortfolio } from './helpers.js';

const app = createApp();
const etStart = civilToUtcDate({ year: 2015, month: 1, day: 1, calendar: 'ethiopian' });

interface PortalSession {
  organizationId: string;
  tenantId: string;
  leaseId: string;
  token: string;
}

/** Org + portfolio + two generated periods, with the tenant signed in to the portal. */
async function setupPortalTenant(label: string, phone: string, rentMinor = 1_500_000) {
  const f = await createOrganizationFixture(label);
  const prisma = getPrisma();
  const portfolio = await createPortfolio(prisma, {
    organizationId: f.organizationId,
    billingCalendar: 'ethiopian',
    rentAmountMinor: rentMinor,
    startDate: etStart,
    dueDayOfMonth: 5,
    tenantPhone: phone,
  });
  await generateCharges(prisma, {
    organizationId: f.organizationId,
    periodKeys: ['2019-01', '2019-02'],
  });

  const enroll = await request(app)
    .post(`/api/v1/tenants/${portfolio.tenantId}/portal`)
    .set(authHeader(f))
    .expect(201);
  expect(enroll.body.enrolled).toBe(true);

  await request(app).post('/api/v1/portal/request-code').send({ phone: localPhone(phone) }).expect(200);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: portfolio.tenantId } });
  const notification = await prisma.notification.findFirstOrThrow({
    where: { recipientUserId: tenant.userId ?? '' },
    orderBy: { createdAt: 'desc' },
  });
  const code = (notification.payload as { code: string }).code;
  const verify = await request(app)
    .post('/api/v1/portal/verify')
    .send({ phone: localPhone(phone), code })
    .expect(200);

  const session: PortalSession = {
    organizationId: f.organizationId,
    tenantId: portfolio.tenantId,
    leaseId: portfolio.leaseId,
    token: verify.body.tokens.accessToken,
  };
  return { fixture: f, prisma, portfolio, session, header: { Authorization: `Bearer ${session.token}` } };
}

function localPhone(e164: string): string {
  // '+251911000123' -> '0911000123', the local form the OTP endpoints accept.
  return `0${e164.replace('+251', '')}`;
}

describe('initiating a portal payment', () => {
  it('creates a pending attempt with a mock checkout redirect and supersedes older ones', async () => {
    const { header, prisma, session } = await setupPortalTenant('pay-init', '+251911000101');

    const first = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({})
      .expect(201);
    expect(first.body.provider).toBe('mock');
    expect(first.body.status).toBe('pending');
    expect(first.body.amountMinor).toBe('3000000'); // two periods of 1,500,000
    expect(first.body.currency).toBe('ETB');
    expect(first.body.providerRef).toMatch(/^MOCK-/);
    expect(first.body.redirectUrl).toContain('/portal/pay/mock?ref=');

    const firstRow = await prisma.payment.findUniqueOrThrow({ where: { id: first.body.paymentId } });
    expect(firstRow.status).toBe('pending');
    expect(firstRow.method).toBe('mock');
    expect(firstRow.leaseId).toBe(session.leaseId);

    // A second attempt supersedes the first: one live intent per tenant.
    const second = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({})
      .expect(201);
    expect(second.body.providerRef).not.toBe(first.body.providerRef);
    const superseded = await prisma.payment.findUniqueOrThrow({ where: { id: first.body.paymentId } });
    expect(superseded.status).toBe('failed');
    const pendingCount = await prisma.payment.count({
      where: { organizationId: session.organizationId, tenantId: session.tenantId, status: 'pending' },
    });
    expect(pendingCount).toBe(1);
  });

  it('accepts a partial amount but refuses more than the outstanding balance', async () => {
    const { header } = await setupPortalTenant('pay-partial-init', '+251911000102');

    const partial = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({ amountMinor: '900000' })
      .expect(201);
    expect(partial.body.amountMinor).toBe('900000');

    await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({ amountMinor: '4000000' })
      .expect(422);
  });

  it('refuses to start a payment when nothing is due', async () => {
    const { fixture, header, prisma } = await setupPortalTenant('pay-none', '+251911000103');
    // Settle everything through the normal staff path, then retry the portal.
    const charges = await prisma.charge.findMany({
      where: { organizationId: fixture.organizationId },
      select: { amountMinor: true },
    });
    const total = charges.reduce((sum, c) => sum + c.amountMinor, 0n);
    const { recordPayment } = await import('../services/payments.js');
    const leases = await prisma.lease.findMany({
      where: { organizationId: fixture.organizationId },
      select: { id: true },
    });
    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: leases[0]!.id,
      amount: { amountMinor: Number(total), currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const response = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({})
      .expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE');
    expect(response.body.error.message).toMatch(/Nothing is due/);
  });
});

describe('completing a portal payment', () => {
  it('verifies with the provider, allocates oldest-first and posts the ledger entry', async () => {
    const { header, prisma, session } = await setupPortalTenant('pay-complete', '+251911000104');

    const intent = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({})
      .expect(201);

    const done = await request(app)
      .post(`/api/v1/portal/payments/${intent.body.providerRef}/complete`)
      .set(header)
      .send({})
      .expect(200);
    expect(done.body.status).toBe('succeeded');
    expect(done.body.receiptNumber).toMatch(/^RCT-\d{4}-\d{6}$/);
    expect(done.body.allocatedMinor).toBe('3000000');
    expect(done.body.unallocatedMinor).toBe('0');

    const charges = await prisma.charge.findMany({
      where: { organizationId: session.organizationId, tenantId: session.tenantId },
      orderBy: { dueDate: 'asc' },
    });
    expect(charges.map((c) => c.status)).toEqual(['paid', 'paid']);

    const ledger = await prisma.ledgerEntry.findFirstOrThrow({
      where: { organizationId: session.organizationId, paymentId: done.body.paymentId },
    });
    expect(ledger.amountMinor).toBe(-3_000_000n);
    expect(ledger.kind).toBe('payment');

    // The portal balance reflects the payment immediately.
    const me = await request(app).get('/api/v1/portal/me').set(header).expect(200);
    expect(me.body.dueMinor).toBe('0');
  });

  it('supports a partial payment and leaves the charge partially paid', async () => {
    const { header, prisma, session } = await setupPortalTenant('pay-part-complete', '+251911000105');

    const intent = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({ amountMinor: '900000' })
      .expect(201);
    const done = await request(app)
      .post(`/api/v1/portal/payments/${intent.body.providerRef}/complete`)
      .set(header)
      .send({})
      .expect(200);
    expect(done.body.allocatedMinor).toBe('900000');

    const charges = await prisma.charge.findMany({
      where: { organizationId: session.organizationId, tenantId: session.tenantId },
      orderBy: { dueDate: 'asc' },
    });
    expect(charges[0]!.status).toBe('partial');
    expect(charges[0]!.paidMinor).toBe(900_000n);
    expect(charges[1]!.status).toBe('open');
  });

  it('rejects a second completion of the same attempt', async () => {
    const { header } = await setupPortalTenant('pay-twice', '+251911000106');

    const intent = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({})
      .expect(201);
    await request(app)
      .post(`/api/v1/portal/payments/${intent.body.providerRef}/complete`)
      .set(header)
      .send({})
      .expect(200);
    const again = await request(app)
      .post(`/api/v1/portal/payments/${intent.body.providerRef}/complete`)
      .set(header)
      .send({})
      .expect(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('hides other tenants and organizations attempts behind a 404', async () => {
    const a = await setupPortalTenant('pay-iso-a', '+251911000107');
    const b = await setupPortalTenant('pay-iso-b', '+251911000108');

    const intentA = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(a.header)
      .send({})
      .expect(201);

    // Another organization's tenant cannot see or complete it.
    await request(app)
      .get(`/api/v1/portal/payments/${intentA.body.providerRef}`)
      .set(b.header)
      .expect(404);
    await request(app)
      .post(`/api/v1/portal/payments/${intentA.body.providerRef}/complete`)
      .set(b.header)
      .send({})
      .expect(404);

    // An unknown reference is a 404 as well.
    await request(app)
      .post('/api/v1/portal/payments/MOCK-does-not-exist/complete')
      .set(a.header)
      .send({})
      .expect(404);
  });

  it('exposes the pending attempt to its own tenant', async () => {
    const { header } = await setupPortalTenant('pay-view', '+251911000109');

    const intent = await request(app)
      .post('/api/v1/portal/payments/initiate')
      .set(header)
      .send({})
      .expect(201);
    const view = await request(app)
      .get(`/api/v1/portal/payments/${intent.body.providerRef}`)
      .set(header)
      .expect(200);
    expect(view.body.amountMinor).toBe('3000000');
    expect(view.body.status).toBe('pending');
    expect(view.body.provider).toBe('mock');
  });
});
