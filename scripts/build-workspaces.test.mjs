import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaces } from './build-workspaces.mjs';
test('existing but stale dist never bypasses the source-aware build', async () => {
  const calls = [];
  await buildWorkspaces(
    async (...args) => {
      calls.push(args);
      return 0;
    },
    () => true,
    () => {},
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0][2].includes('--concurrency=1'));
  assert.ok(calls[0][2].includes('--filter=./packages/*'));
});
test('build failure stops startup even when old output exists', async () => {
  await assert.rejects(
    buildWorkspaces(
      async () => 1,
      () => true,
      () => {},
    ),
    /build failed/,
  );
});
test('missing output after an apparently successful build stops startup', async () => {
  await assert.rejects(
    buildWorkspaces(
      async () => 0,
      () => false,
      () => {},
    ),
    /build failed/,
  );
});
