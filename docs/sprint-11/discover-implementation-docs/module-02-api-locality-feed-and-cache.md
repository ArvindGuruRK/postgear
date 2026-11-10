# Module 02: API, Place, Feed And Cache

> **Sprint 11, Discover** | Status: Done (2026-11-05, uncommitted, awaiting the hand check) | Size: M (one session)
> **Depends on**: [Module 01](module-01-engine-core-trends-and-news.md)
> **Stories**: DC-1.3 and DC-1.4 (server side), DC-2.4; the feed behind DC-2.1 and DC-3.1
> **Next**: [Module 03](module-03-discover-page-and-location.md)

## Goal

The `discover` API module: status, place resolution (reverse, time zone, search) within Nominatim's policy, the Trending and News feed with a shared stale-while-revalidate cache, single-flight locks, a breaker per source, budgets and throttles, and `DISCOVER_SIMULATION`. Everything is checkable with curl before any UI exists.

## Read First

- Sprint doc: API Routes, Caching And Budgets, Simulation.
- Research: [`04-legal-limits-and-risks.md`](../research/04-legal-limits-and-risks.md) section 3, [`05-approach-on-postgear.md`](../research/05-approach-on-postgear.md) sections 3 and 4, [`03-location-and-language.md`](../research/03-location-and-language.md) section 3 (the policy and how we comply).
- Code: `apps/api/src/modules/search/` (controller, service, schema: the read-only fan-out shape); `apps/api/src/modules/redis/redis.service.ts`; `apps/api/src/modules/seo/seo.gate.ts`; `apps/api/src/modules/studio/brand-kits.service.ts` (`throttle`, `refusal`); `packages/seo-engine/src/crawler/safe-fetch.ts` (`fetchUrlSafely`, the robots fetch in `crawler.ts` for the XML accept header); `apps/api/src/config/env.ts` (the `*_SIMULATION` flags and their production refusal); `apps/api/src/modules/ai/engine/engine.config.ts` (how a simulation flag picks an implementation); `.claude/skills/new-api-module/SKILL.md`.

## Design

### 1. Env

In `env.ts`: `DISCOVER_SIMULATION` (`'true' | 'false'`, default `'false'`, refused in production), `DISCOVER_GEOCODER` (`'nominatim' | 'off'`, default `'nominatim'`), `DISCOVER_GEOCODER_USER_AGENT` (default `PostGear/1.0 (+https://postgear.rkay.in)`; production should set a contact address), `DISCOVER_LINK_DECODE` (default `'true'`, used in Module 08), `YOUTUBE_API_KEY` (optional, Module 05). Document each in `.env.example` next to the other flags, in the same voice.

### 2. Module Layout

`apps/api/src/modules/discover/`: `discover.module.ts` (imports `RedisModule` implicitly as it is global; exports `DiscoverService` for Module 04), `discover.controller.ts`, `discover.service.ts` (feeds), `locality.service.ts`, `discover.engine.ts` (the factory that builds sources and the geocoder from env: simulation picks `createFixtureFetch` and the simulated geocoder; otherwise a `DiscoverFetch` adapter over `fetchUrlSafely({ requireHtml: false, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, application/json;q=0.8, */*;q=0.5', maxBytes: 1 MiB, timeoutMs: 8000, userAgent })`), `discover.cache.ts`, `discover.gate.ts`, `discover.messages.ts`, `dto/discover.schema.ts`, specs. Register in `app.module.ts` with a dated comment.

### 3. Routes (this module)

| Route | Behaviour |
|---|---|
| `GET /discover/status` | `{ status: { simulation, geocoder, sources: { trends: true, news: true, wikipedia: false, videos: false, holidays: false, social: false } } }` (the false ones flip in Module 05) |
| `GET /discover/locality?lat&lng` | schema: numbers with at most 2 decimals (refuse more: the browser must round); per-org throttle 5 a minute (`incrementWithTtl('discover:locality:<org>', 60)`), global budget `discover:budget:nominatim:<unix second>` cap 1 with a 2 s wait, cache `discover:geo:rev:<lat>:<lng>` 30 days; 429 `locality_throttled`, 503 `geocoder_off` |
| `GET /discover/locality?tz=` | no upstream call: `countryFromTimeZone` gives a country-level `Locality` with `languages` resolved; unknown zone gives Worldwide |
| `GET /discover/locality/search?q=` | `q` cleaned with `collapseWhitespace(stripControlChars())`, 2 to 80 characters; same throttle and budget; cache `discover:geo:q:<normalised>` 30 days; `{ localities }` max 8 |
| `GET /discover/feed?kind=trending\|news&country&region?&city?&lang&tz?&topic?` | `kind` other than those two answers 501 "Arrives in a later step of this sprint." until Module 05; the rest in section 4 |

Every answer's `locality` echoes what was used (with the resolved `languages`), so the web can fill the chips from it.

### 4. Feed Service And Cache

`DiscoverService.feed(kind, locality, language, topic)`:

