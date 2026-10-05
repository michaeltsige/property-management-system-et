/**
 * Authentication flow.
 *
 * These tests use the running Express app against the test database, so they
 * exercise the real middleware chain (validation, rate limiting, error mapping).
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { hashPassword } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import { TEST_PASSWORD, createOrganizationFixture } from './helpers.js';

const app = createApp();

describe('registration', () => {
  it('creates the organization, owner and default settings in one step', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        organizationName: 'Abebe Properties',
        fullName: 'Abebe Kebede',
        email: 'abebe@example.test',
        password: 'StrongPass123',
        phone: '0911234567',
        language: 'am',
        calendar: 'ethiopian',
      })
      .expect(201);

    expect(response.body.organization.slug).toBe('abebe-properties');
    expect(response.body.tokens.accessToken).toBeTruthy();
    expect(response.body.tokens.refreshToken).toBeTruthy();

    const prisma = getPrisma();
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'abebe-properties' },
      include: { memberships: true, settings: true },
    });
    expect(organization.calendar).toBe('ethiopian');
    expect(organization.memberships[0]?.role).toBe('owner_admin');
    expect(organization.settings.length).toBeGreaterThan(0);
    // The phone number is normalised to +251 form.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'abebe@example.test' } });
    expect(user.phone).toBe('+251911234567');
    // Passwords are argon2id, never plaintext.
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects a duplicate email and weak passwords', async () => {
    await createOrganizationFixture('dupe');
    const existing = await getPrisma().user.findFirstOrThrow({ where: { email: { startsWith: 'dupe-' } } });

    await request(app)
      .post('/api/v1/auth/register')
      .send({
        organizationName: 'Second Org',
        fullName: 'Someone',
        email: existing.email,
        password: 'StrongPass123',
        language: 'en',
        calendar: 'gregorian',
      })
      .expect(409);

    await request(app)
      .post('/api/v1/auth/register')
      .send({
        organizationName: 'Third Org',
        fullName: 'Someone',
        email: 'weak@example.test',
        password: 'short',
        language: 'en',
        calendar: 'gregorian',
      })
      .expect(400);
  });
});

describe('login, refresh and logout', () => {
  it('signs in, rotates refresh tokens and detects reuse', async () => {
    const fixture = await createOrganizationFixture('login');
    const prisma = getPrisma();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    const { accessToken, refreshToken } = login.body.tokens as { accessToken: string; refreshToken: string };

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.user.organizationId).toBe(fixture.organizationId);
    expect(me.body.user.role).toBe('owner_admin');
    expect(me.body.user.permissions).toContain('charges.write');
    expect(me.body.user.calendar).toBe('ethiopian');

    // Rotate.
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    const newRefresh = refreshed.body.tokens.refreshToken as string;
    expect(newRefresh).not.toBe(refreshToken);

    // Reusing the rotated token is treated as a breach: all sessions are revoked.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: newRefresh }).expect(401);
  });

  it('does not reveal whether an email exists', async () => {
    const fixture = await createOrganizationFixture('enum');
    const prisma = getPrisma();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'DefinitelyWrong123' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'DefinitelyWrong123' })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const prisma = getPrisma();
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email: 'lockout@example.test', fullName: 'Lock Me', passwordHash },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'WrongPassword1' })
        .expect(401);
    }

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.failedLoginCount).toBe(10);
    expect(locked.lockedUntil).not.toBeNull();

    // Even the correct password is refused while locked.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);
  });

  it('logs out and revokes the refresh token', async () => {
    const fixture = await createOrganizationFixture('logout');
    const prisma = getPrisma();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(204);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(401);
  });
});

describe('authorization basics', () => {
  it('rejects requests without a token', async () => {
    await request(app).get('/api/v1/leases').expect(401);
  });

  it('rejects a token from a session whose membership was disabled', async () => {
    const fixture = await createOrganizationFixture('disabled');
    const prisma = getPrisma();
    await prisma.membership.updateMany({
      where: { organizationId: fixture.organizationId, userId: fixture.userId },
      data: { status: 'disabled' },
    });

    await request(app)
      .get('/api/v1/leases')
      .set('Authorization', `Bearer ${fixture.accessToken}`)
      .expect(401);
  });

  it('enforces the role matrix (a tenant cannot write charges)', async () => {
    const fixture = await createOrganizationFixture('rolecheck', 'tenant');

    await request(app)
      .post('/api/v1/charges/generate')
      .set('Authorization', `Bearer ${fixture.accessToken}`)
      .send({ periodKeys: ['2019-01'] })
      .expect(403);
  });
});
