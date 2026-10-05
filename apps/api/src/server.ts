/**
 * HTTP entrypoint.
 *
 * Deliberately thin: it validates configuration, checks the database, starts
 * listening and shuts down gracefully. No business logic, and no background jobs —
 * those run in `worker.ts` so that a slow job can never block a request.
 */

import { createApp } from './app.js';
import { configWarnings, loadConfig } from './config.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma, getPrisma } from './lib/prisma.js';

async function main(): Promise<void> {
  const config = loadConfig();

  for (const warning of configWarnings(config)) logger.warn(warning);

  // Fail fast if the database is unreachable or migrations have not been applied.
  try {
    await getPrisma().$queryRaw`SELECT 1`;
  } catch (error) {
    logger.fatal({ err: error }, 'Cannot reach the database. Is Postgres running and migrated?');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(config.API_PORT, config.API_HOST, () => {
    logger.info({ host: config.API_HOST, port: config.API_PORT, env: config.NODE_ENV }, 'pms-api listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
}

void main();
