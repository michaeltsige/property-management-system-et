/**
 * Subscription-aware limit enforcement.
 *
 * The unit cap is the one plan limit enforced in code right now. An
 * organization with no subscription row is treated as unlimited — that keeps
 * direct database fixtures (tests, seeds) working and gives the operator a
 * clean "no billing relationship yet" state instead of a default cap.
 */

import type { PrismaClient } from '@prisma/client';

import { businessRule } from '../lib/errors.js';

/**
 * Throws 422 when adding `adding` units would exceed the organization's
 * subscription `unitLimit`. Call before every unit-creation path: manual
 * create, bulk create, CSV import.
 */
export async function assertUnitAllowance(
  prisma: PrismaClient,
  organizationId: string,
  adding: number,
): Promise<void> {
  if (adding <= 0) return;

  const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
  // No row / no cap / cancelled-but-still-unlimited: nothing to enforce.
  if (!subscription || subscription.unitLimit == null) return;

  const current = await prisma.unit.count({ where: { organizationId, deletedAt: null } });
  if (current + adding > subscription.unitLimit) {
    const room = Math.max(0, subscription.unitLimit - current);
    throw businessRule(
      room === 0
        ? `Your plan allows ${subscription.unitLimit} units and every slot is used. Upgrade the plan to add more.`
        : `Your plan allows ${subscription.unitLimit} units; ${room} slot(s) remain. Reduce the selection or upgrade the plan.`,
      { unitLimit: subscription.unitLimit, currentUnits: current, requested: adding },
    );
  }
}
