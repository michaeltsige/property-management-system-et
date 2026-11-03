/**
 * Authentication: organization registration, login, refresh-token rotation, logout,
 * email verification and password reset.
 *
 * Design notes
 * ------------
 * - Passwords are argon2id hashes; a wrong password and an unknown email produce
 *   the same response, so the endpoint cannot be used to enumerate accounts.
 * - Repeated failures lock the account for a cooling-off period.
 * - Refresh tokens are opaque random values, stored hashed and rotated on every
 *   use; reuse of a rotated token is treated as a breach (all sessions revoked).
 * - Registration creates the organization, the owner user and an
 *   owner_admin membership in one transaction, plus the default settings, and
 *   sends a 6-digit verification code — the account cannot sign in until the
 *   code is redeemed (`POST /auth/verify-email`).
 * - Password reset trades a 6-digit email code (15-minute TTL, single use) for
 *   a new password and revokes every live session. Redeeming any emailed
 *   credential (invite, verification, reset) marks the address verified.
 */

import type { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

import { DEFAULT_ORG_SETTINGS, signupBillingSchema, type Role } from '@pms/shared';
import type { CalendarKind, LanguageCode } from '@pms/calendar';
import type { CurrencyCode } from '@pms/shared';
import { createTranslator, type TranslationKey } from '@pms/i18n';

import { getConfig } from '../config.js';
import { conflict, emailNotVerified, forbidden, notFound, unauthenticated } from '../lib/errors.js';
import {
  generateEmailCode,
  generateRefreshToken,
  hashEmailCode,
  hashPassword,
  hashRefreshToken,
  secureEqualHex,
  verifyPassword,
} from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { getEmailProvider } from '../providers/email/index.js';
import { recordAudit } from './audit.js';
import { signAccessToken } from '../middleware/auth.js';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
/** Email verification codes live a day — long enough to sleep on it, short enough to expire. */
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Password reset codes are shorter-lived: they change credentials. */
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

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
  /** The books' currency for the new organization; defaults to ETB. */
  currency?: CurrencyCode;
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

// ---------------------------------------------------------------------------
// Email codes (verification + password reset)
// ---------------------------------------------------------------------------

export type EmailCodePurpose = 'verification' | 'password_reset';

/** Store a fresh single-use code (hashed) on the user and return the raw code for the email. */
async function issueEmailCode(userId: string, purpose: EmailCodePurpose): Promise<string> {
  const prisma = getPrisma();
  const code = generateEmailCode();
  const data =
    purpose === 'verification'
      ? {
          emailVerificationCodeHash: hashEmailCode(code),
          emailVerificationExpiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
        }
      : {
          passwordResetCodeHash: hashEmailCode(code),
          passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        };
  await prisma.user.update({ where: { id: userId }, data });
  return code;
}

/** Send transactional auth mail; a provider outage is recorded, never thrown. */
async function sendAuthEmail(params: {
  to: string;
  language: string;
  templateKey: TranslationKey;
  values: Record<string, string | number>;
  subjectKey?: TranslationKey;
}): Promise<void> {
  try {
    const result = await getEmailProvider().send({
      to: params.to,
      language: (params.language as LanguageCode) ?? 'en',
      templateKey: params.templateKey,
      values: params.values,
      subjectKey: params.subjectKey,
    });
    if (result.status !== 'sent') {
      logger.warn({ to: params.to, detail: result.detail }, 'auth email was not delivered');
    }
  } catch (error) {
    logger.warn({ to: params.to, err: error }, 'auth email send failed');
  }
}

/** The raw code is echoed back only when nothing real could have been delivered. */
function devCode(code: string): string | undefined {
  const config = getConfig();
  return config.NODE_ENV !== 'production' && config.EMAIL_PROVIDER === 'mock' ? code : undefined;
}

function localizedAppName(language: string): string {
  return createTranslator({ language: (language as LanguageCode) ?? 'en' }).t('app.name');
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
        currency: input.currency ?? DEFAULT_ORG_SETTINGS.currency,
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

  // No tokens here: the account activates when the emailed 6-digit code is
  // redeemed (POST /auth/verify-email), which mints the first session.
  const code = await issueEmailCode(user.id, 'verification');
  await sendAuthEmail({
    to: user.email,
    language: user.language,
    templateKey: 'email.verification.body',
    values: { appName: localizedAppName(user.language), code },
    subjectKey: 'email.verification.subject',
  });

  await recordAudit(prisma, {
    actorUserId: user.id,
    action: 'verify',
    entityType: 'User',
    entityId: user.id,
    after: { event: 'verification_code_sent' },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ip ?? null,
  });

  return {
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    user: { id: user.id, email: user.email, fullName: user.fullName },
    verificationRequired: true as const,
    devVerificationCode: devCode(code),
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

  // Only AFTER the password is proven: otherwise this error would tell the
  // world which addresses have accounts. The web app maps the machine code to
  // the verify-email page instead of a dead end.
  if (!user.emailVerifiedAt) {
    throw emailNotVerified('Verify your email address before signing in. Check your inbox for the code.');
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
      // The session remembers which organization it was issued for; refresh
      // re-issues for this one and never for whatever memberships[0] says.
      organizationId,
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
 *
 * The new tokens are issued for the organization the session was created in —
 * never for whichever membership happens to sort first today. Sessions created
 * before the `organizationId` column existed (null) fall back to the oldest
 * active membership, matching the old behaviour, and the replacement session
 * becomes bound.
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

  // Stay in the session's organization. Membership must still be active there.
  const membership = session.organizationId
    ? session.user.memberships.find((m) => m.organizationId === session.organizationId)
    : session.user.memberships[0];
  if (!membership) {
    throw notFound(
      session.organizationId
        ? 'No active membership in the organization of this session'
        : 'No active organization membership for this user',
    );
  }
  if (membership.organization.status !== 'active') throw forbidden('This organization is not active');

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

/**
 * Accept a staff invitation: redeem the single-use token, set the account
 * password and activate the membership. This is the path that turns the
 * "invited" membership row into a sign-in-able account — without it an invite
 * is a dead end.
 *
 * The response mirrors the fields the login screen needs to continue straight
 * into the organization.
 */
export async function acceptInvite(
  input: { token: string; password: string },
  meta: { requestId?: string; ip?: string; userAgent?: string } = {},
) {
  const prisma = getPrisma();
  const tokenHash = hashRefreshToken(input.token);

  const membership = await prisma.membership.findFirst({
    where: { inviteTokenHash: tokenHash },
    include: { organization: true, user: true },
  });
  // Same answer whether the token is unknown, used, or expired.
  const invalid = () => unauthenticated('This invitation is no longer valid; ask for a new one');
  if (!membership) throw invalid();
  if (membership.status !== 'invited' || !membership.inviteExpiresAt) throw invalid();
  if (membership.inviteExpiresAt < new Date()) throw invalid();
  if (!membership.user.isActive) throw forbidden('This account has been disabled');

  const passwordHash = await hashPassword(input.password);

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: membership.userId },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        // The single-use invite token was delivered to this address; redeeming
        // it demonstrates control of the inbox the same way a verification code
        // would. Invited accounts must not be locked out by the login gate.
        emailVerifiedAt: membership.user.emailVerifiedAt ?? new Date(),
      },
    }),
    prisma.membership.update({
      where: { id: membership.id },
      data: {
        status: 'active',
        acceptedAt: new Date(),
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    }),
  ]);

  await recordAudit(prisma, {
    organizationId: membership.organizationId,
    actorUserId: membership.userId,
    action: 'update',
    entityType: 'Membership',
    entityId: membership.id,
    after: { status: 'active', acceptedAt: new Date().toISOString() },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ip ?? null,
  });

  return {
    email: user.email,
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
    },
  };
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

