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
  it('creates the organization, owner and default settings in one step, then demands email verification', async () => {
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
    // No tokens at registration: the session starts after the emailed code is
    // redeemed (see the email verification describe below).
    expect(response.body.tokens).toBeUndefined();
    expect(response.body.verificationRequired).toBe(true);
    // The mock provider cannot deliver mail, so dev/test responses echo the code.
    expect(response.body.devVerificationCode).toMatch(/^\d{6}$/);

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
    // New signups start unverified, with a stored (hashed) verification code.
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.emailVerificationCodeHash).toMatch(/^[0-9a-f]{64}$/);
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

  it('returns the flat session shape the web client stores', async () => {
    // The web app keeps `{tokens, role, user, organization}` in local storage and
    // renders `role` in the header. A missing field shows up as "role.undefined"
    // on every screen rather than as a failed request, so the shape is asserted.
    const fixture = await createOrganizationFixture('session-shape');
    const prisma = getPrisma();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    expect(typeof login.body.tokens.accessToken).toBe('string');
    expect(typeof login.body.tokens.refreshToken).toBe('string');
    expect(login.body.role).toBe('owner_admin');
    expect(login.body.user).toMatchObject({ email: user.email, fullName: user.fullName });
    expect(login.body.user.passwordHash).toBeUndefined();
    expect(login.body.organization).toMatchObject({
      id: fixture.organizationId,
      currency: 'ETB',
      calendar: 'ethiopian',
    });
    expect(login.body.memberships[0]).toMatchObject({
      organizationId: fixture.organizationId,
      role: 'owner_admin',
    });
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

describe('email verification', () => {
  async function registerUnverified(email: string): Promise<string> {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        organizationName: `Verify Org ${email.split('@')[0]}`,
        fullName: 'Verify Me',
        email,
        password: 'StrongPass123',
        language: 'en',
        calendar: 'gregorian',
      })
      .expect(201);
    return response.body.devVerificationCode as string;
  }

  it('blocks sign-in until the emailed code is redeemed', async () => {
    const email = 'verify-gate@example.test';
    await registerUnverified(email);

    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'StrongPass123' })
      .expect(403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects a wrong code, then activates on the right one and starts a session', async () => {
    const email = 'verify-flow@example.test';
    const code = await registerUnverified(email);

    await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email, code: '000000' === code ? '111111' : '000000' })
      .expect(401);

    const verified = await request(app).post('/api/v1/auth/verify-email').send({ email, code }).expect(200);
    expect(verified.body.tokens.accessToken).toBeTruthy();
    expect(verified.body.role).toBe('owner_admin');
    expect(verified.body.emailVerified).toBe(true);
    expect(verified.body.user).toMatchObject({ email });

    // The code was single-use: a second redemption fails.
    await request(app).post('/api/v1/auth/verify-email').send({ email, code }).expect(401);

    // The user is now marked verified and can sign in.
    const prisma = getPrisma();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.emailVerificationCodeHash).toBeNull();

    await request(app).post('/api/v1/auth/login').send({ email, password: 'StrongPass123' }).expect(200);
  });

  it('re-issues a fresh code via resend-verification and invalidates the old one', async () => {
    const email = 'verify-resend@example.test';
    const firstCode = await registerUnverified(email);

    const resent = await request(app).post('/api/v1/auth/resend-verification').send({ email }).expect(200);
    expect(resent.body.ok).toBe(true);
    const secondCode = resent.body.devVerificationCode as string;
    expect(secondCode).toMatch(/^\d{6}$/);

    await request(app).post('/api/v1/auth/verify-email').send({ email, code: firstCode }).expect(401);
    await request(app).post('/api/v1/auth/verify-email').send({ email, code: secondCode }).expect(200);
  });

  it('never reveals whether an address has an account', async () => {
    const known = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'verify-gate@example.test' })
      .expect(200);
    const unknown = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'ghost-unknown@example.test' })
      .expect(200);
    // Same body shape; only the dev code differs (present only for real accounts).
    expect(known.body.ok).toBe(true);
    expect(unknown.body).toEqual({ ok: true });
    expect(unknown.body.devVerificationCode).toBeUndefined();
  });
});

describe('password reset', () => {
  async function requestReset(email: string): Promise<string> {
    const response = await request(app).post('/api/v1/auth/forgot-password').send({ email }).expect(200);
    expect(response.body.ok).toBe(true);
    return response.body.devResetCode as string;
  }

  it('emails a code, rejects the wrong one, then resets and revokes old sessions', async () => {
    const fixture = await createOrganizationFixture('reset');
    const prisma = getPrisma();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });

    const code = await requestReset(user.email);
    expect(code).toMatch(/^\d{6}$/);

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code: '000000', password: 'BrandNew123' })
      .expect(401);

    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code, password: 'BrandNew123' })
      .expect(200);
    expect(reset.body.ok).toBe(true);

    // The code is single-use.
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code, password: 'BrandNew123' })
      .expect(401);

    // Old sessions are dead; the new password signs in.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: fixture.refreshToken }).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'BrandNew123' })
      .expect(200);
  });

  it('marks the address verified (recovery path for an unverified account)', async () => {
    const email = 'reset-unverified@example.test';
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        organizationName: 'Reset Unverified Org',
        fullName: 'Reset Unverified',
        email,
        password: 'StrongPass123',
        language: 'en',
        calendar: 'gregorian',
      })
      .expect(201);

    const code = await requestReset(email);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email, code, password: 'Recovered123' })
      .expect(200);

    const user = await getPrisma().user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    await request(app).post('/api/v1/auth/login').send({ email, password: 'Recovered123' }).expect(200);
  });

  it('stays silent for unknown addresses and tenant-only users', async () => {
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody-reset@example.test' })
      .expect(200);
    expect(unknown.body).toEqual({ ok: true });
    expect(unknown.body.devResetCode).toBeUndefined();

    // A user with memberships is staff; a tenant-linked user without any is not.
    const prisma = getPrisma();
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const tenantOnly = await prisma.user.create({
      data: { email: 'tenant-only-reset@example.test', fullName: 'Tenant Only', passwordHash },
    });
    const tenantOnlyResponse = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: tenantOnly.email })
      .expect(200);
    expect(tenantOnlyResponse.body).toEqual({ ok: true });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: tenantOnly.id } });
    expect(stored.passwordResetCodeHash).toBeNull();
  });
});
