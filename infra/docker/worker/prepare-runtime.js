#!/usr/bin/env node
/**
 * Lays out the compiled worker for the image (infra/docker/Dockerfile.worker).
 * Build time only: it is not copied into the image.
 *
 *   node prepare-runtime.js <repo> <compiled> <stage>
 *
 * <compiled> is tsc's out folder for infra/docker/worker/tsconfig.build.json:
 * `apps/worker/src/**` and `packages/<name>/src/**` as JavaScript (plus the
 * JSON fixtures media-tools imports). It writes into <stage>, mirroring the
 * repo so every `__dirname` walk in the code finds what it finds in a checkout:
 *
 *   <stage>/apps/worker/dist/apps/worker/src/   the worker (`npm start`'s path)
 *   <stage>/packages/<name>/package.json        main and exports point at .js
 *   <stage>/packages/<name>/src/                the compiled package
 *   <stage>/packages/media-tools/assets/        the export watermark
 *
 * The image's node_modules links `@postgear/<name>` to `../../packages/<name>`
 * (npm's own workspace links), so a bare `require('@postgear/db')` lands on
 * the compiled package. Every `@postgear/...` the compiled code requires is
 * checked against what was emitted, so a new import fails this build instead
 * of the worker's first boot.
 */

const fs = require('node:fs');
const path = require('node:path');

const [repo, compiled, stage] = process.argv.slice(2).map((value) => path.resolve(value));
if (!repo || !compiled || !stage) {
  console.error('usage: node prepare-runtime.js <repo> <compiled> <stage>');
  process.exit(2);
}

/** Files a package needs at run time that tsc does not emit. */
const EXTRA_FILES = {
  'media-tools': ['assets/watermark.png'],
};

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

/** `./src/index.ts` is `./src/index.js`; anything else is kept. */
function toJs(target) {
  return typeof target === 'string' ? target.replace(/\.ts$/, '.js') : target;
}

function runtimeManifest(original) {
  const manifest = {
    name: original.name,
    version: original.version,
    private: true,
    main: toJs(original.main ?? 'src/index.ts'),
  };
  if (original.exports && typeof original.exports === 'object') {
    manifest.exports = {};
    for (const [key, value] of Object.entries(original.exports)) {
      manifest.exports[key] = toJs(value);
    }
  }
  if (original.dependencies) manifest.dependencies = original.dependencies;
  return manifest;
}

// 1. The worker itself.
const workerOut = path.join(compiled, 'apps', 'worker', 'src');
if (!fs.existsSync(path.join(workerOut, 'index.js'))) {
  console.error(`No compiled worker at ${workerOut}`);
  process.exit(1);
}
copyTree(workerOut, path.join(stage, 'apps', 'worker', 'dist', 'apps', 'worker', 'src'));
fs.copyFileSync(
  path.join(repo, 'apps', 'worker', 'package.json'),
  path.join(stage, 'apps', 'worker', 'package.json'),
);

// 2. Every workspace package tsc emitted.
const emitted = new Map();
const packagesOut = path.join(compiled, 'packages');
for (const name of fs.readdirSync(packagesOut)) {
  const original = JSON.parse(
    fs.readFileSync(path.join(repo, 'packages', name, 'package.json'), 'utf8'),
  );
  const target = path.join(stage, 'packages', name);
  copyTree(path.join(packagesOut, name), target);
  const manifest = runtimeManifest(original);
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of EXTRA_FILES[name] ?? []) {
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, 'packages', name, file), path.join(target, file));
  }
  emitted.set(original.name, manifest);
  console.log(`  ${original.name} -> packages/${name} (main ${manifest.main})`);
}

// 3. Every @postgear import in the compiled code must have landed.
const REQUIRE = /require\("(@postgear\/[a-z0-9-]+)(\/[a-z0-9/-]+)?"\)/g;
const problems = new Set();
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(full);
    } else if (entry.name.endsWith('.js')) {
      const text = fs.readFileSync(full, 'utf8');
      for (const match of text.matchAll(REQUIRE)) {
        const [, name, sub] = match;
        const manifest = emitted.get(name);
        if (!manifest) {
          problems.add(`${name} (required by ${path.relative(stage, full)}) was not compiled`);
        } else if (sub && !manifest.exports?.[`.${sub}`]) {
          problems.add(`${name}${sub} is not in ${name}'s exports`);
        }
      }
    }
  }
}
scan(path.join(stage, 'apps'));
scan(path.join(stage, 'packages'));
if (problems.size > 0) {
  console.error('The compiled worker requires packages the image does not carry:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Runtime layout ready: the worker and ${emitted.size} packages.`);
