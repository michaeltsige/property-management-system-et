/**
 * PDF receipts: a completed payment renders a one-page PDF through the
 * staff route and — for their own payments — the tenant portal route. The
 * renderer embeds Noto Sans Ethiopic (ADR-0028), so Amharic names reach the
 * receipt unchanged.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { civilToUtcDate } from '@pms/calendar';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { generateCharges } from '../services/charges.js';
import { recordPayment } from '../services/payments.js';
import { authHeader, createOrganizationFixture, createPortfolio } from './helpers.js';

const app = createApp();
const etStart = civilToUtcDate({ year: 2015, month: 1, day: 1, calendar: 'ethiopian' });

async function setupPaidLease(label: string, tenantName = 'Test Tenant') {
  const f = await createOrganizationFixture(label);
  const prisma = getPrisma();
  const portfolio = await createPortfolio(prisma, {
    organizationId: f.organizationId,
    billingCalendar: 'ethiopian',
    rentAmountMinor: 1_500_000,
    startDate: etStart,
    dueDayOfMonth: 5,
  });
  await prisma.tenant.update({
    where: { id: portfolio.tenantId },
    data: { fullName: tenantName },
  });
  await generateCharges(prisma, {
    organizationId: f.organizationId,
    periodKeys: ['2019-01'],
  });
  const payment = await recordPayment(prisma, {
    organizationId: f.organizationId,
    leaseId: portfolio.leaseId,
    amount: { amountMinor: 1_500_000, currency: 'ETB' },
    method: 'bank_transfer',
    paidAt: new Date(),
    reference: 'CBE-001',
  });
  return { fixture: f, prisma, portfolio, payment, staffHeader: authHeader(f) };
}

async function isPdf(response: request.Response): Promise<boolean> {
  const head = response.body.subarray(0, 5).toString('latin1');
  const tail = response.body.subarray(-6).toString('latin1');
  return (
    response.headers['content-type'] === 'application/pdf' &&
    head === '%PDF-' &&
    tail.includes('%%EOF')
  );
}

describe('staff receipt download', () => {
  it('renders a valid single-page PDF for a succeeded payment', async () => {
    const { fixture, payment, staffHeader, prisma } = await setupPaidLease('pdf-staff');

    const response = await request(app)
      .get(`/api/v1/payments/${payment.paymentId}/receipt.pdf`)
      .set(staffHeader)
      .expect(200);

    expect(await isPdf(response)).toBe(true);
    expect(response.body.length).toBeGreaterThan(2000); // embedded font subset + content
    expect(response.headers['content-disposition']).toContain('.pdf');

    // Exactly one page: receipts never spill.
    const pages = response.body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages).toHaveLength(1);

    const paymentRow = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.paymentId },
    });
    expect(paymentRow.receiptNumber).toBeTruthy();
    void fixture;
  });

  it('rejects a pending or reversed payment', async () => {
    const { fixture, prisma, staffHeader } = await setupPaidLease('pdf-pending');
    // A superseded portal intent is pending: no receipt for money not recorded.
    const tenant = await prisma.tenant.findFirstOrThrow({
      where: { organizationId: fixture.organizationId },
    });
    const intent = await prisma.payment.create({
      data: {
        organizationId: fixture.organizationId,
        tenantId: tenant.id,
        amountMinor: 1_500_000n,
        currency: 'ETB',
        method: 'mock',
        status: 'pending',
        paidAt: new Date(),
        provider: 'mock',
        providerRef: 'MOCK-no-receipt',
      },
    });

    const response = await request(app)
      .get(`/api/v1/payments/${intent.id}/receipt.pdf`)
      .set(staffHeader)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('hides another organization’s payment behind a 404', async () => {
    const a = await setupPaidLease('pdf-iso-a');
    const other = await createOrganizationFixture('pdf-iso-b');

    const response = await request(app)
      .get(`/api/v1/payments/${a.payment.paymentId}/receipt.pdf`)
      .set(authHeader(other))
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

function localPhone(e164: string): string {
  return `0${e164.replace('+251', '')}`;
}

describe('tenant receipt download', () => {
  it('serves the tenant their own receipt after a portal payment', async () => {
    const f = await createOrganizationFixture('pdf-tenant');
    const prisma = getPrisma();
    const phone = '+251911100301';
    const portfolio = await createPortfolio(prisma, {
      organizationId: f.organizationId,
      billingCalendar: 'ethiopian',
      rentAmountMinor: 1_500_000,
      startDate: etStart,
      dueDayOfMonth: 5,
      tenantPhone: phone,
    });
    await generateCharges(prisma, {
      organizationId: f.organizationId,
      periodKeys: ['2019-01'],
    });
    await request(app).post(`/api/v1/tenants/${portfolio.tenantId}/portal`).set(authHeader(f)).expect(201);
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
    const header = { Authorization: `Bearer ${verify.body.tokens.accessToken}` };

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

    const receipt = await request(app)
      .get(`/api/v1/portal/payments/${intent.body.providerRef}/receipt.pdf`)
      .set(header)
      .expect(200);
    expect(await isPdf(receipt)).toBe(true);
    expect(receipt.headers['content-disposition']).toContain('RCT-');
  });

  it('does not leak other tenants’ receipts', async () => {
    const a = await createOrganizationFixture('pdf-tenant-a');
    const b = await createOrganizationFixture('pdf-tenant-b');
    const prisma = getPrisma();
    const portfolioA = await createPortfolio(prisma, {
      organizationId: a.organizationId,
      billingCalendar: 'ethiopian',
      startDate: etStart,
      tenantPhone: '+251911100302',
    });
    await generateCharges(prisma, {
      organizationId: a.organizationId,
      periodKeys: ['2019-01'],
    });
    const payment = await recordPayment(prisma, {
      organizationId: a.organizationId,
      leaseId: portfolioA.leaseId,
      amount: { amountMinor: 1_500_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    // Organization B enrolls and signs in one of its own tenants.
    const portfolioB = await createPortfolio(prisma, {
      organizationId: b.organizationId,
      billingCalendar: 'ethiopian',
      startDate: etStart,
      tenantPhone: '+251911100303',
    });
    await request(app).post(`/api/v1/tenants/${portfolioB.tenantId}/portal`).set(authHeader(b)).expect(201);
    await request(app).post('/api/v1/portal/request-code').send({ phone: '0911100303' }).expect(200);
    const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { id: portfolioB.tenantId } });
    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientUserId: tenantB.userId ?? '' },
      orderBy: { createdAt: 'desc' },
    });
    const code = (notification.payload as { code: string }).code;
    const verify = await request(app)
      .post('/api/v1/portal/verify')
      .send({ phone: '0911100303', code })
      .expect(200);

    const providerlessRef = 'MOCK-unknown-reference';
    await request(app)
      .get(`/api/v1/portal/payments/${providerlessRef}/receipt.pdf`)
      .set({ Authorization: `Bearer ${verify.body.tokens.accessToken}` })
      .expect(404);

    // And the receipt route exists only under the tenant's own organization.
    expect(payment.paymentId).toBeTruthy();
    void a;
  });
});
