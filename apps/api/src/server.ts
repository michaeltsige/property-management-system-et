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

  // Fail fast if the database is unreachable or migrations have not been
  // applied — but not *instantly*: Neon's free tier sleeps and needs a few
  // seconds to wake on the first connection, and platforms that kill
  // containers which never bind a port make a one-shot ping fatal. Retry
  // with backoff before giving up.
  const BOOT_PING_ATTEMPTS = 5;
  const BOOT_PING_BACKOFF_MS = 5_000;
  for (let attempt = 1; attempt <= BOOT_PING_ATTEMPTS; attempt += 1) {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      break;
    } catch (error) {
      if (attempt === BOOT_PING_ATTEMPTS) {
        logger.fatal({ err: error }, 'Cannot reach the database. Is Postgres running and migrated?');
        process.exit(1);
      }
      logger.warn(
        { err: error, attempt, of: BOOT_PING_ATTEMPTS },
        `Database not reachable (attempt ${attempt}/${BOOT_PING_ATTEMPTS}) — retrying in ${BOOT_PING_BACKOFF_MS / 1000}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, BOOT_PING_BACKOFF_MS));
    }
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
