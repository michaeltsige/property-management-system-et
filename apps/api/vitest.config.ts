import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one Postgres database; running files sequentially keeps
    // truncation predictable and avoids serialization noise between suites.
    fileParallelism: false,
    globals: false,
    environment: 'node',
    // Auth tests sign in many times in a row; the limiter gets a generous budget so
    // tests stay deterministic. The limiter itself is covered by rate-limit.test.ts.
    env: {
      RATE_LIMIT_AUTH_MAX: '1000',
      // Uploads in tests never touch the developer's real storage directory.
      STORAGE_LOCAL_DIR: './.test-storage',
    },
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
});
