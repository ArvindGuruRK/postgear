/**
 * Every outside call a workflow step makes goes through `safeHttpRequest`
 * (lib/safe-http.ts: address check, pinned DNS, no redirects, size cap).
 * `fetch` skips all of that, so nothing under `automation/` may call it,
 * except the gateway client, whose address is the API's own from
 * configuration, never a step's data.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = __dirname;
const ALLOWED = new Set(['gateway-client.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(name) ? [path] : [];
  });
}

/** The code without its comments, so a sentence about fetch is not a call. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('outside calls from workflow steps', () => {
  it('never use fetch( outside the gateway client', () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(10);

    const offenders = files
      .filter((file) => !ALLOWED.has(relative(ROOT, file).replace(/\\/g, '/')))
      .filter((file) => /\bfetch\s*\(/.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(ROOT, file).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('would notice one (the check itself works)', () => {
    expect(/\bfetch\s*\(/.test(code('const r = await fetch(url);'))).toBe(true);
    expect(/\bfetch\s*\(/.test(code('await globalThis.fetch (url)'))).toBe(true);
    expect(/\bfetch\s*\(/.test(code('// we never call fetch(url) here'))).toBe(false);
    expect(/\bfetch\s*\(/.test(code('const r = await doFetch(url);'))).toBe(false);
  });
});
