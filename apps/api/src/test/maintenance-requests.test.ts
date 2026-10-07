import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture, createPortfolio, utcDate } from './helpers.js';

const app = createApp();

/** An org with an active lease whose tenant is enrolled in the portal and signed in. */
async function setup() {
  const f = await createOrganizationFixture();
  const h = authHeader(f);
  const portfolio = await createPortfolio(getPrisma(), {
    organizationId: f.organizationId,
    startDate: utcDate(2026, 1, 1),
  });
  await request(app).post(`/api/v1/tenants/${portfolio.tenantId}/portal`).set(h).expect(201);
  await request(app).post('/api/v1/portal/request-code').send({ phone: '0911000123' }).expect(200);
  const tenant = await getPrisma().tenant.findUniqueOrThrow({ where: { id: portfolio.tenantId } });
  const notification = await getPrisma().notification.findFirstOrThrow({
    where: { recipientUserId: tenant.userId ?? '' },
    orderBy: { createdAt: 'desc' },
  });
  const code = (notification.payload as { code: string }).code;
  const login = await request(app)
    .post('/api/v1/portal/verify')
    .send({ phone: '0911000123', code })
    .expect(200);
  return {
    fixture: f,
    staffHeaders: h,
    portfolio,
    tenantHeaders: { Authorization: `Bearer ${login.body.tokens.accessToken as string}` },
  };
}

async function fileRequest(
  tenantHeaders: Record<string, string>,
  title = 'Water is leaking under the kitchen sink',
) {
  return request(app)
    .post('/api/v1/portal/maintenance-requests')
    .set(tenantHeaders)
    .send({ title, description: 'Started this morning after the rain.' })
    .expect(201);
}

describe('portal maintenance requests', () => {
  it('lets a tenant file a request against their active lease, and staff see the origin', async () => {
    const { staffHeaders, portfolio, tenantHeaders } = await setup();

    const tooShort = await request(app)
      .post('/api/v1/portal/maintenance-requests')
      .set(tenantHeaders)
      .send({ title: 'tap' })
      .expect(400);
    expect(tooShort.status).toBe(400);

    const created = await fileRequest(tenantHeaders);
    expect(created.body.workOrder.status).toBe('open');
    expect(created.body.workOrder.tenantId).toBe(portfolio.tenantId);
    expect(created.body.workOrder.unitId).toBe(portfolio.unitId);
    expect(created.body.workOrder.propertyId).toBe(portfolio.propertyId);
    expect(created.body.workOrder.ticketNumber).toMatch(/^WO-\d{4}-\d{6}$/);

    const mine = await request(app).get('/api/v1/portal/maintenance-requests').set(tenantHeaders).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].title).toBe('Water is leaking under the kitchen sink');

    // Staff see who reported it on their board.
    const board = await request(app).get('/api/v1/work-orders').set(staffHeaders).expect(200);
    expect(board.body.items).toHaveLength(1);
    expect(board.body.items[0].tenant.fullName).toBe('Test Tenant');
  });

  it('rejects tenants without an active lease', async () => {
    const f = await createOrganizationFixture();
    const tenant = await request(app)
      .post('/api/v1/tenants')
      .set(authHeader(f))
      .send({ fullName: 'No Lease Tenant', phone: '0911555666' })
      .expect(201);
    await request(app).post(`/api/v1/tenants/${tenant.body.tenant.id}/portal`).set(authHeader(f)).expect(201);
    await request(app).post('/api/v1/portal/request-code').send({ phone: '0911555666' }).expect(200);
    const row = await getPrisma().tenant.findUniqueOrThrow({ where: { id: tenant.body.tenant.id } });
    const notification = await getPrisma().notification.findFirstOrThrow({
      where: { recipientUserId: row.userId ?? '' },
      orderBy: { createdAt: 'desc' },
    });
    const code = (notification.payload as { code: string }).code;
    const login = await request(app)
      .post('/api/v1/portal/verify')
      .send({ phone: '0911555666', code })
      .expect(200);
    const response = await request(app)
      .post('/api/v1/portal/maintenance-requests')
      .set({ Authorization: `Bearer ${login.body.tokens.accessToken as string}` })
      .send({ title: 'Something is broken somewhere' })
      .expect(400);
    expect(response.body.error.code).toBeDefined();
  });
});

