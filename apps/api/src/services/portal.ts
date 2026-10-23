/**
 * Tenant portal: OTP-only access for tenants.
 *
 * Security notes
 * --------------
 * - The owner explicitly wants clear feedback over enumeration-avoidance: a
 *   phone with no enrolled tenant gets a 404 ("not registered"), and a real
 *   resend inside the cooldown gets a 429. Abuse is bounded by the per-phone
 *   and per-IP rate limits instead of silence.
 * - Codes are six random digits, stored as HMAC-SHA-256 hashes (keyed with a
 *   server secret — a leaked database column alone cannot brute-force them),
 *   valid ten minutes, single-use, with a five-attempt budget.
 * - Enrollment creates a User with an unusable random password; the only way in
 *   is a fresh code, so there is no password to phish or stuff.
 */

import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import { phoneEtSchema } from '@pms/shared';

import type { PrismaClient } from '@prisma/client';

import { badRequest, rateLimited, unauthenticated } from '../lib/errors.js';
import { hashPassword } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { getConfig } from '../config.js';
import { getSmsProvider } from '../providers/sms/index.js';
import { recordAudit } from './audit.js';
import type { PrismaLike } from './audit.js';
import type { LanguageCode } from '@pms/calendar';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Code requests allowed per phone number within the sliding window. */
export const OTP_PHONE_REQUESTS = 5;
export const OTP_PHONE_WINDOW_MINUTES = 15;

export function normalizePhone(value: unknown): string | null {
  const parsed = phoneEtSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * HMAC-SHA-256 keyed with a server-only secret (derived from the JWT access
 * secret; both live in the same .env the operator backs up). An unsalted
 * SHA-256 of a 6-digit code is brute-forceable in seconds from a leaked
 * database; the keyed hash is not.
 */
function hashCode(code: string): string {
  const key = createHash('sha256')
    .update(`portal-otp:${getConfig().JWT_ACCESS_SECRET}`)
    .digest();
  return createHmac('sha256', key).update(code).digest('hex');
}

/** Constant-time hash comparison — code equality must not leak byte-by-byte. */
function hashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/**
 * Per-phone request limiter (in-memory, sliding window). The IP limiter in the
 * route protects the endpoint; this one protects a single victim's phone from
 * SMS bombing even when the requests come from many addresses.
 */
const phoneRequestLog = new Map<string, number[]>();

export function assertPhoneRequestBudget(phone: string): void {
  const now = Date.now();
  const windowMs = OTP_PHONE_WINDOW_MINUTES * 60_000;
  const recent = (phoneRequestLog.get(phone) ?? []).filter((ts) => now - ts < windowMs);
  if (recent.length >= OTP_PHONE_REQUESTS) {
    throw rateLimited(
      `Too many code requests for this phone number; try again in ${OTP_PHONE_WINDOW_MINUTES} minutes`,
    );
  }
  recent.push(now);
  phoneRequestLog.set(phone, recent);
  // Opportunistic cleanup so the map cannot grow without bound.
  if (phoneRequestLog.size > 10_000) {
    for (const [key, stamps] of phoneRequestLog) {
      if (stamps.every((ts) => now - ts >= windowMs)) phoneRequestLog.delete(key);
    }
  }
}

export async function findEnrolledTenantByPhone(prisma: PrismaLike, phone: string) {
  // `user.isActive` matters: disabling a tenant's portal access sets it to false,
  // and a disabled account must not be able to request or verify codes.
  return prisma.tenant.findFirst({
    where: {
      deletedAt: null,
      userId: { not: null },
      user: { isActive: true },
      OR: [{ phone }, { altPhone: phone }],
    },
    include: { organization: true, user: true },
  });
}

/**
 * Result of a code request. `not_registered` and `cooldown` are surfaced to the
 * user on purpose (owner decision): the SMS budget for abuse is the per-phone
 * limiter, not silence.
 */
export type PortalCodeRequestResult =
  | { ok: true }
  | { ok: false; reason: 'not_registered' }
  | { ok: false; reason: 'cooldown'; retryAfterSeconds: number };

export async function requestPortalCode(
  prisma: PrismaLike,
  phone: string,
  meta: { requestId?: string },
): Promise<PortalCodeRequestResult> {
  assertPhoneRequestBudget(phone);

  const tenant = await findEnrolledTenantByPhone(prisma, phone);
  if (!tenant?.user) {
    // Explicit "not registered" (owner decision) — but development still logs a
    // hint naming the phones that WOULD have worked, because a missing seed is
    // indistinguishable from a broken SMS provider there.
    if (getConfig().isDevelopment) {
      const enrolled = await prisma.tenant.findMany({
        where: { deletedAt: null, userId: { not: null }, user: { isActive: true } },
        select: { phone: true, altPhone: true },
        take: 20,
      });
      const enrolledPhones = enrolled
        .flatMap((row) => [row.phone, row.altPhone].filter(Boolean))
        .slice(0, 20)
        .join(', ');
      logger.info(
        { phone },
        'DEV demo: portal code requested for a phone with no enrolled, active tenant. ' +
          `Phones that are enrolled for portal access: ${enrolledPhones || '(none — run `pnpm db:seed`)'}. ` +
          'Seeded demo phones are also printed by `pnpm db:seed`.',
      );
    }
    return { ok: false, reason: 'not_registered' };
  }

  const last = await prisma.tenantOtp.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
  });
  if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    const retryAfterSeconds = Math.ceil(
      (last.createdAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000,
    );
    if (getConfig().isDevelopment) {
      logger.info(
        { phone },
        `DEV demo: portal code requested again within the ${OTP_RESEND_COOLDOWN_SECONDS}s resend cooldown — not resending. The earlier code (if one was sent) is still valid.`,
      );
    }
    return { ok: false, reason: 'cooldown', retryAfterSeconds };
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  await prisma.tenantOtp.create({
    data: {
      organizationId: tenant.organizationId,
      tenantId: tenant.id,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    },
  });

  const language = (tenant.language ?? tenant.organization.language ?? 'en') as LanguageCode;
  const notification = await prisma.notification.create({
    data: {
      organizationId: tenant.organizationId,
      templateKey: 'notification.portal_otp',
      channel: 'sms',
      recipientUserId: tenant.userId,
      recipientPhone: phone,
      language,
      payload: { code },
      status: 'queued',
    },
  });

  // Dispatch now, like every other SMS path (manual send, overdue sweep): the
  // queued row alone used to sit forever because nothing drained the outbox,
  // so the code never reached the tenant. A provider failure is recorded on
  // the row and swallowed here — the user still gets `ok: true`.
  try {
    const result = await getSmsProvider().send({
      to: phone,
      templateKey: 'notification.portal_otp',
      values: { code },
      language,
    });
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: result.status === 'sent' ? 'sent' : 'failed',
        providerRef: result.providerRef ?? null,
        sentAt: new Date(),
        error: result.status === 'sent' ? null : (result.detail ?? null),
      },
    });
  } catch (error) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'failed', error: String(error) },
    });
    logger.warn({ err: error, notificationId: notification.id }, 'portal OTP SMS failed');
  }

  await recordAudit(prisma, {
    organizationId: tenant.organizationId,
    action: 'generate',
    entityType: 'TenantOtp',
    entityId: tenant.id,
    requestId: meta.requestId ?? null,
    after: { channel: 'sms' },
  });

  return { ok: true };
}

