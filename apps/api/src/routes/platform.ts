/**
 * Platform administration: the SaaS operator console.
 *
 * Every route here requires `isPlatformAdmin` (the flag comes from the database
 * on every request, so flipping it takes effect immediately). The console works
 * across organizations — it is the only API surface that does — and every
 * mutation is audit-logged against the affected organization with the operator
 * as the actor.
 *
 * Scope notes:
 * - Lifecycle: suspending or closing an organization blocks every future
 *   request from its staff (membership re-read per request) and its tenants
 *   (OTP login re-checks the org), and revokes its live sessions. `closed` is
 *   final by policy — there is no reopen, because a closed customer's data may
 *   already be scheduled for deletion.
 * - Billing: subscriptions are managed offline for now (invoices/bank
 *   transfer), because Chapa has no auto-recurring product. The row records
 *   what was agreed: plan, status, period, price. `unitLimit` is enforced when
 *   a unit is created, so an expired/downgraded customer cannot grow into a
 *   plan they have not paid for.
 */

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { PLAN_DEFS, type PlanId } from '@pms/shared';
import { paginationSchema, platformOrgStatusSchema, platformSubscriptionSchema, uuidSchema } from '@pms/shared';

import { getPrisma } from '../lib/prisma.js';
import { conflict, notFound } from '../lib/errors.js';
import { pstr, str } from '../lib/query.js';
import { requireAuth } from '../middleware/context.js';
import { requirePlatformAdmin } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../services/audit.js';

export const platformRouter = Router();

// Everything under /platform is authenticated twice: a valid token first
// (requireAuth populates req.auth), then the platform flag (requirePlatformAdmin).
platformRouter.use('/platform', requireAuth, requirePlatformAdmin());

const idParamsSchema = z.object({ organizationId: uuidSchema });

/** Aggregate portfolio counts for one organization, in one grouped query. */
function countsFor(prisma: Prisma.TransactionClient | ReturnType<typeof getPrisma>, organizationId: string) {
  return Promise.all([
    prisma.membership.count({ where: { organizationId, status: 'active' } }),
    prisma.unit.count({ where: { organizationId, deletedAt: null } }),
    prisma.tenant.count({ where: { organizationId, deletedAt: null } }),
    prisma.lease.count({ where: { organizationId, status: 'active' } }),
    prisma.property.count({ where: { organizationId, deletedAt: null } }),
  ]);
}

type Counts = { members: number; units: number; tenants: number; leases: number; properties: number };

async function countsMap(
  prisma: ReturnType<typeof getPrisma>,
  organizationIds: string[],
): Promise<Map<string, Counts>> {
  const map = new Map<string, Counts>();
  await Promise.all(
    organizationIds.map(async (organizationId) => {
      const [members, units, tenants, leases, properties] = await countsFor(prisma, organizationId);
      map.set(organizationId, { members, units, tenants, leases, properties });
    }),
  );
  return map;
}

// ---------------------------------------------------------------------------
// Stats — the headline numbers of the whole platform
// ---------------------------------------------------------------------------

