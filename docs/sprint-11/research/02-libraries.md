# Sprint 11 Research: Node Libraries

> **Written**: 2026-11-05. Versions, licences and module formats were read from the npm registry on that day. The API compiles with `module: commonjs` and `moduleResolution: node` (`apps/api/tsconfig.json`), on Node 20.9 or newer (`package.json` engines), so every runtime dependency must load with `require()` and ship its own types.

## 1. The Short List

| Package | Version | Licence | Loads under CommonJS | Used for |
|---|---|---|---|---|
| `rss-parser` | 3.13.0 | MIT | Yes (`main: index.js`, bundled `index.d.ts`, deps `xml2js`, `entities`) | Parsing every RSS and Atom feed (Trends, News, publisher, YouTube channel) from a body we fetched ourselves (`parseString`, never `parseURL`) |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 | Yes (`main: index.js`, no runtime deps) | Pulling the article out of a page for the reader |
| `linkedom` | 0.18.15 | ISC | Yes (`main: ./cjs/index.js`; `exports["."]` falls to the CJS file; `types` bundled) | The lightweight DOM that Readability needs (no jsdom) |
| `date-holidays` | 3.38.0 | ISC code, CC BY-SA 3.0 data | Yes (`main: ./lib/index.cjs`, `exports.require`, bundled types); 11 MB, load lazily | Holidays for 207 countries and their states |
| `countries-and-timezones` | 3.11.0 | MIT | Yes (`main: ./dist/index.js`, bundled types, no deps) | Browser time zone to country for the first guess (`getCountryForTimezone('Asia/Kolkata')` gives `IN`); a country's time zones |
| `cldr-core` (build-time only) | current | Unicode licence | Not imported at runtime | `supplemental/territoryInfo.json` feeds a generator script that writes `languages.generated.ts` (languages per country with official status and population share) |

Everything else the engine needs is already in the repo: the SSRF-guarded fetch and the HTML tokenizer in `packages/seo-engine`, Redis in the API, Zod everywhere.

### 1.1 Why not `@extractus/article-extractor` or `@extractus/feed-extractor`

`@extractus/article-extractor` 9.0.1 (MIT) is a thin layer over exactly `@mozilla/readability` 0.6 and `linkedom` 0.18, but its registry entry has **no `types` field**, so the API's `tsc` build would need a hand-written declaration. `@extractus/feed-extractor` 8 logs a deprecation warning under `require()` and pushes ESM. Using the two underlying libraries directly is simpler and typed.

### 1.2 `rss-parser` or `fast-xml-parser`

`rss-parser` is the simplest API and is CJS. It is built on `xml2js`, which is mature but slow-moving. The alternative is `fast-xml-parser` (MIT, zero dependencies, CJS and ESM, bundled types) with `processEntities: false` to switch off entity expansion. Either way we write the mapper from feed fields to `DiscoverItem` ourselves, because Google Trends uses the `ht:` namespace and media feeds use `media:` fields that generic parsers only expose as custom fields. Module 01 starts with `rss-parser` (custom fields `['ht:approx_traffic', 'ht:news_item', 'ht:picture', 'media:content', 'media:thumbnail']`) and may switch if a feed trips it.

### 1.3 `node-ical` is out

`node-ical` 0.27.3 (Apache-2.0) requires Node 22 or newer; the repo runs on 20.9. Google's holiday calendars contain only plain `VEVENT`s with `DTSTART;VALUE=DATE`, `DTEND`, `SUMMARY`, `DESCRIPTION` and `UID`, and no `RRULE`, so a small parser in the engine (unfold continuation lines, split on `BEGIN:VEVENT`, read five properties) is enough and tested against a recorded calendar. If recurrence ever appears, `ical.js` (MPL-2.0, Mozilla) is the fallback.

## 2. Rejected

| Package | Why not |
|---|---|
| `country-state-city` 3.2.1 | **GPL-3.0**. Not acceptable in a proprietary service. ISO 3166-2 names, if ever needed offline, come from CLDR's `subdivisions` data (Unicode licence). |
| `offline-geocode-city` 1.0.2 | MIT and tiny (217 kB) but returns only `cityName`, `countryIso2`, `countryName`; no region, so it cannot produce `IN-TN`. |
| `local-reverse-geocoder`, `offline-geocoder` | GeoNames-based (CC BY 4.0), need a 100 MB download at install or runtime, and GeoNames admin1 codes for India are numeric, not ISO 3166-2, so a second mapping table would be needed. Nominatim gives the code directly. |
| `google-trends-api` (npm) | Unmaintained since 2020; it scraped the old Explore JSON that now needs a browser. |
| `pytrends`, `trendspyg`, `feedparser`, `googlenewsdecoder` | Python. We port the ideas, not the runtime. |
| `jsdom` | Only a Jest environment in this repo; `linkedom` is lighter and enough for Readability. |

## 3. Porting trendspyg's RSS Path

The Python reference (`trendspyg`, MIT) normalises the Trends feed into: `keyword`, `rank`, `volume_text` ("200+"), `volume_min` (200), `started_at`, `ended_at`, `is_active`, `related_queries`, `news` (headline, url, source, image), `image`, `explore_url`. Our `DiscoverItem` for a trend keeps: `title` = keyword, `signal.label` = volume text, `signal.traffic` = volume minimum (parsed from the digits, `+` means "at least"), `signal.rank` = position in the feed, `publishedAt` = pubDate, `image` = `ht:picture`, `related[]` = the news items (title, real url, source), `url` = the first related story's publisher URL (so Open goes to an article, not to Google), and a Google Trends explore link in `source.url` for attribution. `brief` (the text handed to the AI) is built from the keyword, the traffic label and the related headlines.

## 4. Google News Link Decoder (best effort)

Since 2024 a Google News RSS `link` such as `https://news.google.com/rss/articles/CBMi...?oc=5` carries an opaque id. Two open-source decoders (the Python `googlenewsdecoder` and an Elixir port, both reported) do the same thing:

1. `GET https://news.google.com/rss/articles/<id>` (an HTML page). Read two attributes from the page: `data-n-a-sg` (a signature) and `data-n-a-ts` (a timestamp).
2. `POST https://news.google.com/_/DotsSplashUi/data/batchexecute` with a form body whose `f.req` wraps the id, timestamp and signature in the `Fbv4je` RPC envelope. The response, after stripping the `)]}'` prefix, contains the publisher URL.
3. Older ids can be decoded locally: base64-decode the id after `CBMi`; the URL sits between a known prefix byte sequence and a trailing marker. Try this first because it costs nothing.

Rules in PostGear: run it only when a person presses **Read** on a News item; cache the result in Redis for 7 days per id; keep a global budget of 20 decodes a minute; treat any failure as "not resolvable" and offer "Open the article in a new tab instead". It sits behind `DISCOVER_LINK_DECODE` (default on) so it can be switched off if Google changes the page. Trends items never need it because their news URLs are already real.

## 5. Tests And Fixtures

Every source takes `fetch` as an option, the way `createOpenPageRankProvider` does in `packages/seo-engine/src/authority/authority.test.ts`, so unit tests pass recorded bodies and never touch the network. Module 01 adds `scripts/record-fixtures.ts` that fetches the real feeds for three localities (Chennai, San Francisco, Paris) and writes them under `packages/discover-engine/fixtures/` with the fetch date in each file name. The same fixtures serve `DISCOVER_SIMULATION=true`.
