/**
 * Prisma client singleton.
 *
 * In tests we point Prisma at `TEST_DATABASE_URL` explicitly, so a misconfigured
 * test run can never wipe the development database.
 */

import { PrismaClient } from '@prisma/client';

import { databaseUrl, getConfig } from '../config.js';

let client: PrismaClient | null = null;

export function createPrismaClient(overrideUrl?: string): PrismaClient {
  const config = getConfig();
  const url = overrideUrl ?? databaseUrl(config);
  return new PrismaClient({
    datasources: { db: { url } },
    log: config.isDevelopment ? ['warn', 'error'] : ['error'],
  });
}

export function getPrisma(): PrismaClient {
  if (!client) client = createPrismaClient();
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
