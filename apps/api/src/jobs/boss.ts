/**
 * pg-boss setup.
 *
 * Jobs live in Postgres (no Redis, as the brief specifies). Everything runs in the
 * worker process only — the web process must never execute a background job, so a
 * slow batch can never stall an API request.
 */

import PgBoss from 'pg-boss';

import { databaseUrl, getConfig } from '../config.js';
import { logger } from '../lib/logger.js';

export const QUEUES = {
  generateCharges: 'charges.generate',
  overdueSweep: 'charges.overdue-sweep',
  sendNotification: 'notifications.send',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export async function createBoss(): Promise<PgBoss> {
  const config = getConfig();
  const boss = new PgBoss({
    connectionString: databaseUrl(config),
    schema: 'pgboss',
    // Keep completed jobs briefly so support can see what ran, then clean up.
    retentionDays: 14,
    max: 4,
  });

  boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));
  await boss.start();
  return boss;
}

/**
 * Create a queue if it does not exist. Idempotent, so it is safe on every worker
 * start. Retry policy is supplied per job when sending (`enqueue`), which is how
 * pg-boss v10 applies it.
 */
export async function ensureQueue(boss: PgBoss, name: QueueName): Promise<void> {
  try {
    await boss.createQueue(name);
  } catch (error) {
    logger.debug({ err: error, queue: name }, 'queue already exists');
  }
}

/** Queue work with an idempotency key derived from the business meaning of the job. */
export async function enqueue(
  boss: PgBoss,
  name: QueueName,
  data: Record<string, unknown>,
  options: { singletonKey?: string; startAfter?: Date | number; retryLimit?: number } = {},
): Promise<string | null> {
  const payload = { ...data, enqueuedAt: new Date().toISOString() };
  return boss.send(name, payload, {
    ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
    ...(options.startAfter ? { startAfter: options.startAfter } : {}),
    ...(options.retryLimit !== undefined ? { retryLimit: options.retryLimit } : {}),
  });
}
