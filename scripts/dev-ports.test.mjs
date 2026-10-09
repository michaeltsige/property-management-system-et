/**
 * Tests for the dev launcher's port-ownership helpers (scripts/dev-ports.mjs).
 *
 * These tests spawn real listeners — short-lived Node processes, bound to
 * ephemeral ports — so they exercise the same lsof//proc path the launcher
 * uses on a real machine. The /proc-dependent behavior is Linux-only; on
 * other platforms the tests that need it are skipped.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import { belongsToRepo, listeningPids, portBusy, reclaimPort, THIS_REPO } from './dev-ports.mjs';

const LINUX = process.platform === 'linux';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A throwaway listener process. Runs until killed; owns its own group. */
function spawnListener(port, cwd) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require('node:net').createServer().listen(${port}, '127.0.0.1', () => console.log('listening'));` +
        'setInterval(() => {}, 1 << 30);',
    ],
    { cwd, stdio: 'ignore', detached: true },
  );
  child.unref();
  return child;
}

/** A port that was free a moment ago (small TOCTOU race, fine for tests). */
async function freePort() {
  const net = await import('node:net');
  return new Promise((done) => {
    const server = net.createServer();
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function waitUntilBusy(port) {
  for (let i = 0; i < 40 && !(await portBusy(port, '127.0.0.1')); i += 1) await sleep(250);
}

function killGroup(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  try {
    process.kill(child.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

describe('portBusy', () => {
  it('reports a free port as free and a bound port as busy', async () => {
    const port = await freePort();
    assert.equal(await portBusy(port, '127.0.0.1'), false);

    const listener = spawnListener(port, THIS_REPO);
    try {
      await waitUntilBusy(port);
      assert.equal(await portBusy(port, '127.0.0.1'), true);
    } finally {
      killGroup(listener);
    }
    await waitUntil(async () => !(await portBusy(port, '127.0.0.1')));
    assert.equal(await portBusy(port, '127.0.0.1'), false);
  });
});

describe('listeningPids', { skip: !LINUX }, () => {
  it('maps a bound port to the listener PID', async () => {
    const port = await freePort();
    const listener = spawnListener(port, THIS_REPO);
    try {
      await waitUntilBusy(port);
      const pids = listeningPids(port);
      assert.ok(Array.isArray(pids), 'listeningPids returned an array');
      assert.ok(pids.includes(listener.pid), `pids ${pids} include ${listener.pid}`);
    } finally {
      killGroup(listener);
    }
  });

  it('returns an empty array for a port with no listener', () => {
    // A freshly allocated-then-released port; the listener is gone.
    const pids = listeningPids(9); // the discard service never listens locally
    assert.deepEqual(pids, []);
  });
});

describe('belongsToRepo', { skip: !LINUX }, () => {
  it('is true for a process started inside the repo, false for one started elsewhere', async () => {
    const port = await freePort();
    const repoListener = spawnListener(port, THIS_REPO);
    const elsewhere = mkdtempSync(`${tmpdir()}/pms-not-repo-`);
    const foreignListener = spawnListener(port + 1, elsewhere);
    try {
      await waitUntilBusy(port);
      assert.equal(belongsToRepo(repoListener.pid, THIS_REPO), true);
      assert.equal(belongsToRepo(foreignListener.pid, THIS_REPO), false);
    } finally {
      killGroup(repoListener);
      killGroup(foreignListener);
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('reclaimPort', { skip: !LINUX }, () => {
  it('is a no-op when the port is free', async () => {
    const port = await freePort();
    assert.equal((await reclaimPort(port, THIS_REPO)).status, 'free');
  });

  it('stops a stale repo-owned listener and frees the port', async () => {
    const port = await freePort();
    const listener = spawnListener(port, THIS_REPO);
    try {
      await waitUntilBusy(port);
      const result = await reclaimPort(port, THIS_REPO);
      assert.equal(result.status, 'reclaimed');
      assert.ok(result.holders.some((holder) => holder.pid === listener.pid));

      await waitUntil(async () => !(await portBusy(port, '127.0.0.1')));
      assert.equal(await portBusy(port, '127.0.0.1'), false);
      await waitUntil(async () => {
        try {
          process.kill(listener.pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      assert.throws(() => process.kill(listener.pid, 0), /ESRCH/, 'listener is gone');
    } finally {
      killGroup(listener); // no-op when the reaper already got it
    }
  });

  it('reports but never touches a process from outside the repo', async () => {
    const port = await freePort();
    const elsewhere = mkdtempSync(`${tmpdir()}/pms-not-repo-`);
    const listener = spawnListener(port, elsewhere);
    try {
      await waitUntilBusy(port);
      const result = await reclaimPort(port, THIS_REPO);
      assert.equal(result.status, 'foreign');
      assert.ok(result.holders.some((holder) => holder.pid === listener.pid));

      process.kill(listener.pid, 0); // still alive — the reaper left it alone
      assert.equal(await portBusy(port, '127.0.0.1'), true);
    } finally {
      killGroup(listener);
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('kills a supervising parent that respawns its listener child', async () => {
    const port = await freePort();
    // Models `tsx watch src/server.ts`: the supervisor restarts the listener
    // whenever it dies, so reaping the listener alone can never free the port.
    const supervisor = spawn(
      process.execPath,
      [
        '-e',
        `
        const { spawn } = require('node:child_process');
        const start = () => {
          const child = spawn(process.execPath, ['-e',
            "require('node:net').createServer().listen(${port}, '127.0.0.1');setInterval(() => {}, 1 << 30);"
          ], { stdio: 'ignore' });
          child.on('exit', () => setTimeout(start, 100));
        };
        start();
        setInterval(() => {}, 1 << 30);
      `,
      ],
      { cwd: THIS_REPO, stdio: 'ignore', detached: true },
    );
    supervisor.unref();
    try {
      await waitUntilBusy(port);
      const result = await reclaimPort(port, THIS_REPO);
      assert.equal(result.status, 'reclaimed');
      assert.ok(
        result.holders.some((holder) => holder.pid === supervisor.pid),
        'the supervising parent is part of what was stopped',
      );

      await waitUntil(async () => !(await portBusy(port, '127.0.0.1')));
      assert.equal(await portBusy(port, '127.0.0.1'), false);
      // The port can free before the supervisor finishes tearing down —
      // wait for the process itself to disappear.
      await waitUntil(async () => {
        try {
          process.kill(supervisor.pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      assert.throws(() => process.kill(supervisor.pid, 0), /ESRCH/, 'supervisor is gone');
    } finally {
      killGroup(supervisor);
    }
  });
});

async function waitUntil(check) {
  for (let i = 0; i < 40 && !(await check()); i += 1) await sleep(250);
}
