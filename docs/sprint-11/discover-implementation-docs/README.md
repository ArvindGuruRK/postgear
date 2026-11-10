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
| 04 | [Create Post](module-04-create-post.md) | M | 03 | DC-4.1 to 4.5 | Not started |
| 05 | [More Sources: Wikipedia, Social, Videos, Festivals](module-05-more-sources.md) | L | 03 | DC-2.2, 2.3, DC-5.x, DC-6.1 | Not started |
| 06 | [Settings And Data Model](module-06-settings-and-data-model.md) | M | 03 | DC-1.6, DC-3.2 | Not started |
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
| Package | `@postgear/discover-engine` at `packages/discover-engine` |
| API module | `apps/api/src/modules/discover` |
| Web routes | `/[orgId]/discover` (`?tab=trending|news|videos|festivals|competitors`), `/[orgId]/settings/discover` |
| Web components | `apps/web/src/components/discover/` |
| Web client and types | `apps/web/src/lib/discover-api.ts`, `apps/web/src/types/discover.ts` |
| Models | `DiscoverSettings` (Module 06), `Competitor` (Module 07), enum `DiscoverLocationSource` |
| Env flags | `DISCOVER_SIMULATION` (refused when `NODE_ENV=production`), `DISCOVER_GEOCODER` (`nominatim` default, `off`), `DISCOVER_GEOCODER_USER_AGENT`, `DISCOVER_LINK_DECODE` (default `true`), `YOUTUBE_API_KEY` (optional) |
| Credit type | `generate_post` (5), unchanged |
| Source ids | `google-trends`, `google-news`, `wikipedia`, `bluesky`, `mastodon`, `youtube`, `holidays`, `rss` |
| Cache keys | `discover:feed:v1:...`, `discover:geo:...`, `discover:read:...`, `discover:link:...`, `discover:lock:...`, `discover:breaker:...`, `discover:budget:...` (sprint doc, Caching). Under simulation all of them sit under `discover:sim:`, so a recording can never be served as today's news. All in `apps/api/src/modules/discover/discover.keys.ts` |
| Per-workspace counters | `discover:locality:<org>` (5 a minute), `discover:feedmiss:<org>` (30 new places a minute) |
| Fixtures | `packages/discover-engine/fixtures/<place>/<source>.<date>.xml|json|ics`, recorded by `scripts/record-fixtures.ts` |
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
| 03 | Done | 2026-11-10 | see `git log` ("Module 03") | Web only, no API change. Route `/[orgId]/discover` (`?tab=`), rail entry after Workflows. `types/discover.ts`, `lib/discover-api.ts` (`roundCoordinate`, `feedQuery`, `getFeed`, `searchPlaces`, `localityFromPosition`, `localityFromTimeZone`, `getDiscoverStatus`). `components/discover/`: `usePlace(orgId)` (place, language, source, status, `locate`, `pickPlace`, `pickWorldwide`, `setLanguage`, `retry`), `useFeed`, `DiscoverView` (takes `onCreatePost` and `renderCardExtra` for Module 04), `DiscoverGroup`, `TrendCard`/`StoryCard` (`ItemCardProps` with `onCreatePost?` and `extra?`), `PlaceChip`, `PlacePopover`, `LanguageChip`, `languageLabel`. Storage key `pg:discover:<orgId>`, version 1, no coordinates. 6 suites, 82 tests; web 1465 tests green. Playwright: guess, Use My Location (sent as 13.08, 80.27), Chennai in Tamil, blocked alert with focus, "paris" on Enter, reload keeps Paris, language switch, phone with no sideways scroll, playground. **Gap**: with the place finder off, the popover offers Worldwide only (no country picker yet). Arvind's hand check is still to do |
| 04 | Not started | | | |
| 05 | Not started | | | |
| 06 | Not started | | | |
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
kind=videos, kind=festivals:    501 { error: 'Arrives in a later step of this sprint.', statusCode: 501 }
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
