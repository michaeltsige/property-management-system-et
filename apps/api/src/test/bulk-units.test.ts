import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture } from './helpers.js';
const app = createApp();
async function setup() {
  const f = await createOrganizationFixture();
  const h = authHeader(f);
  const p = await request(app)
    .post('/api/v1/properties')
    .set(h)
    .send({ name: 'Demo', type: 'apartment_block' })
    .expect(201);
  return { ...f, h, propertyId: p.body.property.id as string };
}
const naming = { pattern: 'A-{n}', start: 1, count: 3, padding: 3 };
describe('bulk units', () => {
  it('creates vacant units and audit records atomically with an optional block', async () => {
    const f = await setup();
    const b = await request(app)
      .post('/api/v1/buildings')
      .set(f.h)
      .send({ propertyId: f.propertyId, name: 'A' })
      .expect(201);
    const result = await request(app)
      .post('/api/v1/units/bulk')
      .set(f.h)
      .send({ propertyId: f.propertyId, buildingId: b.body.building.id, naming })
      .expect(201);
    expect(result.body.count).toBe(3);
    expect(result.body.units.map((u: { label: string }) => u.label).sort()).toEqual([
      'A-001',
      'A-002',
      'A-003',
    ]);
    expect(result.body.units.every((u: { status: string }) => u.status === 'vacant')).toBe(true);
    expect(
      await getPrisma().auditLog.count({ where: { entityType: 'Unit', organizationId: f.organizationId } }),
    ).toBe(3);
  });
  it('rejects conflicting batches including reserved soft-deleted names without partial writes', async () => {
    const f = await setup();
    await request(app)
      .post('/api/v1/units/bulk')
      .set(f.h)
      .send({ propertyId: f.propertyId, naming })
      .expect(201);
    await getPrisma().unit.updateMany({
      where: { propertyId: f.propertyId },
      data: { deletedAt: new Date() },
    });
    await request(app)
      .post('/api/v1/units/bulk')
      .set(f.h)
      .send({ propertyId: f.propertyId, naming: { ...naming, count: 5 } })
      .expect(409);
    expect(await getPrisma().unit.count()).toBe(3);
  });
  it('handles simultaneous duplicate requests without creating a partial or doubled batch', async () => {
    const f = await setup();
    const run = () =>
      request(app).post('/api/v1/units/bulk').set(f.h).send({ propertyId: f.propertyId, naming });
    const results = await Promise.all([run(), run()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await getPrisma().unit.count()).toBe(3);
    expect(await getPrisma().auditLog.count({ where: { entityType: 'Unit' } })).toBe(3);
  });
  it('rejects cross-org property and wrong-property block, invalid bounds, and unauthorized roles', async () => {
    const a = await setup();
    const b = await setup();
    const block = await request(app)
      .post('/api/v1/buildings')
      .set(b.h)
      .send({ propertyId: b.propertyId, name: 'B' })
      .expect(201);
    await request(app)
      .post('/api/v1/units/bulk')
      .set(a.h)
      .send({ propertyId: b.propertyId, naming })
      .expect(404);
    await request(app)
      .post('/api/v1/units/bulk')
      .set(a.h)
      .send({ propertyId: a.propertyId, buildingId: block.body.building.id, naming })
      .expect(404);
    await request(app)
      .post('/api/v1/units/bulk')
      .set(a.h)
      .send({ propertyId: a.propertyId, naming: { ...naming, count: 201 } })
      .expect(400);
    const accountant = await createOrganizationFixture('accountant', 'accountant');
    await request(app)
      .post('/api/v1/units/bulk')
      .set(authHeader(accountant))
      .send({ propertyId: a.propertyId, naming })
      .expect(403);
    await request(app).post('/api/v1/units/bulk').send({ propertyId: a.propertyId, naming }).expect(401);
    expect(await getPrisma().unit.count()).toBe(0);
  });
});
