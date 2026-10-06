import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CSV_HEADERS } from '@pms/shared';
import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture } from './helpers.js';
const app = createApp();
const csv =
  CSV_HEADERS.tenants.join(',') + '\nDemo Tenant,0911234567,demo@example.test,am,Contact,0911234568\n';
describe('portfolio CSV imports', () => {
  it('validates without writing then imports and replays exact concurrent submissions once', async () => {
    const f = await createOrganizationFixture();
    const h = authHeader(f);
    const dry = await request(app).post('/api/v1/imports/tenants').set(h).send({ csv }).expect(200);
    expect(dry.body.valid).toBe(true);
    expect(await getPrisma().tenant.count()).toBe(0);
    const run = () =>
      request(app).post('/api/v1/imports/tenants').set(h).send({ csv, dryRun: false }).expect(200);
    const results = await Promise.all([run(), run()]);
    expect(results.map((r) => r.body.imported).sort()).toEqual([0, 1]);
    expect(await getPrisma().tenant.count()).toBe(1);
    expect(await getPrisma().importBatch.count()).toBe(1);
    expect(await getPrisma().auditLog.count({ where: { entityType: 'Tenant' } })).toBe(1);
    expect((await getPrisma().tenant.findFirstOrThrow()).phone).toBe('+251911234567');
  });
  it('rejects the entire file with row errors, no source values echoed', async () => {
    const f = await createOrganizationFixture();
    const r = await request(app)
      .post('/api/v1/imports/tenants')
      .set(authHeader(f))
      .send({ csv: csv + 'Other,secret-invalid-phone,,,Contact,\n', dryRun: false })
      .expect(200);
    expect(r.body.valid).toBe(false);
    expect(r.body.errors[0].row).toBe(3);
    expect(JSON.stringify(r.body)).not.toContain('secret-invalid-phone');
    expect(await getPrisma().tenant.count()).toBe(0);
    expect(await getPrisma().importBatch.count()).toBe(0);
  });
  it('reports header/quote errors and detects duplicate rows and existing tenants', async () => {
    const f = await createOrganizationFixture();
    const h = authHeader(f);
    for (const bad of ['fullName,idNumber\nDemo,ID123', 'fullName\n"open', csv + csv.split('\n')[1] + '\n']) {
      const r = await request(app)
        .post('/api/v1/imports/tenants')
        .set(h)
        .send({ csv: bad, dryRun: false })
        .expect(200);
      expect(r.body.valid).toBe(false);
    }
    await request(app).post('/api/v1/imports/tenants').set(h).send({ csv, dryRun: false }).expect(200);
    const r = await request(app)
      .post('/api/v1/imports/tenants')
      .set(h)
      .send({ csv: csv.replace('Demo Tenant', 'DEMO TENANT'), dryRun: false })
      .expect(200);
    expect(r.body.valid).toBe(false);
    expect(await getPrisma().tenant.count()).toBe(1);
  });
  it('imports scoped units with integer rent and reports duplicate labels', async () => {
    const f = await createOrganizationFixture();
    const h = authHeader(f);
    const p = await request(app)
      .post('/api/v1/properties')
      .set(h)
      .send({ name: 'Demo', type: 'apartment_block' })
      .expect(201);
    const propertyId = p.body.property.id;
    const unitCsv = CSV_HEADERS.units.join(',') + '\nA-01,1,2,1,1500000\n';
    const r = await request(app)
      .post('/api/v1/imports/units')
      .set(h)
      .send({ csv: unitCsv, propertyId, dryRun: false })
      .expect(200);
    expect(r.body.imported).toBe(1);
    expect((await getPrisma().unit.findFirstOrThrow()).marketRentMinor).toBe(1500000n);
    const conflict = await request(app)
      .post('/api/v1/imports/units')
      .set(h)
      .send({ csv: unitCsv + 'A-02,1,2,1,1500000\n', propertyId, dryRun: false })
      .expect(200);
    expect(conflict.body.errors[0]).toMatchObject({ row: 2, field: 'label' });
    expect(await getPrisma().unit.count()).toBe(1);
    const other = await createOrganizationFixture();
    await request(app)
      .post('/api/v1/imports/units')
      .set(authHeader(other))
      .send({ csv: unitCsv, propertyId })
      .expect(404);
  });
  it('enforces RBAC, bounds and organization isolation of import replays', async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    for (const f of [a, b]) {
      const r = await request(app)
        .post('/api/v1/imports/tenants')
        .set(authHeader(f))
        .send({ csv, dryRun: false })
        .expect(200);
      expect(r.body.imported).toBe(1);
    }
    const f = await createOrganizationFixture('accountant', 'accountant');
    await request(app).post('/api/v1/imports/tenants').set(authHeader(f)).send({ csv }).expect(403);
    await request(app).post('/api/v1/imports/tenants').send({ csv }).expect(401);
    await request(app)
      .post('/api/v1/imports/tenants')
      .set(authHeader(a))
      .send({ csv: 'x'.repeat(262145) })
      .expect(400);
  });
});

it('rejects wrong-property blocks and reports normalized in-file duplicate tenants', async () => {
  const f = await createOrganizationFixture();
  const h = authHeader(f);
  const makeProperty = () =>
    request(app)
      .post('/api/v1/properties')
      .set(h)
      .send({ name: 'Demo property', type: 'apartment_block' })
      .expect(201);
  const p1 = await makeProperty();
  const p2 = await makeProperty();
  const b = await request(app)
    .post('/api/v1/buildings')
    .set(h)
    .send({ propertyId: p2.body.property.id, name: 'Block' })
    .expect(201);
  await request(app)
    .post('/api/v1/imports/units')
    .set(h)
    .send({
      csv: CSV_HEADERS.units.join(',') + '\nA-01,,,,\n',
      propertyId: p1.body.property.id,
      buildingId: b.body.building.id,
      dryRun: false,
    })
    .expect(404);
  const duplicate = csv + 'DEMO TENANT,+251911234567,DEMO@EXAMPLE.TEST,am,Contact,0911234568\n';
  const r = await request(app)
    .post('/api/v1/imports/tenants')
    .set(h)
    .send({ csv: duplicate, dryRun: false })
    .expect(200);
  expect(r.body.errors).toContainEqual({
    row: 3,
    field: 'fullName',
    message: 'Duplicate name/contact combination; review existing tenant',
  });
  expect(await getPrisma().tenant.count()).toBe(0);
});
