# Sprint 11: Discover, Implementation Modules

This folder splits Sprint 11 (Discover) into **nine modules plus a UX blueprint and a parked P2 list**. Build them in order, **one module per Claude Code session**. Each module builds, verifies and stops so you can check it by hand before the next one starts. The first screen is on by the end of Module 03; the full Create Post loop by the end of Module 04.

| Document | What it decides |
|---|---|
| [`../../sprint-documents/sprint-11-discover.md`](../../sprint-documents/sprint-11-discover.md) | **How** to build: architecture, sources, data model, API routes, caching |
| [`../../new-modules/user-stories-discover.md`](../../new-modules/user-stories-discover.md) | **What the user experiences**: journeys, acceptance criteria, UX rules, completion checklist |
| [`../research/`](../README.md) | **Why**: what each source returned, the libraries, location and language, legal and limits |
| [`00-ux-blueprint.md`](00-ux-blueprint.md) | **How it looks and feels**: page anatomy, chips, cards, sheets, copy |
| `module-NN-*.md` (this folder) | **What to do in each session**: scope, design details, tasks, tests, done when, hand check |

If two documents disagree: user stories win on behaviour, the UX blueprint wins on look and interaction, the sprint doc wins on architecture, the research wins on facts about outside services. Record every such call in the decision log below.

---

## The North Star

> A page that answers "what should I post about today?" for a yoga studio in Chennai and a SaaS team in Berlin alike: local, in their language, honest about where it comes from, one click from a draft, and free to run.

**Reference products** (ideas only, never code): Buffer's Ideas page for the "collect then compose" rhythm; Google Trends' Trending Now page for the card anatomy (term, traffic, related stories); Feedly for group headers that name the source. `trendspyg` (Python, MIT) for the Trends RSS fields.

---

## Module Map

| # | Module | Size | Depends on | Stories | Status |
|---|---|---|---|---|---|
| 00 | [UX Blueprint](00-ux-blueprint.md) (read, do not build) | - | - | all UI stories | Reference |
| 01 | [Engine Core, Trends And News](module-01-engine-core-trends-and-news.md) | L | - | foundations for DC-2.1, DC-3.1 | Done, committed |
| 02 | [API: Place, Feed And Cache](module-02-api-locality-feed-and-cache.md) | M | 01 | DC-1.3, 1.4 (server side), DC-2.4 | Done, committed |
| 03 | [The Discover Page And The Place Flow](module-03-discover-page-and-location.md) | XL | 02 | DC-1.1 to 1.5, 1.7, DC-2.1, 2.4, DC-3.1 | Done, committed |
| 04 | [Create Post](module-04-create-post.md) | M | 03 | DC-4.1 to 4.5 | Done, committed |
| 05 | [More Sources: Wikipedia, Social, Videos, Festivals](module-05-more-sources.md) | L | 03 | DC-2.2, 2.3, DC-5.x, DC-6.1 | Done, committed |
| 06 | [Settings And Data Model](module-06-settings-and-data-model.md) | M | 03 | DC-1.6, DC-3.2 | Done, committed |
| 07 | [Competitors](module-07-competitors.md) | L | 02, 06 | DC-7.x | Not started |
| 08 | [Website Reader](module-08-website-reader.md) | M | 04 | DC-8.x | Not started |
| 09 | [Hardening, E2E And Sprint Close-Out](module-09-hardening-e2e-closeout.md) | M | 01 to 08 | section 6 checklist | Not started |
| 10 | [P2 Backlog (only when you decide)](module-10-p2-backlog.md) | - | 09 | extras | Parked |

```
01 -> 02 -> 03 -> 04 -> 08
              |-> 05
              '-> 06 -> 07
                                 04, 05, 06, 07, 08 all done -> 09 -> (10)
```

04, 05 and 06 are independent of each other after 03 (separate worktrees if wanted). 07 needs 06's migration; 08 needs 04's sheet. Keep the numbered order unless you are running sessions in parallel.

Size guide: M fits one session easily, L fills one, XL may need a second session ("continue Module NN"). Each module lists its tasks as checkboxes so a second session can pick up exactly where the first stopped.

---

## How To Run A Module

1. Docker services up (`docker compose up -d`), on branch `sprint-11-discover`, working tree clean (commit the previous module first; see below).
2. Open a fresh Claude Code session in the repo and paste the **Kickstart Prompt** below with the module number filled in.
3. When it finishes: do the module's **Hand Check**, then ask it to commit (`Module NN: <title>` as the subject line).
4. The session updates the **Progress** table and the **Decision Log** in this README before it stops. That is the memory the next session reads.

### Kickstart Prompt (copy, set the module number, paste)

```text
We are building Sprint 11, Discover, module by module.

Read, in this order:
1. CLAUDE.md
2. docs/sprint-11/discover-implementation-docs/README.md (rules, progress, decision log)
3. docs/sprint-11/discover-implementation-docs/module-NN-*.md (this session's module, in full)
4. Whatever that module's "Read First" section lists (the UX blueprint sections, the sprint doc sections, the research pages, the user stories, the code files).

We are doing Module NN only. Before writing code:
- Check the Progress table and the Decision Log, and confirm the modules this one depends on are Done. If one is not, stop and tell me.
- Check the branch is sprint-11-discover (Module 01 creates it from the branch I name) and the tree is clean.
- Give me a short plan (10 lines or fewer): what you will build, in what order, and anything in the module doc you think is wrong or risky. Then start building without waiting, unless something blocks you.

While building:
- Follow the module's Design and Tasks. Tick each task checkbox in the module doc as you finish it.
- Use the project skills the module names (prisma-change, new-api-module, new-page, verify-change).
- UX follows docs/sprint-11/discover-implementation-docs/00-ux-blueprint.md. Never copy another product's code.
- Every outside call goes through the SSRF-guarded fetch; every source takes fetch as an option; tests never touch the network. No paid call, ever.
- If the module doc and the code disagree, trust the code, make the smallest sensible choice, and write it in the Decision Log.

Before you stop:
- Run the verify-change skill for the touched workspaces.
- Update the module's Status line, the Progress table and the Decision Log in the README.
- Tell me what to check by hand (the module's Hand Check), what is not done and why, and suggest the commit message. Do not commit or push unless I ask.
```

To continue an XL module in a second session, use the same prompt and add: `Module NN is partly done. Its unticked task boxes are what is left.`

---

## Rules For Every Module

**Project rules** (from `CLAUDE.md`, repeated because they are easy to forget):

