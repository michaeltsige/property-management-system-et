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

    const accountant = await createOrganizationFixture('profile-acct', 'accountant');
    await request(app)
      .patch('/api/v1/organizations/profile')
      .set(authHeader(accountant))
      .send({ name: 'Not allowed' })
      .expect(403);
    await request(app).patch('/api/v1/organizations/profile').send({ name: 'Anonymous' }).expect(401);
  });
});
