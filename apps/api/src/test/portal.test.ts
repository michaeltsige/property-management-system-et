import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { mockSmsProvider } from '../providers/sms/index.js';
import { authHeader, createOrganizationFixture } from './helpers.js';
const app = createApp();

async function setupTenant() {
  const f = await createOrganizationFixture();
  const tenant = await request(app)
    .post('/api/v1/tenants')
    .set(f.h ?? authHeader(f))
    .send({ fullName: 'Demo Tenant', phone: '0911234567', language: 'am' })
    .expect(201);
  return { ...f, h: authHeader(f), tenantId: tenant.body.tenant.id as string, phone: '+251911234567' };
}
async function latestCode(tenantId: string): Promise<string> {
  const notification = await getPrisma().notification.findFirstOrThrow({
    where: {
      recipientUserId: (await getPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } })).userId ?? '',
    },
    orderBy: { createdAt: 'desc' },
  });
  return (notification.payload as { code: string }).code;
}

describe('tenant portal enrollment', () => {
  it('creates an OTP-only account and is idempotent; disable revokes it', async () => {
    const f = await setupTenant();
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(f.h).expect(201);
    const again = await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(f.h).expect(201);
    expect(again.body.replayed).toBe(true);
    expect(
      await getPrisma().membership.count({ where: { organizationId: f.organizationId, role: 'tenant' } }),
    ).toBe(1);
    const user = await getPrisma().user.findFirstOrThrow({
      where: { email: `portal-${f.tenantId}@tenants.invalid` },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'anything-long-enough' });
    expect(login.status).toBe(401);
    await request(app).delete(`/api/v1/tenants/${f.tenantId}/portal`).set(f.h).expect(200);
    expect((await getPrisma().membership.findFirstOrThrow({ where: { userId: user.id } })).status).toBe(
      'inactive',
    );
  });
  it('requires tenants.write and organization scope', async () => {
    const f = await setupTenant();
    const accountant = await createOrganizationFixture('accountant', 'accountant');
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(authHeader(accountant)).expect(403);
    const other = await createOrganizationFixture();
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(authHeader(other)).expect(400);
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).expect(401);
  });
});

describe('portal OTP login', () => {
  it('answers identically for unknown and known numbers without leaking enrollment', async () => {
    const f = await setupTenant();
    const unknown = await request(app)
      .post('/api/v1/portal/request-code')
      .send({ phone: '0911999888' })
      .expect(200);
    expect(unknown.body).toEqual({ ok: true });
    const known = await request(app)
      .post('/api/v1/portal/request-code')
      .send({ phone: '0911234567' })
      .expect(200);
    expect(known.body).toEqual({ ok: true });
    expect(await getPrisma().notification.count({ where: { organizationId: f.organizationId } })).toBe(0);
  });
  it('dispatches the code through the SMS provider and records the send', async () => {
    // Regression: the OTP notification used to be created `queued` and never
    // dispatched, so the code never appeared anywhere and login was impossible.
    const f = await setupTenant();
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(f.h).expect(201);
    await request(app).post('/api/v1/portal/request-code').send({ phone: '0911234567' }).expect(200);
    const notification = await getPrisma().notification.findFirstOrThrow({
      where: { organizationId: f.organizationId, templateKey: 'notification.portal_otp' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification.status).toBe('sent');
    expect(notification.sentAt).not.toBeNull();
    expect(notification.providerRef).toMatch(/^MOCK-SMS-/);
    const code = (notification.payload as { code: string }).code;
    expect(mockSmsProvider.outbox.at(-1)).toMatchObject({
      to: '+251911234567',
      body: expect.stringContaining(code),
    });
  });
  it('verifies a fresh code exactly once and issues a tenant-scoped session', async () => {
    const f = await setupTenant();
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(f.h).expect(201);
    await request(app).post('/api/v1/portal/request-code').send({ phone: '0911234567' }).expect(200);
    const code = await latestCode(f.tenantId);
    const wrong = await request(app)
      .post('/api/v1/portal/verify')
      .send({ phone: '0911234567', code: '000000' === code ? '000001' : '000000' });
    expect(wrong.status).toBe(401);
    const ok = await request(app)
      .post('/api/v1/portal/verify')
      .send({ phone: '0911234567', code })
      .expect(200);
    expect(ok.body.role).toBe('tenant');
    expect(ok.body.tenant.id).toBe(f.tenantId);
    // Same identity shape as /auth/login so the web session layer treats an OTP
    // sign-in exactly like a password sign-in.
    expect(ok.body.user.email).toContain('@tenants.invalid');
    expect(ok.body.organization.id).toBe(f.organizationId);
    expect(ok.body.memberships).toEqual([]);
    const replay = await request(app)
      .post('/api/v1/portal/verify')
      .send({ phone: '0911234567', code })
      .expect(401);
    expect(replay.status).toBe(401);
    expect(await getPrisma().auditLog.count({ where: { entityType: 'Tenant', action: 'login' } })).toBe(1);
  });
  it('locks the code after five wrong guesses', async () => {
    const f = await setupTenant();
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(f.h).expect(201);
    await request(app).post('/api/v1/portal/request-code').send({ phone: '0911234567' }).expect(200);
    const code = await latestCode(f.tenantId);
    for (let index = 0; index < 5; index += 1) {
      await request(app)
        .post('/api/v1/portal/verify')
        .send({ phone: '0911234567', code: String((Number(code) + index + 1) % 1000000).padStart(6, '0') })
        .expect(401);
    }
    await request(app).post('/api/v1/portal/verify').send({ phone: '0911234567', code }).expect(401);
  });
});

describe('portal self-service', () => {
  it('lets a tenant read only their own leases and due balance', async () => {
    const f = await setupTenant();
    await request(app).post(`/api/v1/tenants/${f.tenantId}/portal`).set(f.h).expect(201);
    await request(app).post('/api/v1/portal/request-code').send({ phone: '0911234567' }).expect(200);
    const code = await latestCode(f.tenantId);
    const ok = await request(app)
      .post('/api/v1/portal/verify')
      .send({ phone: '0911234567', code })
      .expect(200);
    const me = await request(app)
      .get('/api/v1/portal/me')
      .set({ Authorization: `Bearer ${ok.body.tokens.accessToken}` })
      .expect(200);
    expect(me.body.tenant.id).toBe(f.tenantId);
    expect(Array.isArray(me.body.leases)).toBe(true);
    const staffList = await request(app)
      .get('/api/v1/tenants')
      .set({ Authorization: `Bearer ${ok.body.tokens.accessToken}` });
    expect(staffList.status).toBe(403);
  });
  it('refuses staff endpoints for tenant sessions and portal endpoints for staff sessions', async () => {
    const f = await setupTenant();
    // Tenant sessions may read their own portal page but not manage tenants.
    const tenantUser = await createOrganizationFixture('tenant', 'tenant');
    const enroll = await request(app)
      .post(`/api/v1/tenants/${f.tenantId}/portal`)
      .set(authHeader(tenantUser))
      .expect(403);
    expect(enroll.body.error.code).toBe('FORBIDDEN');
    // Staff sessions never see tenant portal data: no tenant is linked to a
    // staff user, so the portal page is simply not found.
    const me = await request(app).get('/api/v1/portal/me').set(f.h).expect(404);
    expect(me.body.error.code).toBe('NOT_FOUND');
  });
});
