/**
 * The engine stays pure: the browser preview, the API, the worker and
 * Temporal's workflow sandbox all import it, so no source file may reach for
 * a Node built-in or another `@postgear/*` package. Test files may (this one
 * reads the folder with `node:fs`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = __dirname;

const NODE_BUILT_INS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'readline',
  'stream',
  'timers',
  'tls',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') {
        files.push(...sourceFiles(path));
      }
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
    ) {
      files.push(path);
    }
  }
  return files;
}

/** Every module specifier a file names: static imports, re-exports, `import()` and `require()`. */
function specifiers(code: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) {
        found.push(match[1]);
      }
    }
  }
  return found;
}

function isForbidden(specifier: string): boolean {
  if (specifier.startsWith('node:') || specifier.startsWith('@postgear/')) {
    return true;
  }
  const root = specifier.split('/')[0] ?? specifier;
  return NODE_BUILT_INS.has(root);
}

describe('purity', () => {
  const files = sourceFiles(SRC);

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports no Node built-in and no other @postgear package', () => {
    const offences: string[] = [];
    for (const file of files) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (isForbidden(specifier)) {
          offences.push(`${relative(SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('would catch each kind of forbidden import', () => {
    const code = [
      "import { readFile } from 'node:fs';",
      "import path from 'path';",
      "export * from '@postgear/db';",
      "const os = require('os');",
      "const lazy = import('child_process');",
      "import 'crypto';",
      "import { z } from 'zod';",
    ].join('\n');
    expect(specifiers(code).filter(isForbidden)).toEqual([
      'node:fs',
      'path',
      '@postgear/db',
      'crypto',
      'child_process',
      'os',
    ]);
  });
});
