# Sprint 11 Research: The Approach On PostGear

> **Written**: 2026-11-05. How Discover fits the codebase as it is on branch `workflows-page-revamp`. The sprint doc (`../../sprint-documents/sprint-11-discover.md`) is the binding version of this; this page explains the reasoning and lists what we reuse, with paths.

## 1. Data Flow

```
Browser                       API (NestJS)                              Outside
-------                       ------------                              -------
Use My Location click
  rounds lat,lng (2 dp) ----> GET /discover/locality?lat&lng
                                 per-org throttle, global 1/s budget
                                 Redis discover:geo:rev:<lat>:<lng> ---> Nominatim reverse (once per place)
                              <- { locality }

Trending tab opens --------> GET /discover/feed?kind=trending&country=IN&region=IN-TN&lang=ta&tz=Asia/Kolkata
                                 cache key discover:feed:v1:trending:IN:IN-TN:ta
                                 fresh? answer. stale? answer + refresh in background
                                 miss? lock (SET NX), fan out with allSettled:
                                   Google Trends RSS (IN-TN, then IN) ------> trends.google.com
                                   Wikimedia top (ta.wikipedia, yesterday) -> wikimedia.org
                                   Bluesky trends, Mastodon tags ----------> public.api.bsky.app, mastodon.social
                                 compose, rank, strip HTML, build briefs
                              <- { items, fetchedAt, stale, unavailable, attribution }

Create Post on a card -----> POST /ai/generate { topic: item.brief, language: 'ta', channelIds, tone, format }  (SSE)
                                 existing pipeline: research (related headlines) -> classify -> hook -> content
                                 charges generate_post (5)
                              <- events ... done
Open In Composer ----------> POST /posts { state: DRAFT, publishDate, shared, channels }
                              <- { group }
router.push(/composer?group=...)
```

Everything upstream goes through one injected fetch in the engine, which the API binds to `fetchUrlSafely` from `@postgear/seo-engine` (SSRF guard, pinned IP, size cap, redirects re-checked). The engine never imports another `@postgear/*` package, following the Sprint 10 rule that packages do not import each other.

## 2. Where The Code Goes

| Layer | Path | Notes |
|---|---|---|
| Engine | `packages/discover-engine` (`@postgear/discover-engine`) | A Node engine like `packages/seo-engine`: types, locality tables, sources, feed composer, brief builder, article extraction, link decoder, fixtures. `main: src/index.ts`, jest preset, tsconfig paths in the root and `apps/api`. Not imported by the web app; `apps/web/src/types/discover.ts` mirrors the types the way `types/ai.ts` mirrors `ai-engine`. |
| API | `apps/api/src/modules/discover/` | `discover.module.ts`, `discover.controller.ts`, `discover.service.ts` (feeds and cache), `locality.service.ts`, `competitors.service.ts` and repository, `reader.service.ts`, `discover.messages.ts`, `dto/*.schema.ts`, `*.spec.ts`. Registered in `app.module.ts` with a dated comment like the others. |
| AI | `apps/api/src/modules/ai/` and `packages/ai-engine` | one optional `language` field on `generateSchema`, `GenerateRequest` and the content and hook prompts; a `researchProvider` option on `createPipeline` so Discover can hand related headlines in as sources |
| Web | `apps/web/src/app/(dashboard)/[orgId]/discover/page.tsx`, `apps/web/src/components/discover/`, `apps/web/src/lib/discover-api.ts`, `apps/web/src/types/discover.ts`, `settings/discover` | the page, the chip and dialog, tabs and cards, the Create Post sheet (reusing the AI components), the reader sheet, the competitors tab |
| DB | `packages/db/prisma/schema.prisma`, one migration, `SCHEMA_NOTES.md` | `DiscoverSettings`, `Competitor`, enum `DiscoverLocationSource` (Module 06 and 07, not before) |
| Env | `apps/api/src/config/env.ts`, `.env.example` | `DISCOVER_SIMULATION`, `DISCOVER_GEOCODER`, `DISCOVER_GEOCODER_USER_AGENT`, `DISCOVER_LINK_DECODE`, `YOUTUBE_API_KEY` |

## 3. Why These Shapes