- No em dash and no middle dot anywhere (code, comments, docs, commits). A hook blocks them.
- Names in Title Case ("Create Post", "Use My Location", "Save For This Workspace"); sentences in sentence case. No all-caps.
- No in-page titles or taglines; pages open with a `PageActions` row.
- Placeholders read "Enter your ...".
- Clickable icons are animated (`MotionIcon`); decorative and state icons stay lucide.
- Warnings and failures use the design-system `Alert`; deletes are solid red with a confirm.
- Big surfaces use `bg-chrome`; read-only boxes inside a card use `bg-inset`; check light, dark and the Lilac theme.
- Validation with the Zod pipe and `.strict()` schemas; every route authenticated; tenancy through `@CurrentOrg()`.
- Run migrations and `db:generate` yourself in development.
- One search in the app (the top bar); Discover carries no second search box. The city field in the place popover is a picker, not a search of the app.

**Module rules**:

- `packages/discover-engine` never imports another `@postgear/*` package and never calls the network on its own: `fetch` is injected. The API binds it to `fetchUrlSafely` from `@postgear/seo-engine`.
- The web app never imports the engine; it uses `apps/web/src/types/discover.ts` (mirrored types) and `lib/discover-api.ts`.
- Feed caches are keyed by place and language, shared across workspaces. Settings, competitors and throttles are per workspace.
- Nothing from a feed or a page is written to Postgres. Redis only, with the windows in the sprint doc.
- Coordinates are rounded to two decimals in the browser, used once, never stored or logged.
- The UI says **place**, **trend**, **story**, **festival**, **competitor**; never "locality", "feed", "source id", "geocode".
- Everything runs under `DISCOVER_SIMULATION=true` locally (fixtures for Chennai, San Francisco, Paris) and `AI_SIMULATION=true`. A real feed is fetched only with the user's OK, and a paid call never.
- Small UI tweaks: the user checks by hand, so skip Playwright for those. Bigger flows (the place flow, Create Post end to end): use Playwright once, save screenshots to `screenshots/` (never committed).

---

## Names Everyone Uses

| Thing | Name |
|---|---|
| Branch | `sprint-11-discover`, cut from `workflows-page-revamp` at `9f2b93a`. It lives in its own worktree, `D:\rk-personal-projects\postgear-discover` (its `.env` has `DISCOVER_SIMULATION="true"` and `PORT=3101`), because other sessions share the main folder's checkout and its API on `:3001` |
| Database | The worktree has its own: `postgear_discover_db` in the `postgear_postgres` container (its `.env` `DATABASE_URL` points there since 2026-11-10; query it with `docker exec postgear_postgres psql -U postgres -d postgear_discover_db`). The main folder keeps `postgear_db`, which never sees this sprint's migrations until the branch is merged |
| Package | `@postgear/discover-engine` at `packages/discover-engine` |
| API module | `apps/api/src/modules/discover` |
| Web routes | `/[orgId]/discover` (`?tab=trending|news|videos|festivals|competitors`), `/[orgId]/settings/discover` |
| Web components | `apps/web/src/components/discover/` |
| Web client and types | `apps/web/src/lib/discover-api.ts`, `apps/web/src/types/discover.ts` |
| Models | `DiscoverSettings` (Module 06), `Competitor` (Module 07), enum `DiscoverLocationSource` |
| Env flags | `DISCOVER_SIMULATION` (refused when `NODE_ENV=production`), `DISCOVER_GEOCODER` (`nominatim` default, `off`), `DISCOVER_GEOCODER_USER_AGENT`, `DISCOVER_LINK_DECODE` (default `true`), `YOUTUBE_API_KEY` (optional) |
| Credit type | `generate_post` (5), unchanged |
| Source ids | `google-trends`, `google-news`, `wikipedia`, `bluesky`, `mastodon`, `youtube`, `holidays`, `rss` |
| Feed keys (Module 05) | one per load: `discover:feed:v1:trending:<CC>:<region>`, `...:news:...`, `...:wiki:<edition>.wikipedia`, `...:social:bluesky` and `:mastodon`, `...:videos:<CC>`, `...:festivals:<CC>:<region>`; `discover:budget:youtube:<Pacific date>` |
| Cache keys | `discover:feed:v1:...`, `discover:geo:...`, `discover:read:...`, `discover:link:...`, `discover:lock:...`, `discover:breaker:...`, `discover:budget:...` (sprint doc, Caching). Under simulation all of them sit under `discover:sim:`, so a recording can never be served as today's news. All in `apps/api/src/modules/discover/discover.keys.ts` |
| Per-workspace counters | `discover:locality:<org>` (5 a minute), `discover:feedmiss:<org>` (30 new places a minute) |
| Fixtures | `packages/discover-engine/fixtures/<place>/<source>.<date>.xml|json|ics`, recorded by `scripts/record-fixtures.ts` (it skips what is already recorded; `--dry-run` lists what it would ask). Places: `chennai`, `san-francisco`, `paris`, `worldwide`. Hand-written: `youtube-<CC>.sample.json` |
| Error codes | `locality_throttled`, `locality_unavailable`, `feed_throttled`, `geocoder_off`, `competitor_private`, `competitor_limit`, `read_private`, `read_failed`, `read_not_article`, `read_throttled`, `link_unresolved` |

---

## Additions Beyond The Sprint Doc

These come from the research and the design review and are part of this plan. Strike one out here if you do not want it.

| Addition | Module | Why |
|---|---|---|
| Time zone first guess before any prompt | 01, 03 | the page is never empty; no permission needed |
| Stale-while-revalidate with a single-flight lock and a breaker per source | 02 | zero spend, no worker, never an error page |
| Worldwide group (Bluesky, Mastodon) inside Trending | 05 | legally clean signal that survives a Google outage |
| Related headlines as the research sources for the AI | 04 | "Backed By Research" without Tavily |
| Plan A Post lands on the festival date | 04, 05 | the composer already takes `?at=` |
| Feed autodiscovery for competitors | 07 | nobody knows their competitor's RSS address |
| Best-effort Google News link decode behind a flag | 08 | Read works on most stories; Open always works |
| Simulated sticker when `DISCOVER_SIMULATION` is on | 03 | same honesty as Workflows |

---

## Progress

Each session updates its row. Status: Not started, In progress, Done, Done with gaps (say which).

