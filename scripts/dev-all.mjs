#!/usr/bin/env node
/**
 * One command to get a working local stack:
 *
 *   pnpm dev:all
 *
 *  1. starts PostgreSQL through Docker Compose (skipped, with a warning, when the
 *     Docker daemon is unavailable and a database is already reachable),
 *  2. waits until the database accepts connections,
 *  3. builds the shared workspace packages (`@pms/*`) — the apps import their
 *     compiled output, so a clean clone has nothing to run without this step,
 *  4. applies migrations (`migrate deploy` — safe to run every time),
 *  5. seeds fake demo data (idempotent: skipped when the demo organization exists),
 *  6. starts the API, the job worker and the web app, all bound to 0.0.0.0,
 *  7. waits for the API to answer, and only then prints the summary — if a process
 *     died, it says so instead of pretending everything is fine.
 *
 * Written for small machines (Google Cloud Shell included, ~2 GB of RAM): the heap
 * caps are sized from the machine's total memory, telemetry is off, each app is
 * started directly from its own node_modules/.bin (one Node process per app, no
 * pnpm wrapper in between), and the processes share one terminal with prefixed
 * output. `Ctrl-C` stops all of them.
 *
 * Flags: --port <n> | --skip-docker | --skip-seed | --skip-install | --skip-worker
 *        --watch-packages | --help
 * Env:   WEB_PORT, API_HEAP_MB, WEB_HEAP_MB, WORKER_HEAP_MB, DATABASE_URL
 */

import { buildWorkspaces } from './build-workspaces.mjs';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { databaseUrlFromEnv, loadEnv } from './with-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = resolve(ROOT, 'apps/api');
const WEB_DIR = resolve(ROOT, 'apps/web');
const WORKSPACE_PACKAGES = ['calendar', 'shared', 'i18n'];
const IN_CLOUD_SHELL = process.env.CLOUD_SHELL === 'true';

/**
 * Path to a binary in a workspace's own node_modules/.bin directory. Running it
 * directly instead of through `pnpm exec` removes a Node wrapper process per app,
 * which matters on a 2 GB machine.
 */
function bin(directory, name) {
  const candidate = resolve(directory, 'node_modules/.bin', name);
  return existsSync(candidate) ? candidate : name;
}

