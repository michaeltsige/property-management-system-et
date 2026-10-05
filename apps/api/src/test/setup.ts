/**
 * Per-file test setup: load `.env`, assert the test-database guard, and expose
 * helpers for truncating the database between tests.
 */

import { config as loadEnv } from 'dotenv';
import { afterAll, beforeEach } from 'vitest';

import { databaseUrl, getConfig } from '../config.js';
import { getPrisma, disconnectPrisma } from '../lib/prisma.js';

loadEnv({ path: new URL('../../.env', import.meta.url).pathname });

// Fail fast if tests are somehow pointed at a non-test database.
const url = databaseUrl(getConfig());
const databaseName = new URL(url).pathname.replace(/^\//, '').split('?')[0] ?? '';
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refusing to run tests against "${databaseName}": expected a database ending in "_test"`);
}

/** Tables wiped between tests, in an order that ignores foreign keys (TRUNCATE ... CASCADE). */
const TABLES = [
  'PaymentAllocation',
  'LedgerEntry',
  'Charge',
  'Payment',
  'LeaseCoTenant',
  'Lease',
  'WorkOrder',
  'Document',
  'TenantIdDocument',
  'Tenant',
  'Unit',
  'Property',
  'Vendor',
  'Notification',
  'TranslationRevision',
  'TranslationOverride',
  'TaxRule',
  'AuditLog',
  'JobRun',
  'AuthSession',
  'Membership',
  'OrganizationSetting',
  'Organization',
  'User',
];

export async function truncateAll(): Promise<void> {
  const prisma = getPrisma();
  const quoted = TABLES.map((table) => `"public"."${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await disconnectPrisma();
});
