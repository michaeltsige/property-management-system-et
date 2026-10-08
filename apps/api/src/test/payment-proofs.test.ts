/**
 * Proofs of payment: the tenant uploads a bank slip from the portal, staff
 * review it. Approving records the payment through the same transactional core
 * as manual recording (oldest-first allocation, ledger, receipt), so the books
 * stay single-sourced. The file itself is a regular Document.
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

function localPhone(e164: string): string {
  return `0${e164.replace('+251', '')}`;
}

async function otpLogin(phone: string): Promise<{ token: string; tenantId: string }> {
  await request(app).post('/api/v1/portal/request-code').send({ phone: localPhone(phone) }).expect(200);
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { phone } });
  const notification = await prisma.notification.findFirstOrThrow({
    where: { recipientUserId: tenant.userId ?? '' },
    orderBy: { createdAt: 'desc' },
  });
  const code = (notification.payload as { code: string }).code;
  const verify = await request(app)
    .post('/api/v1/portal/verify')
    .send({ phone: localPhone(phone), code })
    .expect(200);
  return { token: verify.body.tokens.accessToken, tenantId: tenant.id };
}

/** Org + lease + two periods of charges, with the tenant signed in to the portal. */
async function setupPortalTenant(label: string, phone: string) {
  const f = await createOrganizationFixture(label);
  const prisma = getPrisma();
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
    periodKeys: ['2019-01', '2019-02'],
  });
  await request(app).post(`/api/v1/tenants/${portfolio.tenantId}/portal`).set(authHeader(f)).expect(201);
  const session = await otpLogin(phone);
  return {
    fixture: f,
    prisma,
    portfolio,
    header: { Authorization: `Bearer ${session.token}` },
    staffHeader: authHeader(f),
  };
}

const pngBase64 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f030005fe02fea72d1e480000000049454e44ae426082',
  'hex',
).toString('base64');

function uploadBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: { amountMinor: 1_500_000, currency: 'ETB' },
    method: 'bank_transfer',
    reference: 'CBE-99881',
    filename: 'slip.png',
    mimeType: 'image/png',
    dataBase64: pngBase64,
    ...overrides,
  };
}

describe('uploading a proof of payment', () => {
  it('stores the file as a payment_proof document and a pending proof', async () => {
    const { header, prisma, portfolio } = await setupPortalTenant('proof-upload', '+251911100201');

    const response = await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(header)
      .send(uploadBody())
      .expect(201);

    expect(response.body.proof.status).toBe('pending');
    expect(response.body.proof.amountMinor).toBe('1500000');
    expect(response.body.proof.method).toBe('bank_transfer');
    expect(response.body.proof.document.mimeType).toBe('image/png');
    expect(response.body.proof.leaseId).toBe(portfolio.leaseId);

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: response.body.proof.documentId },
    });
    expect(document.category).toBe('payment_proof');
    expect(document.tenantId).toBe(portfolio.tenantId);
  });

  it('rejects a currency mismatch and an empty file', async () => {
    const { header } = await setupPortalTenant('proof-bad', '+251911100202');

    await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(header)
      .send(uploadBody({ amount: { amountMinor: 1_500_000, currency: 'USD' } }))
      .expect(422);

    await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(header)
      .send(uploadBody({ dataBase64: '' }))
      .expect(400);
  });

  it('refuses provider methods — only manual methods carry proofs', async () => {
    const { header } = await setupPortalTenant('proof-provider', '+251911100203');

    await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(header)
      .send(uploadBody({ method: 'telebirr' }))
      .expect(400);
  });

  it('lists only the tenant’s own proofs', async () => {
    const a = await setupPortalTenant('proof-list-a', '+251911100204');
    const b = await setupPortalTenant('proof-list-b', '+251911100205');

    await request(app).post('/api/v1/portal/payment-proofs').set(a.header).send(uploadBody()).expect(201);

    const own = await request(app).get('/api/v1/portal/payment-proofs').set(a.header).expect(200);
    expect(own.body.items).toHaveLength(1);

    const other = await request(app).get('/api/v1/portal/payment-proofs').set(b.header).expect(200);
    expect(other.body.items).toHaveLength(0);

    // Staff see it in the review queue.
    const queue = await request(app)
      .get('/api/v1/payments/proofs?status=pending')
      .set(a.staffHeader)
      .expect(200);
    expect(queue.body.total).toBe(1);
    expect(queue.body.items[0]!.tenant.fullName).toBe('Test Tenant');
  });
});