1. Build the cache key (`discover:feed:v1:<kind>:<cc>:<region ?? '-'>:<city ?? '-'>:<lang>:<topic ?? '-'>`) and read `{ fetchedAt, groups }` from Redis.
2. Fresh (younger than the kind's fresh window): answer it.
3. Stale but present: answer it with `stale: true`, and start a background refresh (a caught promise, bounded by the gate) unless the lock is held.
4. Missing: try `setIfAbsent(lock, 20 s)`. Holder: fetch, store (keep window), answer. Not holder: wait up to 3 s polling the key every 250 ms, then answer whatever is there or an empty answer with `unavailable` naming every group.

`fetchGroups(kind, ...)`: `Promise.allSettled` over the groups of that kind (Trending: trends; News: place stories, top stories, topic stories), each wrapped in the breaker (`discover:breaker:<source>`: on failure increment a counter with a 10 minute TTL; at 3 the source is skipped and listed in `unavailable` until the key expires) and the gate (`DiscoverGate`, max 4 upstream fetches process-wide, modelled on `SeoGate`). Each group result is `{ id, title, subtitle, attribution, items, fetchedAt }` with `brief` built for every item on the way out. Titles come from `discover.messages.ts` in Title Case with the place name interpolated.

`RedisService.setIfAbsent(key, value, ttlSeconds): Promise<boolean>` is added (`SET key value EX ttl NX`; the Map fallback checks and sets).

### 5. Messages

`DISCOVER_MESSAGES`: `localityThrottled` ("Try again in a moment."), `geocoderOff` ("Finding places is turned off on this PostGear."), `notFound` ("No places found for '{q}'. Try the city's English name."), group titles and sub-lines ("Rising Searches In {place}", "Via Google Trends.", "{City} Stories", "Top Stories In {Country}", "Via Google News."), `staleNote` ("Showing what we had from {n} minutes ago.").

### 6. Logging

`securityLogger.warn('discover.locality_throttled', { orgId })`, `logger.info('discover.feed.refresh', { key, ms, unavailable })`. Never log coordinates or query text.

## Scope

**In**: env flags, the module, status, locality (reverse, tz, search), feed for trending and news, cache, lock, breaker, gate, budgets, throttles, messages, specs, curl checks.
**Out**: settings and competitors (06, 07), reader (08), other kinds (05), any UI (03).

## Tasks

- [x] Env flags and `.env.example` text; `validateEnv` tests for the production refusal.
- [x] `RedisService.setIfAbsent` with tests (Redis and Map fallback).
- [x] `discover.engine.ts` factory (simulation and real), the `DiscoverFetch` adapter over `fetchUrlSafely`.
- [x] `locality.service.ts`: reverse, tz, search, throttle, budget, cache; specs with a fake geocoder and fake Redis (throttle at the sixth call, budget waits then 429, cache hit skips the geocoder, more than 2 decimals refused by the schema).
- [x] `discover.cache.ts` (fresh, stale, missing, lock) and `discover.gate.ts`; specs with fake timers.
- [x] `discover.service.ts`: feed for trending and news with allSettled, breaker, `unavailable`, briefs; specs (one source failing still answers; three failures open the breaker; the stale path answers at once and refreshes once).
- [x] Controller, DTO schemas, messages, `app.module.ts` registration, `discover.routes.spec.ts` (roles: members allowed; unauthenticated 401).
- [x] curl checks under `DISCOVER_SIMULATION=true` (below) and one real run with Arvind's OK.
- [x] Update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/api/jest.config.js apps/api/src/modules/discover
npx jest --config apps/api/jest.config.js apps/api/src/modules/redis
```

Expect all green; no test opens a socket.

## Done When

With the API running on `DISCOVER_SIMULATION=true` and the demo admin's cookies:

- `GET /discover/status` says `simulation: true`.
- `GET /discover/locality?lat=13.08&lng=80.27` answers Chennai, `IN-TN`, `languages: ['ta', 'en']`; a sixth call in a minute answers 429.
- `GET /discover/locality?tz=Asia/Kolkata` answers India at country level.
- `GET /discover/locality/search?q=paris` answers Paris.
- `GET /discover/feed?kind=trending&country=IN&region=IN-TN&lang=ta` answers one group with ten items, each with a `brief`; the second call within 20 minutes is served from Redis (log line absent).
- `GET /discover/feed?kind=news&country=IN&region=IN-TN&city=Chennai&lang=ta` answers two groups with Tamil titles.
- With the fixture fetch made to fail for trends (a test-only env or a fixture rename), the trending answer has `unavailable: ['google-trends']` and status 200.

## Hand Check

1. Run the curl list above and paste the shapes into the Progress notes.
2. With Arvind's OK, set `DISCOVER_SIMULATION=false` once and fetch Trending for `IN-TN`; confirm the honest User-Agent in the API log and that a second call is a cache hit. Switch back to `true`.

## Handoff

Module 03 builds the page on `GET /discover/status`, `/locality` and `/feed`. The answer shapes as built are in the README, under Progress, and they are the contract; where they differ from this document (hashed place keys, `newsLanguages`, the two new error codes), the Decision Log says why. Module 03 mirrors them in `apps/web/src/types/discover.ts`.
