/**
 * The package's promises, as a test: it imports no other workspace package, it
 * never reaches the network on its own, and its one heavy dependency is loaded
 * on first use. This reads every shipped source file (tests excluded) and fails
 * on anything that would break one of them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as engine from './index';
import type { DiscoverFetch } from './types';

const SRC = __dirname;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

/** The path from `src`, with forward slashes on every machine. */
function nameOf(file: string): string {
  return relative(SRC, file).split(sep).join('/');
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
  'date-holidays',
  'node:crypto',
  'node:fs',
  'node:fs/promises',
  'node:path',
  'rss-parser',
]);

const STATIC_IMPORT = /\bfrom\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT = /\bimport\s+['"]([^'"]+)['"]/g;
/** `require('x')` and `import('x')`: the two ways to load something later. */
const LATE_IMPORT = /\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Every module a file names, however it loads it. */
function modulesNamedIn(text: string): string[] {
  return [STATIC_IMPORT, BARE_IMPORT, LATE_IMPORT].flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[1]),
  );
}

/** The library the festivals source loads on first use, and the one file that may name it. */
const HEAVY = 'date-holidays';
const HEAVY_HOME = 'sources/holidays/date-holidays.ts';

function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

/** Jest keeps its own registry of what a test file has loaded, and shows it here. */
function loadedModules(): string[] {
  return Object.keys(require.cache).map((path) => path.split(sep).join('/'));
}

describe('the package stays pure', () => {
  const files = sourceFiles(SRC);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN.map(([pattern, what]) => [what, pattern] as const))(
    'never uses %s',
    (_what, pattern) => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
      expect(offenders.map(nameOf)).toEqual([]);
    },
  );

  it('imports nothing but its own files and the packages it declares', () => {
    for (const file of files) {
      for (const source of modulesNamedIn(readFileSync(file, 'utf8'))) {
        expect([
          nameOf(file),
          source,
          source.startsWith('.') || ALLOWED_PACKAGES.has(source),
        ]).toEqual([nameOf(file), source, true]);
      }
    }
  });

  it('never loads a module by a name worked out at run time', () => {
    // A `require(name)` or `import(name)` would walk straight past the list above.
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const late = [...text.matchAll(/\b(?:require|import)\(/g)].length;
      const literal = [...text.matchAll(LATE_IMPORT)].length;
      expect([nameOf(file), late - literal]).toEqual([nameOf(file), 0]);
    }
  });

  it('has the import scan seeing every way of loading a module', () => {
    expect(modulesNamedIn("import a from 'one';")).toEqual(['one']);
    expect(modulesNamedIn("import type { A } from 'two';")).toEqual(['two']);
    expect(modulesNamedIn("export { b } from './three';")).toEqual(['./three']);
    expect(modulesNamedIn("import 'four';")).toEqual(['four']);
    expect(modulesNamedIn("const c = require('five');")).toEqual(['five']);
    expect(modulesNamedIn("const d = await import('six');")).toEqual(['six']);
    expect(modulesNamedIn('const e = require( "seven" );')).toEqual(['seven']);
    expect(modulesNamedIn('const required = fromList(names);')).toEqual([]);
  });

  it('has the fetch guard catching what it says it catches', () => {
    const [pattern] = FORBIDDEN[2];
    expect(pattern.test('await fetch(url)')).toBe(true);
    expect(pattern.test('await source.fetch(input)')).toBe(false);
    expect(pattern.test('await createFixtureFetch()')).toBe(false);
    expect(pattern.test('await myfetch(url)')).toBe(false);
  });
});

/**
 * `date-holidays` and its data are 12 MB. The API imports this package when it
 * boots, so the library may only be required inside a function, the first time
 * a festival list is really asked for.
 */
