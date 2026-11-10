# Module 01: Engine Core, Trends And News

> **Sprint 11, Discover** | Status: Done (2026-11-05, uncommitted, awaiting the hand check) | Size: L (one full session)
> **Depends on**: nothing (first module; creates the branch)
> **Stories**: foundations for DC-2.1 and DC-3.1; the place model behind DC-1.x
> **Next**: [Module 02](module-02-api-locality-feed-and-cache.md)

## Goal

A new package, `@postgear/discover-engine`, that turns a place into a list of trend and news items from Google Trends and Google News, with every outside call made through an injected `fetch`, recorded fixtures for three places, and tests that never touch the network. No API, no UI yet.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- Sprint doc: Sources And Adapters, Locality And Languages, Simulation.
- Research: [`01-sources.md`](../research/01-sources.md) sections 3.1 and 3.2, [`02-libraries.md`](../research/02-libraries.md), [`03-location-and-language.md`](../research/03-location-and-language.md) sections 1, 3, 5, 6.
- Code: `packages/seo-engine/package.json`, `tsconfig.json`, `jest.config.js`, `src/index.ts` (the package shape to copy); `packages/seo-engine/src/authority/authority.ts` and `authority.test.ts` (injected fetch and its test); `packages/seo-engine/src/crawler/html.parser.ts` (`tokenize`, `decodeEntities`); root `tsconfig.json` and `apps/api/tsconfig.json` `paths`; `apps/api/package.json` dependencies on `@postgear/*`.

## Branch

Create `sprint-11-discover` from the branch Arvind names (ask if the Progress table does not say). Everything in this sprint commits there.

## Design

### 1. Package Shape

