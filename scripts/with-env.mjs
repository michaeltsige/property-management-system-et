/**
 * Environment loading for the repository's own scripts.
 *
 * One file, one place: `.env` lives at the repository root (copy `.env.example`),
 * and `apps/api/.env` may override individual values for the API only. Docker
 * Compose, Prisma, the seed script, the dev bootstrap and the applications all
 * read the same values, so there is never a second copy to keep in sync.
 *
 * Values already present in the real environment always win, exactly like dotenv:
 * CI and production never depend on a file on disk.
 *
 * Usage as a command:
 *   node scripts/with-env.mjs pnpm --filter @pms/api db:deploy
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files searched, most specific first: the first definition of a key wins. */
export const ENV_FILES = [resolve(ROOT, 'apps/api/.env'), resolve(ROOT, '.env')];

/**
 * Minimal `.env` parser: `KEY=value`, optional `export `, `#` comments, single or
 * double quotes. No variable interpolation, no multi-line values — if a value
 * needs those, it belongs in the real environment, not in a file.
 */
export function parseEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator === -1) continue;
    const key = withoutExport.slice(0, separator).trim();
    let value = withoutExport.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    else value = value.split(/\s+#/)[0].trim();
    if (key) values[key] = value;
  }
  return values;
}

/**
 * Fills `process.env` from the files above (real environment wins), and returns
 * the list of files that were actually read.
 */
export function loadEnv(target = process.env) {
  const loaded = [];
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    const values = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (target[key] === undefined) target[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

/** Default `DATABASE_URL` when nothing is configured: the docker-compose database. */
export function databaseUrlFromEnv(target = process.env) {
  return target.DATABASE_URL ?? 'postgresql://pms:pms@localhost:5432/pms_dev?schema=public';
}

function run() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('usage: node scripts/with-env.mjs <command> [args...]');
    process.exit(2);
  }

  const loaded = loadEnv();
  if (loaded.length === 0 && process.env.DATABASE_URL === undefined) {
    console.warn(
      '[with-env] No .env found. Copy the example first: cp .env.example .env  (never commit it.)',
    );
  }

  const child = spawn([command, ...args].join(' '), {
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
