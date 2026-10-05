/**
 * Operations and reporting.
 *
 * Maintenance, documents and notifications are the non-financial half of the
 * product, and reports are what owners actually look at. The tests here check the
 * lifecycle rules (a work order cannot jump from open to completed), the upload
 * guards, and that every report is scoped to one organization.
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

/** 1×1 transparent PNG. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

async function staffedOrganization(label: string) {
  const fixture = await createOrganizationFixture(label);
  const headers = authHeader(fixture);
  const prisma = getPrisma();

  const portfolio = await createPortfolio(prisma, {
    organizationId: fixture.organizationId,
    rentAmountMinor: 1_500_000,
    startDate: etStart,
    dueDayOfMonth: 5,
  });

  const property = await prisma.property.findUniqueOrThrow({ where: { id: portfolio.propertyId } });

  return { fixture, headers, prisma, portfolio, property };
}

describe('maintenance work orders', () => {
  it('runs the lifecycle with a ticket number, vendor assignment and audit trail', async () => {
    const { headers, prisma, portfolio, property, fixture } = await staffedOrganization('wo');

    const created = await request(app)
      .post('/api/v1/work-orders')
      .set(headers)
      .send({
        propertyId: property.id,
        unitId: portfolio.unitId,
        reportedByTenantId: portfolio.tenantId,
        title: 'Kitchen tap is leaking',
        description: 'Water pooling under the sink since Monday.',
        category: 'plumbing',
        priority: 'high',
        estimatedCost: { amountMinor: 250_000, currency: 'ETB' },
      })
      .expect(201);

    const workOrderId = created.body.workOrder.id as string;
    expect(created.body.workOrder.ticketNumber).toMatch(/^WO-\d{4}-\d{6}$/);
    expect(created.body.workOrder.status).toBe('open');

    // Cannot start work without a vendor.
    await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(headers)
      .send({ status: 'in_progress' })
      .expect(400);

    const vendor = await request(app)
      .post('/api/v1/vendors')
      .set(headers)
      .send({
        name: 'Bole Plumbing PLC',
        category: 'plumbing',
        phone: '+251911223344',
        tinNumber: '1234567890',
      })
      .expect(201);

    await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(headers)
      .send({ status: 'assigned', vendorId: vendor.body.vendor.id })
      .expect(200);

    // `assigned` cannot jump straight to `completed`: the work has not started.
    await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(headers)
      .send({ status: 'completed' })
      .expect(409);

    const completed = await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(headers)
      .send({ status: 'in_progress' })
      .expect(200);
    expect(completed.body.workOrder.status).toBe('in_progress');

    const done = await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(headers)
      .send({ status: 'completed', actualCost: { amountMinor: 180_000, currency: 'ETB' } })
      .expect(200);
    expect(done.body.workOrder.status).toBe('completed');
    expect(done.body.workOrder.completedAt).not.toBeNull();

    // Closing a ticket is final.
    await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(headers)
      .send({ status: 'in_progress' })
      .expect(409);

    const list = await request(app).get('/api/v1/work-orders?status=completed').set(headers).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.openCount).toBe(0);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: fixture.organizationId, entityType: 'WorkOrder' },
    });
    expect(audits.map((entry) => entry.action)).toEqual(['create', 'update', 'update', 'update']);
  });

  it('refuses work orders and vendors from another organization', async () => {
    const alpha = await staffedOrganization('wo-alpha');
    const beta = await staffedOrganization('wo-beta');

    const alphaVendor = await request(app)
      .post('/api/v1/vendors')
      .set(alpha.headers)
      .send({ name: 'Alpha Repairs', category: 'electrical' })
      .expect(201);

    // Beta cannot use alpha's property, unit or vendor.
    await request(app)
      .post('/api/v1/work-orders')
      .set(beta.headers)
      .send({ propertyId: alpha.property.id, title: 'Cross-org attempt' })
      .expect(404);

    await request(app)
      .post('/api/v1/work-orders')
      .set(beta.headers)
      .send({ propertyId: beta.property.id, title: 'Cross-org vendor', vendorId: alphaVendor.body.vendor.id })
      .expect(404);

    const alphaWorkOrder = await request(app)
      .post('/api/v1/work-orders')
      .set(alpha.headers)
      .send({ propertyId: alpha.property.id, title: 'Alpha only' })
      .expect(201);

    await request(app)
      .get(`/api/v1/work-orders/${alphaWorkOrder.body.workOrder.id}`)
      .set(beta.headers)
      .expect(404);

    await request(app)
      .patch(`/api/v1/work-orders/${alphaWorkOrder.body.workOrder.id}`)
      .set(beta.headers)
      .send({ status: 'cancelled' })
      .expect(404);
  });
});

describe('documents', () => {
  it('stores an upload, lists it, downloads the same bytes and soft-deletes it', async () => {
    const { headers, portfolio, property, prisma, fixture } = await staffedOrganization('docs');

    const upload = await request(app)
      .post('/api/v1/documents')
      .set(headers)
      .send({
        category: 'lease_agreement',
        title: 'Signed lease — unit A1',
        filename: 'lease-a1.png',
        mimeType: 'image/png',
        dataBase64: TINY_PNG_BASE64,
        propertyId: property.id,
        leaseId: portfolio.leaseId,
      })
      .expect(201);

    const documentId = upload.body.document.id as string;
    expect(upload.body.document.checksumSha256).toHaveLength(64);
    expect(Number(upload.body.document.sizeBytes)).toBeGreaterThan(0);

    const list = await request(app)
      .get('/api/v1/documents?category=lease_agreement')
      .set(headers)
      .expect(200);
    expect(list.body.items).toHaveLength(1);

    const download = await request(app)
      .get(`/api/v1/documents/${documentId}/download`)
      .set(headers)
      .expect(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(Buffer.from(download.body).toString('base64')).toBe(TINY_PNG_BASE64);

    // The download route omits the Authorization header from the client's view of
    // the URL, so the same request without a token must not succeed.
    await request(app).get(`/api/v1/documents/${documentId}/download`).expect(401);

    await request(app).delete(`/api/v1/documents/${documentId}`).set(headers).expect(204);

    // Soft delete: the row survives (audit trail) but disappears from the list.
    const stillThere = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(stillThere.deletedAt).not.toBeNull();

    const afterDelete = await request(app).get('/api/v1/documents').set(headers).expect(200);
    expect(afterDelete.body.items).toHaveLength(0);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: fixture.organizationId, entityType: 'Document' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((entry) => entry.action)).toEqual(['create', 'delete']);
  });

  it('rejects a disallowed file type and a foreign attachment target', async () => {
    const alpha = await staffedOrganization('docs-alpha');
    const beta = await staffedOrganization('docs-beta');

    await request(app)
      .post('/api/v1/documents')
      .set(alpha.headers)
      .send({
        category: 'other',
        filename: 'archive.zip',
        mimeType: 'application/zip',
        dataBase64: TINY_PNG_BASE64,
      })
      .expect(400);

    await request(app)
      .post('/api/v1/documents')
      .set(beta.headers)
      .send({
        category: 'lease_agreement',
        filename: 'lease.png',
        mimeType: 'image/png',
        dataBase64: TINY_PNG_BASE64,
        leaseId: alpha.portfolio.leaseId,
      })
      .expect(404);
  });
});

describe('notifications', () => {
  it('sends through the provider interface and records the attempt', async () => {
    const { headers, portfolio, prisma, fixture } = await staffedOrganization('notify');

    const sent = await request(app)
      .post('/api/v1/notifications/send')
      .set(headers)
      .send({
        templateKey: 'notification.rent_due_soon',
        channel: 'sms',
        tenantId: portfolio.tenantId,
        values: { amount: 'Br 1,500.00', dueDate: 'Meskerem 5, 2019 E.C.' },
      })
      .expect(201);

    expect(sent.body.notification.status).toBe('sent');
    expect(sent.body.body).toContain('1,500.00');
    // The recipient is the tenant's own phone number.
    expect(sent.body.notification.recipientPhone).toBe('+251911000123');

    const list = await request(app).get('/api/v1/notifications').set(headers).expect(200);
    expect(list.body.total).toBe(1);

    // A tenant's language is honoured: the helper tenant is Amharic.
    expect(sent.body.notification.language).toBe('am');

    const stored = await prisma.notification.findFirstOrThrow({
      where: { organizationId: fixture.organizationId },
    });
    expect(stored.payload).toBeTruthy();
  });

  it('refuses an SMS without a phone number and a cross-organization tenant', async () => {
    const alpha = await staffedOrganization('notify-alpha');
    const beta = await staffedOrganization('notify-beta');

    await request(app)
      .post('/api/v1/notifications/send')
      .set(alpha.headers)
      .send({ templateKey: 'notification.rent_overdue', channel: 'sms', values: {} })
      .expect(400);

    await request(app)
      .post('/api/v1/notifications/send')
      .set(beta.headers)
      .send({
        templateKey: 'notification.rent_overdue',
        channel: 'sms',
        tenantId: alpha.portfolio.tenantId,
        values: { amount: 'Br 1.00', dueDate: '2019-01' },
      })
      .expect(404);
  });
});

describe('reports', () => {
  it('summarises the portfolio and money for a period', async () => {
    const { headers, prisma, fixture, portfolio } = await staffedOrganization('report');
    await generateCharges(prisma, { organizationId: fixture.organizationId, periodKeys: ['2019-01'] });
    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 500_000, currency: 'ETB' },
      method: 'cash',
      paidAt: civilToUtcDate({ year: 2019, month: 1, day: 10, calendar: 'ethiopian' }),
    });

    const summary = await request(app)
      .get('/api/v1/reports/summary?periodKey=2019-01&calendar=ethiopian')
      .set(headers)
      .expect(200);

    expect(summary.body.portfolio.properties).toBe(1);
    expect(summary.body.portfolio.units).toBe(1);
    expect(summary.body.portfolio.occupancyRate).toBe(100);
    expect(summary.body.portfolio.activeLeases).toBe(1);
    expect(summary.body.money.expectedMinor).toBe('1500000');
    expect(summary.body.money.collectedMinor).toBe('500000');
    // The January rent was due on Meskerem 5 (15 September 2026) and 1,000,000
    // santim of it is still outstanding. The rest is due but not yet late.
    expect(summary.body.money.arrearsMinor).toBe('1000000');
    expect(summary.body.period.key).toBe('2019-01');
    expect(summary.body.period.calendar).toBe('ethiopian');
  });

  it('produces a rent roll with period totals and outstanding balances', async () => {
    const { headers, prisma, fixture, portfolio } = await staffedOrganization('rentroll');
    await generateCharges(prisma, {
      organizationId: fixture.organizationId,
      periodKeys: ['2019-01', '2019-02'],
    });
    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 1_500_000, currency: 'ETB' },
      method: 'bank_transfer',
      paidAt: new Date(),
    });

    const rentRoll = await request(app)
      .get('/api/v1/reports/rent-roll?periodKey=2019-01')
      .set(headers)
      .expect(200);
    expect(rentRoll.body.rows).toHaveLength(1);

    const row = rentRoll.body.rows[0];
    expect(row.period.key).toBe('2019-01');
    expect(row.periodDueMinor).toBe('1500000');
    expect(row.periodPaidMinor).toBe('1500000'); // oldest-first allocation paid January
    expect(row.outstandingMinor).toBe('1500000'); // February is still owed
    expect(row.periodCharged).toBe(true);
    expect(rentRoll.body.totals.outstandingMinor).toBe('1500000');
    expect(rentRoll.body.totals.leaseCount).toBe(1);
  });

  it('ages arrears into buckets and never mixes organizations', async () => {
    const alpha = await staffedOrganization('arrears-alpha');
    const beta = await staffedOrganization('arrears-beta');

    // A charge due long ago, unpaid.
    await generateCharges(alpha.prisma, {
      organizationId: alpha.fixture.organizationId,
      periodKeys: ['2015-02'],
    });
    await generateCharges(beta.prisma, {
      organizationId: beta.fixture.organizationId,
      periodKeys: ['2015-02'],
    });
    await recordPayment(beta.prisma, {
      organizationId: beta.fixture.organizationId,
      leaseId: beta.portfolio.leaseId,
      amount: { amountMinor: 1_500_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const arrears = await request(app).get('/api/v1/reports/arrears').set(alpha.headers).expect(200);
    expect(arrears.body.rows).toHaveLength(1);
    expect(arrears.body.totalMinor).toBe('1500000');
    // 2015-02 E.C. is around 2022: far more than 90 days late.
    const over90 = arrears.body.buckets.find((bucket: { key: string }) => bucket.key === 'days_90_plus');
    expect(over90.totalMinor).toBe('1500000');

    // Beta paid in full, so beta's arrears report is empty even though alpha's is not.
    const betaArrears = await request(app).get('/api/v1/reports/arrears').set(beta.headers).expect(200);
    expect(betaArrears.body.totalMinor).toBe('0');
  });

  it('reports occupancy and a 13-month collections series for Ethiopian calendars', async () => {
    const { headers, prisma, fixture, portfolio } = await staffedOrganization('occupancy');

    const occupancy = await request(app).get('/api/v1/reports/occupancy').set(headers).expect(200);
    expect(occupancy.body.totals.totalUnits).toBe(1);
    expect(occupancy.body.totals.occupancyRate).toBe(100);

    await generateCharges(prisma, { organizationId: fixture.organizationId, periodKeys: ['2019-01'] });
    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 1_500_000, currency: 'ETB' },
      method: 'telebirr' as never, // manual recording of a provider method is refused…
      paidAt: new Date(),
    }).catch(() => undefined);

    await recordPayment(prisma, {
      organizationId: fixture.organizationId,
      leaseId: portfolio.leaseId,
      amount: { amountMinor: 1_500_000, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
    });

    const collections = await request(app)
      .get('/api/v1/reports/collections?calendar=ethiopian&months=13')
      .set(headers)
      .expect(200);

    expect(collections.body.calendar).toBe('ethiopian');
    expect(collections.body.rows).toHaveLength(13); // 12 × 30 days + Pagume
    const total = collections.body.rows.reduce(
      (sum: number, row: { totalMinor: string }) => sum + Number(row.totalMinor),
      0,
    );
    expect(total).toBe(1_500_000);
    const withPayments = collections.body.rows.filter(
      (row: { paymentCount: number }) => row.paymentCount > 0,
    );
    expect(withPayments).toHaveLength(1);
  });
});
