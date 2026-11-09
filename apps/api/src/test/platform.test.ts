import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { issueTokens } from '../services/auth.service.js';
import { authHeader, createOrganizationFixture, TEST_PASSWORD, type Fixture } from './helpers.js';

const app = createApp();

/** A fixture whose owner is additionally a platform operator. */
async function platformFixture(label = 'platform'): Promise<{ platform: Fixture; tokens: { accessToken: string } }> {
  const fixture = await createOrganizationFixture(label);
  const prisma = getPrisma();
  await prisma.user.update({ where: { id: fixture.userId }, data: { isPlatformAdmin: true } });
  const tokens = await issueTokens(fixture.userId, fixture.organizationId, 'owner_admin', fixture.email, true);
  return { platform: { ...fixture, accessToken: tokens.accessToken }, tokens: { accessToken: tokens.accessToken } };
}

describe('platform console access', () => {
  it('refuses a normal owner with 403', async () => {
    const f = await createOrganizationFixture('platform-denied');
    await request(app).get('/api/v1/platform/stats').set(authHeader(f)).expect(403);
    await request(app).get('/api/v1/platform/orgs').set(authHeader(f)).expect(403);
    await request(app)
      .post(`/api/v1/platform/orgs/${f.organizationId}/status`)
      .set(authHeader(f))
      .send({ status: 'suspended' })
      .expect(403);
  });

  it('refuses an anonymous caller', async () => {
    await request(app).get('/api/v1/platform/stats').expect(401);
  });

  it('lists organizations with counts and subscription, and reports stats', async () => {
    const { platform } = await platformFixture('platform-list');
    const headers = authHeader(platform);

    const list = await request(app).get('/api/v1/platform/orgs').set(headers).expect(200);
    const own = list.body.organizations.find((o: { id: string }) => o.id === platform.organizationId);
    expect(own).toBeDefined();
    expect(own.counts.members).toBe(1);

    const stats = await request(app).get('/api/v1/platform/stats').set(headers).expect(200);
    expect(stats.body.organizations.total).toBeGreaterThan(0);
    expect(stats.body.portfolio).toHaveProperty('units');
  });
});

describe('organization lifecycle', () => {
  it('suspend blocks the staff API immediately, revokes sessions, blocks login, then activate restores', async () => {
    const { platform } = await platformFixture('platform-cycle');
    const victim = await createOrganizationFixture('platform-victim');
    const victimHeaders = authHeader(victim);

    // Sanity: the victim's API access works before suspension.
    await request(app).get('/api/v1/organizations/settings').set(victimHeaders).expect(200);

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'suspended', reason: 'test suspension' })
      .expect(200);

    // Every subsequent request fails (membership re-read per request)…
    await request(app).get('/api/v1/organizations/settings').set(victimHeaders).expect(403);

    // …every live session of that organization is revoked…
    const revoked = await getPrisma().authSession.findFirst({
      where: { organizationId: victim.organizationId, revokedAt: null },
    });
    expect(revoked).toBeNull();

    // …and login is refused with the lifecycle message.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: victim.email, password: TEST_PASSWORD })
      .expect(403);

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'active' })
      .expect(200);

    // Access works again, but the old (revoked) token needs a fresh one.
    const fresh = await issueTokens(victim.userId, victim.organizationId, 'owner_admin', victim.email, false);
    await request(app)
      .get('/api/v1/organizations/settings')
      .set({ Authorization: `Bearer ${fresh.accessToken}` })
      .expect(200);
  });

  it('closing requires suspension first, and a closed organization cannot change status', async () => {
    const { platform } = await platformFixture('platform-close');
    const victim = await createOrganizationFixture('platform-close-victim');

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'closed' })
      .expect(409);

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'suspended' })
      .expect(200);

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'closed' })
      .expect(200);

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'active' })
      .expect(409);
  });

  it('a suspended organization cannot log tenants in via portal OTP', async () => {
    const { platform } = await platformFixture('platform-portal');
    const victim = await createOrganizationFixture('platform-portal-victim');
    const prisma = getPrisma();

    // An enrolled tenant with a portal user (OTP path needs a live user row)
    // and the phone the request will use — otherwise "not registered" fires
    // before the org-status check and proves nothing.
    const passwordHash = 'x';
    const phone = '+251900000000';
    const tenant = await prisma.tenant.create({
      data: { organizationId: victim.organizationId, fullName: 'Portal Tenant', phone },
    });
    const portalUser = await prisma.user.create({
      data: { email: `portal-${victim.organizationId}@test.local`, fullName: 'Portal Tenant', passwordHash, isActive: true },
    });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { userId: portalUser.id, portalEnabledAt: new Date() } });

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'suspended' })
      .expect(200);

    // The code request answers like "not registered" — no SMS spend, no leak.
    await request(app)
      .post('/api/v1/portal/request-code')
      .send({ phone })
      .expect(404);

    await request(app)
      .post(`/api/v1/platform/orgs/${victim.organizationId}/status`)
      .set(authHeader(platform))
      .send({ status: 'active' })
      .expect(200);

    // Same phone, now active: the request goes through (mock SMS), so the
    // earlier 404 was the suspension, not an unknown number.
    await request(app)
      .post('/api/v1/portal/request-code')
      .send({ phone })
      .expect(200);
  });
});

