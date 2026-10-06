import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { authHeader, createOrganizationFixture } from './helpers.js';
const app = createApp();
async function pending(mode = 'self_owned') {
  const f = await createOrganizationFixture();
  await getPrisma().organization.update({ where: { id: f.organizationId }, data: { portfolioMode: mode } });
  await getPrisma().organizationSetting.create({
    data: { organizationId: f.organizationId, key: 'onboardingStatus', value: 'portfolio_pending' },
  });
  return { ...f, h: authHeader(f) };
}
const input = {
  action: 'create',
  property: { name: 'Demo Apartments', type: 'apartment_block' },
  units: { pattern: 'A-{n}', start: 1, count: 3, padding: 3 },
};
describe('onboarding completion', () => {
  it('atomically creates property/units and handles simultaneous replay', async () => {
    const f = await pending();
    const run = () => request(app).post('/api/v1/organizations/onboarding').set(f.h).send(input).expect(200);
    const results = await Promise.all([run(), run()]);
    expect(results.filter((r) => r.body.replayed)).toHaveLength(1);
    expect(await getPrisma().property.count()).toBe(1);
    expect(await getPrisma().unit.count()).toBe(3);
    expect(await getPrisma().auditLog.count({ where: { entityType: 'Unit' } })).toBe(3);
  });
  it('requires a managed landlord and rolls back before creating anything', async () => {
    const f = await pending('managed');
    await request(app).post('/api/v1/organizations/onboarding').set(f.h).send(input).expect(422);
    expect(await getPrisma().property.count()).toBe(0);
    expect(await getPrisma().owner.count()).toBe(0);
    await request(app)
      .post('/api/v1/organizations/onboarding')
      .set(f.h)
      .send({ ...input, ownerName: 'Demo Landlord' })
      .expect(200);
    expect((await getPrisma().owner.findFirstOrThrow()).name).toBe('Demo Landlord');
  });
  it('allows skipping without property or unit creation', async () => {
    const f = await pending();
    const r = await request(app)
      .post('/api/v1/organizations/onboarding')
      .set(f.h)
      .send({ action: 'skip' })
      .expect(200);
    expect(r.body.status).toBe('skipped');
    expect(await getPrisma().property.count()).toBe(0);
    const retry = await request(app)
      .post('/api/v1/organizations/onboarding')
      .set(f.h)
      .send(input)
      .expect(200);
    expect(retry.body.replayed).toBe(true);
  });
  it('rejects invalid patterns and foreign scope overrides, with no changes', async () => {
    const f = await pending();
    await request(app)
      .post('/api/v1/organizations/onboarding')
      .set(f.h)
      .send({ ...input, organizationId: f.organizationId })
      .expect(400);
    await request(app)
      .post('/api/v1/organizations/onboarding')
      .set(f.h)
      .send({ ...input, units: { ...input.units, count: 201 } })
      .expect(400);
    expect(await getPrisma().unit.count()).toBe(0);
  });
  it('enforces owner/admin permission and pending state', async () => {
    await request(app).post('/api/v1/organizations/onboarding').send(input).expect(401);
    const f = await createOrganizationFixture('manager', 'manager');
    await request(app).post('/api/v1/organizations/onboarding').set(authHeader(f)).send(input).expect(403);
    const other = await createOrganizationFixture();
    await request(app)
      .post('/api/v1/organizations/onboarding')
      .set(authHeader(other))
      .send(input)
      .expect(422);
  });
});
