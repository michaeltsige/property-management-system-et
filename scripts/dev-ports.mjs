/**
 * Port ownership helpers for the dev stack launcher (scripts/dev-all.mjs).
 *
 * The launcher starts long-lived servers with `detached: true` so a shutdown
 * can signal their whole process group. That has a cost: when the launcher
 * itself dies without running its signal handlers (terminal window closed,
 * machine out of memory, `kill -9`), the detached children survive — and the
 * next `pnpm dev:all` dies with a confusing EADDRINUSE after doing all of its
 * boot work. These helpers make startup self-healing:
 *
 *  - `portBusy`       probes whether anything is listening on a TCP port,
 *  - `listeningPids`  maps a port back to the owning process IDs (lsof, then ss),
 *  - `pidCwd`/`pidCommand` read a process' working directory and command line,
 *  - `belongsToRepo`  decides whether a PID was started from this repository,
 *  - `reclaimPort`    stops repo-owned listeners (SIGTERM, then SIGKILL) and
 *                     leaves every other process strictly alone.
 *
 * Linux is the primary target (developer laptops, Cloud Shell, CI). Where /proc
 * is unavailable the helpers degrade from reaping to reporting: the port is
 * still detected as busy, but the caller is told to free it manually instead of
 * this module guessing at process ownership.
 */

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { realpathSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * True when something is already listening on this TCP port. A temporary
 * server binds the same host/port the real server would use, so this is
 * exactly the check that would otherwise fail later as EADDRINUSE.
 */
export function portBusy(port, host = '0.0.0.0') {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(true));
    probe.once('listening', () => probe.close(() => done(false)));
    probe.listen({ port, host, exclusive: true });
  });
}

/**
 * Process IDs listening on `port`, or null when they cannot be determined
 * (neither lsof nor ss available). An empty array is a definitive "nothing
 * listens there right now" — the holder may have exited in the meantime.
 */
export function listeningPids(port) {
  const lsof = spawnSync('lsof', ['-t', '-n', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (!lsof.error) {
    return lsof.stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }

  // ss prints `users:(("next-server",pid=1234,fd=18))` with -p; without root it
  // can only see the current user's processes, which is exactly whose
  // processes a dev launcher may reap anyway.
  const ss = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
  if (!ss.error) {
    return [...new Set([...ss.stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])))];
  }

  return null;
}

/** Best-effort command line of a process, for log messages. */
export function pidCommand(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ') || null;
  } catch {
    return null;
  }
}

/** Best-effort working directory of a process (/proc, with an lsof fallback). */
export function pidCwd(pid) {
  try {
    return realpathSync(readlinkSync(`/proc/${pid}/cwd`));
  } catch {
    /* fall through to lsof */
  }
  const out = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  });
  if (out.error || out.status !== 0) return null;
  const line = out.stdout.split('\n').find((candidate) => candidate.startsWith('n/'));
  if (!line) return null;
  try {
    return realpathSync(line.slice(1));
  } catch {
    return null;
  }
}

/**
 * True when the process belongs to this repository: its working directory or
 * its executable lives under `root`. Only the executable (argv[0]) counts from
 * the command line — an unrelated editor holding an open file from the repo
 * must never look repo-owned.
 */
export function belongsToRepo(pid, root) {
  const cwd = pidCwd(pid);
  if (cwd && (cwd === root || cwd.startsWith(`${root}/`))) return true;
  const command = pidCommand(pid);
  if (!command) return false;
  const executable = command.split(' ')[0];
  return executable === root || executable.startsWith(`${root}/`);
}

/** Parent PID from /proc/<pid>/stat, or null when it cannot be read. */
function parentPid(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 2 (comm) may contain spaces and parentheses — parse from after the
    // last ')'. What follows is "state ppid ...", so the second token is PPid.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    return Number(afterComm.split(' ')[1]);
  } catch {
    return null;
  }
}

/**
 * `pid` plus every ancestor of it that still belongs to this repository —
 * the supervisor that would otherwise respawn the listener (tsx watch, a
 * nested launcher) has to die together with what it supervises. The walk
 * stops at init, at anything outside the repo, and at this process itself.
 */
export function repoOwnedTree(pid, root) {
  const tree = [];
  const seen = new Set();
  let current = pid;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current === process.pid) break;
    if (!belongsToRepo(current, root)) break;
    tree.push(current);
    const parent = parentPid(current);
    if (!parent || parent <= 1) break;
    current = parent;
  }
  return tree;
}

function signalTree(pid, signal) {
  // The dev stack's children run in their own process groups, so the signal
  // usually reaches the whole tree through the negative PID. The direct signal
  // covers processes that are not group leaders. Both may throw ESRCH when
  // the process is already gone.
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
}

/** Poll `check` until it returns true or the timeout elapses. */
async function until(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(250);
  }
  return check();
}

/**
 * Make `port` usable for this repository:
 *
 *   free       nothing is listening — carry on
 *   reclaimed  a stale instance of this repo held the port and was stopped
 *   foreign    an unrelated process holds the port — it was NOT touched
 *   unknown    the port is busy but ownership could not be determined
 *   stuck      repo-owned holders were signaled but would not free the port
 *
 * `log` receives one human-readable line per action, for the dev launcher to
 * print with its own prefix.
 */
export async function reclaimPort(port, root, log = () => {}) {
  let rootPath = root;
  try {
    rootPath = realpathSync(root);
  } catch {
    /* keep the path as given */
  }

  if (!(await portBusy(port))) return { status: 'free' };

  const pids = listeningPids(port);
  if (pids === null) return { status: 'unknown' };
  if (pids.length === 0) {
    return (await portBusy(port)) ? { status: 'unknown' } : { status: 'free' };
  }

  const holders = pids.map((pid) => ({
    pid,
    command: pidCommand(pid) ?? `pid ${pid}`,
  }));

  if (!holders.every((holder) => belongsToRepo(holder.pid, rootPath))) {
    return { status: 'foreign', holders };
  }

  // Every process that has to go: the listeners plus their repo-owned
  // supervisors. Killing only the listener lets a watcher (tsx watch) respawn
  // it behind our back.
  const targets = new Map();
  const addTree = (pid) => {
    for (const member of repoOwnedTree(pid, rootPath)) {
      if (!targets.has(member)) targets.set(member, pidCommand(member) ?? `pid ${member}`);
    }
  };
  for (const { pid } of holders) addTree(pid);

  const free = () => portBusy(port).then((busy) => !busy);
  const signalAll = (signal) => {
    for (const [targetPid, command] of targets) {
      log(
        signal === 'SIGTERM'
          ? `stopping stale process ${targetPid} (${command})`
          : `process ${targetPid} ignored SIGTERM — sending SIGKILL`,
      );
      signalTree(targetPid, signal);
    }
  };

  signalAll('SIGTERM');
  if (!(await until(free, 6_000))) {
    // Something respawned on the port — fold the new holders and their
    // supervisors into the target set and escalate.
    for (const pid of listeningPids(port) ?? []) addTree(pid);
    signalAll('SIGKILL');
    if (!(await until(free, 4_000))) {
      for (const pid of listeningPids(port) ?? []) addTree(pid);
      signalAll('SIGKILL');
      if (!(await until(free, 3_000))) {
        return {
          status: 'stuck',
          holders: [...targets].map(([stuckPid, command]) => ({ pid: stuckPid, command })),
        };
      }
    }
  }
  return {
    status: 'reclaimed',
    holders: [...targets].map(([stoppedPid, command]) => ({ pid: stoppedPid, command })),
  };
}

/** Repository root for the calling script's own checkout (tests, CLI use). */
export const THIS_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
