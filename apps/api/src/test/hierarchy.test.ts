import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture } from './helpers.js';

const app = createApp();
async function managed() {
  const fixture = await createOrganizationFixture();
  await getPrisma().organization.update({
    where: { id: fixture.organizationId },
    data: { portfolioMode: 'managed' },
  });
  const headers = authHeader(fixture);
  const result = await request(app)
    .post('/api/v1/owners')
    .set(headers)
    .send({ name: 'Demo Landlord', managementFeeBps: 750 })
    .expect(201);
  return { ...fixture, headers, owner: result.body.owner };
}
async function property(headers: Record<string, string>, ownerId?: string) {
  const response = await request(app)
    .post('/api/v1/properties')
    .set(headers)
    .send({ name: 'Demo Apartments', type: 'apartment_block', ownerId })
    .expect(201);
  return response.body.property;
}

describe('owner hierarchy', () => {
  it('creates one hidden landlord for legacy self-owned clients and never creates a login', async () => {
    const f = await createOrganizationFixture();
    const h = authHeader(f);
    const a = await property(h);
    const b = await property(h);
    expect(a.ownerId).toBe(b.ownerId);
    expect(await getPrisma().owner.count()).toBe(1);
    expect(await getPrisma().user.count()).toBe(1);
    await request(app).post('/api/v1/owners').set(h).send({ name: 'Another owner' }).expect(422);
    const list = await request(app).get('/api/v1/owners').set(h).expect(200);
    expect(list.body.portfolioMode).toBe('self_owned');
  });

  it('registers managed mode and preserves default self-owned registration', async () => {
    for (const mode of ['managed', undefined]) {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          organizationName: 'Demo Rentals',
          fullName: 'Demo Administrator',
          email: `${mode ?? 'default'}@example.test`,
          password: 'StrongPass123',
          portfolioMode: mode,
        })
        .expect(201);
      const org = await getPrisma().organization.findUniqueOrThrow({
        where: { id: response.body.organization.id },
        include: { owners: true },
      });
      expect(org.portfolioMode).toBe(mode ?? 'self_owned');
      expect(org.owners).toHaveLength(1);
      expect(org.owners[0]?.name).toBe('Demo Administrator');
    }
  });

  it('requires an owner in managed mode; stores basis points without posting money', async () => {
    const f = await managed();
    await request(app)
      .post('/api/v1/properties')
      .set(f.headers)
      .send({ name: 'Demo property', type: 'apartment_block' })
      .expect(422);
    const p = await property(f.headers, f.owner.id);
    expect(p.ownerId).toBe(f.owner.id);
    expect(f.owner.managementFeeBps).toBe(750);
    const updated = await request(app)
      .patch(`/api/v1/owners/${f.owner.id}`)
      .set(f.headers)
      .send({ managementFeeBps: null })
      .expect(200);
    expect(updated.body.owner.managementFeeBps).toBeNull();
    expect(await getPrisma().ledgerEntry.count()).toBe(0);
    expect(await getPrisma().auditLog.count({ where: { entityType: 'Owner' } })).toBe(2);
  });

  it.each([-1, 10001, 7.5, '750'])('rejects invalid management fee %s', async (fee) => {
    const f = await managed();
    await request(app)
      .post('/api/v1/owners')
      .set(f.headers)
      .send({ name: 'Other owner', managementFeeBps: fee })
      .expect(400);
  });

  it('supports optional blocks, renaming and detaching units, and property-wide unit labels', async () => {
    const f = await managed();
    const p = await property(f.headers, f.owner.id);
    const b = await request(app)
      .post('/api/v1/buildings')
      .set(f.headers)
      .send({ propertyId: p.id, name: 'North block' })
      .expect(201);
    await request(app)
      .post('/api/v1/buildings')
      .set(f.headers)
      .send({ propertyId: p.id, name: 'North block' })
      .expect(409);
    const unit = await request(app)
      .post('/api/v1/units')
      .set(f.headers)
      .send({ propertyId: p.id, buildingId: b.body.building.id, label: 'N-101' })
      .expect(201);
    await request(app)
      .post('/api/v1/units')
      .set(f.headers)
      .send({ propertyId: p.id, label: 'N-101' })
      .expect(409);
    await request(app)
      .patch(`/api/v1/buildings/${b.body.building.id}`)
      .set(f.headers)
      .send({ name: 'Block A' })
      .expect(200);
    const list = await request(app).get(`/api/v1/buildings?propertyId=${p.id}`).set(f.headers).expect(200);
    expect(list.body.buildings[0].name).toBe('Block A');
    const detached = await request(app)
      .patch(`/api/v1/units/${unit.body.unit.id}`)
      .set(f.headers)
      .send({ buildingId: null })
      .expect(200);
    expect(detached.body.unit.buildingId).toBeNull();
  });

  it('rejects cross-org owners/blocks and blocks from another property on create and update', async () => {
    const a = await managed();
    const b = await managed();
    const pa = await property(a.headers, a.owner.id);
    const pb = await property(b.headers, b.owner.id);
    await request(app)
      .post('/api/v1/properties')
      .set(a.headers)
      .send({ name: 'Wrong owner', type: 'apartment_block', ownerId: b.owner.id })
      .expect(404);
    await request(app)
      .patch(`/api/v1/properties/${pa.id}`)
      .set(a.headers)
      .send({ ownerId: b.owner.id })
      .expect(404);
    await request(app)
      .patch(`/api/v1/owners/${b.owner.id}`)
      .set(a.headers)
      .send({ name: 'Not allowed' })
      .expect(404);
    const owners = await request(app).get('/api/v1/owners').set(a.headers).expect(200);
    expect(owners.body.owners.map((o: { id: string }) => o.id)).not.toContain(b.owner.id);
    const block = await request(app)
      .post('/api/v1/buildings')
      .set(b.headers)
      .send({ propertyId: pb.id, name: 'Block B' })
      .expect(201);
    await request(app).get(`/api/v1/buildings?propertyId=${pb.id}`).set(a.headers).expect(404);
    await request(app)
      .post('/api/v1/buildings')
      .set(a.headers)
      .send({ propertyId: pb.id, name: 'Foreign' })
      .expect(404);
    await request(app)
      .patch(`/api/v1/buildings/${block.body.building.id}`)
      .set(a.headers)
      .send({ name: 'Foreign' })
      .expect(404);
    const unit = await request(app)
      .post('/api/v1/units')
      .set(a.headers)
      .send({ propertyId: pa.id, label: '101' })
      .expect(201);
    await request(app)
      .patch(`/api/v1/units/${unit.body.unit.id}`)
      .set(a.headers)
      .send({ buildingId: block.body.building.id })
      .expect(404);
    const pa2 = await property(a.headers, a.owner.id);
    const localBlock = await request(app)
      .post('/api/v1/buildings')
      .set(a.headers)
      .send({ propertyId: pa2.id, name: 'Other property' })
      .expect(201);
    await request(app)
      .post('/api/v1/units')
      .set(a.headers)
      .send({ propertyId: pa.id, buildingId: localBlock.body.building.id, label: '102' })
      .expect(404);
    // Database constraints also reject bypassing the API scope checks.
    await expect(
      getPrisma().property.update({ where: { id: pa.id }, data: { ownerId: b.owner.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      getPrisma().unit.update({
        where: { id: unit.body.unit.id },
        data: { buildingId: localBlock.body.building.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces role checks and authentication', async () => {
    await request(app).get('/api/v1/owners').expect(401);
    for (const role of ['tenant', 'maintenance', 'accountant'] as const) {
      const f = await createOrganizationFixture(role, role);
      await request(app)
        .post('/api/v1/owners')
        .set(authHeader(f))
        .send({ name: 'No permission' })
        .expect(403);
    }
    const manager = await createOrganizationFixture('manager', 'manager');
    await getPrisma().organization.update({
      where: { id: manager.organizationId },
      data: { portfolioMode: 'managed' },
    });
    await request(app)
      .post('/api/v1/owners')
      .set(authHeader(manager))
      .send({ name: 'Managed landlord' })
      .expect(201);
  });
});
