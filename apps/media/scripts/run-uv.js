#!/usr/bin/env node
/**
 * Runs `uv <args>` for the npm scripts of `@postgear/media`.
 *
 * - `npm run dev` without uv installed prints one line and exits 0, so the
 *   API, the worker and the web app still start (Clips works; AI shows as off).
 * - `lint`, `typecheck` and `test` without uv fail with the same line: a
 *   machine that cannot check the Python code must not report it green.
 *
 * Never a shell string: the arguments go to `spawn` as an array.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const optional = args[0] === '--optional';
const uvArgs = optional ? args.slice(1) : args;

const probe = spawnSync('uv', ['--version'], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  const line =
    'The media service needs uv (https://docs.astral.sh/uv/). Clips works without it; AI steps show as off.';
  if (optional) {
    console.log(`[media] ${line}`);
    process.exit(0);
  }
  console.error(`[media] ${line}`);
  process.exit(1);
}

const result = spawnSync('uv', uvArgs, {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
});
if (result.error) {
  console.error(`[media] ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
