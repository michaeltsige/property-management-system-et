/**
 * Organization administration: settings and member management.
 *
 * The member list is part of the API contract the web app types against, and a
 * shape mismatch there is a crash on the Settings screen rather than a visible
 * runtime error (it happened once — see the regression test at the bottom).
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { getPrisma } from '../lib/prisma.js';
import { mockEmailProvider } from '../providers/email/index.js';
import { authHeader, createOrganizationFixture } from './helpers.js';

const app = createApp();

describe('organization members', () => {
  it('lists members with the flat shape the web client expects', async () => {
    const fixture = await createOrganizationFixture('members');
    const response = await request(app).get('/api/v1/organizations/members').set(authHeader(fixture));

    expect(response.status).toBe(200);
    const members = response.body.members as Record<string, unknown>[];
    expect(members.length).toBe(1);

    const member = members[0]!;
    // Flat fields, exactly as `apps/web/src/lib/types.ts` declares them.
    expect(member.email).toBe(fixture.email);
    expect(typeof member.fullName).toBe('string');
    expect(member.role).toBe('owner_admin');
    expect(member.status).toBe('active');
    expect(member.userId).toBe(fixture.userId);
    // Nothing nests a `user` object: the web app would render `undefined`.
    expect(member.user).toBeUndefined();
  });

  it('rejects a member list request without a token', async () => {
    const response = await request(app).get('/api/v1/organizations/members');
    expect(response.status).toBe(401);
  });

  it('never leaks members of another organization', async () => {
    const first = await createOrganizationFixture('members-a');
    const second = await createOrganizationFixture('members-b');

    const response = await request(app).get('/api/v1/organizations/members').set(authHeader(first));

    const emails = (response.body.members as { email: string }[]).map((member) => member.email);
    expect(emails).toContain(first.email);
    expect(emails).not.toContain(second.email);
  });

  it('keeps tenants out of the team list even after portal enrollment', async () => {
    const fixture = await createOrganizationFixture('members-tenant');
    const prisma = getPrisma();
    // A portal-enrolled tenant: its own user + a `tenant`-role membership, the
    // exact row that used to surface in the team table as a fake member.
    const tenantUser = await prisma.user.create({
      data: {
        email: 'tenant-team@example.com',
        fullName: 'Enrolled Tenant',
        passwordHash: 'x',
        language: 'en',
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: fixture.organizationId,
        userId: tenantUser.id,
        role: 'tenant',
        status: 'active',
      },
    });

    const response = await request(app).get('/api/v1/organizations/members').set(authHeader(fixture));

    expect(response.status).toBe(200);
    const emails = (response.body.members as { email: string }[]).map((member) => member.email);
    expect(emails).toContain(fixture.email);
    expect(emails).not.toContain('tenant-team@example.com');
  });
});

describe('invite emails', () => {
  it('emails the accept-invite link and still returns the token for hand-over', async () => {
    const fixture = await createOrganizationFixture('invite');
    const outboxBefore = mockEmailProvider.outbox.length;

    const response = await request(app)
      .post('/api/v1/organizations/members')
      .set(authHeader(fixture))
      .send({ email: 'new.manager@example.test', role: 'manager', fullName: 'New Manager' })
      .expect(201);

    const invite = response.body.invite as { token: string; email: string; emailed: boolean };
    // The token still rides along (hand-over fallback when mail is not configured).
    expect(invite.token).toMatch(/[A-Za-z0-9_-]{20,}/);
    expect(invite.emailed).toBe(true);

    // The mock provider recorded the invitation mail with the accept link.
    const sent = mockEmailProvider.outbox.slice(outboxBefore).find((mail) => mail.to === invite.email);
    expect(sent).toBeTruthy();
    expect(sent?.subject).toContain('invited to join');
    expect(sent?.body).toContain(`/accept-invite?token=${invite.token}`);
    expect(sent?.body).toContain('Property Manager');
  });

  it('resend-invite emails a fresh link for a pending membership', async () => {
    const fixture = await createOrganizationFixture('invite-resend');
    const created = await request(app)
      .post('/api/v1/organizations/members')
      .set(authHeader(fixture))
      .send({ email: 'pending.member@example.test', role: 'owner_admin' })
      .expect(201);

    const outboxBefore = mockEmailProvider.outbox.length;
    const response = await request(app)
      .post(`/api/v1/organizations/members/${created.body.membership.id as string}/resend-invite`)
      .set(authHeader(fixture))
      .expect(200);

    const invite = response.body.invite as { token: string; email: string; emailed: boolean; role: string };
    expect(invite.emailed).toBe(true);
    expect(invite.role).toBe('owner_admin');
    const sent = mockEmailProvider.outbox.slice(outboxBefore).find((mail) => mail.to === invite.email);
    expect(sent?.body).toContain(`/accept-invite?token=${invite.token}`);
  });
});

describe('organization profile', () => {
  it('lets an owner rename the organization with an audit trail; others are refused', async () => {
    const fixture = await createOrganizationFixture('profile');
    const res = await request(app)
      .patch('/api/v1/organizations/profile')
      .set(authHeader(fixture))
      .send({ name: 'Renamed Management PLC' })
      .expect(200);
    expect(res.body.organization.name).toBe('Renamed Management PLC');

    const org = await getPrisma().organization.findUniqueOrThrow({
      where: { id: fixture.organizationId },
    });
    expect(org.name).toBe('Renamed Management PLC');
    const audit = await getPrisma().auditLog.findFirstOrThrow({
      where: { organizationId: fixture.organizationId, entityType: 'Organization' },
    });
    expect(audit.action).toBe('update');

    const manager = await createOrganizationFixture('profile-acct', 'manager');
    await request(app)
      .patch('/api/v1/organizations/profile')
      .set(authHeader(manager))
      .send({ name: 'Not allowed' })
      .expect(403);
    await request(app).patch('/api/v1/organizations/profile').send({ name: 'Anonymous' }).expect(401);
  });
});
