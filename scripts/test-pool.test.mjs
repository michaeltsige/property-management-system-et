/** Verify the patched pool through the same dependency resolution as Vitest. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const vitestRequire = createRequire(require.resolve('vitest/package.json'));
const { default: Tinypool } = await import(pathToFileURL(vitestRequire.resolve('tinypool')).href);
const filename = fileURLToPath(new URL('./test-fixtures/pool-worker.mjs', import.meta.url));

for (const runtime of ['worker_threads', 'child_process']) {
  test(`${runtime}: ignore inherited constructor options`, async () => {
    const options = Object.assign(Object.create({ name: 'notAnExport' }), {
      filename,
      runtime,
      minThreads: 1,
      maxThreads: 1,
    });
    const pool = new Tinypool(options);
    try {
      assert.equal(await pool.run('constructor safe'), 'constructor safe');
      await pool.recycleWorkers();
      assert.equal(await pool.run('recycled'), 'recycled');
    } finally {
      await pool.destroy();
    }
  });
  test(`${runtime}: ignore inherited run options`, async () => {
    const pool = new Tinypool({ filename, runtime, minThreads: 1, maxThreads: 1 });
    try {
      assert.equal(
        await pool.run('run safe', Object.create({ name: 'notAnExport', filename: '/nonexistent.mjs' })),
        'run safe',
      );
    } finally {
      await pool.destroy();
    }
  });
}