- **Stateless feed endpoint, shared cache.** The feed answers depend on place and language, not on the workspace. Keying the cache on place means one Chennai fetch serves every Chennai workspace, which is what makes zero-spend and zero-worker possible. The viewer's current place lives in `localStorage` per org (like a filter), and the workspace default lives in `DiscoverSettings` once Module 06 ships. Before that, the page already works with the browser's choice.
- **One call per tab, not one fan-out call.** Tabs have different freshness and failure modes; a slow Wikipedia call must not hold up News. Inside a tab the sub-sources fan out with `Promise.allSettled` and the answer lists `unavailable`, the pattern the Search module uses.
- **No new AI endpoint.** `POST /ai/generate` already takes a topic (up to 2,000 characters) and channels, streams over SSE, charges and refunds `generate_post`, and the web already has the state, progress and result components whose "Open In Composer" creates the draft and opens the composer. Discover adds a `language` field and passes the item's `brief` as the topic. That is one new field and one new sheet, not a second pipeline.
- **The engine is a Node engine, not a pure package.** It needs no Temporal sandbox (the worker is not involved in v1), so it may use Node built-ins, but it still takes `fetch` from outside so tests and simulation never touch the network.
- **No Temporal in v1.** On-demand with stale-while-revalidate keeps every tab fast after the first visit. If pre-warming is wanted later, the maintenance workflow already loops every 15 minutes (`apps/worker/src/workflows/maintenance.workflow.ts`) and can call an API endpoint to refresh the places of active workspaces.
- **Nothing stored from feeds.** No items table in v1. Saved items ("Ideas") are a P2 table.

## 4. Caching Design

| Key | Fresh | Keep |
|---|---|---|
| `discover:feed:v1:trending:<cc>:<region>:<lang>` | 20 min | 6 h |
| `discover:feed:v1:news:<cc>:<region>:<city>:<lang>:<topic>` | 15 min | 6 h |
| `discover:feed:v1:wiki:<project>:<day>` | 24 h | 48 h |
| `discover:feed:v1:videos:<cc>` | 60 min | 6 h (never past 30 days, YouTube terms) |
| `discover:feed:v1:festivals:<cc>:<region>` | 7 d | 30 d |
| `discover:feed:v1:social:<source>` | 10 min | 2 h |
| `discover:competitor:<id>` | 30 min | 24 h |
| `discover:geo:rev:<lat2dp>:<lng2dp>`, `discover:geo:q:<normalised>` | 30 d | 30 d |
| `discover:read:<sha256(url)>` | 24 h | 24 h |
| `discover:link:<id>` | 7 d | 7 d |
| `discover:lock:<key>` | 20 s (SET NX) | |
| `discover:breaker:<source>` | 10 min | |
| `discover:budget:nominatim:<second>`, `discover:budget:youtube:<date>`, `discover:budget:decode:<minute>` | 1 s, 1 d, 1 min | |

`RedisService` (`apps/api/src/modules/redis/redis.service.ts`) already has `get`, `set(key, value, ttl)` and `incrementWithTtl`; Module 02 adds `setIfAbsent(key, value, ttl)` (`SET ... EX ttl NX`, with the in-memory Map fallback) for the lock. A process-wide gate modelled on `apps/api/src/modules/seo/seo.gate.ts` caps concurrent upstream fetches at four.

## 5. Simulation

`DISCOVER_SIMULATION=true` (refused when `NODE_ENV=production`, like the other flags in `apps/api/src/config/env.ts`) binds the engine to a fixture fetch: recorded real responses for Chennai (IN-TN, `ta` and `en`), San Francisco (US-CA, `en`) and Paris (FR, `fr`), plus a simulated geocoder that answers those three for any coordinates near them and "Worldwide" otherwise. Everything on screen works offline and in Playwright. Unit tests always inject a fetch, with or without the flag.

## 6. What We Reuse (with paths)

