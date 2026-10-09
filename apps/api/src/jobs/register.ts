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
import { runLeaseExpirySweep, type LeaseExpiryPayload } from './lease-expiry.job.js';
import { runSendNotification, type SendNotificationPayload } from './send-notification.job.js';

export type JobPayloadMap = {
  [QUEUES.generateCharges]: ChargeGenerationPayload;
  [QUEUES.overdueSweep]: OverdueSweepPayload;
  [QUEUES.leaseExpirySweep]: LeaseExpiryPayload;
  [QUEUES.sendNotification]: SendNotificationPayload;
};

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

  await boss.work<LeaseExpiryPayload>(QUEUES.leaseExpirySweep, async (jobs) => {
    for (const job of jobs) {
      const result = await runLeaseExpirySweep(prisma, job.data ?? {});
      logger.info(result, 'lease expiry sweep finished');
    }
  });

  await boss.work<SendNotificationPayload>(QUEUES.sendNotification, async (jobs) => {
    for (const job of jobs) {
      const result = await runSendNotification(prisma, job.data ?? {});
      logger.info(result, 'notification dispatch finished');
    }
  });

  if (config.isProduction || config.JOBS_ENABLED) {
    await scheduleChargeGeneration(boss, config.WORKER_CRON_CHARGE_GENERATION);
    await boss.schedule(QUEUES.overdueSweep, config.WORKER_CRON_OVERDUE_SWEEP, {});
    await boss.schedule(QUEUES.leaseExpirySweep, '0 3 * * *', {});
    logger.info(
      {
        chargeGeneration: config.WORKER_CRON_CHARGE_GENERATION,
        overdueSweep: config.WORKER_CRON_OVERDUE_SWEEP,
        leaseExpirySweep: '0 3 * * *',
      },
      'background job schedules registered',
    );
  }
}
