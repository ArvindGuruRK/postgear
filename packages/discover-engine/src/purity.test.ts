/**
 * The package's promises, as a test: it imports no other workspace package, and
 * it never reaches the network on its own. This reads every shipped source file
 * (tests excluded) and fails on anything that would break either.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as engine from './index';

const SRC = __dirname;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/from ['"]@postgear\//, 'another workspace package'],
  [/require\(['"]@postgear\//, 'another workspace package'],
  // The lookbehind lets `source.fetch(...)` through: that is the injected kind.
  [/(?<![.\w])fetch\(/, 'the global fetch'],
  [/\bglobalThis\.fetch\b/, 'the global fetch'],
  [/from ['"]node:(http|https|net|tls|dns|http2)['"]/, 'a Node network module'],
  [/from ['"](http|https|net|tls|dns|http2|axios|got|undici|node-fetch)['"]/, 'a network library'],
  [/\.parseURL\(/, 'the feed parser reaching the network itself'],
  [/\bprocess\.env\b/, 'the environment: the API decides configuration'],
];

const ALLOWED_PACKAGES = new Set([
  'countries-and-timezones',
  'node:crypto',
  'node:fs',
  'node:fs/promises',
  'node:path',
  'rss-parser',
]);

describe('the package stays pure', () => {
  const files = sourceFiles(SRC);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN.map(([pattern, what]) => [what, pattern] as const))(
    'never uses %s',
    (_what, pattern) => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
      expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
    },
  );

  it('imports nothing but its own files and the packages it declares', () => {
    for (const file of files) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(
        (match) => match[1],
      );
      for (const source of imports) {
        expect([
          relative(SRC, file),
          source,
          source.startsWith('.') || ALLOWED_PACKAGES.has(source),
        ]).toEqual([relative(SRC, file), source, true]);
      }
    }
  });

  it('has the fetch guard catching what it says it catches', () => {
    const [pattern] = FORBIDDEN[2];
    expect(pattern.test('await fetch(url)')).toBe(true);
    expect(pattern.test('await source.fetch(input)')).toBe(false);
    expect(pattern.test('await createFixtureFetch()')).toBe(false);
    expect(pattern.test('await myfetch(url)')).toBe(false);
  });
});

describe('the public surface', () => {
  it('exports what the API builds on from the package root', () => {
    for (const name of [
      'createGoogleTrendsSource',
      'createGoogleNewsSource',
      'composeFeed',
      'buildBrief',
      'createNominatimGeocoder',
      'createSimulatedGeocoder',
      'createFixtureFetch',
      'resolveLanguages',
      'editionFor',
      'countryFromTimeZone',
      'trendsGeo',
      'buildLocality',
      'WORLDWIDE',
      'GeocoderError',
      'NEWS_TOPICS',
    ]) {
      expect((engine as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