platformRouter.get('/platform/stats', async (_req, res, next) => {
  try {
    const prisma = getPrisma();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [orgsByStatus, subsByPlan, totalUnits, totalTenants, activeLeases, newOrgs30d, monthPayments] =
      await Promise.all([
        prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.subscription.groupBy({ by: ['plan', 'status'], _count: { _all: true } }),
        prisma.unit.count({ where: { deletedAt: null } }),
        prisma.tenant.count({ where: { deletedAt: null } }),
        prisma.lease.count({ where: { status: 'active' } }),
        prisma.organization.count({ where: { createdAt: { gte: monthAgo } } }),
        // MRR proxy: sum of monthly prices over subscriptions currently in
        // good standing (active or trialing). past_due/cancelled excluded so
        // the number stays honest about money actually being owed-and-current.
        prisma.subscription.aggregate({
          where: { status: { in: ['active', 'trialing'] }, priceMonthlyMinor: { not: null } },
          _sum: { priceMonthlyMinor: true },
        }),
      ]);

    const organizationsByStatus = Object.fromEntries(
      orgsByStatus.map((row) => [row.status, row._count._all]),
    );
    const subscriptionsByPlan = Object.fromEntries(
      subsByPlan.map((row) => [`${row.plan}:${row.status}`, row._count._all]),
    );

    res.json({
      organizations: {
        total: Object.values(organizationsByStatus).reduce((a, b) => a + b, 0),
        byStatus: organizationsByStatus,
        newLast30Days: newOrgs30d,
      },
      subscriptions: { byPlanAndStatus: subscriptionsByPlan },
      portfolio: { units: totalUnits, tenants: totalTenants, activeLeases },
      /** Sum of active/trialing monthly prices, minor units as a string. */
      mrrMinor: (monthPayments._sum.priceMonthlyMinor ?? 0n).toString(),
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Organizations — list and detail
// ---------------------------------------------------------------------------

platformRouter.get(
  '/platform/orgs',
  validate({ query: paginationSchema.partial() }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const search = str(req.query.search);
      const organizations = await prisma.organization.findMany({
        where: search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }] }
          : undefined,
        include: { subscription: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      const counts = await countsMap(prisma, organizations.map((o) => o.id));

      res.json({
        organizations: organizations.map((organization) => {
          const { subscription, ...rest } = organization;
          return {
            ...rest,
            subscription: subscription ? { ...subscription, priceMonthlyMinor: subscription.priceMonthlyMinor?.toString() ?? null } : null,
            counts: counts.get(organization.id) ?? { members: 0, units: 0, tenants: 0, leases: 0, properties: 0 },
          };
        }),
        total: organizations.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

platformRouter.get('/platform/orgs/:organizationId', validate({ params: idParamsSchema }), async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const organizationId = pstr(req, 'organizationId');
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        subscription: true,
        memberships: {
          where: { status: { in: ['active', 'invited'] } },
          include: { user: { select: { id: true, email: true, fullName: true, lastLoginAt: true, isActive: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!organization) throw notFound('Organization not found');

    const [counts, recentPayments, recentAudit] = await Promise.all([
      countsFor(prisma, organizationId).then(([members, units, tenants, leases, properties]) => ({
        members,
        units,
        tenants,
        leases,
        properties,
      })),
      prisma.payment.findMany({
        where: { organizationId, status: 'succeeded' },
        orderBy: { paidAt: 'desc' },
        take: 5,
        select: { id: true, amountMinor: true, currency: true, method: true, status: true, paidAt: true },
      }),
      prisma.auditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, action: true, entityType: true, createdAt: true },
      }),
    ]);

    const { subscription, memberships, ...rest } = organization;
    res.json({
      organization: {
        ...rest,
        subscription: subscription
          ? { ...subscription, priceMonthlyMinor: subscription.priceMonthlyMinor?.toString() ?? null }
          : null,
        counts,
        members: memberships.map((m) => ({
          id: m.id,
          role: m.role,
          status: m.status,
          email: m.user.email,
          fullName: m.user.fullName,
          lastLoginAt: m.user.lastLoginAt,
        })),
        recentPayments: recentPayments.map((p) => ({ ...p, amountMinor: p.amountMinor.toString() })),
        recentAudit,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Lifecycle — suspend / activate / close
// ---------------------------------------------------------------------------

platformRouter.post(
  '/platform/orgs/:organizationId/status',
  validate({ params: idParamsSchema, body: platformOrgStatusSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = pstr(req, 'organizationId');
      const { status, reason } = req.body;

      const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (!organization) throw notFound('Organization not found');
      if (organization.status === status) throw conflict(`Organization is already ${status}`);
      if (organization.status === 'closed') throw conflict('A closed organization cannot change status');
      if (status === 'closed' && organization.status !== 'suspended') {
        // Closing a live customer is a two-step action: suspend first, so the
        // decision is always deliberate and auditable.
        throw conflict('Suspend the organization before closing it');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.organization.update({
          where: { id: organizationId },
          data: { status },
        });
        // Revoke every live session in the organization (staff and portal).
        // Request-scoped enforcement would kick them out on their next call
        // anyway; revoking here means their refresh cookie dies too.
        await tx.authSession.updateMany({
          where: { organizationId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return row;
      });

      await recordAudit(prisma, {
        organizationId,
        actorUserId: req.auth?.userId,
        action: 'update',
        entityType: 'Organization',
        entityId: organizationId,
        before: { status: organization.status },
        after: { status, reason: reason ?? null },
        requestId: req.requestId,
      });

      res.json({ organization: { id: updated.id, status: updated.status } });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Subscription — plan, period, price
// ---------------------------------------------------------------------------

platformRouter.put(
  '/platform/orgs/:organizationId/subscription',
  validate({ params: idParamsSchema, body: platformSubscriptionSchema }),
  async (req, res, next) => {
    try {
      const prisma = getPrisma();
      const organizationId = pstr(req, 'organizationId');
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        include: { subscription: true },
      });
      if (!organization) throw notFound('Organization not found');

      const input = req.body;
      const plan: PlanId = input.plan;
      // unitLimit follows the plan unless the operator overrides it explicitly.
      const unitLimit =
        input.unitLimit !== undefined ? input.unitLimit : (PLAN_DEFS[plan]?.unitLimit ?? null);
      const data = {
        plan,
        status: input.status,
        unitLimit,
        priceMonthlyMinor:
          input.priceMonthlyMinor === undefined
            ? undefined
            : input.priceMonthlyMinor === null
              ? null
              : BigInt(input.priceMonthlyMinor),
        currency: input.currency,
        periodStart: input.periodStart ? new Date(input.periodStart) : undefined,
        periodEnd:
          input.periodEnd === undefined ? undefined : input.periodEnd === null ? null : new Date(input.periodEnd),
        notes: input.notes,
      };

      const subscription = await prisma.subscription.upsert({
        where: { organizationId },
        create: {
          organizationId,
          plan: data.plan,
          status: data.status,
          unitLimit,
          priceMonthlyMinor: data.priceMonthlyMinor ?? null,
          currency: data.currency ?? organization.currency,
          periodStart: data.periodStart ?? new Date(),
          periodEnd: data.periodEnd ?? null,
          notes: data.notes ?? null,
        },
        update: {
          plan: data.plan,
          status: data.status,
          unitLimit,
          priceMonthlyMinor: data.priceMonthlyMinor,
          currency: data.currency,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          notes: data.notes,
        },
      });

      await recordAudit(prisma, {
        organizationId,
        actorUserId: req.auth?.userId,
        action: 'update',
        entityType: 'Subscription',
        entityId: subscription.id,
        before: organization.subscription
          ? { plan: organization.subscription.plan, status: organization.subscription.status }
          : null,
        after: { plan: subscription.plan, status: subscription.status },
        requestId: req.requestId,
      });

      res.json({ subscription: { ...subscription, priceMonthlyMinor: subscription.priceMonthlyMinor?.toString() ?? null } });
    } catch (error) {
      next(error);
    }
  },
);
