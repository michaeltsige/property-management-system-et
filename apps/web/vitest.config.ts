import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Component and unit tests for the web app.
 *
 * `jsdom` because the shell, the charts and the forms are DOM code; the alias
 * mirrors `tsconfig.json` so tests import exactly what the app imports.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  esbuild: {
    // Next compiles JSX itself (`"jsx": "preserve"` in tsconfig); tests use the
    // automatic runtime directly.
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