describe('reviewing a proof of payment', () => {
  it('approval records the payment, links the receipt and settles charges', async () => {
    const { header, staffHeader, prisma, portfolio } = await setupPortalTenant(
      'proof-approve',
      '+251911100206',
    );

    const proof = await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(header)
      .send(uploadBody())
      .expect(201);

    const approved = await request(app)
      .post(`/api/v1/payments/proofs/${proof.body.proof.id}/approve`)
      .set(staffHeader)
      .send({ notes: 'Slip verified with the bank' })
      .expect(200);

    expect(approved.body.proof.status).toBe('approved');
    expect(approved.body.payment.receiptNumber).toMatch(/^RCT-\d{4}-\d{6}$/);
    expect(approved.body.payment.allocatedMinor).toBe('1500000');

    const proofRow = await prisma.paymentProof.findUniqueOrThrow({
      where: { id: proof.body.proof.id },
    });
    expect(proofRow.paymentId).toBe(approved.body.payment.paymentId);
    expect(proofRow.reviewedById).not.toBeNull();

    // One period settled, exactly like a staff-recorded payment.
    const charges = await prisma.charge.findMany({
      where: { leaseId: portfolio.leaseId },
      orderBy: { dueDate: 'asc' },
    });
    expect(charges[0]!.status).toBe('paid');
    expect(charges[1]!.status).toBe('open');

    const ledger = await prisma.ledgerEntry.findFirstOrThrow({
      where: { paymentId: approved.body.payment.paymentId },
    });
    expect(ledger.amountMinor).toBe(-1_500_000n);
  });

  it('rejects a proof with a reason and never records money', async () => {
    const { header, staffHeader, prisma } = await setupPortalTenant('proof-reject', '+251911100207');

    const proof = await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(header)
      .send(uploadBody())
      .expect(201);

    const rejected = await request(app)
      .post(`/api/v1/payments/proofs/${proof.body.proof.id}/reject`)
      .set(staffHeader)
      .send({ reason: 'The slip is not readable' })
      .expect(200);
    expect(rejected.body.proof.status).toBe('rejected');
    expect(rejected.body.proof.reviewNotes).toBe('The slip is not readable');

    expect(await prisma.payment.count({ where: { tenantId: proof.body.proof.tenantId } })).toBe(0);
    expect(await prisma.paymentAllocation.count()).toBe(0);
  });

  it('refuses a second review and a review by another organization', async () => {
    const a = await setupPortalTenant('proof-twice', '+251911100208');
    const other = await createOrganizationFixture('proof-other-org');

    const proof = await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(a.header)
      .send(uploadBody())
      .expect(201);

    await request(app)
      .post(`/api/v1/payments/proofs/${proof.body.proof.id}/approve`)
      .set(authHeader(other))
      .send({})
      .expect(404);

    await request(app)
      .post(`/api/v1/payments/proofs/${proof.body.proof.id}/approve`)
      .set(a.staffHeader)
      .send({})
      .expect(200);

    const again = await request(app)
      .post(`/api/v1/payments/proofs/${proof.body.proof.id}/approve`)
      .set(a.staffHeader)
      .send({})
      .expect(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('lets the tenant download their own slip but nobody else’s', async () => {
    const a = await setupPortalTenant('proof-download', '+251911100209');
    const b = await setupPortalTenant('proof-download-b', '+251911100210');

    const proof = await request(app)
      .post('/api/v1/portal/payment-proofs')
      .set(a.header)
      .send(uploadBody())
      .expect(201);

    const own = await request(app)
      .get(`/api/v1/portal/payment-proofs/${proof.body.proof.id}/document`)
      .set(a.header)
      .expect(200);
    expect(own.headers['content-type']).toBe('image/png');
    expect(Buffer.from(own.body).toString('base64')).toBe(pngBase64);

    await request(app)
      .get(`/api/v1/portal/payment-proofs/${proof.body.proof.id}/document`)
      .set(b.header)
      .expect(404);
  });
});
