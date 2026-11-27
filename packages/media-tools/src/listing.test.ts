/**
 * `@postgear/media-tools/listing` is the only door from the API into
 * media-tools, so it must stay pure: this test walks the import graph of
 * `src/listing.ts` (relative imports, followed file by file) and fails if it
 * reaches `src/run/` (the process runner), Node's process module, or any
 * package other than the pure engine and zod. It also checks that the API
 * imports nothing else from media-tools.
 *
 * Files are parsed with the TypeScript compiler, as `guard.test.ts` does, so
 * a name inside a string or a comment does not count as an import.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const SRC = path.resolve(__dirname);
const RUN_DIR = path.join(SRC, 'run') + path.sep;
const REPO_ROOT = path.resolve(SRC, '..', '..', '..');
const ENTRY = path.join(SRC, 'listing.ts');

/** Built from parts so this file never names the module itself. */
const PROCESS_MODULE = new RegExp(`^(node:)?${['child', 'process'].join('_')}(/.*)?$`);
/** The only packages the listing graph may import. */
const ALLOWED_PACKAGES = new Set(['@postgear/video-engine', 'zod']);

function importsOf(fileName: string): string[] {
  const text = readFileSync(fileName, 'utf8');
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const first = node.arguments[0];
      if ((isRequire || isDynamicImport) && first && ts.isStringLiteralLike(first)) {
        found.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** A relative import to the file it names, or null when it is not a source file here. */
function resolveRelative(from: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file the entry reaches, and every outside module named on the way. */
function graph(entry: string): { files: string[]; packages: string[]; unresolved: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (file.endsWith('.json')) continue;
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) {
        const target = resolveRelative(file, specifier);
        if (target === null) unresolved.push(`${path.relative(SRC, file)} -> ${specifier}`);
        else queue.push(target);
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files: [...files], packages: [...packages], unresolved };
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('@postgear/media-tools/listing', () => {
  const walked = graph(ENTRY);

  it('resolves every relative import it walks', () => {
    expect(walked.unresolved).toEqual([]);
    expect(walked.files.length).toBeGreaterThan(3);
  });

  it('never reaches the process runner', () => {
    const inRun = walked.files.filter((file) => file.startsWith(RUN_DIR));
    expect(inRun.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it('imports no outside module but the pure engine and zod', () => {
    expect(walked.packages.filter((name) => PROCESS_MODULE.test(name))).toEqual([]);
    expect(walked.packages.filter((name) => !ALLOWED_PACKAGES.has(name))).toEqual([]);
  });

  it('is the only part of media-tools the API imports (with the Drive door, Module 12)', () => {
    const apiSrc = path.join(REPO_ROOT, 'apps', 'api', 'src');
    const doors = new Set(['@postgear/media-tools/listing', '@postgear/media-tools/drive']);
    const offenders = listSources(apiSrc).flatMap((file) =>
      importsOf(file)
        .filter((name) => name.startsWith('@postgear/media-tools'))
        .filter((name) => !doors.has(name))
        .map((name) => `${path.relative(REPO_ROOT, file).split(path.sep).join('/')}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Sprint 13 Module 12: `@postgear/media-tools/drive` is the API's second door
 * (Google Drive's file facts). It may use Node's file and stream modules and
 * `fetch`, never the process runner or the process module.
 */
describe('@postgear/media-tools/drive', () => {
  const walked = graph(path.join(SRC, 'drive', 'drive.ts'));
  const NODE_ALLOWED = new Set([
    'node:fs',
    'node:fs/promises',
    'node:path',
    'node:stream',
    'node:stream/promises',
  ]);

  it('never reaches the process runner or the process module', () => {
    expect(walked.unresolved).toEqual([]);
    expect(walked.files.filter((file) => file.startsWith(RUN_DIR))).toEqual([]);
    expect(walked.packages.filter((name) => PROCESS_MODULE.test(name))).toEqual([]);
    expect(walked.packages.filter((name) => name !== 'zod' && !NODE_ALLOWED.has(name))).toEqual([]);
  });
});