| # | Status | Date | Commit | Notes (exports, endpoints, gaps) |
|---|---|---|---|---|
| 01 | Done | 2026-11-05 | `7445f97` | `packages/discover-engine`, 215 tests. Exports: places and languages (`buildLocality`, `localityFromTimeZone`, `WORLDWIDE`, `editionFor`, `newsLanguagesFor`, `resolveLanguages`), sources (`createGoogleTrendsSource`, `createGoogleNewsSource`), `composeFeed`, `buildBrief`, the place finder (`createNominatimGeocoder`), simulation (`createFixtureFetch`, `createSimulatedGeocoder`, `CHENNAI`, `SAN_FRANCISCO`, `PARIS`). Fixtures recorded once, dated 2026-11-04 UTC, about 1.2 MiB. Arvind's hand check is still to do |
| 02 | Done | 2026-11-05 | `fad4bac` | `apps/api/src/modules/discover`, exports `DiscoverService`. Routes: `GET /discover/status`, `/discover/locality`, `/discover/locality/search`, `/discover/feed`. The curl list passed under simulation, and so did the one real run: Trending for `IN-TN`, 428 ms, ten items, second call 13 ms from Redis, one refresh line. **Gap**: Nominatim has only met a recorded answer and a mock, never the real service, because the real run covered Trending only. Arvind's hand check is still to do. Shapes below |
| 03 | Done | 2026-11-10 | `6da0ac0` | Web only, no API change. Route `/[orgId]/discover` (`?tab=`), rail entry after Workflows. `types/discover.ts`, `lib/discover-api.ts` (`roundCoordinate`, `feedQuery`, `getFeed`, `searchPlaces`, `localityFromPosition`, `localityFromTimeZone`, `getDiscoverStatus`). `components/discover/`: `usePlace(orgId)` (place, language, source, status, `locate`, `pickPlace`, `pickWorldwide`, `setLanguage`, `retry`), `useFeed`, `DiscoverView` (takes `onCreatePost` and `renderCardExtra` for Module 04), `DiscoverGroup`, `TrendCard`/`StoryCard` (`ItemCardProps` with `onCreatePost?` and `extra?`), `PlaceChip`, `PlacePopover`, `LanguageChip`, `languageLabel`. Storage key `pg:discover:<orgId>`, version 1, no coordinates. 6 suites, 82 tests; web 1465 tests green. Playwright: guess, Use My Location (sent as 13.08, 80.27), Chennai in Tamil, blocked alert with focus, "paris" on Enter, reload keeps Paris, language switch, phone with no sideways scroll, playground. **Gap**: with the place finder off, the popover offers Worldwide only (no country picker yet). Arvind's hand check is still to do |
| 04 | Done | 2026-11-10 | `490c993` | No new endpoint, no migration. `POST /ai/generate` takes three optional fields: `language` (a BCP 47 tag), `sources` (1 to 6 `{ title, url, snippet }`, which become the run's research) and `publishAt` (echoed on `done`); without them the call is unchanged. API: `createHeadlinesResearch(sources)` (provider `discover-headlines`) in `modules/ai/engine/headlines-research.ts`, `PipelineOptions.researchProvider`. ai-engine: `GenerateRequest.language`, `prompts/language.ts` (`languageName`, `languageRule`, `languageField`), the simulated client echoes "(written in <tag>)". Web: `CreatePostSheet` and `CreatePostTarget { item, place, language, publishAt? }` (Module 05's Plan A Post and Module 08 open it with this), `CardMenu` (Draft In Copilot), `DiscoverPage`, `useGenerateRun` (shared with the AI page), `draftDate`, `GenerateResult` `publishAt` and `onOpened`, `discover-model` `draftTopic`, `draftSources`, `draftLanguages`, `copilotHref`. Tests: ai-engine 174, API 1994 passed, web 1486, discover-engine 215. Playwright under both simulations: Chennai in Tamil, one LinkedIn channel, "(written in ta)", Backed By Research with the card's 3 headlines and no web search, Open In Composer with the text, the channel and the next full hour, Draft In Copilot fills the topic, phone width. That run saved one real DRAFT in the demo workspace and spent 5 credits (5 left until Nov 29); the close check replayed the stream in the browser to spend nothing. **Gaps**: no real OpenAI run (simulation only); the 0-credit hand check is a unit test only; the API suite's `image-processor.spec` "Studio 2x export" test (Sprint 9) times out at 5 s under a full parallel run and passes alone. Arvind's hand check is still to do |
| 05 | Done | 2026-11-10 | `e614faf` | No migration. Engine: `createWikipediaSource`, `createBlueskySource`, `createMastodonSource`, `createYoutubeSource`, `createHolidaysSource`, `parseIcs`, `calendarName`, `HOLIDAY_CALENDAR_IDS`, `festivalsInWindow`, `todayIn`, `daysUntil`, `holidayRegion`, `isWikipediaArticle`, the address builders, `buildBrief` for wiki, social, video and festival; `SourceResult` gained `answeredDay`, `unitsUsed`, `partial`; new dependency `date-holidays`. API: `GET /discover/feed` answers all four kinds (the 501 is gone), one cache entry per load (`discover.plan.ts`), `today` on festivals, `reason` on videos, `status.sources` true for wikipedia, social and holidays and `videos` by the key. Web: `WikipediaRows`, `SocialChips`, `VideoCard`, `FestivalList` and `FestivalRow` (`discover-rows.tsx`, `festival-list.tsx`), `festivalPublishAt`, `isAdmin` on `DiscoverPage` and `DiscoverView`, playground rows. Fixtures: 8 recorded once, 3 hand-written YouTube samples. Tests: engine 1037, API Discover folder 291, web 1558, each with clean lint and typecheck. Playwright under both simulations: Chennai Trending with three groups (Wikipedia rows to `ta.wikipedia.org`, 20 chips that link out), Festivals for Chennai, Paris (one Armistice Day) and San Francisco (Thanksgiving), Plan A Post on Guru Nanak Jayanti sent `2026-11-23T18:00:00+05:30` and the composer opened on Mon 23 Nov 6:00 PM, Videos "not set up", phone width with no sideways scroll. That run saved one DRAFT and spent 5 credits in the worktree's own database. **Gaps**: 14 Chinese-calendar countries get no `date-holidays` rows (a bug in `date-chinese@2.2.0`); 11 calendar ids, 8 of them never fetched; YouTube has only met hand-written samples; in the full run on 2026-11-10 `image-processor.spec`, `media.service.spec` (image tests, 5 s timeouts) and once `brand-extractor.spec` (a speed test) failed on a busy machine, all older than Sprint 11 and untouched by it. Review findings fixed before the commit: a made-up region now reads the country's festival copy, and a Wikipedia list fetched late in the evening is asked again once it stops being yesterday's. Arvind's hand check is still to do |
| 06 | Done | 2026-11-10 | see `git log` ("Module 06") | The sprint's first migration: `20261110120000_sprint11_discover_settings` (model `DiscoverSettings`, enum `DiscoverLocationSource`), applied to the worktree's `postgear_discover_db` only. Seed: the demo workspace starts in Chennai, `['ta', 'en']`, topic Business; the second workspace has no row. API: `GET /discover/settings` (any member) and `PATCH /discover/settings` (admins; a member gets 403 "Only workspace admins can change the workspace place.", code `settings_admin_only`), both answering `{ settings }` with the stored fields plus a built `place` and `updatedAt`; `GET /discover/feed?...&useWorkspaceSources=1` leaves switched-off groups out before anything is fetched and answers `hidden`. `DiscoverSettingsService` (`get`, `update`, `switchedOff`), `DiscoverSettingsRepository`, `SOURCE_SWITCHES` (`trends, wikipedia, social, videos, festivals`). Web: `usePlace(orgId, workspace)` with `topic`, `setTopic`, `followWorkspace`; `findBrowserPlace`; `PlaceFinder` and `WorkspaceDefault` split out of `PlacePopover`; `TopicSelect`; `DiscoverSettingsForm` at `/[orgId]/settings/discover` (Workspace Place, Languages, News Topics, Sources); `settings` is a required prop of `DiscoverPage` and `DiscoverView`. Tests: API Discover folder 499, web Discover and settings 338, db 36; lint and typecheck clean for db, api, web and worker (tests were run per folder, not the whole suites again). Checked on the running API: member read, member save refused with nothing written, admin save, five bad bodies refused, Worldwide Social and Videos switched off. Playwright under both simulations: cleared storage opens on Chennai with the Workspace badge in Tamil, the popover line and Save For This Workspace for the admin, News opens on Business Stories, the settings page, Videos turned off shows "Videos are turned off for this workspace.", and as the member the button is disabled with the tooltip and the settings page is read-only (screenshots `s11-30` to `s11-35`). **Gaps**: on the very first page after login, before the workspace cookie is set, the server cannot read the settings and the page opens on the time zone guess (a reload shows the default); no review agent ran on this module; saving from the popover and the Languages, Topics and place cards were not clicked through in the browser (covered by tests). Arvind's hand check is still to do |
| 07 | Not started | | | |
| 08 | Not started | | | |
| 09 | Not started | | | |
| 10 | Parked | | | |

