/**
 * The package's promise, as a test: it runs in the browser. Every shipped
 * source file (tests excluded) is read, and any import of a Node built-in,
 * another workspace package or an undeclared library fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = __dirname;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

function nameOf(file: string): string {
  return relative(SRC, file).split(sep).join('/');
}

const STATIC_IMPORT = /\bfrom\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT = /\bimport\s+['"]([^'"]+)['"]/g;
const LATE_IMPORT = /\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;

function modulesNamedIn(text: string): string[] {
  return [STATIC_IMPORT, BARE_IMPORT, LATE_IMPORT].flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[1]),
  );
}

/** The Node built-ins, by their bare names (`fs`) as well as `node:fs`. */
const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

/** Libraries the package may use. Today it needs none. */
const ALLOWED_PACKAGES = new Set<string>(['zod']);

describe('the package stays pure', () => {
  const files = sourceFiles(SRC);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it('imports no Node built-in, no other workspace package and nothing undeclared', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const source of modulesNamedIn(readFileSync(file, 'utf8'))) {
        const ok =
          source.startsWith('.') ||
          (ALLOWED_PACKAGES.has(source) &&
            !source.startsWith('node:') &&
            !source.startsWith('@postgear/') &&
            !NODE_BUILTINS.has(source));
        if (!ok) offenders.push(`${nameOf(file)}: ${source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never reaches for the environment, the process or a global Node object', () => {
    const forbidden = [/\bprocess\./, /\brequire\(/, /\bBuffer\b/, /\b__dirname\b/];
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return forbidden.some((pattern) => pattern.test(text));
    });
    expect(offenders.map(nameOf)).toEqual([]);
  });

  it('has the import scan seeing every way of loading a module', () => {
    expect(modulesNamedIn("import a from 'node:fs';")).toEqual(['node:fs']);
    expect(modulesNamedIn("import type { A } from '@postgear/db';")).toEqual(['@postgear/db']);
    expect(modulesNamedIn("export { b } from './three';")).toEqual(['./three']);
    expect(modulesNamedIn("import 'fs';")).toEqual(['fs']);
    expect(modulesNamedIn("const c = require('path');")).toEqual(['path']);
    expect(modulesNamedIn("const d = await import('os');")).toEqual(['os']);
  });
});