/**
 * Redeem the emailed verification code: marks the address verified and mints
 * the first session, so a fresh signup goes registration → verify → app
 * without a separate login. Unauthenticated by design — the code IS the
 * credential — but rate limited like every other auth endpoint.
 */
export async function verifyEmail(
  input: { email: string; code: string },
  meta: { requestId?: string; ip?: string; userAgent?: string } = {},
) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Same answer for unknown email, wrong code, expired code and already-used
  // code — nothing about which one it was.
  const invalid = () => unauthenticated('This verification code is not valid. Request a new one.');
  if (!user || !user.emailVerificationCodeHash || !user.emailVerificationExpiresAt) throw invalid();
  if (user.emailVerifiedAt) throw conflict('This email address is already verified — sign in instead.');
  if (user.emailVerificationExpiresAt < new Date()) throw invalid();
  if (!secureEqualHex(user.emailVerificationCodeHash, hashEmailCode(input.code))) throw invalid();
  if (!user.isActive) throw forbidden('This account has been disabled');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
    },
  });

  await recordAudit(prisma, {
    actorUserId: user.id,
    action: 'verify',
    entityType: 'User',
    entityId: user.id,
    after: { emailVerified: true },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ip ?? null,
  });

  // A fresh signup has exactly one membership, but resolve it the way login
  // does so a verified user with several organizations still lands somewhere.
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, status: 'active' },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });
  const membership = memberships.find((m) => m.organization.status === 'active') ?? memberships[0];
  if (!membership) {
    throw forbidden('This account has no active organization membership');
  }

  const tokens = await issueTokens(
    user.id,
    membership.organizationId,
    membership.role as Role,
    user.email,
    user.isPlatformAdmin,
    meta,
  );

  return {
    tokens,
    emailVerified: true as const,
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

/**
 * Send a fresh verification code. The response is identical whether or not the
 * address has an account, so the endpoint cannot be used to enumerate users.
 */
export async function resendVerification(input: { email: string }) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (user && !user.emailVerifiedAt && user.isActive) {
    const code = await issueEmailCode(user.id, 'verification');
    await sendAuthEmail({
      to: user.email,
      language: user.language,
      templateKey: 'email.verification.body',
      values: { appName: localizedAppName(user.language), code },
      subjectKey: 'email.verification.subject',
    });
    await recordAudit(prisma, {
      actorUserId: user.id,
      action: 'verify',
      entityType: 'User',
      entityId: user.id,
      after: { event: 'verification_code_resent' },
    });
    return { ok: true as const, devVerificationCode: devCode(code) };
  }
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Password reset (staff accounts; tenants sign in with OTP)
// ---------------------------------------------------------------------------

/**
 * Request a password-reset code. Staff accounts (any membership) get an email
 * with a 6-digit code; unknown addresses and tenant-only users — who never use
 * a password, the portal is OTP-only — get the same silent ok, so the endpoint
 * cannot be used to enumerate accounts.
 */
export async function forgotPassword(input: { email: string }) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { select: { id: true }, take: 1 } },
  });
  if (user && user.isActive && user.memberships.length > 0) {
    const code = await issueEmailCode(user.id, 'password_reset');
    await sendAuthEmail({
      to: user.email,
      language: user.language,
      templateKey: 'email.password_reset.body',
      values: { code },
      subjectKey: 'email.password_reset.subject',
    });
    await recordAudit(prisma, {
      actorUserId: user.id,
      action: 'update',
      entityType: 'User',
      entityId: user.id,
      after: { event: 'password_reset_requested' },
    });
    return { ok: true as const, devResetCode: devCode(code) };
  }
  return { ok: true as const };
}

/**
 * Trade the emailed code for a new password: single use, expiry enforced,
 * every live session revoked, and the address counts as verified (the code
 * proved inbox ownership — this is also the recovery path for an unverified
 * account that lost its verification email).
 */
export async function resetPassword(
  input: { email: string; code: string; password: string },
  meta: { requestId?: string; ip?: string; userAgent?: string } = {},
) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  const invalid = () => unauthenticated('This reset code is not valid. Request a new one.');
  if (!user || !user.passwordResetCodeHash || !user.passwordResetExpiresAt) throw invalid();
  if (user.passwordResetExpiresAt < new Date()) throw invalid();
  if (!secureEqualHex(user.passwordResetCodeHash, hashEmailCode(input.code))) throw invalid();
  if (!user.isActive) throw forbidden('This account has been disabled');

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction([
    prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetCodeHash: null,
        passwordResetExpiresAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    }),
  ]);

  await recordAudit(prisma, {
    actorUserId: user.id,
    action: 'update',
    entityType: 'User',
    entityId: user.id,
    after: { passwordReset: true, sessionsRevoked: true },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ip ?? null,
  });

  return { ok: true as const };
}