export async function verifyPortalCode(
  prisma: PrismaLike,
  phone: string,
  code: string,
  meta: { requestId?: string },
) {
  const tenant = await findEnrolledTenantByPhone(prisma, phone);
  if (!tenant?.user) throw unauthenticated('Email or code is incorrect');

  const otp = await prisma.tenantOtp.findFirst({
    where: { tenantId: tenant.id, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.expiresAt.getTime() < Date.now()) throw unauthenticated('Code expired or not requested');
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw unauthenticated('Too many attempts; request a new code');
  if (!hashesMatch(otp.codeHash, hashCode(code))) {
    await prisma.tenantOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw unauthenticated('Email or code is incorrect');
  }

  await prisma.tenantOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  await prisma.user.update({ where: { id: tenant.user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit(prisma, {
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: 'login',
    entityType: 'Tenant',
    entityId: tenant.id,
    requestId: meta.requestId ?? null,
  });

  return { tenant, user: tenant.user, organizationId: tenant.organizationId };
}

export async function enrollTenantPortal(
  prisma: PrismaClient,
  params: { organizationId: string; actorUserId: string; tenantId: string },
) {
  const { organizationId, actorUserId, tenantId } = params;
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId, organizationId, deletedAt: null } });
    if (!tenant) throw badRequest('Tenant not found in this organization');
    if (tenant.userId) {
      // Re-enrolling a previously disabled account must actually re-enable it,
      // otherwise "enable" silently does nothing.
      await tx.user.updateMany({ where: { id: tenant.userId, isActive: false }, data: { isActive: true } });
      await tx.membership.updateMany({
        where: { organizationId, userId: tenant.userId, status: { in: ['inactive', 'disabled'] } },
        data: { status: 'active' },
      });
      await tx.tenant.update({ where: { id: tenant.id }, data: { portalEnabledAt: new Date() } });
      return { enrolled: true, replayed: true };
    }

    const email = `portal-${tenant.id}@tenants.invalid`;
    const user = await tx.user.create({
      data: {
        email,
        fullName: tenant.fullName,
        phone: tenant.phone ?? null,
        language: tenant.language ?? 'en',
        // Unusable password: portal login is OTP-only by design.
        passwordHash: await hashPassword(randomUUID() + randomUUID()),
      },
    });
    await tx.membership.create({
      data: { organizationId, userId: user.id, role: 'tenant', status: 'active', acceptedAt: new Date() },
    });
    const updated = await tx.tenant.update({
      where: { id: tenant.id },
      data: { userId: user.id, portalEnabledAt: new Date() },
    });
    await recordAudit(tx, {
      organizationId,
      actorUserId,
      action: 'create',
      entityType: 'TenantPortal',
      entityId: tenant.id,
      after: { source: 'enrollment' },
    });
    return { enrolled: true, replayed: false, tenant: updated };
  });
}

export async function disableTenantPortal(
  prisma: PrismaClient,
  params: { organizationId: string; actorUserId: string; tenantId: string },
) {
  const { organizationId, actorUserId, tenantId } = params;
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId, organizationId, deletedAt: null } });
    if (!tenant) throw badRequest('Tenant not found in this organization');
    if (!tenant.userId) return { enrolled: false };
    await tx.membership.updateMany({
      where: { organizationId, userId: tenant.userId },
      data: { status: 'disabled' },
    });
    await tx.user.update({ where: { id: tenant.userId }, data: { isActive: false } });
    await tx.tenant.update({ where: { id: tenant.id }, data: { portalEnabledAt: null } });
    await recordAudit(tx, {
      organizationId,
      actorUserId,
      action: 'update',
      entityType: 'TenantPortal',
      entityId: tenant.id,
      after: { enabled: false },
    });
    return { enrolled: false };
  });
}
