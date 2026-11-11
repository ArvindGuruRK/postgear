# Sprint 11: Completion Checklist & Test Guide

Companion to [sprint-11-discover.md](../sprint-documents/sprint-11-discover.md),
built through the ten module documents in
[`docs/sprint-11/discover-implementation-docs/`](../sprint-11/discover-implementation-docs/README.md)
(their README holds the Progress table and the full Decision Log).
Status as of **2026-11-11**. Branch `sprint-11-discover`, cut from
`workflows-page-revamp` at `9f2b93a`, with `workflows-page-revamp` merged back in
at `c7c41f4`. Modules 01 to 08 are committed and pushed (`7445f97`, `fad4bac`,
`6da0ac0`, `490c993`, `e614faf`, `813b053`, `150dbc6`, `d807ee5`); Module 09 is
this pass. Not merged, no pull request.

Sprint 11 started from nothing for Discover: no `packages/discover-engine`, no
`discover` module in the API, no Discover entry in the rail, no Discover tables,
and no way to turn a trend, a story or a festival into a draft. `POST
/ai/generate` took a topic and channels and nothing about language or sources.
The SSRF-guarded fetch in `packages/seo-engine` could only GET.

The **[Pre-existing]** things worth not re-testing: the content pipeline, the
credits ledger and the generate components (Sprint 6); the guarded fetch, its
address guard and the HTML tokenizer (Sprint 7); the composer and `POST /posts`
(Sprint 4); the brand extractor that first read a stranger's website (Sprint
9); the design-system components and the dashboard shell.

**12 of the 14 Definition of Done items are met, every one of them in
simulation**, and two are partly met: looks (four small things left), and
`npm run validate`, which is green for lint, typecheck and every Discover test
but fails on two image tests older than this sprint (Known gaps 11). Nothing in this sprint
costs money, and nothing was run against a paid service. What has run for
real, once each with Arvind's OK: the Google Trends and Google News feeds were
recorded (2026-11-04), one `DISCOVER_SIMULATION=false` Trending request was made
(2026-11-05), eight free addresses were recorded for Module 05 (2026-11-10),
and one live visit read the Trends feed and one publisher page (2026-11-11; the
publisher refused the read).

What has **not** run for real: OpenStreetMap's place finder (never called),
YouTube (no key exists), any competitor's site, feed, channel or account, the
Google News link decoder (samples only), a successful read of a real publisher
page, and OpenAI (every draft under `AI_SIMULATION`). The reader's worker thread
has never run in a production build (see Known gaps 1). The hand walk of
Journeys A to D is yours (§10).

---

## Prerequisites

```bash
docker compose up -d
npm install                                   # new: rss-parser, countries-and-timezones, date-holidays,
                                              # @mozilla/readability, linkedom (pinned to 0.18.12)
npm run db:generate
npm run migrate:deploy --workspace=packages/db   # 20261110120000_sprint11_discover_settings,
                                                 # 20261110130000_sprint11_competitors
npm run db:seed                               # the demo workspace starts Discover in Chennai (Tamil, English, Business)
```

`npm run db:seed` also resets credits, billing events and notifications. On a
database with data you care about, skip it: the page then starts from the time
zone guess until an admin saves a place.

| Variable | Default | Meaning |
|---|---|---|
| `DISCOVER_SIMULATION` | `false` | Recorded feeds, a stand-in place finder, one sample competitor and sample articles. Refused when `NODE_ENV=production`. **Set `true` locally** |
| `DISCOVER_GEOCODER` | `nominatim` | `off` turns finding places off (503 `geocoder_off`); the time zone guess keeps working |
| `DISCOVER_GEOCODER_USER_AGENT` | `PostGear/1.0 (+https://postgear.rkay.in)` | Who Discover says it is on every outside call. Production should add a contact |
| `DISCOVER_LINK_DECODE` | `true` | Whether a Google News link is resolved before Read. `false` shows "open it in a new tab" |
| `YOUTUBE_API_KEY` | empty | Optional, free. Without it the Videos tab says it is not set up |

`AI_SIMULATION="true"` (Sprint 6) is what Create Post drafts with locally.

---

## 1. The engine: `packages/discover-engine`

