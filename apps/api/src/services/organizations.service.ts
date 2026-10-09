/**
 * Organization settings and membership management.
 *
 * Settings are stored as individual rows so that every change is a data edit with
 * an audit trail, and so the tax/legal values required by the brief never live in
 * code. Reads fall back to `DEFAULT_ORG_SETTINGS` for keys that have not been set.
 */

import type { PrismaClient } from '@prisma/client';

import { DEFAULT_ORG_SETTINGS, PAYMENT_GATEWAY_SETTING_KEY, type Role, type UpdateOrganizationSettings } from '@pms/shared';

import { conflict, notFound } from '../lib/errors.js';
import { generateRefreshToken, hashPassword } from '../lib/crypto.js';
import { recordAudit } from './audit.js';

/** Invitation tokens use the same shape as refresh tokens: opaque, stored hashed. */
function generateInviteToken(): { token: string; hash: string } {
  return generateRefreshToken();
}

export type ResolvedSettings = typeof DEFAULT_ORG_SETTINGS & Record<string, unknown>;

export async function getOrganization(prisma: PrismaClient, organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
  });
  if (!organization) throw notFound('Organization not found');
  return organization;
}

export async function getSettings(prisma: PrismaClient, organizationId: string): Promise<ResolvedSettings> {
  const [organization, rows] = await Promise.all([
    getOrganization(prisma, organizationId),
    prisma.organizationSetting.findMany({ where: { organizationId } }),
  ]);

  const fromRows: Record<string, unknown> = {};
  for (const row of rows) {
    // The payment gateway row holds encrypted merchant credentials and has its
    // own masked endpoints — it must never ride along with generic settings.
    if (row.key === PAYMENT_GATEWAY_SETTING_KEY) continue;
    fromRows[row.key] = row.value;
  }

  return {
    ...DEFAULT_ORG_SETTINGS,
    ...fromRows,
    // These three live on the organization row itself, not in the settings table.
    currency: organization.currency,
    defaultCalendar: organization.calendar,
    defaultLanguage: organization.language,
  } as ResolvedSettings;
}

export async function updateSettings(
  prisma: PrismaClient,
  params: { organizationId: string; actorUserId: string; patch: UpdateOrganizationSettings },
) {
  const { organizationId, actorUserId, patch } = params;

  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx as unknown as PrismaClient, organizationId);

    const organizationFields: Record<string, unknown> = {};
    if (patch.currency) organizationFields.currency = patch.currency;
    if (patch.defaultCalendar) organizationFields.calendar = patch.defaultCalendar;
    if (patch.defaultLanguage) organizationFields.language = patch.defaultLanguage;
    if (Object.keys(organizationFields).length > 0) {
      await tx.organization.update({ where: { id: organizationId }, data: organizationFields });
    }

    const settingEntries = Object.entries(patch).filter(
      ([key]) => !['currency', 'defaultCalendar', 'defaultLanguage'].includes(key),
    );
    for (const [key, value] of settingEntries) {
      if (value === undefined) continue;
      await tx.organizationSetting.upsert({
        where: { organizationId_key: { organizationId, key } },
        create: { organizationId, key, value: value as never, updatedById: actorUserId },
        update: { value: value as never, updatedById: actorUserId },
      });
    }

    const after = await getSettings(tx as unknown as PrismaClient, organizationId);

    await recordAudit(tx, {
      organizationId,
      actorUserId,
      action: 'update',
      entityType: 'OrganizationSetting',
      entityId: organizationId,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });

    return after;
  });
}