describe('subscription and unit cap', () => {
  it('sets a subscription and enforces its unit limit on every creation path', async () => {
    const { platform } = await platformFixture('platform-sub');
    const org = await createOrganizationFixture('platform-sub-org');
    const headers = authHeader(org);

    // Portfolio: self-owned mode creates the hidden owner automatically.
    const property = await request(app)
      .post('/api/v1/properties')
      .set(headers)
      .send({ name: 'Cap Apartments', type: 'apartment_block' })
      .expect(201)
      .then((r) => r.body.property);

    await request(app)
      .put(`/api/v1/platform/orgs/${org.organizationId}/subscription`)
      .set(authHeader(platform))
      .send({ plan: 'starter', status: 'active', unitLimit: 2, priceMonthlyMinor: 100000 })
      .expect(200);

    await request(app).post('/api/v1/units').set(headers).send({ propertyId: property.id, label: 'A-1', status: 'vacant' }).expect(201);
    await request(app).post('/api/v1/units').set(headers).send({ propertyId: property.id, label: 'A-2', status: 'vacant' }).expect(201);
    await request(app)
      .post('/api/v1/units')
      .set(headers)
      .send({ propertyId: property.id, label: 'A-3', status: 'vacant' })
      .expect(422);

    // Bulk creation is capped as a batch: nothing is created if any part overflows.
    await request(app)
      .post('/api/v1/units/bulk')
      .set(headers)
      .send({
        propertyId: property.id,
        naming: { pattern: 'B-{n}', start: 1, count: 5 },
        bedrooms: 2,
        bathrooms: 1,
      })
      .expect(422);

    // Raising the cap unblocks creation.
    await request(app)
      .put(`/api/v1/platform/orgs/${org.organizationId}/subscription`)
      .set(authHeader(platform))
      .send({ plan: 'growth', status: 'active' })
      .expect(200);
    await request(app).post('/api/v1/units').set(headers).send({ propertyId: property.id, label: 'A-3', status: 'vacant' }).expect(201);
  });

  it('an organization without a subscription row is unlimited (fixtures stay working)', async () => {
    const org = await createOrganizationFixture('platform-no-sub');
    const headers = authHeader(org);
    const property = await request(app)
      .post('/api/v1/properties')
      .set(headers)
      .send({ name: 'No Cap Apartments', type: 'apartment_block' })
      .expect(201)
      .then((r) => r.body.property);
    for (const label of ['C-1', 'C-2', 'C-3']) {
      await request(app).post('/api/v1/units').set(headers).send({ propertyId: property.id, label, status: 'vacant' }).expect(201);
    }
  });

  it('units list carries the active-lease tenant for the clickable name column', async () => {
    const org = await createOrganizationFixture('platform-unit-tenant');
    const headers = authHeader(org);
    const prisma = getPrisma();

    const property = await request(app)
      .post('/api/v1/properties')
      .set(headers)
      .send({ name: 'Tenant Column Apartments', type: 'apartment_block' })
      .expect(201)
      .then((r) => r.body.property);

    const tenant = await prisma.tenant.create({
      data: { organizationId: org.organizationId, fullName: 'Lease Holder' },
    });
    const unit = await prisma.unit.create({
      data: { organizationId: org.organizationId, propertyId: property.id, label: 'T-1', status: 'occupied' },
    });

    await request(app)
      .post('/api/v1/leases')
      .set(headers)
      .send({
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: '2026-01-01',
        rentAmount: { amountMinor: 500000, currency: 'ETB' },
      })
      .expect(201);

    const units = await request(app).get('/api/v1/units').set(headers).expect(200);
    const listed = units.body.units.find((u: { id: string }) => u.id === unit.id);
    expect(listed.leases?.[0]?.tenant.fullName).toBe('Lease Holder');
  });
});