| # | Item | Status |
|---|---|---|
| 1.1 | Places: `Locality`, `buildLocality`, `localityFromTimeZone`, `WORLDWIDE`, ISO 3166 helpers, the CLDR-generated language table with region overrides, the Google News editions table (`editionFor`, `newsLanguagesFor`) | ✅ [New] |
| 1.2 | The place finder seam: `createNominatimGeocoder` (reverse and search, one identifying User-Agent) and `createSimulatedGeocoder` (Chennai, San Francisco, Paris) | ✅ [New]; **Nominatim never called for real** |
| 1.3 | Sources that never throw (`failed: 'upstream'` or `'not_found'`): Google Trends (region, then country), Google News (place, top, topic, search), Wikipedia top articles, Bluesky and Mastodon trends, YouTube most popular, holidays (Google calendar ICS merged with `date-holidays`) | ✅ [New]; **YouTube on hand-written samples only** |
| 1.4 | Competitor sources: RSS and Atom, YouTube channel feed, Bluesky author feed, Mastodon account (lookup then statuses), `discoverFeeds` (the page's `<link>` tags first, common paths only when it links none) | ✅ [New]; **samples only, written from documentation** |
| 1.5 | The reader: `extractArticle` (Readability on linkedom, plain paragraphs out, page limits as a first filter, `PageTooComplexError`) and the Google News link decoder (local base64, then a page and one POST) | ✅ [New]; **decoder never met Google; no real page parsed** |
| 1.6 | `composeFeed` (one list per group, no story twice, caps, the 48 hour news limit with an off switch) and `buildBrief` (plain text, 1,800 characters, a competitor brief that asks for our own take) | ✅ [New] |
| 1.7 | Simulation: `createFixtureFetch` over recorded feeds, `COMPETITOR_FIXTURES` and `createReaderFixtureFetch` over hand-written samples marked as samples inside | ✅ [New] |
| 1.8 | Purity: the package imports no other `@postgear/*` package and never reaches the network on its own (`purity.test.ts`, plus the API's no-direct-fetch sweep, §2.9) | ✅ [New] |
| 1.9 | Speed: `composeFeed` over 100 items in **4.6 ms** and `buildBrief` for 100 items in **9.2 ms** (median of 15, budget 20 ms each; `sources/performance.test.ts`) | ✅ [New] |

### 1.5: why the reader's limits are only a first filter

Finding an article is synchronous work on a stranger's markup. Two reviews
found page shapes that held it for 11 to 55 seconds, and limits on a page's
shape (tags, elements, links, depth, attributes) kept missing one. So the
limits refuse nearly every hostile page in milliseconds, and the API runs the
finder in a worker thread that it kills after two seconds (§2.7).

```bash
npx jest --config packages/discover-engine/jest.config.js
```

Expect **1662 passed** in 30 suites: places and languages, every source
on recorded or hand-written bodies with an injected fetch, the composer, the
briefs, the reader and decoder, simulation, purity and speed.

## 2. The API: `apps/api/src/modules/discover`

| # | Item | Status |
|---|---|---|
| 2.1 | `GET /discover/status`, `/discover/locality` (a rounded position, or a time zone), `/discover/locality/search`: 5 lookups a minute per workspace, one Nominatim request a second for the deployment, 30 day copies under hashed keys | ✅ [New]; in simulation |
| 2.2 | `GET /discover/feed` for Trending, News, Videos and Festivals: stale-while-revalidate in Redis shared by place, a single-flight lock, a breaker per source, a kept copy for a failed group, the YouTube daily budget, 30 new places a minute per workspace | ✅ [New]; in simulation, **one real Trending request on 2026-11-05 and one on 2026-11-11** |
| 2.3 | `GET` and `PATCH /discover/settings` (table `DiscoverSettings`): a place saved whole, ordered languages, news topics, five source switches; members read, admins save, a member's save refused with its sentence | ✅ [New] |
| 2.4 | `POST /ai/generate` gained `language`, `sources` (the card's headlines as research, no Tavily call) and `publishAt` | ✅ [New]; in simulation, **no OpenAI call** |
| 2.5 | Competitors (table `Competitor`): list, add, edit, remove (admins), `discover-feeds` (5 a minute), `:id/items` (30 minutes fresh, 24 hours kept, a note per failed kind, `pending`). 20 per workspace in one serializable transaction; a gate of their own; a breaker per host; 30 new reads a minute | ✅ [New]; samples only |
| 2.6 | `POST /discover/read` and `/discover/resolve-link`: the guard first, 10 reads a minute, a 24 hour copy under a hashed key, the reader's own gate, two pages in flight per workspace, a share of the link decodes, a refusal for a page that names another encoding | ✅ [New]; samples only |
| 2.7 | The article worker (`reader.extractor.ts`): one worker thread, a page at a time, killed after two seconds, a 256 MB ceiling, a budget of its time per workspace | ✅ [New]; **never run in a production build** (Known gaps 1) |
| 2.8 | Every address a person types (a competitor's website, each feed, a Mastodon instance, a page to read, what a Google News link resolves to) passes the private-network guard before it is saved, shown or fetched; 30 refused addresses a minute per workspace; `WEBHOOK_ALLOW_PRIVATE_URLS` cannot reach this module | ✅ [New] |
| 2.9 | The security sweep, `discover.security.spec.ts`: all 14 routes in a table (a new route fails it), 401 without a session, 403 outside the workspace, nothing public, the admin split, foreign and malformed ids 404, private addresses refused with no fetch on every entry point, no position, typed text, key, address or markup in any answer, Redis key or log line, and no direct `fetch(` outside the one adapter | ✅ [New] |
| 2.10 | Speed, `discover.performance.spec.ts`, under simulation: Trending cold **88 ms** and from cache **6.9 ms**; News cold **144 ms** and from cache **8.2 ms** (limits 3 s and 50 ms) | ✅ [New] |

```bash
npx jest --config apps/api/jest.config.js apps/api/src/modules/discover
```

Expect **829 passed** in 20 suites: the feed service and its cache, plan, gate and
keys; the place service; settings; competitors (schema, repository, service,
routes); the reader (service, routes, the worker for real); the sweep and the
speed spec.

## 3. The web app: `apps/web`

| # | Item | Status |
|---|---|---|
| 3.1 | Route `/[orgId]/discover` (`?tab=`), rail entry after Workflows, a `PageActions` row and no in-page title | ✅ [New] |
| 3.2 | Place chip and popover: the time zone guess, Use My Location (rounded to two decimals in the browser), city search on Enter only, Worldwide, the choice remembered per workspace with no position, Save For This Workspace for admins | ✅ [New] |
| 3.3 | Language chip, topic select, tabs Trending, News, Videos, Festivals, Competitors, the Simulated sticker, the OpenStreetMap credit, stale notes, empty and error states | ✅ [New] |
| 3.4 | Cards and rows: trend, story and video cards; Wikipedia rows; social chips; festival rows in sections by week; competitor rows with kind badges | ✅ [New] |
| 3.5 | `CreatePostSheet`: the brief, language, channels, tone, format, credits, Draft With AI, Open In Composer, Plan A Post with a date | ✅ [New]; drafts in simulation |
| 3.6 | Competitors tab and `CompetitorDialog`: Find Feeds, a pasted feed, the private sentence, the cap, Edit for everyone, Remove for admins with a confirm, a waiting state for an answer that is not ready | ✅ [New] |
| 3.7 | `ReaderSheet`: Read on trend and story cards and on a competitor's Blog and News rows, Read A Page on News, the article as text only, one sentence per failure with Open kept, Create Post From This | ✅ [New] |
| 3.8 | `/[orgId]/settings/discover`: Workspace Place, Languages, News Topics, Sources; read-only for a member | ✅ [New] |
| 3.9 | Accessibility: the tab list is "Discover tabs", groups are regions named by their heading, cards are articles named by their title, per-item names ("Create Post for {title}", "Read {title}", "Plan A Post for {title}"), Escape closes the popover and the sheet, every animation has its reduced-motion partner | ✅ [New] |
| 3.10 | Scripts: Tamil, Arabic and Japanese sample items in the playground, `dir="auto"` on every title and paragraph that carries outside text | ✅ [New] |
| 3.11 | Fixed in this pass: Discover adopts the workspace's place when it arrives after the first-login workspace sync (it used to stay on the guess until a reload); Discover and its Competitors tab never show another workspace's place or list when reached by address; the AI page's Open In Composer button no longer stays on "Opening…" after the composer closes, and reopens its draft instead of saving a second one | ✅ [New] |

```bash
npx jest --config apps/web/jest.config.js apps/web/src/components/discover apps/web/src/components/ai apps/web/src/components/settings/discover-settings.test.tsx apps/web/src/lib/title-case.test.ts apps/web/src/app/dev
```

Expect **571 passed** in 26 suites.

## 4. End to end: `e2e/discover.spec.ts`

Ten tests, each in a fresh browser context, under `DISCOVER_SIMULATION=true`
and `AI_SIMULATION=true`. **10 of 10 passed on two runs in a row** (2.3 and 2.2
minutes, four workers, 2026-11-11), and a third time after the review's fixes
(3.6 minutes).

| # | Test | Status |
|---|---|---|
| 4.1 | opens on the workspace place, in its first language, wearing the Simulated sticker | ✅ [New] |
| 4.2 | a workspace with no saved place starts on the time zone guess | ✅ [New] |
| 4.3 | Use My Location finds Chennai from a rounded position and shows Tamil content (the request carries exactly `lat=13.08&lng=80.27`, once; the browser's storage holds the city and no position) | ✅ [New] |
| 4.4 | switching the language chip moves News from Tamil to English and back | ✅ [New] |
| 4.5 | Create Post drafts from a trend in the chip language and opens it in the composer | ✅ [New] |
| 4.6 | Festivals lists the coming weeks and Plan A Post dates the draft | ✅ [New] |
| 4.7 | a competitor is added by website, shows what it published, and is removed | ✅ [New] |
| 4.8 | Read opens a story in the reader, and Create Post From This carries it into the sheet | ✅ [New] |
| 4.9 | a News story is opened through the link resolver, and a private or non-article page is refused | ✅ [New] |
| 4.10 | with location blocked, a search for Paris sets the place and a reload keeps it | ✅ [New] |

`POST /ai/generate` is answered inside the browser, so the spec spends no
credits (the demo workspace has 5 left). The tests that choose a place use the
second seeded workspace; the demo workspace's saved place is only read.

**What the spec found:** opening another workspace's Discover by address, while
the workspace cookie still named the demo workspace, showed "Chennai, Tamil
Nadu, Workspace" for a workspace with no saved place. The page now skips the
settings read until the cookie matches the address (`settingsInScope`, the rule
Home uses), with a unit test.

**Not covered by the spec:** a member's disabled Save For This Workspace (unit
tested, §5), the composer closing back onto the cards, and a run alongside the
rest of the e2e suite. The spec does not clear the read limit itself: a third
run within a minute could meet "10 reads a minute".

```bash
npm run dev:api:e2e                           # its own terminal, with the two simulation flags "true"
npm run test:e2e -- e2e/discover.spec.ts
```

**The log sweep after the runs** (393 lines of API log): no position (`13.08`,
`80.27`, `lat=`, `lng=`), no typed city, no competitor or reader address, no
Google News link id. Refusals log the workspace and the reason only. Five
`rbac.denied` lines with `no-active-org` come from a request made right after
login, before the workspace cookie exists; which request was not traced.

### The look pass

| What | Result |
|---|---|
| Dark, 1440 px (`s11-50`) | ✅ no sideways scroll (1440 of 1440) |
| Light, Classic (`s11-51`) | ✅ |
| Lilac, Trending and Festivals (`s11-52`, `s11-53`) | ✅ near-white cards on the lilac panel; `s11-53` caught the rows part way through their fade-in |
| Tamil, Arabic, Japanese in the playground (`s11-54`) | ✅ Arabic computes `rtl` and sits on the right; the shot shows the story cards, not the rows |
| Phone, 390 px: Trending, News, Competitors, the reader (`s11-55` to `s11-58`) | ✅ no sideways scroll on any (390 of 390; the sheet 388 of 388) |
| Reduced motion (`s11-59`) | ⚠️ nothing moves at rest; while the Create Post sheet opens, a 200 ms fade and the skeleton's pulse still run. Whether either moves anything but opacity was not checked |

Seen and **not fixed** (small, yours to call):

1. On a phone the tab bar scrolls sideways and Competitors sits off screen with
   no hint that it is there.
2. On a card the three-dot menu drops to a row of its own beside Open, leaving a
   blank band under the buttons.
3. The reader shows an empty bordered 16:9 box while its picture loads; it goes
   away if the load fails.
4. On a phone the language chip reads the bare code ("ta"). That is written
   that way on purpose, to fit the row; say if the name should show.

## 5. Edge cases: one test per row of the stories' section 5

| Situation | Where | Test |
|---|---|---|
| Location permission denied | web `place-popover.test.tsx` | "replaces the consent sentence with the warning and focuses the field when blocked" |
| Position found but Nominatim is down | api `locality.service.spec.ts` | "offers the search box when a position cannot be placed" |
| Search also down | api `locality.service.spec.ts` | "does not offer the search box when that is what failed" |
| Place finder turned off | api `locality.service.spec.ts`, web `place-popover.test.tsx` | "answers 503, and spends none of the limit on it"; "offers only Worldwide when finding places is turned off" (**the picker the story asks for is not built**, Known gaps 4) |
| Region has no Trends feed | engine `google-trends.test.ts`, api `discover.service.spec.ts` | "asks the country when the region is empty, and says so"; "names the country when that is what really answered" |
| Country has no Google News edition | api `discover.service.spec.ts` | "does not put a country's name on American news when it has no edition" |
| Place feed is empty | api `discover.service.spec.ts` | "does not show an empty group, and does not call that a failure" |
| Google answers 429 or a consent page | engine `feed-parser.test.ts`, api `discover.service.spec.ts` | "calls a consent page with a 200 the service being in trouble"; "leaves a source alone after three failures, for every place"; "keeps what it had for the failed group, with its real age" |
| Wikipedia has no data for yesterday | engine `wikipedia.test.ts` | "asks for the day before when yesterday is not published yet, and says so" |
| YouTube key missing | api `discover.service.spec.ts`, web `discover-view.test.tsx` | "says it is not set up, and touches nothing"; "says videos are not set up without a key, and makes no request" |
| YouTube budget spent | api `discover.service.spec.ts` | "says it is resting when it has nothing to show, and keeps no call waiting" |
| Holiday calendar id missing | engine `holidays/index.test.ts` | "answers the library rows as a complete result, with no call" |
| A festival is also an observance | engine `holidays/merge.test.ts` | "lets the stronger badge win, whichever reader holds it" |
| Competitor website has no feed | api `competitors.service.spec.ts`, web `competitor-dialog.test.tsx` | "answers an empty list for a site with no feed, a page that is missing and a site that is down"; "says so when the website has no feeds, and takes a pasted one" |
| Competitor feed is huge or malformed | engine `rss.test.ts`, api `competitors.service.spec.ts` | "says unreadable for a feed over the size cap"; "says \"could not be read\" for a feed that answered with something else" |
| Reader hits a paywall or a login page | api `reader.service.spec.ts` | "says \"could not read\" for a login wall, and does not remember it" |
| Reader URL is private | api `reader.service.spec.ts` | "refuses %s with the sentence, with no request and no read counted" |
| Google News link cannot be resolved | api `reader.service.spec.ts`, web `reader-sheet.test.tsx` | "says the story could not be opened when the answer is malformed, with no retry"; "shows the sentence for link_unresolved in place of the text, and keeps Open" |
| Out of AI credits | web `create-post-sheet.test.tsx` | "disables Draft With AI with the reset date when the balance cannot cover it" |
| Draft fails after charging | api `ai/ai.service.spec.ts`, web `create-post-sheet.test.tsx` | "refunds the whole charge and sends a safe error event when the pipeline fails"; "shows the sentence and the refunded balance when a draft fails after it was charged" |
| Member tries Save For This Workspace | api `settings.service.spec.ts`, web `discover-workspace.test.tsx` | "refuses a member with the sentence, and touches nothing"; "never sends a save for a member, who sees the button disabled with the reason" |
| Simulation on | web `discover-view.test.tsx`, engine `geocoder.test.ts` | "shows the chips, the credit, the Simulated sticker and the groups"; "is Worldwide more than 50 km away" |
| Arabic or Hebrew place | web `discover-accessibility.test.tsx` | the nine "titles in Tamil, Arabic and Japanese" tests (`dir="auto"`); Hebrew is not sampled, the mechanism is the same |

---

## Definition of Done: evidence

| DoD item | Evidence |
|---|---|
| Discover opens from the rail; the first visit shows country-level Trending and News from the browser's time zone with no prompt | **In simulation.** §3.1, §3.2; e2e 4.2 |
| Use My Location turns a rounded position into a city, region and country through Nominatim within its policy; denied and unavailable states each show their sentence; coordinates are never stored or logged | **In simulation.** §2.1, §2.9 (no position in any answer, key or log line); e2e 4.3. **Nominatim itself has never been called** |
| A typed city (on Enter) becomes a place; Worldwide works; the viewer's choice survives a reload | **In simulation.** §3.2; e2e 4.10 |
| Trending shows rising searches for the region (country fallback), Wikipedia reads for the language, and Worldwide social topics; each group names its source and place | **In simulation**, plus two real Trending requests (428 ms on 2026-11-05, 1,037 ms on 2026-11-11). §1.3, §2.2 |
| News shows the city's stories in the place's first language and switches language from the chip; every card links out and shows the publisher | **In simulation**, on feeds recorded from Google News on 2026-11-04. e2e 4.4 |
| Create Post on any card drafts through `POST /ai/generate` in the chosen language, charges 5 credits (refunded on failure), and Open In Composer opens the draft; a festival draft lands on the festival date | **In simulation.** §2.4, §3.5; Module 04 and 05's browser runs each saved one real draft and spent 5 credits; e2e 4.5 and 4.6 (the generate call stubbed) |
| Festivals lists the next 30 days with Public Holiday and Observance badges from the holiday calendar and `date-holidays`, merged and de-duplicated | **In simulation**, on calendars recorded on 2026-11-10 for India, the United States and France. **14 countries get no `date-holidays` rows** (Known gaps 5) |
| Videos shows YouTube's most popular for the country when `YOUTUBE_API_KEY` is set and says "not set up" otherwise; the daily budget stops at 8,000 units | **In simulation**, on hand-written samples: no key exists. The budget is unit tested |
| A workspace admin saves a default place, languages, topics and sources; members see it on a new device | ✅ §2.3, §3.8, §3.11 |
| Competitors: add by website with feeds found automatically, add channel handles, see the latest items per competitor and name mentions from Google News; 20 per workspace; unsafe URLs refused with a sentence | **In simulation**, on one invented company. §2.5, §2.8, §3.6 |
| Read opens an article in a sheet from a safe fetch with Readability; private, unreadable and non-article pages each get their sentence; the reader never stores page text; Google News links resolve when they can and fall back to Open | **In simulation.** §2.6, §2.7, §3.7. The one live read (2026-11-11) was refused by the publisher, so **no real page has been parsed** |
| Every upstream call goes through the SSRF-guarded fetch; the cache is shared by place; a resting source shows stale items or `unavailable`, never an error page; no paid call exists in the code | ✅ §2.8, §2.9. No paid adapter exists: the only keys are the optional free YouTube one and Sprint 6's OpenAI and Tavily, which Discover does not call for feeds |
| `DISCOVER_SIMULATION=true` runs every screen offline; `e2e/discover.spec.ts` passes under it; unit tests cover every source with injected fetch; `npm run validate` is green | **In simulation.** §4: 10 of 10, twice; every source has unit tests on an injected fetch (§1.3, §1.4); **Partly.** `npm run validate` on 2026-11-11, nothing else running: lint and typecheck clean in every workspace; every package suite passed (engine 1662, worker 463, automation 698, design-engine 744, and the rest); web 1929 of 1929 in 133 suites (run on its own, because the run stops at the first failed task); API 2645 passed, 20 skipped, **4 failed, all in `media/image-processor.spec` and `media/media.service.spec`** (5 second timeouts on large pictures; Sprint 9 code this sprint does not touch). All 829 Discover API tests passed |
| Light, dark and Lilac checked; phone width checked; Tamil, Arabic and Japanese sample items render with `dir="auto"` | **Partly.** §4, the look pass: the three themes, 390 px and the three scripts are checked, with screenshots `s11-50` to `s11-59`. Four small things were seen and left (§4), and reduced motion still runs two opacity animations in the Create Post sheet |

### The stories' section 6

Every story from DC-1.1 to DC-8.3 is built and tested in simulation. Two are
short of their text: **DC-1.3** has never met the real place finder, and the
edge row beside **DC-1.4** (a country and region picker when the place finder
is off) is not built. **DC-6.1** runs on hand-written samples only. The quality
gates: sources and places named (✅), no coordinates stored or logged (✅,
§2.9), the guarded fetch everywhere (✅), simulation runs every screen (✅),
looks (**partly**, §4), copy rules (✅, `title-case.test.ts`), this checklist (✅).

---

## Deviations from the sprint document, and why

The full list, with reasons, is the Decision Log in the modules' README (about
190 rows). The ones that change what someone reading the sprint document would
expect:

| The document said | What shipped | Why |
|---|---|---|
| `DiscoverSource.fetch(input, signal)` may fail | Sources never throw; they answer `failed: 'upstream'` or `'not_found'` | only real trouble may count towards a breaker |
| Feed keys by `<lat>:<lng>` and typed text | SHA-256 of the rounded position and of the text | nothing about where someone is can be read off a key list |
| Create Post is the primary button on every card | `secondary`; Draft With AI and Create Post From This are the calls to action | Arvind's pick (2026-11-10) |
| Language as a field in the prompt | a system rule, with the tag in the field | rules sit with the other rules |
| `source: 'discover'` in the generate body | `sources: [{ title, url, snippet }]`, bounded and cleaned | a `javascript:` link or a repeat must never reach the prompt |
| A community list of 232 calendar ids | 11 ids, the ones the research names | an id nobody checked is a guess |
| `discover:competitor:<id>` | the id plus a hash of what is read | an edit must never meet the old list's copy |
| Common feed paths tried every time | only when the page links no feed | eight requests to a site that already said where its feeds are |
| `discover-feeds` with `requireHtml` | without it; a page that is itself a feed answers that feed | people paste a feed's address as the website |
| The reader parses on the request | in a worker thread, killed after two seconds | no limit on a page's shape bounds the parse |
| A recorded `batchexecute` answer | hand-written samples; the decoder has never met Google | fixtures only, by instruction |
| `discover:read:<sha256(url)>`, `discover:link:<id>` | both hashed | an address with a token in it never becomes a key |
| Logging the host of a private address | the workspace and the guard's reason only | a host is what someone tried to read |
| A worktree and a database of its own | the main folder and `postgear_db` since Module 07; `postgear_discover_db` dropped 2026-11-11 | the UI revamp that needed the main folder is finished |

## Review findings fixed before closing

| Finding | Fix |
|---|---|
| Module 05: a made-up region cost a fetch of the same calendar each time | festivals keyed by the region only when the holiday rules know it |
| Module 05: a Wikipedia list fetched late in the evening hid the next day's for 21 hours | a list that is no longer yesterday's is asked again after an hour |
| Module 04: a Japanese draft for X could reach twice X's limit | the limit is halved for scripts X counts double |
| Module 04: a stream that broke after the parts arrived hid a paid draft | the parts stay, with a red alert |
| Module 07 (blocker): the tokenizer lower-cased the page once per script tag; a megabyte of script tags took 26 seconds | lower-cased once; a test reads that page in under two seconds |
| Module 07: competitor reads shared the place feeds' four slots | a gate of their own |
| Module 07: saving in a loop made the server fetch chosen addresses 150 times a minute | 30 new reads a minute per workspace |
| Module 07: "Nothing new from Acme" for a competitor that had not been read yet | `pending`, a skeleton, and a retry |
| Module 08 (three blockers): page shapes past the reader's limits held the API for 17 to 31 seconds; a burst beat the parsing budget | the article finder runs in a worker thread killed after two seconds; two pages in flight; the budget checked twice |
| Module 08: two workspaces could spend the deployment's link decodes | 5 a minute per workspace; a dead link remembered for five minutes |
| Module 08: a page in another encoding shown, and kept, as garbage | refused |
| Module 09: name lookups of refused addresses were uncounted | 30 refused addresses a minute per workspace |
| Module 09: Discover stayed on the time zone guess after the first-login workspace sync | the view and `usePlace` adopt the workspace's place when it arrives |
| Module 09: the AI page's Open In Composer stayed on "Opening…" after the composer closed | unlocked when the page is back from the composer |
| Module 09 (found by the e2e spec): another workspace's place opened under a Workspace badge when the page was reached by address with a stale workspace cookie | the settings read waits until the cookie matches the address |
| Module 09: two tests compared "Updated 25 min ago" with the real clock | a fixed clock |
| Module 09: two Discover tests failed only inside the full run (a one second wait for a sheet's first button; a wall-clock limit on the killed worker, which took 8 seconds under load) | `findBy` and `waitFor` get five seconds in the web workspace; the worker test judges the answer only the deadline gives, not the clock |

The Module 09 review (`postgear-reviewer`, 2026-11-11) found no blocker. Its
findings, all fixed except where said:

| Finding | Fix |
|---|---|
| The e2e Festivals test needed a public holiday still to come, which the calendar does not have on about 159 days up to the end of 2028 (the first: 2026-11-24) | it takes the first day still to come, whatever its badge |
| After the composer closed, Open In Composer saved the same words as a second draft | it reopens the draft it made, and makes a new one only when that draft is gone |
| The Competitors tab, reached by address with a stale workspace cookie, listed the other workspace's competitors until Refresh | the list waits for the workspace switch to land (`competitors-scope.test.tsx`) |
| The settings form's own first load, landing after the server's answer, could put an error over good settings | that late answer is dropped |
| The refused-address count is read before the guard and raised after it, so a burst at the same moment passes | **not changed**: the comment now says it is a brake, not a meter; the API's limit per caller bounds a burst |
| The two engine speed checks judged the median against 20 ms, about twice the measured time, inside the gated suite | the fastest run is judged, the median is printed |

## Known gaps

1. **The article worker has never run in a production build.** `tsc` builds,
   but the compiled API loads `@postgear/discover-engine` by name, which points
   at TypeScript source, and `linkedom` is installed under
   `packages/discover-engine/node_modules`, out of reach of `apps/api/dist`. In
   development and under Jest the worker registers ts-node for itself and works
   (reads checked on the running API). Whoever sets up deployment has to settle
   how workspace packages are loaded there; this is true of every package, and
   the worker is the first place it would show as a broken feature (Read would
   answer "could not read") rather than a failed boot.
2. **No real page has been parsed, and the Google News decoder has never met
   Google.** The decoder leans on an unofficial endpoint and will break one day;
   `DISCOVER_LINK_DECODE=false` and Open are the fallback.
3. **OpenStreetMap's place finder has never been called for real**, and no
   YouTube key exists. Both are free; both are your call (§10).
4. **With the place finder off, the popover offers Worldwide only.** The
   stories ask for a country and region picker there. Not built: a new control,
   out of Module 09's scope.
5. **14 countries get no `date-holidays` rows** (BN, CC, CN, CX, HK, ID, KR, MU,
   MY, PH, SG, SR, TW, VN): `date-chinese@2.2.0` breaks under `require`, and no
   newer release exists (checked 2026-11-11). Singapore reads its calendar
   alone; the others have an empty Festivals tab.
6. **11 holiday calendar ids ship, 8 of them never fetched.** A wrong one only
   leaves that country on `date-holidays`.
7. **A page in an encoding other than UTF-8 is refused, not decoded.**
8. **After a killed page, a new worker takes a few seconds to start in
   development** (it loads a compiler). Reads wait in line meanwhile.
9. **Feeds found on a page and the target of a Google News link are not counted
   by the refused-address limit.** Both are bounded by other limits.
10. **`.xxx` shows in the recorded English Wikipedia list** (a real article).
    There is no blocklist; say if such titles should be hidden.
11. **`npm run validate` is not green on this machine**: `image-processor.spec`
    ("fits a large photo inside 2048 px", "keeps a picture past 2048 px ... a
    Studio 2x export") and `media.service.spec` ("compresses an image ...")
    pass Jest's 5 second limit. On 2026-11-11 the image spec failed even run
    alone (5,017 ms), so it is the machine's speed at large pictures and not
    only the load. Sprint 9 code, untouched here. Reported, not fixed, as
    asked. `brand-extractor.spec` and the SEO crawler's hanging-server test
    failed the same way in earlier full runs and passed in the last two.
12. **No OpenAI call was made.** Every draft is the simulated model's.
13. **Google's feeds are unofficial** (option A in research 04). Every recorded
    Google News feed carries a personal, non-commercial use line. The adapter
    seam, the breaker and the clean sources (Wikipedia, Bluesky, Mastodon,
    calendars) are the mitigation; the decision stays yours.

## 10. What remains for you

1. **Walk Journeys A to D by hand** on the seeded demo workspace under
   simulation: testing guide §5o has every step. Journey A (Priya, Chennai,
   Deepavali, Plan A Post), B (Karthik adds Acme as a competitor), C (Meera saves
   a workspace place; a member sees it and cannot change it), D (denied
   location, a resting source, out of credits, a private competitor address, a
   News link that will not open with `DISCOVER_LINK_DECODE="false"`).
2. **One real session, only if you say yes**: `DISCOVER_SIMULATION="false"` for
   Chennai (Trending, News, Festivals from the live feeds), Use My Location
   through OpenStreetMap once, one Read, and back to simulation (guide §5o, "The
   real feeds").
3. **Decide**: Google feeds option A, B or C; the rail position and the name
   (Discover, Trends, Radar, Pulse); whether to apply for the Trends API alpha
   and create a free YouTube Data API key.
4. **Before merging**: the merge list below.

### The merge list

Nothing is merged and no pull request is open.

1. **What the branch carries.** `sprint-11-discover` was cut from
   `workflows-page-revamp` and has it merged in (`c7c41f4`), so a pull request
   to `master` carries every earlier unmerged branch with it. Merge those
   first, or accept one large merge.
2. **The local database is ready.** The worktree is gone; `postgear_db` has both
   Sprint 11 migrations, and `.env` has `DISCOVER_SIMULATION="true"`. The old
   notes about main's `.env`, main's database and stale copies of the Sprint 11
   documents no longer apply. `postgear_discover_db` was dropped.
3. **Any other machine or database** (a teammate, staging, production):
   `npm install`, `npm run db:generate`, `npm run migrate:deploy
   --workspace=packages/db`.
4. **Production settings**: `DISCOVER_SIMULATION` must be `false` (the API
   refuses to start otherwise), and `DISCOVER_GEOCODER_USER_AGENT` should name a
   contact, which OpenStreetMap's policy asks for.
5. **CI may be red.** `npm run validate` fails here on four image tests from
   Sprint 9 (Known gaps 11). If CI's machine is faster they pass; if not, they
   need their own fix before this branch can show green.
6. **`linkedom` is pinned to exactly 0.18.12.** A newer release ships as an ES
   module only and breaks the reader under `require`. Do not let a tool bump it.
7. **The article worker in a production build** (Known gaps 1) has to be settled
   before Read is switched on for real.
8. **`e2e/discover.spec.ts` has only been run alone**, never beside the other
   e2e specs.
9. **Left in `postgear_db` by the e2e runs**: 4 competitors and about 10 drafts
   as soft-deleted rows. `npm run db:seed` does not remove them; they are
   invisible in the app.
10. **`screenshots/` is untracked and must stay out of the commit** (`s11-01` to
    `s11-59`). Say when it can be cleared.
11. **Google's feeds** (Known gaps 13): pick option A, B or C before real users
    see Trending and News.

---

## Files changed in this pass (Module 09)

**Added**
- `apps/api/src/modules/discover/{discover.security,discover.performance}.spec.ts`
- `packages/discover-engine/src/sources/performance.test.ts`
- `apps/web/src/components/ai/generate-result.test.tsx`, `apps/web/src/components/discover/{discover-accessibility,competitors-scope}.test.tsx`, `apps/web/src/app/dev/components/sections/discover-script-samples.ts`
- `e2e/discover.spec.ts`, `e2e/helpers/discover.ts`
- `docs/sprint-completion-checklists/sprint-11-completion-checklist.md`

**Modified**
- `apps/api`: `discover.addresses.ts`, `discover.keys.ts`, `reader.service.ts`, `competitors.service.ts` (the refused-address limit), their specs
- `apps/web`: `app/(dashboard)/[orgId]/discover/page.tsx` and `discover-model.ts` (the stale workspace cookie), `use-place.ts`, `discover-view.tsx`, `settings/discover-settings.tsx` (late workspace settings), `ai/generate-result.tsx` (the stuck button, and no second draft), `competitors-tab.tsx` (waits for the workspace switch), accessible names on cards and rows, the playground's script samples, `jest.config.js` (one test timeout), the fixed clock in `discover-view.test.tsx`
- `docs`: testing guide §0, §5o and §9, `.env.example`, the modules' README, `module-09-hardening-e2e-closeout.md`, `docs/new-modules/README.md`

The whole sprint against its base: 290 files and about 72,800 lines before this
pass, most of them recorded feeds and tests.
