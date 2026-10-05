/**
 * Background worker entrypoint.
 *
 * Runs separately from the API (`pnpm worker` / `node dist/worker.js`) so that
 * scheduled jobs never occupy a web request. Two modes:
 *
 *   node dist/worker.js                     -> long-running worker + scheduler
 *   node dist/worker.js --once=charges.generate   -> run one job now and exit
 *
 * The `--once` mode is what a plain cron/Task Scheduler entry should call on a
 * small single-machine deployment.
 */

import { configWarnings, loadConfig } from './config.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma, getPrisma } from './lib/prisma.js';
import { createBoss, QUEUES } from './jobs/boss.js';
import { handleChargeGeneration } from './jobs/charge-generation.job.js';
import { runOverdueSweep } from './jobs/overdue-sweep.job.js';
import { registerWorkers } from './jobs/register.js';

function parseOnceArgument(argv: string[]): string | null {
  const flag = argv.find((arg) => arg.startsWith('--once'));
  if (!flag) return null;
  const [, value] = flag.split('=');
  return value ?? 'charges.generate';
}

async function main(): Promise<void> {
  const config = loadConfig();
  for (const warning of configWarnings(config)) logger.warn(warning);

  const prisma = getPrisma();
  const once = parseOnceArgument(process.argv);

  if (once) {
    logger.info({ job: once }, 'running a single job');
    const boss = null as unknown as undefined;
    void boss;

    if (once === QUEUES.generateCharges || once === QUEUES.generateCharges.replace('.', '.')) {
      const result = await handleChargeGeneration({} as never, prisma, { triggeredBy: 'manual' });
      logger.info(result, 'charge generation completed');
    } else if (once === QUEUES.overdueSweep) {
      const result = await runOverdueSweep(prisma);
      logger.info(result, 'overdue sweep completed');
    } else {
      logger.error({ job: once }, 'unknown job');
      process.exitCode = 1;
    }

    await disconnectPrisma();
    return;
  }

  const boss = await createBoss();
  await registerWorkers(boss, prisma);
  logger.info('pms worker started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    await boss.stop({ graceful: true, timeout: 15_000 });
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