describe('the heavy library is loaded on first use', () => {
  const files = sourceFiles(SRC);
  const home = files.find((file) => nameOf(file) === HEAVY_HOME);
  const lines = home ? readFileSync(home, 'utf8').split(/\r?\n/) : [];

  it('is named by one file only', () => {
    const naming = files.filter((file) =>
      modulesNamedIn(readFileSync(file, 'utf8')).includes(HEAVY),
    );
    expect(naming.map(nameOf)).toEqual([HEAVY_HOME]);
  });

  it('is imported there for its types alone, which compile to nothing', () => {
    // Comments are left out: the file's header talks about its import in plain words.
    const text = lines.filter((line) => !isCommentLine(line)).join('\n');
    // An import statement ends at its semicolon, so this never runs into the next one.
    const imports = [
      ...text.matchAll(/\bimport\s+(type\s+)?[^;]*?\bfrom\s+['"]date-holidays['"]/g),
    ];
    const bare = [...text.matchAll(/\bimport\s+['"]date-holidays['"]/g)];

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((match) => !match[1]).map((match) => match[0])).toEqual([]);
    expect(bare).toEqual([]);
  });

  it('is required once, inside a function', () => {
    const requiring = lines.filter(
      (line) => /\brequire\(\s*['"]date-holidays['"]\s*\)/.test(line) && !isCommentLine(line),
    );
    expect(requiring).toHaveLength(1);
    // Indented means inside a block. At the left edge it would run when the file is imported.
    expect(requiring[0]).toMatch(/^\s{2,}\S/);
    expect(lines.some((line) => /\bimport\(\s*['"]date-holidays['"]/.test(line))).toBe(false);
  });

  it('is not loaded by importing the package root, and is by the first festival list', async () => {
    const isHeavy = (path: string) => path.includes(`/node_modules/${HEAVY}/`);

    // The root is imported at the top of this file. The feed parser's library is
    // required at import time, so finding it proves this list can see a load.
    expect(loadedModules().some((path) => path.includes('/node_modules/rss-parser/'))).toBe(true);
    expect(loadedModules().filter(isHeavy)).toEqual([]);

    // Building a source and using the window helpers is still not a festival list.
    const noCalendar: DiscoverFetch = async (url) => ({ status: 404, body: '', finalUrl: url });
    const now = () => new Date('2026-11-10T08:00:00Z');
    const source = engine.createHolidaysSource({ fetch: noCalendar, now });
    expect(engine.todayIn('Asia/Kolkata', now())).toBe('2026-11-10');
    expect(engine.festivalsInWindow([], '2026-11-10')).toEqual([]);
    expect(loadedModules().filter(isHeavy)).toEqual([]);

    const result = await source.fetch({
      locality: engine.buildLocality({ countryCode: 'NL' }),
      language: 'nl',
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(loadedModules().some(isHeavy)).toBe(true);
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
      // Module 05: the four sources, festivals, and the addresses they ask.
      'createWikipediaSource',
      'isWikipediaArticle',
      'wikipediaProject',
      'wikipediaTopPrefix',
      'wikipediaTopUrl',
      'createBlueskySource',
      'BLUESKY_TRENDS_URL',
      'createMastodonSource',
      'MASTODON_INSTANCE',
      'mastodonTrendsUrl',
      'createYoutubeSource',
      'youtubePopularPrefix',
      'youtubePopularUrl',
      'createHolidaysSource',
      'todayIn',
      'daysUntil',
      'festivalsInWindow',
      'FESTIVAL_DAYS_BACK',
      'FESTIVAL_DAYS_AHEAD',
      'FESTIVAL_SPAN_DAYS_BACK',
      'FESTIVAL_SPAN_DAYS_AHEAD',
      'HOLIDAY_CALENDAR_IDS',
      'holidayCalendarUrl',
      'parseIcs',
      'calendarName',
    ]) {
      expect((engine as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it('keeps how festivals are read and merged to itself', () => {
    for (const name of [
      'mergeFestivals',
      'festivalItem',
      'festivalNameKeys',
      'libraryFestivals',
      'isObservance',
      'festivalsFromCalendar',
      'readHolidayCalendar',
      'holidayCalendarId',
      'holidayCalendarPageUrl',
    ]) {
      expect((engine as Record<string, unknown>)[name]).toBeUndefined();
    }
  });
});
