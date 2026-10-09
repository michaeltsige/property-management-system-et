/**
 * Lease expiry sweep.
 *
 * Active leases whose end date has passed become `expired` — the same terminal
 * state the PATCH endpoint enforces — and their unit is freed when nothing else
 * holds it. Without this sweep a lease whose term ended stays `active` forever:
 * it keeps appearing in rent rolls and charge generation, and the unit never
 * shows as vacant.
 */

import type { PrismaClient } from '@prisma/client';

import { logger } from '../lib/logger.js';

export interface LeaseExpiryPayload {
  organizationId?: string;
}

export interface LeaseExpiryResult {
  leasesExpired: number;
  unitsFreed: number;
}

export async function runLeaseExpirySweep(
  prisma: PrismaClient,
  payload: LeaseExpiryPayload = {},
  now: Date = new Date(),
): Promise<LeaseExpiryResult> {
  const result: LeaseExpiryResult = { leasesExpired: 0, unitsFreed: 0 };

  // End dates are stored at UTC midnight; a lease is expired the day after its
  // end date begins. Compare against the start of today so the end date itself
  // is still inside the term.
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const stale = await prisma.lease.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      endDate: { lt: todayStart },
      ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
    },
    select: { id: true, organizationId: true, unitId: true, endDate: true },
    take: 1000,
  });

  for (const lease of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.lease.update({
          where: { id: lease.id },
          data: { status: 'expired' },
        });

        const remaining = await tx.lease.count({
          where: {
            organizationId: lease.organizationId,
            unitId: lease.unitId,
            id: { not: lease.id },
            status: { in: ['pending', 'active'] },
            deletedAt: null,
          },
        });
        if (remaining === 0) {
          await tx.unit.update({ where: { id: lease.unitId }, data: { status: 'vacant' } });
          result.unitsFreed += 1;
        }
      });
      result.leasesExpired += 1;
    } catch (error) {
      logger.warn({ err: error, leaseId: lease.id }, 'lease expiry failed for one lease');
    }
  }

  return result;
}
