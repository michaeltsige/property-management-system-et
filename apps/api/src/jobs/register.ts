/**
 * Worker registration: schedules and handlers.
 *
 * Intervals come from configuration (`WORKER_CRON_*`) so operations can change
 * them without a code change; the queries themselves are timezone-agnostic in UTC,
 * and the Ethiopian calendar is applied when periods are computed.
 */

import type PgBoss from 'pg-boss';
import type { PrismaClient } from '@prisma/client';

import { getConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { ensureQueue, QUEUES } from './boss.js';
import {
  handleChargeGeneration,
  scheduleChargeGeneration,
  type ChargeGenerationPayload,
} from './charge-generation.job.js';
import { runOverdueSweep, type OverdueSweepPayload } from './overdue-sweep.job.js';

export async function registerWorkers(boss: PgBoss, prisma: PrismaClient): Promise<void> {
  const config = getConfig();

  for (const queue of Object.values(QUEUES)) {
    await ensureQueue(boss, queue);
  }

  await boss.work<ChargeGenerationPayload>(QUEUES.generateCharges, async (jobs) => {
    for (const job of jobs) {
      await handleChargeGeneration(boss, prisma, job.data ?? {});
    }
  });

  await boss.work<OverdueSweepPayload>(QUEUES.overdueSweep, async (jobs) => {
    for (const job of jobs) {
      const result = await runOverdueSweep(prisma, job.data ?? {});
      logger.info(result, 'overdue sweep finished');
    }
  });

  if (config.isProduction || config.JOBS_ENABLED) {
    await scheduleChargeGeneration(boss, config.WORKER_CRON_CHARGE_GENERATION);
    await boss.schedule(QUEUES.overdueSweep, config.WORKER_CRON_OVERDUE_SWEEP, {});
    logger.info(
      {
        chargeGeneration: config.WORKER_CRON_CHARGE_GENERATION,
        overdueSweep: config.WORKER_CRON_OVERDUE_SWEEP,
      },
      'background job schedules registered',
    );
  }
}
