/** Always ask Turbo to check source/config hashes; output existence is not freshness. */
export async function buildWorkspaces(run, outputsExist, log) {
  log('dev', 'checking workspace package builds (source-aware Turbo cache)');
  const code = await run('dev', 'pnpm', [
    'exec',
    'turbo',
    'run',
    'build',
    '--filter=./packages/*',
    '--concurrency=1',
    '--output-logs=errors-only',
  ]);
  if (code !== 0 || !outputsExist()) throw new Error('Workspace package build failed; apps were not started');
}
