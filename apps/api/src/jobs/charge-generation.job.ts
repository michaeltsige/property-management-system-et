/**
 * Monthly charge generation job.
 *
 * For every active organization, generate rent charges for the current period in
 * that organization's default calendar — and, on the first run of the month, catch
 * up on the previous period so a missed run is repaired automatically.
 *
 * Double safety: the job is idempotent (the `Charge` unique constraint), and each
 * organization/period pair also writes a `JobRun` row with a unique idempotency
 * key, so a duplicate calendar trigger is visible rather than silent.
 */

import type { PrismaClient } from '@prisma/client';

import { periodForDate, shiftPeriod, todayIn, type BillingPeriod, type CalendarKind } from '@pms/calendar';

import { generateCharges } from '../services/charges.js';
import { enqueue, QUEUES } from './boss.js';
import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger.js';

export interface ChargeGenerationPayload {
  organizationId?: string;
  periodKeys?: string[];
  triggeredBy?: 'schedule' | 'manual';
}

export async function runChargeGeneration(
  prisma: PrismaClient,
  payload: ChargeGenerationPayload,
): Promise<{ organizations: number; created: number; skippedExisting: number; skippedJobRuns: number }> {
  const organizations = await prisma.organization.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      ...(payload.organizationId ? { id: payload.organizationId } : {}),
    },
    select: { id: true, calendar: true, name: true },
  });

  let created = 0;
  let skippedExisting = 0;
  let skippedJobRuns = 0;

  for (const organization of organizations) {
    const calendar = (organization.calendar === 'gregorian' ? 'gregorian' : 'ethiopian') as CalendarKind;
    const current = periodForDate(todayIn(calendar));
    // Catch up on the previous period too: cron misses happen (deploys, outages).
    const periods: BillingPeriod[] = payload.periodKeys?.length ? [] : [shiftPeriod(current, -1), current];

    const periodKeys = payload.periodKeys?.length ? payload.periodKeys : periods.map((period) => period.key);

    for (const periodKey of periodKeys) {
      const idempotencyKey = `${organization.id}:${periodKey}`;
      try {
        const jobRun = await prisma.jobRun.create({
          data: {
            jobName: QUEUES.generateCharges,
            organizationId: organization.id,
            idempotencyKey,
            status: 'running',
          },
        });

        const result = await generateCharges(prisma, {
          organizationId: organization.id,
          periodKeys: [periodKey],
          skipNotYetStarted: true,
        });

        created += result.created;
        skippedExisting += result.skippedExisting;

        await prisma.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: 'succeeded',
            finishedAt: new Date(),
            result: { created: result.created, skippedExisting: result.skippedExisting },
          },
        });
      } catch (error) {
        // Unique violation on (jobName, idempotencyKey): this period was already
        // processed for this organization.
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
          skippedJobRuns += 1;
          continue;
        }
        logger.error({ err: error, organizationId: organization.id, periodKey }, 'charge generation failed');
        await prisma.jobRun.updateMany({
          where: { jobName: QUEUES.generateCharges, idempotencyKey, status: 'running' },
          data: { status: 'failed', finishedAt: new Date(), error: String(error) },
        });
        throw error;
      }
    }
  }

  return { organizations: organizations.length, created, skippedExisting, skippedJobRuns };
}

/** Register the recurring schedule (called by the worker). */
export async function scheduleChargeGeneration(boss: PgBoss, cron: string): Promise<void> {
  await boss.schedule(QUEUES.generateCharges, cron, { triggeredBy: 'schedule' });
}

export async function handleChargeGeneration(
  boss: PgBoss,
  prisma: PrismaClient,
  payload: ChargeGenerationPayload,
) {
  const result = await runChargeGeneration(prisma, payload);
  logger.info(result, 'charge generation finished');
  void boss;
  void enqueue;
  return result;
}
