/**
 * Vitest global setup.
 *
 * Applies migrations to the **test** database before the suite runs. It refuses to
 * touch anything whose name does not end in `_test`, so a misconfigured
 * TEST_DATABASE_URL fails loudly instead of truncating development data.
 */

import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

export default function globalSetup(): void {
  loadEnv({ path: new URL('../../.env', import.meta.url).pathname });

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL must be set to run the API test suite');
  }
  const databaseName = new URL(testUrl).pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${databaseName}": the test database name must end with "_test"`,
    );
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: new URL('../../', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
