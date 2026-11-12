/**
 * Writes `src/geo/regions.generated.ts`: the first-level regions of each country
 * a place picker can offer, with their ISO 3166-2 codes and English names.
 *
 *   npm run regions --workspace=@postgear/discover-engine
 *
 * ## Where the rows come from
 *
 * Nothing installed has every country's regions with names. Two packages have
 * part of it, and this joins them:
 *
 * - `date-holidays` (a runtime dependency) names the states it has holiday rules
 *   for, in English where its data has English, else in the local language.
 * - `cldr-core` (build time only) lists every country's first-level subdivision
 *   codes, but no names. It is the check that a code is a real first-level one.
 *
 * A few rows are written here by hand ({@link HAND_WRITTEN}): France, whose
 * regions `date-holidays` does not list (it has three departments and the
 * overseas ones), and the two Indian territories it lacks.
 *
 * ## Only whole lists
 *
 * A country is written only when its list covers every first-level region CLDR
 * knows for it. A picker that offered six of Italy's twenty regions would be
 * worse than one that offers Italy alone, so a partial country gets no list and
 * the picker shows the country only. The run prints which ones were left out.
 * Subdivisions that are countries of their own (Puerto Rico in the United
 * States, Aruba in the Netherlands) are not counted: the picker lists them as
 * countries.
 *
 * ## India keeps the older codes
 *
 * ISO renamed five Indian codes in 2023 (`IN-CT` to `IN-CG`, `IN-OR` to `IN-OD`,
 * `IN-TG` to `IN-TS`, `IN-UT` to `IN-UK`, and `IN-DD` with `IN-DN` merged into
 * `IN-DH`). Google Trends and `date-holidays` still use the older ones (checked
 * on 2026-11-11 against SerpApi's list of Trends locations, which shows the 36
 * Indian codes Trends accepts), so the older ones are written: a region picked
 * here has to work as a Trends `geo` and as a holiday state. The engine reads the
 * newer ones too (`region-languages.ts` lists both), for places the geocoder finds.
 *
 * France is the one country where the codes here are not Trends' own: Trends
 * still files France under its pre-2016 regions (`FR-J` for Ile-de-France), which
 * ISO withdrew, and the rest of the engine and the geocoder use the current ones
 * (`FR-IDF`). A French region reads Trends for the whole country, which is what
 * Paris already does.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { default as Holidays } from 'date-holidays';

const HolidaysLibrary: typeof Holidays = require('date-holidays');

interface ContainmentFile {
  supplemental: { subdivisionContainment: Record<string, { _contains?: string[] }> };
}

/** Codes Trends and `date-holidays` use that ISO has since renamed, and the current code each stands for. */
const OLDER_CODES: Readonly<Record<string, string>> = {
  'IN-CT': 'IN-CG',
  'IN-OR': 'IN-OD',
  'IN-TG': 'IN-TS',
  'IN-UT': 'IN-UK',
  'IN-DD': 'IN-DH',
  'IN-DN': 'IN-DH',
};

/** Rows no installed package has. France from ISO 3166-2:FR (2016 regions, five overseas ones). */
const HAND_WRITTEN: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  FR: [
    ['FR-ARA', 'Auvergne-Rhône-Alpes'],
    ['FR-BFC', 'Bourgogne-Franche-Comté'],
    ['FR-BRE', 'Brittany'],
    ['FR-CVL', 'Centre-Val de Loire'],
    ['FR-20R', 'Corsica'],
    ['FR-GES', 'Grand Est'],
    ['FR-HDF', 'Hauts-de-France'],
    ['FR-IDF', 'Île-de-France'],
    ['FR-NOR', 'Normandy'],
    ['FR-NAQ', 'Nouvelle-Aquitaine'],
    ['FR-OCC', 'Occitanie'],
    ['FR-PDL', 'Pays de la Loire'],
    ['FR-PAC', "Provence-Alpes-Côte d'Azur"],
    ['FR-971', 'Guadeloupe'],
    ['FR-972', 'Martinique'],
    ['FR-973', 'French Guiana'],
    ['FR-974', 'Réunion'],
    ['FR-976', 'Mayotte'],
  ],
  IN: [
    ['IN-JH', 'Jharkhand'],
    ['IN-LA', 'Ladakh'],
  ],
};

