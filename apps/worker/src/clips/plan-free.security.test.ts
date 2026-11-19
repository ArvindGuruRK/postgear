/**
 * Security sweep, the Limits line (Sprint 12, Module 20 section 1): the
 * worker never resolves entitlements.
 *
 * Every plan value a job needs (the longest video, the space, the retention,
 * the quality, the mark, the priority) is decided by the API and copied into
 * the job when it is made (`clip-limits.guard.spec.ts` "copies the plan into
 * the job", `clip-exports.service.spec.ts` "freezes ... the plan values into a
 * RENDER job"), and the worker reads the job (`render.export.test.ts`, the
 * mark tests). So a plan change mid-job changes nothing, and the worker has
 * no way to grant itself more.
 *
 * This test fails if the worker, or a package it runs Clips with, imports the
 * entitlement rules or the API's code, reads the plan tables, the overrides,
 * the usage ledger or the change log, or (in the Clips code) a subscription.
 * It parses each file with the TypeScript compiler, so a name inside a
 * string or a comment is not a finding.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const WORKER_SRC = path.join(REPO, 'apps', 'worker', 'src');
/** The packages the worker runs Clips with. */
const CLIPS_PACKAGES = ['media-tools', 'video-engine', 'storage', 'scheduling'].map((name) =>
  path.join(REPO, 'packages', name, 'src'),
);
const CLIPS_DIRS = [path.join(WORKER_SRC, 'clips'), path.join(WORKER_SRC, 'workflows', 'clips')];

const SKIPPED = new Set(['node_modules', 'dist', 'coverage']);

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIPPED.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...sources(full));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

interface Found {
  modules: string[];
  properties: string[];
}

/** Every module a file loads and every property name it reads, from its syntax tree. */
function read(file: string, text: string): Found {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Found = { modules: [], properties: [] };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.modules.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0];
      const loads =
        (ts.isIdentifier(callee) && callee.text === 'require') ||
        callee.kind === ts.SyntaxKind.ImportKeyword;
      if (loads && first && ts.isStringLiteralLike(first)) found.modules.push(first.text);
    } else if (ts.isPropertyAccessExpression(node)) {
      found.properties.push(node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      found.properties.push(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The entitlement rules, or anything of the API's, by package name or by a relative path. */
function isBannedModule(file: string, name: string): boolean {
  if (/^@postgear\/(entitlements|api)(\/|$)/.test(name)) return true;
  if (name.startsWith('.')) {
    const target = path.resolve(path.dirname(file), name);
    const inside = (dir: string) => !path.relative(dir, target).startsWith('..');
    return (
      inside(path.join(REPO, 'apps', 'api')) || inside(path.join(REPO, 'packages', 'entitlements'))
    );
  }
  return false;
}

/** The Prisma delegates that hold plan values and usage. */
const PLAN_TABLES = new Set([
  'planEntitlement',
  'orgEntitlementOverride',
  'usageEntry',
  'entitlementChange',
]);

const relativeName = (file: string) => path.relative(REPO, file).split(path.sep).join('/');

describe('the worker never resolves a plan', () => {
  it('does not depend on the entitlement package', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO, 'apps', 'worker', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(names).not.toContain('@postgear/entitlements');
    expect(names).not.toContain('@postgear/api');
  });

  it('imports neither the entitlement rules nor the API, in the worker or the Clips packages', () => {
    const files = [WORKER_SRC, ...CLIPS_PACKAGES].flatMap((dir) => sources(dir));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) =>
      read(file, readFileSync(file, 'utf8'))
        .modules.filter((name) => isBannedModule(file, name))
        .map((name) => `${relativeName(file)} -> ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('never reads the plan tables, the overrides, the usage ledger or the change log', () => {
    const offenders = sources(WORKER_SRC).flatMap((file) =>
      read(file, readFileSync(file, 'utf8'))
        .properties.filter((name) => PLAN_TABLES.has(name))
        .map((name) => `${relativeName(file)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('never reads a subscription in the Clips code', () => {
    const offenders = CLIPS_DIRS.flatMap((dir) => sources(dir)).flatMap((file) =>
      read(file, readFileSync(file, 'utf8'))
        .properties.filter((name) => name === 'subscription' || name === 'subscriptions')
        .map((name) => `${relativeName(file)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('would see a planted look-up (the scan is not blind)', () => {
    const file = path.join(WORKER_SRC, 'clips', 'planted.ts');
    const planted = read(
      file,
      [
        "import { resolve } from '@postgear/entitlements';",
        "import { EntitlementResolver } from '../../../api/src/modules/entitlements/entitlement-resolver';",
        'const rows = prisma.planEntitlement.findMany();',
        "const sub = org['subscription'];",
      ].join('\n'),
    );
    expect(planted.modules.filter((name) => isBannedModule(file, name))).toHaveLength(2);
    expect(planted.properties).toEqual(expect.arrayContaining(['planEntitlement', 'subscription']));
  });
});