// ---------------------------------------------------------------------------
// flags & env
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {
    docker: true,
    seed: true,
    install: true,
    worker: true,
    watchPackages: false,
    port: undefined,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--skip-docker') flags.docker = false;
    else if (arg === '--skip-seed') flags.seed = false;
    else if (arg === '--skip-install') flags.install = false;
    else if (arg === '--skip-worker') flags.worker = false;
    else if (arg === '--watch-packages') flags.watchPackages = true;
    else if (arg === '--port') flags.port = argv[++i];
    else if (arg.startsWith('--port=')) flags.port = arg.slice('--port='.length);
    else {
      console.error(`[dev] unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));

if (flags.help) {
  console.log(`pnpm dev:all — packages, database, migrations, seed, API, worker and web

  --port <n>         web port (default ${process.env.WEB_PORT ?? 3000})
  --skip-docker      never touch Docker; use the DATABASE_URL that is already running
  --skip-seed        do not run the demo seed
  --skip-install     do not check that dependencies are installed
  --skip-worker      do not run the background job worker (saves ~100 MB)
  --watch-packages   keep rebuilding @pms/* while you edit them (one extra process)
  --help             this text
`);
  process.exit(0);
}

const loadedFiles = loadEnv();
const PORT = Number(flags.port ?? process.env.WEB_PORT ?? 3000);
const API_PORT = Number(process.env.API_PORT ?? 4000);

/** Total RAM in MiB, used to size the heap caps below. */
function totalMemoryMb() {
  try {
    const match = /MemTotal:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'));
    if (match) return Math.round(Number(match[1]) / 1024);
  } catch {
    /* not Linux: fall through */
  }
  return 4096;
}

const TOTAL_MB = totalMemoryMb();
const SMALL_MACHINE = TOTAL_MB <= 2400; // Cloud Shell, small VMs, containers
const API_HEAP_MB = process.env.API_HEAP_MB ?? (SMALL_MACHINE ? '320' : '512');
const WEB_HEAP_MB = process.env.WEB_HEAP_MB ?? (SMALL_MACHINE ? '512' : '1024');
const WORKER_HEAP_MB = process.env.WORKER_HEAP_MB ?? (SMALL_MACHINE ? '256' : '384');

const children = [];
let shuttingDown = false;

// ---------------------------------------------------------------------------
// process helpers
// ---------------------------------------------------------------------------

const COLORS = { api: '\u001b[36m', worker: '\u001b[35m', web: '\u001b[32m', dev: '\u001b[33m' };
const RESET = '\u001b[0m';

function log(scope, message) {
  const color = COLORS[scope] ?? '';
  for (const line of String(message).split('\n')) {
    console.log(`${color}[${scope.padEnd(6)}]${RESET} ${line}`);
  }
}

function runOnce(scope, command, args, options = {}) {
  return new Promise((resolvePromise) => {
    log(scope, `${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.quiet ? 'ignore' : 'inherit',
      shell: false,
    });
    child.on('exit', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}

function start(scope, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group: Ctrl-C and shutdown reach the whole tree
  });
  child.stdout.on('data', (chunk) => log(scope, chunk.toString().trimEnd()));
  child.stderr.on('data', (chunk) => log(scope, chunk.toString().trimEnd()));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `was killed (${signal})` : `exited with code ${code ?? 0}`;
    log(scope, `${reason} — stopping the other processes`);
    if (signal === 'SIGKILL') {
      log(scope, 'SIGKILL usually means the machine ran out of memory. Lower the caps with');
      log(scope, 'API_HEAP_MB / WEB_HEAP_MB, or close other work and try again.');
    }
    shutdown(code ?? 1);
  });
  children.push({ scope, child });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    for (const { child } of children) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    process.exit(code);
  }, 1500).unref();
}

process.on('SIGINT', () => {
  log('dev', 'stopping…');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

/** Host and port from DATABASE_URL, used to wait for the server to come up. */
function databaseTarget() {
  try {
    const url = new URL(databaseUrlFromEnv());
    return { host: url.hostname, port: Number(url.port || 5432) };
  } catch {
    return { host: 'localhost', port: 5432 };
  }
}

function canConnect({ host, port }, timeoutMs = 1500) {
  return new Promise((done) => {
    const socket = createConnection({ host, port });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

async function waitForDatabase(seconds) {
  const target = databaseTarget();
  const deadline = Date.now() + seconds * 1000;
  let announced = false;
  while (Date.now() < deadline) {
    if (await canConnect(target)) return true;
    if (!announced) {
      log('dev', `waiting for PostgreSQL on ${target.host}:${target.port}…`);
      announced = true;
    }
    await sleep(1000);
  }
  return false;
}

async function dockerInfo() {
  return (await runOnce('dev', 'docker', ['info'], { quiet: true })) === 0;
}

async function startDatabase() {
  if (!flags.docker) {
    log('dev', 'Docker skipped (--skip-docker): using DATABASE_URL as-is');
    return;
  }

  let dockerReady = await dockerInfo();
  if (!dockerReady && IN_CLOUD_SHELL) {
    log('dev', 'Docker daemon is not running — starting it (Cloud Shell)…');
    await runOnce('dev', 'sudo', ['-n', 'service', 'docker', 'start'], { quiet: true });
    for (let attempt = 0; attempt < 15 && !dockerReady; attempt += 1) {
      await sleep(1000);
      dockerReady = await dockerInfo();
    }
  }

  if (!dockerReady) {
    log('dev', 'Docker is unavailable: assuming a PostgreSQL server is already reachable at DATABASE_URL.');
    return;
  }

  await runOnce('dev', 'docker', ['compose', 'up', '-d', 'postgres']);
}

async function ensureDependencies() {
  if (!flags.install) return;
  if (!existsSync(resolve(ROOT, 'node_modules')) || !existsSync(resolve(WEB_DIR, 'node_modules'))) {
    log('dev', 'installing dependencies (first run)…');
    const code = await runOnce('dev', 'pnpm', ['install']);
    if (code !== 0) {
      log('dev', 'pnpm install failed — fix the error above and re-run pnpm dev:all');
      process.exit(code);
    }
  }
}

/** The compiled output every app imports; a clean clone has none. */
function packagesBuilt() {
  return WORKSPACE_PACKAGES.every((name) => existsSync(resolve(ROOT, 'packages', name, 'dist', 'index.js')));
}

async function buildPackages() {
  await buildWorkspaces(runOnce, packagesBuilt, log);
}

/**
 * The Prisma client is generated by `pnpm install` (apps/api postinstall), but a
 * schema change, a cleared node_modules or a different package manager can leave it
 * missing — and then nothing in the API runs at all. Cheap to make certain of.
 */
async function generatePrismaClient() {
  const code = await runOnce('dev', 'pnpm', ['--filter', '@pms/api', 'db:generate'], {
    quiet: true,
  });
  if (code !== 0) {
    log('dev', 'prisma generate failed — run it yourself to see why:');
    log('dev', 'pnpm --filter @pms/api db:generate');
    process.exit(code);
  }
}

async function migrate() {
  const code = await runOnce('dev', 'pnpm', ['--filter', '@pms/api', 'db:deploy']);
  if (code !== 0) {
    log('dev', 'migrations failed. If the database is brand new, check DATABASE_URL in .env.');
    process.exit(code);
  }
}

async function seed() {
  if (!flags.seed) {
    log('dev', 'seed skipped (--skip-seed)');
    return;
  }
  const code = await runOnce('dev', 'pnpm', ['--filter', '@pms/api', 'db:seed']);
  if (code !== 0) {
    log('dev', 'seed failed — the stack will start, but the demo data may be incomplete');
  }
}

async function waitForApi(seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const response = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  return false;
}

function banner() {
  const preview = IN_CLOUD_SHELL && process.env.WEB_HOST ? `https://${PORT}-${process.env.WEB_HOST}` : null;
  const lines = [
    '',
    '  ready:',
    `    web      http://localhost:${PORT}`,
    `    api      http://localhost:${API_PORT}/api/v1/health`,
    flags.worker
      ? '    worker   running (charges.generate, charges.overdue-sweep, notifications.send)'
      : '    worker   not started (--skip-worker)',
    '',
    `  memory: ${TOTAL_MB} MB detected — heaps capped at api ${API_HEAP_MB}, web ${WEB_HEAP_MB}${
      flags.worker ? `, worker ${WORKER_HEAP_MB}` : ''
    } MB`,
    '          (override with API_HEAP_MB / WORKER_HEAP_MB / WEB_HEAP_MB)',
    '',
    '  demo login: owner@demo.test / DemoPass123   (fake data only)',
  ];
  if (preview) {
    lines.push('', '  Cloud Shell Web Preview (any port in 2000-65000 works; the menu also lists them):');
    lines.push(`    ${preview}`);
  }
  if (loadedFiles.length > 0) {
    lines.push('', `  env: ${loadedFiles.map((file) => file.replace(`${ROOT}/`, '')).join(', ')}`);
  }
  lines.push('', `  Ctrl-C stops ${flags.worker ? 'web, api and worker' : 'web and api'}.`, '');
  console.log(lines.join('\n'));
}

async function main() {
  console.log(
    `\n  property-management-system-et — local stack (${IN_CLOUD_SHELL ? 'Cloud Shell' : 'local'})\n`,
  );
  await ensureDependencies();
  await startDatabase();

  if (!(await waitForDatabase(90))) {
    const target = databaseTarget();
    log('dev', `PostgreSQL never became reachable on ${target.host}:${target.port}.`);
    log('dev', 'Start it with: docker compose up -d postgres   (or fix DATABASE_URL in .env)');
    process.exit(1);
  }

  await buildPackages();
  await generatePrismaClient();
  await migrate();
  await seed();

  const apiEnv = {
    NODE_OPTIONS: `--max-old-space-size=${API_HEAP_MB}`,
    NODE_ENV: 'development',
  };

  if (flags.watchPackages) {
    log('dev', 'watching workspace packages (tsc --watch)');
    start('dev', bin(ROOT, 'turbo'), ['run', 'dev', '--filter=./packages/*']);
  }

  start('api', bin(API_DIR, 'tsx'), ['watch', 'src/server.ts'], { cwd: API_DIR, env: apiEnv });
  log('dev', 'waiting for the API to answer before starting web/worker…');
  if (!(await waitForApi(90))) {
    log('dev', 'the API did not come up. The reason is in the [api] lines above.');
    shutdown(1);
    return;
  }

  if (flags.worker) {
    start('worker', bin(API_DIR, 'tsx'), ['watch', 'src/worker.ts'], {
      cwd: API_DIR,
      env: { ...apiEnv, NODE_OPTIONS: `--max-old-space-size=${WORKER_HEAP_MB}` },
    });
    await sleep(1000);
  } else {
    log('dev', 'worker skipped (--skip-worker): scheduled jobs will not run');
  }

  start('web', bin(WEB_DIR, 'next'), ['dev', '--hostname', '0.0.0.0', '--port', String(PORT)], {
    cwd: WEB_DIR,
    env: {
      NODE_OPTIONS: `--max-old-space-size=${WEB_HEAP_MB}`,
      NEXT_TELEMETRY_DISABLED: '1',
      // The browser only ever talks to this server; it proxies /api/* to the API.
      API_PROXY_TARGET: process.env.API_PROXY_TARGET ?? `http://127.0.0.1:${API_PORT}`,
    },
  });

  log('dev', 'waiting for the API to answer…');
  if (!(await waitForApi(90))) {
    log('dev', 'the API did not come up. The reason is in the [api] lines above.');
    shutdown(1);
    return;
  }

  banner();
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