### Module 02 Answer Shapes (the contract for Module 03)

From the curl run under `DISCOVER_SIMULATION=true`, on 2026-11-05.

```text
GET /discover/status
  200 { status: { simulation: true, geocoder: 'nominatim', sources: { trends: true, news: true, wikipedia: false, videos: false, holidays: false, social: false } } }

GET /discover/locality?lat=13.08&lng=80.27
  200 { locality: { countryCode: 'IN', countryName: 'India', regionCode: 'IN-TN', regionName: 'Tamil Nadu', city: 'Chennai',
                    timeZone: 'Asia/Kolkata', languages: ['ta', 'en'], newsLanguages: ['ta', 'en'] } }
  sixth call in a minute: 429 { error: 'Try again in a moment.', statusCode: 429, code: 'locality_throttled' }
  more than two decimals: 400 { error: 'Invalid input', statusCode: 400 }

GET /discover/locality?tz=Asia/Kolkata
  200 { locality: { countryCode: 'IN', regionCode: null, regionName: null, city: null, timeZone: 'Asia/Kolkata',
                    languages: ['hi', 'en', 'bn', ...21 in all], newsLanguages: ['hi', 'en', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa'] } }
GET /discover/locality?tz=Etc/UTC
  200 { locality: { countryCode: null, ..., languages: ['en'], newsLanguages: ['en'] } }   (Worldwide)

GET /discover/locality/search?q=paris
  200 { localities: [{ countryCode: 'FR', regionCode: 'FR-IDF', regionName: 'Ile-de-France', city: 'Paris', timeZone: 'Europe/Paris', languages: ['fr', 'en'], newsLanguages: ['fr'] }] }
  no result: 200 { localities: [], message: "No places found for 'nowhere at all'. Try the city's English name." }

GET /discover/feed?kind=trending&country=IN&region=IN-TN&lang=ta
  200 { kind: 'trending', language: 'ta', locality: {...}, unavailable: [],
        groups: [{ id: 'trends', title: 'Rising Searches In Tamil Nadu', subtitle: 'Via Google Trends.', stale: false, fetchedAt: '<ISO>',
                   attribution: { name: 'Google Trends', url: 'https://trends.google.com/trending' }, items: [10 of these] }] }
  second call: 11 ms, no refresh log line
  item: { id, kind: 'trend', source: { id: 'google-trends', name, url }, title, url, image, publishedAt,
          signal: { label: '500+ searches', rank: 1, traffic: 500 }, related: [{ title, url, source }], brief }

GET /discover/feed?kind=news&country=IN&region=IN-TN&city=Chennai&lang=ta
  200 { kind: 'news', language: 'ta', locality: {...}, unavailable: [],
        groups: [{ id: 'place', title: 'Chennai Stories', subtitle: 'Via Google News.', items: [20] },
                 { id: 'top', title: 'Top Stories In India', subtitle: 'Via Google News.', items: [20] }] }   every headline in Tamil
  item: { id, kind: 'news', source: { id: 'google-news', name: 'Nakkheeran', url }, title, opaqueUrl, publishedAt, language: 'ta',
          related: [{ title, url, source }], brief }

Other group ids: 'topic' (with &topic=SPORTS, first, 'Sports Stories'), 'world' ('Top Stories Worldwide': no country, or a country with no edition).
A stale group: stale: true, subtitle 'Via Google News. Showing what we had from 16 minutes ago.', fetchedAt the real age.

trends-US-CA fixture renamed:   200 { unavailable: ['google-trends'], groups: [] }
kind=trending with no country:  200 { unavailable: [], groups: [] }   (until Module 05)
kind=videos, kind=festivals:    501 { error: 'Arrives in a later step of this sprint.', statusCode: 501 }   (until Module 05: both answer now, see its Progress row)
unknown kind, unknown key:      400 { error: 'Invalid input', statusCode: 400 }
no session:                     401
```

Two things for the page: without `tz` the answer's `timeZone` is the country's main zone, so send the place's own; and at country level `languages[0]` is the country's most spoken language (Hindi for India), so a language the browser already prefers, if the place has it, makes a better first choice.

---

## Decision Log