| Need | Reuse | Path |
|---|---|---|
| Safe outbound fetch for feeds and pages | `fetchUrlSafely` (`requireHtml: false` and an XML accept header for feeds, as `checkRobots` does), `assertSafeUrl`, `DEFAULT_USER_AGENT` | `packages/seo-engine/src/crawler/safe-fetch.ts`, `url-guard.ts` |
| HTML stripping, feed autodiscovery, reader fallback text | `tokenize`, `decodeEntities`, `parseHtml` (`text.content`), the `readLink` scan used by the brand extractor | `packages/seo-engine/src/crawler/html.parser.ts`, `apps/api/src/modules/studio/brand-extractor.ts` |
| Stranger-URL precedent (throttle, refusal mapping, address normaliser) | `BrandKitsService.throttle()`, `refusal()`, `websiteAddress()` | `apps/api/src/modules/studio/brand-kits.service.ts` |
| Process-wide concurrency gate | `SeoGate` | `apps/api/src/modules/seo/seo.gate.ts` |
| Redis cache and throttles | `RedisService` (`get`, `set`, `incrementWithTtl`, new `setIfAbsent`) | `apps/api/src/modules/redis/redis.service.ts` |
| Credits and the two-phase SSE run | `CreditsService`, `prepareGenerate` and `PreparedRun` | `apps/api/src/modules/ai/credits/`, `apps/api/src/modules/ai/ai.service.ts` |
| Research seam for related headlines | `ResearchProvider`, `createPipeline` options | `packages/ai-engine/src/types.ts`, `apps/api/src/modules/ai/engine/engine.factory.ts` |
| Input cleaning | `stripControlChars`, `collapseWhitespace`, `cleanText(min, max)` | `apps/api/src/common/sanitize.ts`, `apps/api/src/modules/ai/dto/ai.schema.ts` |
| Read-only fan-out shape | `SearchService.search` (`allSettled`, `unavailable`) | `apps/api/src/modules/search/` |
| Create Post sheet | `generate-state.ts`, `generate-progress.tsx`, `generate-result.tsx` (`openInComposer`), `use-credits.ts`, `credits-meter.tsx`, `ai-unavailable.tsx`, `lib/sse.ts` | `apps/web/src/components/ai/`, `apps/web/src/lib/sse.ts` |
| Quick path | `ai-copilot?topic=` prefill (`TOPIC_MAX` 2,000) | `apps/web/src/components/ai/generate-panel.tsx` |
| Festival date in the composer | `?at=` query param | `apps/web/src/lib/composer-data.ts` |
| Time zone guess and its validation | `viewerTimeZone()`, the dashboard `tz` schema | `apps/web/src/components/home/home-model.ts`, `apps/api/src/modules/dashboard/dto/dashboard.schema.ts` |
| Page scaffolding | `PageActions`, `AnalyticsPanel` and `PanelHeader`, `INSET`, `Tabs`, `Sheet`, `Combobox`, `EmptyState` and `ErrorState`, `Skeleton`, `Badge`, `Alert`, toasts | `packages/ui`, `apps/web/src/components/analytics/analytics-ui.tsx`, `apps/web/src/components/ai/ai-ui.tsx` |
| Rail and titles | `RAIL`, `TITLES` | `apps/web/src/components/navigation/dashboard-shell.tsx` |
| Settings section | `SECTIONS`, the notification preferences form as the pattern | `apps/web/src/components/settings/settings-shell.tsx`, `components/notifications/notification-preferences.tsx` |
| API client and type mirror shapes | `lib/workflows-api.ts`, `types/workflows.ts` | `apps/web/src/lib/`, `apps/web/src/types/` |
| Test patterns | injected `fetch` (`authority.test.ts`), `ExtractDeps` fakes (`brand-extractor.spec.ts`), the e2e helpers | `packages/seo-engine/src/authority/authority.test.ts`, `apps/api/src/modules/studio/brand-extractor.spec.ts`, `e2e/` |
| Rendered-page fallback (P2) | the shared browser pool | `apps/api/src/common/browser/browser-pool.module.ts` |

## 7. Page Layout

```
Top bar: Discover                                                            (global search)
+----------------------------------------------------------------------------------------+
| PageActions:  [ Chennai, Tamil Nadu v ]  [ Tamil v ]            ( Updated 12 min ago ) |
|               Places by OpenStreetMap contributors                                     |
+----------------------------------------------------------------------------------------+
| Tabs:  Trending | News | Videos | Festivals | Competitors                              |
+----------------------------------------------------------------------------------------+
| Trending                                                                               |
|  Rising searches in Tamil Nadu (via Google Trends)                                     |
|  [card] [card] [card] [card]                                                           |
|  What people are reading on Tamil Wikipedia (CC BY-SA)                                 |
|  [row] [row] [row]                                                                     |
|  Worldwide on Bluesky and Mastodon                                                     |
|  [chip] [chip] [chip] [chip]                                                           |
+----------------------------------------------------------------------------------------+
Card: image (optional) | title (dir=auto) | source, time, "200+ searches" | Create Post  Read  Open
```

On a phone the tabs scroll horizontally, cards stack, the chip collapses to the city name, and the sheets go full height. See `../discover-implementation-docs/00-ux-blueprint.md`.