export async function listMembers(prisma: PrismaClient, organizationId: string) {
  const members = await prisma.membership.findMany({
    where: { organizationId },
    include: { user: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  return members.map((membership) => ({
    id: membership.id,
    userId: membership.userId,
    email: membership.user.email,
    fullName: membership.user.fullName,
    role: membership.role,
    status: membership.status,
    lastLoginAt: membership.user.lastLoginAt,
    createdAt: membership.createdAt,
  }));
}

/**
 * Invite a user by email.
 *
 * If the person already has an account they are attached to this organization; if
 * not, a placeholder account is created with a random unusable password. Either
 * way the membership starts as `invited` and the invitee activates it by
 * redeeming the returned single-use token (POST /auth/accept-invite), which sets
 * their password. The token is returned once — it is up to the client to hand it
 * to the invitee (link or message) until email delivery exists.
 */
const INVITE_TTL_DAYS = 14;

export async function inviteMember(
  prisma: PrismaClient,
  params: { organizationId: string; actorUserId: string; email: string; role: Role; fullName?: string },
) {
  const { organizationId, actorUserId, email, role } = params;

  return prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { email } });
    const user =
      existingUser ??
      (await tx.user.create({
        data: {
          email,
          fullName: params.fullName ?? email.split('@')[0] ?? email,
          passwordHash: await hashPassword(crypto.randomUUID() + crypto.randomUUID()),
        },
      }));

    const existingMembership = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (existingMembership) throw conflict('This person is already a member of the organization');

    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const membership = await tx.membership.create({
      data: {
        organizationId,
        userId: user.id,
        role,
        status: 'invited',
        invitedById: actorUserId,
        invitedAt: new Date(),
        inviteTokenHash: hash,
        inviteExpiresAt: expiresAt,
      },
    });

    await recordAudit(tx, {
      organizationId,
      actorUserId,
      action: 'create',
      entityType: 'Membership',
      entityId: membership.id,
      after: { email, role, status: membership.status },
    });

    return { membership, invite: { token, expiresAt, email } };
  });
}

/**
 * Re-issue the invite token for a membership that is still `invited` (e.g. the
 * first token expired or was lost). Active memberships have nothing to redeem.
 */
export async function resendInvite(
  prisma: PrismaClient,
  params: { organizationId: string; actorUserId: string; membershipId: string },
) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: params.membershipId, organizationId: params.organizationId },
      include: { user: true },
    });
    if (!membership) throw notFound('Membership not found in this organization');
    if (membership.status !== 'invited') {
      throw conflict('This membership is already active; no invitation is pending');
    }

    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    await tx.membership.update({
      where: { id: membership.id },
      data: { inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedAt: new Date() },
    });

    await recordAudit(tx, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      action: 'update',
      entityType: 'Membership',
      entityId: membership.id,
      after: { inviteResent: true, inviteExpiresAt: expiresAt.toISOString() },
    });

    return { invite: { token, expiresAt, email: membership.user.email } };
  });
}

export async function updateMembership(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    actorUserId: string;
    membershipId: string;
    patch: { role?: Role; status?: 'active' | 'disabled' };
  },
) {
  const { organizationId, actorUserId, membershipId, patch } = params;

  return prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({ where: { id: membershipId, organizationId } });
    if (!membership) throw notFound('Membership not found in this organization');

    const owners = await tx.membership.count({
      where: { organizationId, role: 'owner_admin', status: 'active' },
    });
    const demotingLastOwner =
      membership.role === 'owner_admin' &&
      owners <= 1 &&
      ((patch.role !== undefined && patch.role !== 'owner_admin') || patch.status === 'disabled');
    if (demotingLastOwner) {
      throw conflict('An organization must always keep at least one active owner/admin');
    }

    const updated = await tx.membership.update({
      where: { id: membership.id },
      data: {
        ...(patch.role ? { role: patch.role } : {}),
        ...(patch.status ? { status: patch.status } : {}),
      },
    });

    await recordAudit(tx, {
      organizationId,
      actorUserId,
      action: 'update',
      entityType: 'Membership',
      entityId: membership.id,
      before: { role: membership.role, status: membership.status },
      after: { role: updated.role, status: updated.status },
    });

    return updated;
  });
}