| Date | Module | Decision | Why |
|---|---|---|---|
| 2026-11-05 | plan | TypeScript port of the Trends RSS path; no Python | the monorepo is Node; pytrends is archived |
| 2026-11-05 | plan | Feed endpoint is stateless and its cache is shared by place | one Chennai fetch serves every Chennai workspace |
| 2026-11-05 | plan | No `/discover/draft`; `POST /ai/generate` gains `language` | one pipeline, one refund path, no new credit type |
| 2026-11-05 | plan | Nominatim for reverse and search, Enter-only search, 1 a second global budget | the policy forbids autocomplete and more than 1 a second |
| 2026-11-05 | plan | No coordinates stored; city, region, country, time zone only | privacy, and nothing needs them |
| 2026-11-05 | plan | No Temporal in v1 | on-demand with stale copies is enough; pre-warm is P2 |
| 2026-11-05 | plan | Google feeds ship with attribution and a swappable adapter (option A) unless Arvind picks B or C | see research 04, section 4 |
| 2026-11-05 | 01, 02 | Both prompts said "only", and both ran in one session, 01 first because it clears 02's gate. 02's "tree is clean" could not hold, because 01 stays uncommitted as asked | keeps the order and the do-not-commit rule; the two get separate `git add` lists |
| 2026-11-05 | 01 | The prompt's `<branch>` was left unfilled: cut from `workflows-page-revamp`, in a separate worktree | it is the only branch holding the whole design system (it contains the other sprint branches); other sessions share the main folder's HEAD, `node_modules` and `:3001` |
| 2026-11-05 | 01 | Sources never throw: they return an empty result with `failed: 'upstream' or 'not_found'`, and `answeredGeo` | only real trouble may count towards a breaker, and a heading must say what really answered after a fallback |
| 2026-11-05 | 01 | Trends retries the country on an empty feed or a non-200 other than 429; not on a 429, a dropped connection, or a 200 that is not a feed (the doc said any non-200) | when a service says slow down, or is broken, asking again straight away is impolite and useless |
| 2026-11-05 | 01 | `html-text.ts` keeps small copies of seo-engine's tokenizer and entity decoder, and its `stripControlChars` keeps ZWJ and ZWNJ, unlike the API's | the engine imports no other package; those joiners are real letters in Malayalam, Sinhala and Persian |
| 2026-11-05 | 01 | `SA:ar` in the editions table, correcting research's `SA:sa` | the research had a typo: Saudi Arabia's edition is Arabic |
| 2026-11-05 | 01 | `FR: ['fr','en']` override; the CLDR rule is otherwise kept in spite of some noise (`bar`, `nds` in Germany, `gsw` in Switzerland) | tightening the rule would lose real second languages such as `fr` in Morocco and `ru` in Ukraine |
| 2026-11-05 | 01 | A main time zone for the countries where the library's first one is far from most people (`America/Adak` for the US) | "today" must not start hours away from nearly everyone |
| 2026-11-05 | 01 | `composeFeed` takes a clock and `maxNewsAgeMs: null`; the fixture fetch serves topic addresses from that edition's top stories | recordings all pass 48 hours two days after they are made, and topic feeds were not recorded |
| 2026-11-05 | 01 | Nominatim's "recorded Chennai answer" is the one quoted in research 03 section 3, copied by hand | the OK to fetch covered the Google feeds only |
| 2026-11-05 | 01 | Fixtures write the two banned characters as `&#8212;` and `&#183;`, which `stripHtml` turns back with nothing lost, and a test guards them | the hook cannot see files a script writes, and real headlines contain them |
| 2026-11-05 | 01 | `print-feed.ts` prints the place and top story groups as well as trends; fixture dates are UTC | the hand check should see the whole answer |
| 2026-11-05 | 01 | `countryName('US')` is "United States" | "Top Stories In United States of America" reads badly; the library's other names are fine |
| 2026-11-05 | 01 | Heads-up, nothing changed: every Google News fixture carries the line "made available solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial use. Any other use of the feed is expressly prohibited." | research 04 quoted this from an older copy of the terms; it is in today's feeds too. Option A stands unless Arvind picks B or C |
| 2026-11-05 | 02 | Place keys hold a SHA-256 of the rounded position or the typed text, with no person or workspace in them (the doc had `<lat>:<lng>` and the plain text) | nothing about where someone is can be read off a key list. Two-decimal positions are few enough to walk, so the hash alone is pseudonymity; the missing link to a person is what really protects |
| 2026-11-05 | 02 | The Nominatim budget is one rolling key (`SET NX EX 1`), not one per clock second | a per-second key allows two calls 20 ms apart either side of the tick, and the policy says an absolute maximum of one a second |
| 2026-11-05 | 02 | The place throttle comes before the cache | Done When wants the sixth call refused; it counts a person asking, not an outside call |
| 2026-11-05 | 02 | The exception filter logs and reports the path only, and Sentry has `dataCollection: { urlQueryParams: false }` | positions and typed cities travel in query strings, and the SDK would otherwise keep them in events, breadcrumbs and spans |
| 2026-11-05 | 02 | `fetchUrlSafely` gains `verifyCertificate` (default false, so the analyzer is unchanged), and Discover sets it | the analyzer reaches past bad certificates because "nothing we send is sensitive", which does not hold for a position or a typed city |
| 2026-11-05 | 02 | Headings and briefs are built per request, never stored; `regionName` is an optional display-only parameter, not in the key | one person's words must not reach another through a shared copy |
| 2026-11-10 | 03, 04 | Both ran in one session, and Arvind asked for each to be committed and pushed (the kickstart said do not commit) | his own words came after the template and override it |
| 2026-11-10 | 03 | Create Post on a card is the neutral secondary Button, not the blue primary | the same action on every card is not the page's one call to action; Draft With AI inside the sheet is (Arvind's pick) |
| 2026-11-10 | 03 | On a guess the chip reads "India, from your time zone" with a Guess badge; the story's "Use My Location for your city" lives in the popover the chip opens | the blueprint's chip text; the chip has no room for both |
| 2026-11-10 | 03 | The popover's field label is "Search for a city", sentence case (the blueprint had it in Title Case) | CLAUDE.md: form labels stay sentence case |
| 2026-11-10 | 03 | First language: a region or city takes its first news language (Tamil for Chennai); a country or Worldwide takes a browser language the place offers, else its first | at country level the first language is the most spoken one (Hindi for India), which a browser preference beats; the Module 02 note |
| 2026-11-10 | 03 | The city search, Use My Location and Worldwide are all in the popover; with the place finder off it shows a sentence and Worldwide only | the smallest honest choice; a country and region picker for that case is a gap, logged in Progress |
| 2026-11-10 | 03 | The island is keyed by `orgId`, and `usePlace` drops an answer that lands after a workspace switch | each workspace keeps its own choice, and a slow answer for the old one never paints the new one |
| 2026-11-10 | 03 | Open names itself with `aria-label` ("Open <title> in a new tab"), not a hidden span | the title-case test reads hidden text as a name, and the label is a sentence |
| 2026-11-10 | 03 | "Updated ... ago" is the oldest group's `fetchedAt` | it must never claim more freshness than the stalest group on screen |
| 2026-11-10 | 03 | In development the time zone guess is asked twice on first load | React's Strict Mode runs effects twice in dev only; production asks once |
| 2026-11-10 | 04 | The prompt's Language field reads `ta (Tamil)`; the instruction ("Write in Tamil. Keep brand names and product names as they are. Do not translate the brand voice notes.") is a system rule (the doc put the sentence in the field) | rules sit with the other rules, and the simulated client needs the tag to echo "(written in ta)" |
| 2026-11-10 | 04 | Hashtags are left out of that rule | both prompts already forbid hashtags, so "keep hashtags" would contradict them |
| 2026-11-10 | 04 | `imagePrompt` is always written in English, whatever the post's language | image models follow English prompts best; the post text is what the reader sees |
| 2026-11-10 | 04 | Sources: a story is its own first source (its link, the publisher as snippet), then its related headlines; a trend starts at its related headlines. Web addresses only, each once, at most 6 (the doc had `related.slice(0, 6)`) | the story is what the person saw; a `javascript:` link or a repeat must never reach the prompt |
| 2026-11-10 | 04 | No safe source means `sources` is left out, and the workspace's own research runs as before | the schema refuses an empty list, and a draft with research beats one without |
| 2026-11-10 | 04 | The schema bounds each source: title and snippet cleaned to one line (control characters out), the URL `http(s)` only, at most 2,048 characters; `publishAt` needs an offset | the doc's sketch had no bounds; the same cleaning the topic gets |
| 2026-11-10 | 04 | Create Post shows only when the page hands the cards a sheet; Module 03's "coming next" tooltip is gone | no disabled placeholder is left anywhere |
| 2026-11-10 | 04 | `useGenerateRun` (stream, stop, failure) was lifted out of `GeneratePanel`, and both use it | "reuse, do not fork": one copy of the run logic for the AI page and the sheet |
| 2026-11-10 | 04 | `ChannelPicker` stays in `components/composer/` and is imported from there | moving it would touch the composer for nothing |
| 2026-11-10 | 04 | Format offers all four of the AI page's formats, default Short Post (the blueprint named three) | the API takes four, and the two screens should offer the same |
| 2026-11-10 | 04 | While a draft runs the sheet shows Cancel; after it, Edit Settings goes back to the form with the choices kept | the AI page's flow, in a narrower space |
| 2026-11-10 | 04 | Channels, platform rules and the AI status load on the first open and stay for the page's life; the balance loads on every open | the doc asked for the channels once; the balance moves |
| 2026-11-10 | 04 | `draftDate` dates the draft at `publishAt` only while it is still ahead, else the next full hour | a draft must never open dated in the past |
| 2026-11-10 | 04 | Open In Composer closes the sheet (`GenerateResult` gained `onOpened`) | found in the Playwright run: the composer opens as a modal over the page, and the sheet sat under it, stuck on "Opening..." once the composer closed. The AI page passes nothing and keeps its old behaviour, which likely has the same stuck button (not checked or changed here) |
| 2026-11-10 | 04 | The Format tiles go two across below `sm` | four in a row squeezed each name onto two lines at 390 px |
| 2026-11-10 | 04 | The route's default export is `DiscoverRoute`; the client island `DiscoverPage` (keyed by `orgId`) holds the sheet's target and the card menu | the server page stays thin, and the sheet closes on a workspace switch |
| 2026-11-10 | 04 | The animated icon test stub hands its ref `startAnimation` and `stopAnimation` | `MotionIcon` calls them on hover; the old stub handed over the bare svg |
| 2026-11-10 | 04 | The hand check's 0-credit step is covered by the sheet test, not by editing the shared ledger | other sessions share the database; the demo workspace reaches 0 on its own after one more draft |
| 2026-11-10 | 04 | For a language usually written in a script X counts double (Japanese, Korean, Chinese, Amharic, Khmer and others, `x-heavy-scripts.ts`), `strictestLimit` halves X's limit; the script comes from `Intl.Locale(...).maximize()` | found in review: the engine counts `text.length`, so a Japanese draft for X could reach twice X's limit. Every listed script is checked against social-core's own X counter. The workflow steps pass no language and keep the full limit |
| 2026-11-10 | 04 | A stream that breaks after the hook or the parts arrived keeps them in the sheet, with a red "Generation didn't finish" alert; only a refusal before anything streamed goes back to the form | found in review: the reducer marks every `fail` as before the stream, so the sheet hid a draft that may have been paid for |
| 2026-11-10 | 04 | Tests prove that closing the sheet and Cancel both abort the running stream | found in review: a broken unmount abort would charge for a draft nobody sees, with every test still green |
| 2026-11-05 | 02 | The feed key holds only what changes the upstream answer: Trending has no city or language (Module 05's Wikipedia caches under its own key), News has no region and uses the edition's language | a made-up `lang` must not be able to force a fetch; more sharing, fewer calls |
| 2026-11-05 | 02 | `not_found` is listed in `unavailable`, but never counts for the breaker and keeps the normal window | a place Google does not cover must not switch a source off for everyone |
| 2026-11-05 | 02 | An entry with a failure is retried after 60 s, one with a full gate as soon as the lock allows; the 20 s lock is never deleted, only expires | one attempt per window per place, whoever asks, and no race of deleting a lock someone else now holds |
| 2026-11-05 | 02 | The breaker counts `upstream` only, resets on any answer, and at 3 re-sets its expiry | the doc's counter would expire ten minutes from the first failure, not the last |
| 2026-11-05 | 02 | New limit: 30 new places a minute per workspace, 429 `feed_throttled`; a place already cached is free | the doc had no limit on misses, so walking every region would have hammered Google through us |
| 2026-11-05 | 02 | New 503 `locality_unavailable`, with a sentence per route | the doc had no code for OpenStreetMap being down; a failed position points at the search box, a failed search does not |
| 2026-11-05 | 02 | The gate is a semaphore with a bounded wait (4 slots, 4 s) around each group, not `SeoGate`'s instant refusal; being refused is not a breaker failure | someone is looking at an empty page and a slot frees within seconds; a full gate says nothing about the source |
| 2026-11-05 | 02 | A failed group keeps its old copy, marked stale with its real age, until the 6 h keep window | the page shows what it had and never has to guess; a kept copy still goes through the composer, so it cannot repeat a fresh story |
| 2026-11-05 | 02 | Simulated and real answers never share a key (`discover:sim:`) | the flag can change between two runs against the same Redis |
| 2026-11-05 | 02 | Worldwide: `country` is optional; Trending has no groups until Module 05; News reads the WORLD topic on `US:en`, also for a country with no edition | `US:en`'s top stories with another country's name on them would be a lie |
| 2026-11-05 | 02 | A chosen topic is the first group | de-duplicating favours the earlier group, and a story belongs under what was asked for |
| 2026-11-05 | 02 | `kind` knows four values: videos and festivals answer 501 until Module 05, anything else 400 | a typo should not read as "coming soon" |
| 2026-11-05 | 02 | A search with no result answers `{ localities: [], message }`; the place finder always asks in English | an empty list is an answer, not an error; the kept answer is shared, and Google's place feed reads English names best |
| 2026-11-05 | 02 | Every `locality` in an answer also carries `newsLanguages` (the doc had `languages` filtered to editions) | the chip needs the editions and the Create Post sheet needs the full list; `es` comes back as `es-419`, the way the edition writes it |
| 2026-11-05 | 02 | `tz` is checked for shape only, and goes back as sent | an unfamiliar zone must not refuse a whole answer. Nothing uses it yet: Module 05 must guard `Intl` where it first does |
| 2026-11-05 | 02 | The refresh log line's `key` can hold a city name, as the doc's logging asks; the line has no workspace in it | a shared place is not a position and not a search. Positions and typed text never appear (checked in a spec and in the log of the curl run) |
| 2026-11-05 | 02 | `DISCOVER_GEOCODER_USER_AGENT` names us on every Discover outside call, and a boot line prints the mode and the User-Agent | the first thing to check when an outside service has a complaint |
| 2026-11-05 | design | Blueprint section 11 maps every piece to a real component. Corrected: text buttons (Read, Open, Worldwide, Refresh) are `secondary`, not `ghost`, which is for icon-only controls on a surface; Open is a real link; the press is `pressSm`, since the Media tiles have no lift; city search is `Popover`, `Input`, `Button` and `List`, not `Combobox` (filters per keystroke) | checked against `/dev/components` and the code. Module 03 builds from it |
| 2026-11-05 | design | Open for Arvind: a blue Create Post on every card, or `secondary`, given "one blue primary per area" | see blueprint section 11; recommendation is `secondary` |
| 2026-11-10 | 05, 06 | Both prompts said "only", and both ran in one session, 05 first, each with its own commit and push | the same as 01 with 02 and 03 with 04; 06's switches need 05's groups |
| 2026-11-10 | 05, 06 | The worktree got its own database, `postgear_discover_db`, before 05's browser check and not only before 06's migration | Plan A Post's draft and its 5 credits landed there, not in the shared demo workspace, which had 5 credits left |
| 2026-11-10 | 05 | Screenshots continue at `s11-20` (to `s11-29`), after the highest number in the folder | the numbers in the module docs are out of date |
| 2026-11-10 | 05 | `date-holidays@3.39.1`: ISC code, **CC BY-SA 4.0 data** (the research said 3.0). The Festivals group credits it in its sub-line | the code licence is permissive; the data asks for credit and share-alike, and we show dates, not a changed copy of the data |
| 2026-11-10 | 05 | **Gap**: `date-holidays` throws for the 14 countries whose rules use the Chinese calendar (BN, CC, CN, CX, HK, ID, KR, MU, MY, PH, SG, SR, TW, VN). The adapter catches it, so Singapore reads its calendar alone and the others have an empty Festivals tab | `date-chinese@2.2.0`, published 2026-11-08, hands astronomia's data over wrongly under `require`. A root `overrides` pin to 2.1.4 was tried and npm did not apply it, so it was taken out again. Fix when upstream does, or in Module 09 |
| 2026-11-10 | 05 | The recording ran once: 8 requests (Wikipedia `ta`, `en`, `fr`, Bluesky, Mastodon, the calendars of India, the United States and France), 2 s apart, with the Discover User-Agent. The recorder now skips anything already recorded and has `--dry-run`, which showed the 8 addresses first and 0 afterwards | Arvind's OK covered exactly these, once; the Google feeds must never be asked again by accident |
| 2026-11-10 | 05 | JSON recordings write the two banned characters as `\u` escapes, calendars as a hyphen and a full stop; YouTube has hand-written `.sample.json` files marked `_sample` | nothing is lost in JSON; a calendar has no escape (none was needed); there is no key to record with |
| 2026-11-10 | 05 | Wikipedia drops a page whose title has a colon with no space after it, plus a table of main page titles for 26 editions (the doc had an English prefix list) | the recordings showed namespaces are translated (`சிறப்பு:Search`, `Spécial:Recherche`) and a real article can hold a colon (`Ramayana:_Part_1`). Only `en` and `ta` main pages are checked against a recording; a wrong or missing one only leaves that main page in the list |
| 2026-11-10 | 05 | Open for Arvind: the recorded English list shows `.xxx` (a real article about the domain) in its top 10. There is no blocklist | the stories ask for none; say if such titles should be hidden |
| 2026-11-10 | 05 | The calendar id table has 11 countries, the ones research 01 names (the doc asked for the 232 of a community list) | fetching that list was not covered by the OK, and an id nobody checked is a guess. India, the United States and France were confirmed by the calendar's own name; the other 8 are reported. Every other country reads `date-holidays` alone |
| 2026-11-10 | 05 | A calendar row that says "Public holiday in District of Columbia, Maryland, Virginia" is an Observance | the calendar is country level and its copy is shared; a regional day off must not show as a holiday for everyone. `date-holidays` gives real state holidays by region code |
| 2026-11-10 | 05 | The festivals source hands over 45 days back to 400 ahead, and the API cuts 7 back and 30 ahead per request with the place's own today (the doc had the source cut the window) | the copy is kept up to 30 days, so a windowed copy would show an old window; `todayIn` is where an unknown `tz` reads UTC instead of throwing (the Module 02 note) |
| 2026-11-10 | 05 | New `SourceResult` fields: `unitsUsed` (the doc put it in `warnings`), `answeredDay`, `partial` | `warnings` is a list of sentences; a header must not call the day before "yesterday"; a calendar that is down while `date-holidays` answers is half an answer, shown, never counted for the breaker, never replacing a whole copy, asked again after 10 minutes. A calendar 404 with library rows is a plain answer, or a wrong id would be asked every 10 minutes for ever |
| 2026-11-10 | 05 | `date-holidays` is asked in English and loaded on first use; rows merge on date and a normalised name ("labour" reads as "labor"); the calendar's name and the stronger badge win | "Armistice 1918" and "Armistice Day" would never match; the calendars write American English. A looser rule merged Christmas Eve into Christmas Day (substitute), so a few doubles stay (India on 2 October: Gandhi Jayanti next to Mahatma Gandhi Jayanti) |
| 2026-11-10 | 05 | The API caches one entry per load, not per tab (`discover.plan.ts`): Trending is rising searches (20 min), a Wikipedia edition (24 h), and Bluesky and Mastodon (10 min each), each with its own key, lock, age and kept copy | the three age at different speeds and belong to a region, a language and nobody. Stale is judged per group |
| 2026-11-10 | 05 | Wikipedia is keyed by edition, not by day; when the day before answered it is asked again after 60 minutes. The edition follows `lang` only when the place speaks it or it is English | yesterday's numbers arrive some hours into the day; a made-up language must not cost a call |
| 2026-11-10 | 05 | The YouTube budget is counted per Pacific day and a unit is taken before the call (the doc had a UTC date) | the quota resets at midnight Pacific, and two UTC days can fall inside one quota day: 16,000 against 10,000. Taken before, so a failed call counts and a race cannot pass 8,000 |
| 2026-11-10 | 05 | The YouTube key lives only inside its source; simulation uses a stand-in key; specs prove it is in no log line, key or answer | the key travels in the address, so no address is ever logged or put in a warning |
| 2026-11-10 | 05 | The feed answer gained `today` (festivals) and `reason: 'not_set_up' or 'resting'` (videos with no groups) | "in 3 days" must be counted from the place's day, and a tab with nothing needs to know which sentence to say |
| 2026-11-10 | 05 | The Worldwide group is named after the networks that have something to show ("Worldwide On Mastodon") | a heading must not name a network whose chips are missing |
| 2026-11-10 | 05 | The stale note counts in hours and days past two hours | "10,080 minutes ago" on a festival list tells nobody anything |
| 2026-11-10 | 05 | Festival sections: This Week, Next Week, Later This Month, **Next Month**, Just Happened; weeks run Monday to Sunday everywhere | read on 10 November, "Later This Month" would have held December dates; one week rule beats one per country |
| 2026-11-10 | 05 | Plan A Post is the secondary small button; it dates the post the day before at 18:00 for a public holiday and the day itself at 10:00 for an observance, on the place's clock, and passes the date even when it has passed | the same choice as Create Post on cards; the sheet's `draftDate` falls back to the next full hour |
| 2026-11-10 | 05 | "Updated ... ago" leaves the Wikipedia group out and is not shown on Festivals | a list that is a day old by design would make the page read "Updated 20 hours ago" |
| 2026-11-10 | 05 | New copy: Videos for Worldwide says "Trending videos need a place.", Festivals for Worldwide "Festivals need a place."; the empty Festivals state offers Try Again only when the source failed | the generic state offered a Try Again that could never work |
| 2026-11-10 | 05 | The server page reads the viewer's role from `GET /orgs` and passes `isAdmin` down (Module 06 reuses it) | the same lookup the channels and workflows pages do; a failed lookup reads as a member |
| 2026-11-10 | 05 | A Wikipedia row and a video are their own first source for a draft; Wikipedia rows have no overflow menu; a chip with no safe address is drawn but is not a link | a draft should cite what the person saw; an address that is not http or https is never a link |
| 2026-11-10 | 05 | The purity test now also reads `require('x')` and `import('x')`, and refuses a module name worked out at run time | a lazy `require` was invisible to the old scan |
| 2026-11-10 | 05 | Festivals are keyed by the region only when `date-holidays` has rules for it (`holidayRegion`), else by the country | found in review: `region` is checked for shape only, so `IN-ZZ1`, `IN-ZZ2` and so on each cost a fetch of the same calendar and a copy kept for a month |
| 2026-11-10 | 05 | A cached Wikipedia list that is no longer yesterday's is asked again after an hour, whenever it was fetched | found in review: a list fetched at 23:30 UTC waited a full day, so the next day's list stayed hidden for up to 21 hours |
| 2026-11-10 | 05 | Left as it is: the gate still allows four outside fetches at once, and a cold Trending request now uses all four | noted in review, not seen to bite; raise it in Module 09 if News is seen to wait. Also noted: the first festival request loads `date-holidays` (12 MB) on the request's own thread |
| 2026-11-10 | 05 | The first API agent hit the usage limit after writing the code and before its specs; a second agent wrote the specs (and proved each one fails against a deliberately broken copy of the service), and a read-only review ran before the commit | the workflow run could not finish on its own |
| 2026-11-10 | 06 | The member refusal is thrown inside the route, not by `@Roles(Role.ADMIN)` | the roles guard answers a wrong role with its own generic sentence, and the stories ask for ours. An admin, a super admin and a user flagged super admin pass. Validation runs first, so a member with a broken body gets 400 |
| 2026-11-10 | 06 | `locationSource: NONE` means "never saved"; a null country with any other source is a saved Worldwide. A place is saved whole: the fields a save leaves out are written as null | a null country alone cannot tell the two apart; a new city must never keep the old region |
| 2026-11-10 | 06 | The settings answer carries a built `place` (country name, languages, news languages) and `updatedAt`, neither stored | the row has no language list of the place, and the page needs a whole place to start from |
| 2026-11-10 | 06 | Five switches: `trends`, `wikipedia`, `social`, `videos`, `festivals`. News has none; a missing key means on; the stored JSON is read key by key | the doc named no keys; a hand-edited row must not crash a request or switch something else |
| 2026-11-10 | 06 | Switches only decide which loads a request asks for; the shared copies are untouched, and a failed settings read fails the request instead of guessing "everything on" | one workspace's choice must not reach another's, and a switched-off source must never be fetched by accident |
| 2026-11-10 | 06 | Turned off beats every other state on Videos and Festivals, "not set up" included | with no YouTube key locally, hand check 4 could otherwise never be seen |
| 2026-11-10 | 06 | A workspace start is not written to the browser, like the guess. A remembered record whose source is `guess` or `workspace` keeps its language and topic but takes the place from the workspace as saved now | a changed default reaches everyone who never chose a place; one language switch must not pin an old default for ever |
| 2026-11-10 | 06 | The topic is kept with the place as an optional field of the version 1 record, and All is stored as `ALL` | old records still read; choosing All must beat the workspace's default topic |
| 2026-11-10 | 06 | Picking a place on the settings page also sets the languages to that place's; Clear leaves them alone. Languages are a numbered list with Move Up, Move Down and Remove, not chips; Remove and Clear are not red | Tamil must not stay on a workspace moved to Paris; up and down only make sense top to bottom; neither deletes content |
| 2026-11-10 | 06 | The popover's workspace part sits under a line, as blueprint section 3 draws it | the blueprint wins on look; flagged because the app's rule is no decorative dividers |
| 2026-11-10 | 06 | Five page-level web suites set a 20 s test timeout | they passed alone and timed out at 5 s side by side on a busy machine; a `testTimeout` in the web Jest config would be the tidier home |
| 2026-11-10 | 06 | The refusal is logged as the existing `rbac.denied` event | the security logger's event names are a closed list outside the module |
| 2026-11-10 | 06 | Screenshots `s11-30` to `s11-35`, continuing the folder's numbering | the same rule as Module 05 |
| 2026-11-10 | 05 | Not verified, no network or key: the festival attribution's calendar embed address, the YouTube source against a real answer, and that an invalid key answers 400 naming the API key (read as trouble) | all three are written from documentation and knowledge |