/** Where `date-holidays` names a community or a language group rather than the region. */
const NAME_FIXES: Readonly<Record<string, string>> = {
  'BE-BRU': 'Brussels',
  'BE-VLG': 'Flanders',
  'BE-WAL': 'Wallonia',
};

const source = require.resolve('cldr-core/supplemental/subdivisionContainment.json');
const containment = (JSON.parse(readFileSync(source, 'utf8')) as ContainmentFile).supplemental
  .subdivisionContainment;

/** `usca` to `US-CA`. */
function isoOf(cldrCode: string): string {
  return `${cldrCode.slice(0, 2).toUpperCase()}-${cldrCode.slice(2).toUpperCase()}`;
}

function firstLevel(country: string): Set<string> {
  return new Set((containment[country]?._contains ?? []).map(isoOf));
}

const probe = new HolidaysLibrary();
const countries = new Set([
  ...Object.keys(probe.getCountries() ?? {}),
  ...Object.keys(HAND_WRITTEN),
]);
/**
 * Subdivisions ISO 3166-2 lists that also have an ISO 3166-1 code of their own,
 * so the picker offers them as countries. Named one by one, because a code like
 * `US-CA` also looks like a country (Canada) and must not be skipped.
 */
const OWN_COUNTRIES = new Set([
  'CN-HK',
  'CN-MO',
  'CN-TW',
  'FR-BL',
  'FR-CP',
  'FR-MF',
  'FR-NC',
  'FR-PF',
  'FR-PM',
  'FR-TF',
  'FR-WF',
  'NL-AW',
  'NL-CW',
  'NL-SX',
  'US-AS',
  'US-GU',
  'US-MP',
  'US-PR',
  'US-UM',
  'US-VI',
]);

const written: [string, (readonly [string, string])[]][] = [];
const partial: string[] = [];

for (const country of [...countries].sort()) {
  const levelOne = firstLevel(country);
  const states: Record<string, string> = probe.getStates(country, 'en') ?? {};
  const rows = new Map<string, string>();

  for (const [state, name] of Object.entries(states)) {
    const code = `${country}-${state}`;
    if (levelOne.has(code) || Object.hasOwn(OLDER_CODES, code)) {
      rows.set(code, NAME_FIXES[code] ?? name.trim());
    }
  }
  for (const [code, name] of HAND_WRITTEN[country] ?? []) rows.set(code, name);
  if (rows.size === 0) continue;

  const covered = new Set([...rows.keys()].map((code) => OLDER_CODES[code] ?? code));
  const missing = [...levelOne].filter((code) => !covered.has(code) && !OWN_COUNTRIES.has(code));

  if (missing.length > 0) {
    partial.push(`${country} (${rows.size} of ${rows.size + missing.length})`);
    continue;
  }
  written.push([country, [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))]);
}

const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const lines = [
  '/**',
  ' * Generated by scripts/generate-regions.ts from date-holidays and cldr-core,',
  ' * plus the rows that script writes by hand. Do not edit by hand.',
  ' */',
  '',
  'export const COUNTRY_REGIONS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {',
  ...written.flatMap(([country, rows]) => [
    `  ${country}: [`,
    ...rows.map(([code, name]) => `    [${quote(code)}, ${quote(name)}],`),
    '  ],',
  ]),
  '};',
  '',
];

const target = join(__dirname, '..', 'src', 'geo', 'regions.generated.ts');
writeFileSync(target, lines.join('\n'));
console.log(`Wrote ${written.length} countries to ${target}`);
console.log(`Left out as partial: ${partial.join(', ') || 'none'}`);
