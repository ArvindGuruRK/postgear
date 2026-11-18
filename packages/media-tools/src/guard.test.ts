/**
 * The one-door rule: only `packages/media-tools/src/run/runner.ts` may start
 * an outside program. Everything else goes through its `RunTool`, so every
 * program runs with an argument array, a minimal environment, a timeout and
 * a tree kill. This test reads every source file and fails on any import of
 * Node's process module in any spelling (`import`, `export from`, `require`,
 * `import()`, `import x = require()`), with or without the `node:` prefix.
 *
 * It parses the files with the TypeScript compiler instead of searching the
 * text, so a test that merely names the module in a string does not trip it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/** Built from parts so this file never names the module itself. */
const MODULE = ['child', 'process'].join('_');
const MODULE_PATTERN = new RegExp(`^(node:)?${MODULE}(/.*)?$`);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MEDIA_TOOLS = path.join(REPO_ROOT, 'packages', 'media-tools');
const ALLOWED = path.join(MEDIA_TOOLS, 'src', 'run', 'runner.ts');
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'build']);

function listSources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries) {
    if (SKIPPED_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      files.push(...listSources(full));
    } else if (SOURCE_FILE.test(name) && !name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Every module name a file imports, requires or loads, from its syntax tree. */
function importedModules(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      found.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const first = node.arguments[0];
      if ((isRequire || isDynamicImport) && first && ts.isStringLiteralLike(first)) {
        found.push(first.text);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function offenders(files: string[]): string[] {
  return files
    .filter((file) => path.resolve(file) !== ALLOWED)
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      // Only files that mention the name at all are worth parsing.
      return (
        text.includes(MODULE) &&
        importedModules(file, text).some((name) => MODULE_PATTERN.test(name))
      );
    })
    .map((file) => path.relative(REPO_ROOT, file).split(path.sep).join('/'));
}

describe('the process module guard', () => {
  it('spots every way of importing the module', () => {
    const spellings = [
      `import { spawn } from '${MODULE}';`,
      `import * as cp from "node:${MODULE}";`,
      `import '${MODULE}';`,
      `export { spawn } from 'node:${MODULE}';`,
      `const cp = require('${MODULE}');`,
      `const cp = require(\`node:${MODULE}\`);`,
      `async function f() { return import('${MODULE}'); }`,
      `import cp = require('${MODULE}');`,
      `type P = import('node:${MODULE}').ChildProcess;`,
    ];
    for (const text of spellings) {
      const names = importedModules('x.ts', text);
      expect(names.some((name) => MODULE_PATTERN.test(name))).toBe(true);
    }
  });

  it('ignores the name inside a plain string', () => {
    const text = `const banned = ['${MODULE}']; const sample = "import('${MODULE}')";`;
    expect(importedModules('x.ts', text)).toEqual([]);
  });

  it('allows it only in src/run/runner.ts inside media-tools', () => {
    const files = [
      ...listSources(path.join(MEDIA_TOOLS, 'src')),
      ...listSources(path.join(MEDIA_TOOLS, 'scripts')),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files)).toEqual([]);
  });

  it('is not imported by the API, the worker or any other package', () => {
    const packagesDir = path.join(REPO_ROOT, 'packages');
    const otherPackages = readdirSync(packagesDir)
      .filter((name) => name !== 'media-tools')
      .map((name) => path.join(packagesDir, name, 'src'));
    const files = [
      ...listSources(path.join(REPO_ROOT, 'apps', 'api', 'src')),
      ...listSources(path.join(REPO_ROOT, 'apps', 'worker', 'src')),
      ...otherPackages.flatMap((dir) => listSources(dir)),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files)).toEqual([]);
  });
});