describe('work order notes', () => {
  it('hides internal notes from tenants while staff see the whole thread', async () => {
    const { staffHeaders, tenantHeaders } = await setup();
    const created = await fileRequest(tenantHeaders);
    const workOrderId = created.body.workOrder.id as string;

    await request(app)
      .post(`/api/v1/work-orders/${workOrderId}/notes`)
      .set(staffHeaders)
      .send({ body: 'Vendor will visit Thursday morning.', internal: true })
      .expect(201);
    await request(app)
      .post(`/api/v1/work-orders/${workOrderId}/notes`)
      .set(staffHeaders)
      .send({ body: 'We scheduled a visit for Thursday.' })
      .expect(201);

    const detail = await request(app).get(`/api/v1/work-orders/${workOrderId}`).set(staffHeaders).expect(200);
    expect(detail.body.workOrder.notes).toHaveLength(2);

    const mine = await request(app).get('/api/v1/portal/maintenance-requests').set(tenantHeaders).expect(200);
    const notes = mine.body.items[0].notes as Array<{ body: string; internal: boolean }>;
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('We scheduled a visit for Thursday.');
    expect(notes[0].internal).toBe(false);
  });

  it('requires a tenant-visible closing note to complete or cancel', async () => {
    const { fixture, staffHeaders, tenantHeaders } = await setup();
    const created = await fileRequest(tenantHeaders);
    const workOrderId = created.body.workOrder.id as string;

    await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(staffHeaders)
      .send({ status: 'cancelled' })
      .expect(400);

    const cancelled = await request(app)
      .patch(`/api/v1/work-orders/${workOrderId}`)
      .set(staffHeaders)
      .send({ status: 'cancelled', resolutionNotes: 'Duplicate of an earlier request.' })
      .expect(200);
    expect(cancelled.body.workOrder.status).toBe('cancelled');

    // The tenant sees why it was closed.
    const mine = await request(app).get('/api/v1/portal/maintenance-requests').set(tenantHeaders).expect(200);
    const note = (mine.body.items[0].notes as Array<{ body: string }>).at(0);
    expect(note?.body).toBe('Duplicate of an earlier request.');

    // Full lifecycle: open → assigned → in progress → completed, with a note.
    const second = await fileRequest(tenantHeaders, 'The bedroom light switch sparks');
    const vendor = await request(app)
      .post('/api/v1/vendors')
      .set(staffHeaders)
      .send({ name: 'Bole Plumbing PLC', category: 'plumbing' })
      .expect(201);
    const vendorId = vendor.body.vendor.id as string;

    await request(app)
      .patch(`/api/v1/work-orders/${second.body.workOrder.id}`)
      .set(staffHeaders)
      .send({ status: 'assigned', vendorId })
      .expect(200);
    await request(app)
      .patch(`/api/v1/work-orders/${second.body.workOrder.id}`)
      .set(staffHeaders)
      .send({ status: 'in_progress' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/work-orders/${second.body.workOrder.id}`)
      .set(staffHeaders)
      .send({ status: 'completed' })
      .expect(400);

    const done = await request(app)
      .patch(`/api/v1/work-orders/${second.body.workOrder.id}`)
      .set(staffHeaders)
      .send({ status: 'completed', resolutionNotes: 'Replaced the switch and tested the circuit.' })
      .expect(200);
    expect(done.body.workOrder.status).toBe('completed');
    expect(done.body.workOrder.completedAt).not.toBeNull();

    const board = await request(app)
      .get('/api/v1/work-orders?status=completed')
      .set(staffHeaders)
      .expect(200);
    expect(board.body.items).toHaveLength(1);
    expect(await getPrisma().workOrderNote.count({ where: { organizationId: fixture.organizationId } })).toBe(
      2,
    );
  });
});