`packages/discover-engine/` with `package.json` (`name: @postgear/discover-engine`, `main: src/index.ts`, `types: src/index.ts`, jest preset), `tsconfig.json` extending the base, `src/index.ts` exporting everything below, `fixtures/`, `scripts/record-fixtures.ts`, `scripts/generate-languages.ts`. Add the path alias to the root `tsconfig.json` and `apps/api/tsconfig.json`, and `"@postgear/discover-engine": "*"` to `apps/api/package.json`. Dependencies: `rss-parser`, `countries-and-timezones`; dev: `cldr-core`. No `@postgear/*` imports (add a test like Sprint 10's purity test that greps `src/` for `@postgear/`).

### 2. Types (`src/types.ts`)

`Locality`, `DiscoverItem`, `SourceId`, `SourceInput { locality, language, topic?, signal }`, `SourceResult { items, attribution: { name, url? }, warnings: string[] }`, `DiscoverSource`, `DiscoverFetch = (url: string, init: { accept: string; signal: AbortSignal; maxBytes: number }) => Promise<{ status: number; body: string; finalUrl: string }>`, `Geocoder { reverse(lat, lng, lang), search(q, lang), fromTimeZone(tz) }`. Types may import only `zod`.

### 3. Place Tables (`src/geo/`)

- `editions.ts`: the Google News editions table from research 03 section 6, with `editionFor(country, language)` returning `{ hl, gl, ceid }` or the `US:en` fallback, and `languagesWithEdition(country)`.
- `languages.generated.ts`: written by `scripts/generate-languages.ts` from `cldr-core/supplemental/territoryInfo.json`: per country, languages that are official, official_regional or at least 5 percent, ordered by share. Checked in. The script is re-runnable and the file header says the CLDR version.
- `region-languages.ts`: the override table (India in full, plus CA, CH, BE, ES, US-PR, GB-WLS, IT-BZ, FI, ZA, NG, PK, LK, MY, SG).
- `resolveLanguages(locality): string[]`: override if present, else the country list; always de-duplicated; English appended last when absent so the AI always has it.
- `iso3166.ts`: `isRegionCode`, `countryOf(regionCode)`, `trendsGeo(locality)` (region when present, else country).
- `timezone.ts`: `countryFromTimeZone(tz)` through `countries-and-timezones`, `defaultTimeZone(country)`.
- `geocoder/nominatim.ts`: `createNominatimGeocoder({ fetch, userAgent, acceptLanguage })` with `reverse` (`/reverse?format=jsonv2&zoom=10&addressdetails=1`), `search` (`/search?format=jsonv2&addressdetails=1&limit=8`); maps `address` to `Locality` (city from `city`, `town`, `village`, `municipality`, `county` in that order; region from `ISO3166-2-lvl4` and `state`; country from `country_code` upper-cased; time zone from `defaultTimeZone(country)` unless the caller supplies one). It does **not** rate limit; the API does.
- `geocoder/simulated.ts`: answers Chennai for coordinates within 50 km of 13.08, 80.27, San Francisco near 37.77, -122.42, Paris near 48.86, 2.35, else Worldwide; search matches those three names.

### 4. Sources (`src/sources/`)

- `feed-parser.ts`: one `rss-parser` instance with custom fields (`ht:approx_traffic`, `ht:news_item`, `ht:picture`, `media:content`, `media:thumbnail`, `source`), a `parseFeed(body)` that throws a typed `FeedParseError`, and `stripHtml(text)` built on `tokenize` and `decodeEntities` (copied into the engine as small pure functions, since the engine cannot import seo-engine; note this in the Decision Log).
- `google-trends.ts`: `createGoogleTrendsSource({ fetch })`. URL `https://trends.google.com/trending/rss?geo=<trendsGeo>`; on an empty feed or a non-200, retry with the country; map items as research 02 section 3 describes (`kind: 'trend'`, `url` = first related story's URL, `source.url` = `https://trends.google.com/trending?geo=<geo>`); `warnings` says which geo answered.
- `google-news.ts`: `createGoogleNewsSource({ fetch })` with three fetchers: `place(city)` (`rss/headlines/section/geo/<encoded city>`), `top()`, `topic(id)`, all with `hl`, `gl`, `ceid` from `editionFor`. Items: `kind: 'news'`, `title` with the trailing " - Publisher" removed when it matches `source`, `opaqueUrl` = the link, `url` undefined (Module 08 resolves on demand), `related` from the description's list (title, link, source), `summary` undefined.
- `compose.ts`: `composeFeed(groups)` de-duplicates by normalised title across groups, drops items older than 48 hours for news, orders trends by rank and news by time, caps each group (10 trends, 20 stories), and assigns stable ids (`sha1(source + (url ?? opaqueUrl ?? title))`).
- `brief.ts`: `buildBrief(item, locality, language)` as the sprint doc specifies: plain text, control characters stripped, 1,800 characters max, the place name in the person's language when known.

### 5. Fixtures And Simulation

- `scripts/record-fixtures.ts` fetches, with the honest User-Agent, the Trends feed for `IN-TN`, `IN`, `US-CA`, `FR`, the News top and place feeds for Chennai (`IN:ta`, `IN:en`), San Francisco (`US:en`), Paris (`FR:fr`), and writes `fixtures/<place>/<source>.<YYYY-MM-DD>.xml`. It is run by a person, never by tests or CI.
- `src/simulation.ts`: `createFixtureFetch()` serves the newest fixture whose URL pattern matches, 404 otherwise; `createSimulatedGeocoder()`.

### 6. Tests

Jest in the package, all on injected fetch or fixture bodies: editions and language resolution (Chennai gives `ta, en`; Montreal gives `fr, en`; a country with no override uses CLDR order; unknown country gives `['en']`), the Trends mapper (fields, rank, traffic parsing of "200+", country fallback on empty), the News mapper (publisher stripping, related list parsing, Tamil titles preserved, HTML stripped), `composeFeed` (de-dup, caps, ids stable), `buildBrief` (length cap, no control characters, no HTML), Nominatim mapping (the recorded Chennai answer gives `IN-TN`), the simulated geocoder, and the purity test (no `@postgear/` imports, no bare `fetch(` in `src/`).

## Scope

**In**: the package, tables, two sources, composer, brief, fixtures, simulation, tests, wiring into the root and API tsconfig and the API package.json.
**Out**: the API module (02), any UI (03), Wikipedia, social, videos, holidays (05), the reader and link decode (08), rate limiting (02).

## Tasks

- [x] Create the branch; scaffold the package; wire the tsconfig paths and the API dependency; add the jest config and a passing smoke test.
- [x] Types.
- [x] `scripts/generate-languages.ts` and the generated table; `editions.ts`; `region-languages.ts`; `resolveLanguages`; `iso3166.ts`; `timezone.ts`.
- [x] Nominatim geocoder (mapping only) and the simulated geocoder.
- [x] `feed-parser.ts` with `stripHtml`.
- [x] Google Trends source with country fallback.
- [x] Google News source (place, top, topic).
- [x] `composeFeed` and `buildBrief`.
- [x] `scripts/record-fixtures.ts`; record the fixtures (with Arvind's OK to fetch the real feeds once); `createFixtureFetch`.
- [x] Tests listed above; `npm run validate` for the package and the API (the API must still compile with the new path alias).
- [x] Update the Progress table and the Decision Log.

## Tests

`npx jest --config packages/discover-engine/jest.config.js`. Expect every test green with no network (set `DISCOVER_TEST_OFFLINE=1`, or simply never pass a real fetch).

## Done When

- `import { createGoogleTrendsSource } from '@postgear/discover-engine'` compiles in `apps/api`.
- `createGoogleTrendsSource({ fetch: createFixtureFetch() }).fetch({ locality: chennai, language: 'ta' })` returns ten trend items with related headlines.
- `createGoogleNewsSource(...)` returns Tamil stories for Chennai and English stories for San Francisco.
- `resolveLanguages(chennai)` is `['ta', 'en']`; `resolveLanguages(paris)` is `['fr', 'en']`.
- The purity test passes; no `@postgear/*` import and no direct `fetch(` in the engine.

## Hand Check

1. `npx ts-node packages/discover-engine/scripts/print-feed.ts IN-TN ta` (a tiny script added for this check) prints ten trends and twenty stories from the fixtures, Tamil text intact.
2. Open one recorded fixture and confirm no personal data is in it (they are public feeds).

## Handoff

Module 02 binds `fetch` to `fetchUrlSafely`, adds the cache, the budgets and the routes. Exports it needs: `createGoogleTrendsSource`, `createGoogleNewsSource`, `composeFeed`, `buildBrief`, `createNominatimGeocoder`, `createSimulatedGeocoder`, `createFixtureFetch`, `resolveLanguages`, `editionFor`, `countryFromTimeZone`, `trendsGeo`, and the types.
