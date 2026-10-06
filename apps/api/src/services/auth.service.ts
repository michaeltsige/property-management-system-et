/**
 * Authentication: organization registration, login, refresh-token rotation, logout.
 *
 * Design notes
 * ------------
 * - Passwords are argon2id hashes; a wrong password and an unknown email produce
 *   the same response, so the endpoint cannot be used to enumerate accounts.
 * - Repeated failures lock the account for a cooling-off period.
 * - Refresh tokens are opaque random values, stored hashed and rotated on every
 *   use; reuse of a rotated token is treated as a breach (all sessions revoked).
 * - Registration creates the organization, the owner user and an
 *   owner_admin membership in one transaction, plus the default settings.
 */

import type { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

import { DEFAULT_ORG_SETTINGS, signupBillingSchema, type Role } from '@pms/shared';
import type { CalendarKind, LanguageCode } from '@pms/calendar';

import { getConfig } from '../config.js';
import { conflict, forbidden, notFound, unauthenticated } from '../lib/errors.js';
import { generateRefreshToken, hashPassword, hashRefreshToken, verifyPassword } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import { recordAudit } from './audit.js';
import { signAccessToken } from '../middleware/auth.js';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface RegisterInput {
  accountType?: 'individual_landlord' | 'management_company';
  billing?: z.infer<typeof signupBillingSchema>;
  organizationName: string;
  portfolioMode?: 'self_owned' | 'managed';
  organizationSlug?: string;
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  language: LanguageCode;
  calendar: CalendarKind;
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 2 ? base : 'org';
}

async function uniqueSlug(prisma: PrismaClient, preferred: string): Promise<string> {
  let candidate = preferred;
  let suffix = 1;
  // Slugs are user-visible, so keep them readable rather than appending a uuid.
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${preferred}-${suffix}`;
  }
  return candidate;
}

export async function registerOrganization(input: RegisterInput, meta: { requestId?: string; ip?: string }) {
  const prisma = getPrisma();

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(prisma, input.organizationSlug ?? slugify(input.organizationName));
  const isPlatformAdmin = getConfig().PLATFORM_ADMIN_EMAILS.includes(input.email.toLowerCase());

  const { organization, user } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        portfolioMode: input.portfolioMode ?? 'self_owned',
        slug,
        currency: DEFAULT_ORG_SETTINGS.currency,
        calendar: input.calendar,
        language: input.language,
      },
    });

    await tx.owner.create({
      data: {
        organizationId: organization.id,
        name: input.fullName,
        phone: input.phone ?? null,
        email: input.email,
        defaultKey: 'self',
      },
    });

    const user = await tx.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        passwordHash,
        language: input.language,
        calendar: input.calendar,
        isPlatformAdmin,
      },
    });

    await tx.organization.update({ where: { id: organization.id }, data: { createdById: user.id } });

    await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: 'owner_admin' satisfies Role,
        status: 'active',
        acceptedAt: new Date(),
      },
    });

    // Materialise the default configuration as rows, so that later changes are
    // ordinary data edits with an audit trail.
    const billing = signupBillingSchema.parse(input.billing ?? {});
    const settings = {
      ...DEFAULT_ORG_SETTINGS,
      accountType: input.accountType ?? 'individual_landlord',
      defaultCalendar: input.calendar,
      defaultLanguage: input.language,
      defaultBillingCalendar: billing.billingCalendar,
      rentDueDay: billing.dueDay,
      gracePeriodDays: billing.graceDays,
      lateFeeEnabled: billing.lateFeeRule !== 'none',
      lateFeeType: billing.lateFeeRule === 'fixed' ? 'fixed' : 'percent',
      lateFeePercent: billing.lateFeeBps / 100,
      lateFeeBps: billing.lateFeeBps,
      lateFeeFixedMinor: billing.lateFeeMinor,
      acceptedPaymentMethods: billing.acceptedPaymentMethods,
      onboardingStatus: 'portfolio_pending',
    };
    await tx.organizationSetting.createMany({
      data: Object.entries(settings).map(([key, value]) => ({
        organizationId: organization.id,
        key,
        value: value as never,
        updatedById: user.id,
      })),
    });

    await recordAudit(tx, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: 'create',
      entityType: 'Organization',
      entityId: organization.id,
      after: { name: organization.name, slug: organization.slug },
      requestId: meta.requestId ?? null,
      ipAddress: meta.ip ?? null,
    });

    return { organization, user };
  });

  const tokens = await issueTokens(user.id, organization.id, 'owner_admin', user.email, isPlatformAdmin, {
    requestId: meta.requestId,
    ip: meta.ip,
  });

  return {
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    user: { id: user.id, email: user.email, fullName: user.fullName },
    tokens,
  };
}

export async function login(
  input: { email: string; password: string; organizationSlug?: string },
  meta: { requestId?: string; ip?: string; userAgent?: string },
) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Same error for unknown user and wrong password.
  const invalid = () => unauthenticated('Email or password is incorrect');
  if (!user) {
    // Spend comparable time to avoid a timing oracle.
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000000000000000',
      input.password,
    );
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw forbidden('Account temporarily locked after repeated failed sign-ins');
  }
  if (!user.isActive) throw forbidden('This account has been disabled');

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    const failedLoginCount = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil:
          failedLoginCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await recordAudit(prisma, {
      actorUserId: user.id,
      action: 'login',
      entityType: 'User',
      entityId: user.id,
      after: { outcome: 'failed', failedLoginCount },
      requestId: meta.requestId ?? null,
      ipAddress: meta.ip ?? null,
    });
    throw invalid();
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, status: 'active' },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });

  const membership = input.organizationSlug
    ? memberships.find((m) => m.organization.slug === input.organizationSlug)
    : memberships[0];

  if (!membership) {
    throw forbidden(
      memberships.length > 0
        ? 'No active membership in that organization'
        : 'This account has no active organization membership',
    );
  }
  if (membership.organization.status !== 'active') throw forbidden('This organization is not active');

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const tokens = await issueTokens(
    user.id,
    membership.organizationId,
    membership.role as Role,
    user.email,
    user.isPlatformAdmin,
    { requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent },
  );

  await recordAudit(prisma, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: 'login',
    entityType: 'User',
    entityId: user.id,
    after: { outcome: 'success' },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ip ?? null,
  });

  return {
    tokens,
    // The role this session was issued for. `memberships` below lists every
    // organization the user belongs to; this is the one they are now acting in.
    role: membership.role,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      calendar: user.calendar,
      language: user.language,
    },
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      calendar: membership.organization.calendar,
      currency: membership.organization.currency,
    },
    memberships: memberships.map((m) => ({
      organizationId: m.organizationId,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    })),
  };
}

export async function issueTokens(
  userId: string,
  organizationId: string,
  role: Role,
  email: string,
  isPlatformAdmin: boolean,
  meta: { requestId?: string; ip?: string; userAgent?: string } = {},
): Promise<AuthTokens> {
  const config = getConfig();
  const prisma = getPrisma();
  const accessToken = await signAccessToken({
    sub: userId,
    org: organizationId,
    role,
    email,
    platform: isPlatformAdmin,
  });

  const { token, hash } = generateRefreshToken();
  await prisma.authSession.create({
    data: {
      userId,
      refreshTokenHash: hash,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ip ?? null,
      expiresAt: new Date(Date.now() + config.JWT_REFRESH_TTL_SECONDS * 1000),
    },
  });

  return { accessToken, refreshToken: token, expiresInSeconds: config.JWT_ACCESS_TTL_SECONDS };
}

/**
 * Rotate a refresh token.
 *
 * If the presented token is unknown but *looks* like one of ours, we cannot tell
 * which session it belonged to, so we do nothing dramatic; if it matches a session
 * that is already revoked, that is a reuse of a rotated token and every session
 * for that user is revoked.
 */
export async function refresh(
  refreshToken: string,
  meta: { requestId?: string; ip?: string; userAgent?: string },
) {
  const prisma = getPrisma();
  const hash = hashRefreshToken(refreshToken);
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hash },
    include: {
      user: { include: { memberships: { where: { status: 'active' }, include: { organization: true } } } },
    },
  });

  if (!session) throw unauthenticated('Invalid refresh token');

  if (session.revokedAt) {
    await prisma.authSession.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(prisma, {
      actorUserId: session.userId,
      action: 'logout',
      entityType: 'AuthSession',
      entityId: session.id,
      after: { reason: 'refresh_token_reuse' },
      requestId: meta.requestId ?? null,
    });
    throw unauthenticated('This session is no longer valid; please sign in again');
  }
  if (session.expiresAt < new Date()) throw unauthenticated('Session expired');

  const membership = session.user.memberships[0];
  if (!membership) throw notFound('No active organization membership for this user');

  await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

  return issueTokens(
    session.userId,
    membership.organizationId,
    membership.role as Role,
    session.user.email,
    session.user.isPlatformAdmin,
    meta,
  );
}

export async function logout(refreshToken: string | undefined, userId: string, organizationId: string) {
  const prisma = getPrisma();
  if (refreshToken) {
    await prisma.authSession.updateMany({
      where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  await recordAudit(prisma, {
    organizationId,
    actorUserId: userId,
    action: 'logout',
    entityType: 'AuthSession',
    entityId: null,
  });
}
