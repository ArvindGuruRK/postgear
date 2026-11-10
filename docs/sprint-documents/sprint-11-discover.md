# Sprint 11: Discover (Location-Aware Trending Content For AI Posts)

> **PRD Coverage**: new module, not in `prd.md` section 5 yet. It touches 5.5 (AI content: a new way in) and replaces the never-built "AI content from RSS" P1 line in 5.3 with something broader.
> **User stories**: [`../new-modules/user-stories-discover.md`](../new-modules/user-stories-discover.md) holds the journeys, acceptance criteria, UX rules and the completion checklist. This document decides *how* to build; the stories decide *what the user experiences*.
> **Research**: [`../sprint-11/README.md`](../sprint-11/README.md) (sources, libraries, location and language, legal and limits, the approach). Every source named below was fetched on 2026-11-05 unless marked reported.
> **Depends on**: [Sprint 6](sprint-06-ai-content-engine.md) (content pipeline, credits, SSE), [Sprint 7](sprint-07-analytics-and-seo-engine.md) (the SSRF-guarded fetch and HTML parser in `seo-engine`), [Sprint 4](sprint-04-post-composer-and-media.md) (the composer and `POST /posts`). Sprint 9's brand extractor is the precedent for reading a stranger's URL.
> **Branch**: `sprint-11-discover`, cut from the branch Arvind names (the tree is on `workflows-page-revamp`; Sprint 10's docs name `sprint-10-workflow-builder`).
> **Reference**: `trendspyg` (Python, MIT) for the Google Trends RSS fields; Buffer's Ideas page and Postiz for placement only (never their code). The four names Arvind brought (SerpApi, Google News RSS with feedparser, trendspyg, pytrends) are judged in [`../sprint-11/research/01-sources.md`](../sprint-11/research/01-sources.md) section 2.

## Sprint Goal

A user opens **Discover** from the rail and sees what is trending today where their audience is: rising searches, local news in the local language, what people are reading on Wikipedia, worldwide social topics, the festivals coming up, trending videos, and what their competitors published. Every item has **Create Post**: the AI drafts a post in the chosen language for the chosen channels and the draft opens in the composer. Location comes from "Use My Location", a city search, or a saved workspace setting, and the whole thing works for any country, state or city at zero cost.

Example: *Priya in Chennai opens Discover on a Tuesday in November. Trending shows "weather coimbatore" and a Tamil film; News shows Chennai stories from Tamil publishers; Festivals says Deepavali is in 3 days. She presses Create Post on the Deepavali row, picks Tamil and Instagram, and a draft with a Deepavali hook is in her composer, dated the day before the festival.*

## What The Research Settled

1. **TypeScript, no Python.** `pytrends` is archived (2025-04-17). `trendspyg`'s browser-free RSS path is a short fetch-and-parse that we port. Nothing new in Docker or deploy.
2. **Google Trends RSS takes ISO 3166-2 sub-regions** (`geo=IN-TN`, `geo=US-CA` both verified), so state-level trends are free. Trends items carry real publisher URLs; News items carry opaque Google links.
3. **Google News has an edition per language** (ten for India) and a place feed for any city name, verified in Tamil and French.
4. **Nominatim answers with the region code** (`address["ISO3166-2-lvl4"] = "IN-TN"`, verified) and has a strict, quoted usage policy: one request a second, identify the app, cache, no autocomplete.
5. **Google's public holiday calendars** (232 countries, ICS) carry public holidays and observances; `date-holidays` adds state data where it exists (not for India). Together they cover festivals well enough for v1.
6. **Wikipedia top articles, Bluesky and Mastodon trends** are free, keyless and legally clean; they keep Trending alive if Google ever goes dark.
7. **No new AI endpoint is needed.** `POST /ai/generate` plus one `language` field does the drafting; the existing generate components do the composer handoff.
8. **Google's terms are a risk to decide on, not a blocker**: attribution, outbound links, no storage, short caches, swappable adapters. See the research's option table.

## Names And Placement

| Thing | Name |
|---|---|
| Rail label | Discover (alternatives for Arvind: Trends, Radar, Pulse) |
| Top bar page name | Discover |
| Routes | `/[orgId]/discover` (the page; `?tab=` keeps the open tab), `/[orgId]/settings/discover` (workspace place and languages, Module 06) |
| Rail position | after Workflows (only the first four rail items reach the phone tab bar; Arvind may move it) |
| Primary action | Create Post (on every card) |
| UI words | place, trend, story, festival, competitor, "Use My Location", "Worldwide". Never "locality", "feed", "source id", "geocode" |
| Package | `@postgear/discover-engine` at `packages/discover-engine` |
| API module | `apps/api/src/modules/discover` |
| Web | `apps/web/src/app/(dashboard)/[orgId]/discover/`, `apps/web/src/components/discover/`, `apps/web/src/lib/discover-api.ts`, `apps/web/src/types/discover.ts` |
| Models | `DiscoverSettings`, `Competitor`, enum `DiscoverLocationSource` |
| Env | `DISCOVER_SIMULATION`, `DISCOVER_GEOCODER` (`nominatim` or `off`), `DISCOVER_GEOCODER_USER_AGENT`, `DISCOVER_LINK_DECODE`, `YOUTUBE_API_KEY` (optional) |
| Credit type | `generate_post` (5 credits), unchanged |

## Screens

### Discover Page

- `PageActions` (left): the **place chip** ("Chennai, Tamil Nadu" with a map-pin animated icon) and the **language chip** ("Tamil"). Right: "Updated 12 min ago" as quiet text and a **Refresh** ghost button. Under the chips, one small line: "Places by OpenStreetMap contributors".
- `Tabs` (design system): **Trending**, **News**, **Videos**, **Festivals**, **Competitors**. The open tab is kept in `?tab=`.
- Each tab is a stack of **groups** (an `AnalyticsPanel`-style card with `PanelHeader`): a group has a Title Case name, a sentence under it that names the source and the place ("Rising searches in Tamil Nadu, via Google Trends"), and its items. A group whose source is resting shows its stale items with "Showing what we had from 25 minutes ago", and an `Alert variant="warning"` only when nothing at all could be shown.
- First visit with no place: the page guesses the country from the browser's time zone and says so in the chip ("India, from your time zone. Use My Location for your city."). Nothing is blocked on the prompt.

### Place Chip And Dialog

- Clicking the chip opens a popover with: **Use My Location** (secondary button; the consent sentence under it: "We use your location once to find your city. We keep the city, not your position."), a **Search For A City** field (submit on Enter; placeholder "Enter your city"), **Worldwide**, and, for admins once Module 06 ships, **Save For This Workspace** and "Workspace default: Chennai".
- Permission denied: the popover says "Location is blocked in your browser. Search for your city instead." and keeps the field focused. Unavailable or timeout: "We could not find your location. Search for your city instead."
- The viewer's current choice is remembered in `localStorage` per org; the workspace default (when saved) is the starting point on a new device.

### Item Cards

- A card (design-system `Card`, `bg-chrome`, `rounded-xl`, hard shadow): optional image (lazy, no referrer, hidden on error), the title (`dir="auto"`), a meta line (source name, time, and the signal: "200+ searches", "648 reads", "1.2k posts"), related headlines on Trends items (up to three, each a link), and the actions: **Create Post** (primary), **Read** (ghost, only when the item has a readable URL), **Open** (ghost, external).
- Wikipedia items and social trends are compact rows and chips, not full cards.
- Festival rows: date, name, badge **Public Holiday** or **Observance**, "in 3 days", **Plan A Post**.
- Competitor rows: competitor name, the post title, source kind (Blog, YouTube, Bluesky, Mastodon, News), time, **Create Post**, **Open**.

### Create Post Sheet

- A right-hand `Sheet` opened from **Create Post** with: the item's title as a read-only brief preview (`bg-inset`), **Language** (`Select` seeded from the place's languages; default is the language chip), **Channels** (the same picker the AI page uses), **Tone** and **Format** (`ChoiceTiles`, defaults Personal and One Short), the credits meter ("5 credits, 44 left"), and **Draft With AI** (violet `highlight` button).
- While drafting it shows the existing generate progress; when done, the existing result view with **Open In Composer** (creates the DRAFT via `POST /posts` and navigates to `/composer?group=`). Festival drafts pass the festival date as `publishAt` so the composer opens on that day.
- Out of credits: the sheet shows the existing out-of-credits alert with the reset date.

### Reader Sheet

- Opened from **Read**: the article's title, site name, byline, published date, estimated reading time, the hero image if any, and the extracted text (scrollable, `bg-inset`). Footer: **Create Post From This** (opens the Create Post sheet with the excerpt as the brief) and **Open** (external).
- Failures are one sentence each: "This page is private or on your own network.", "We could not read this page. Open it in a new tab instead.", "This page is not an article."

### Settings Section (Module 06)

- `settings/discover`: Workspace Place (the same popover controls), Languages (ordered chips), News Topics (checkbox list of Google News topics), Sources (on and off switches for each group), with the optimistic save and toast pattern from Notifications.

### Phone

- Tabs scroll horizontally; groups stack; the chips collapse to the city name and the language code; sheets are full height. No immersive mode: this is a normal page.

## Sources And Adapters

One interface in the engine:

```ts
interface DiscoverSource {
  readonly id: SourceId;                      // 'google-trends' | 'google-news' | 'wikipedia' | 'youtube' | 'bluesky' | 'mastodon' | 'holidays' | 'rss'
  readonly name: string;                      // for attribution
  fetch(input: SourceInput, signal: AbortSignal): Promise<SourceResult>;   // never throws; { items, attribution, warnings }
}
```

| Tab | Groups (in order) | Source and selection | Fallback |
|---|---|---|---|
| Trending | Rising searches in {region or country} | Google Trends RSS, `geo=<region>` then `<country>` | country, then hide the group |
| | What people are reading on {language} Wikipedia | Wikimedia top articles, `<lang>.wikipedia`, yesterday UTC then the day before, namespaces filtered | hide |
| | Worldwide on Bluesky and Mastodon | `app.bsky.unspecced.getTrends`, `mastodon.social/api/v1/trends/tags` | hide either |
| News | {City} stories, {Top stories in country} | Google News place feed (`geo/<city>`), top feed, per edition (`hl`, `gl`, `ceid` from the editions table); optional topic feed when a topic is picked | top feed when the place feed is empty; `US:en` world news when the country has no edition |
| Videos | Trending on YouTube in {country} | YouTube Data API `videos.list chart=mostPopular regionCode=<cc>` | "not set up" without a key; "resting" past the budget |
| Festivals | Next 30 days (and the past 7 for "just happened") | Google holiday calendar ICS for the country, merged with `date-holidays` (country and region), de-duplicated by date and normalised name | whichever is available; empty state otherwise |
| Competitors | Latest from {competitor} | the competitor's feeds (RSS, Atom), YouTube channel feed, Bluesky author feed, Mastodon account statuses, Google News search feed for the brand name | per-feed `unavailable` |

Item shape (engine and the web mirror):

```ts
interface DiscoverItem {
  id: string;                      // stable hash of source + url or title
  kind: 'trend' | 'news' | 'wiki' | 'social' | 'video' | 'festival' | 'competitor';
  source: { id: SourceId; name: string; url?: string };
  title: string;                   // plain text, HTML stripped
  summary?: string;                // plain text
  url?: string;                    // where Open goes (a real URL when we have one)
  opaqueUrl?: string;              // the Google News redirect, when that is all we have
  image?: string;
  publishedAt?: string;            // ISO
  language?: string;               // BCP-47
  signal?: { label: string; rank?: number; traffic?: number; views?: number; posts?: number };
  related?: Array<{ title: string; url: string; source: string }>;
  date?: string;                   // festivals: YYYY-MM-DD in the place's calendar
  observance?: boolean;            // festivals: true for observances
  brief: string;                   // what Create Post sends as the topic (built on the way out, never stored)
}
```

`brief` is built by `buildBrief(item, locality, language)`: for a trend, the keyword, the traffic label, the place and the related headlines; for a story, the headline, the publisher and the related headlines; for a festival, the name, the date, the place and a line about what people do; for a competitor post, the title and the competitor's name with a note to write something of our own, not a copy. Always plain text, control characters stripped, capped at 1,800 characters (the generate topic allows 2,000).

## Locality And Languages

Covered in [`../sprint-11/research/03-location-and-language.md`](../sprint-11/research/03-location-and-language.md). In short: the browser rounds the position to two decimals and the API reverse-geocodes it once through Nominatim (global budget of one request a second, identifying User-Agent, 30 day cache, attribution); a typed city goes through Nominatim search on Enter; with no permission the browser's time zone gives the country through `countries-and-timezones`; the place's languages come from a CLDR-generated country table plus a region override table, intersected with the Google News editions table; the viewer can always change the language chip.

## Database

Use the `prisma-change` skill. Nothing is added before Module 06; Modules 01 to 05 are stateless on purpose.

```prisma
enum DiscoverLocationSource { NONE BROWSER SEARCH TIMEZONE }

model DiscoverSettings {
  organizationId String   @id                       // 1:1, the org id is the key
  countryCode    String?                            // ISO 3166-1 alpha-2; null means Worldwide
  regionCode     String?                            // ISO 3166-2, "IN-TN"
  regionName     String?
  city           String?
  timeZone       String?                            // IANA
  languages      String[] @default([])              // BCP-47, first is the default
  topics         String[] @default([])              // Google News topic ids the workspace follows
  sources        Json?                              // { trends: true, wikipedia: true, social: false, ... }
  locationSource DiscoverLocationSource @default(NONE)
  updatedById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  updatedBy      User?        @relation(fields: [updatedById], references: [id], onDelete: SetNull)
}

model Competitor {
  id               String    @id @default(uuid())
  organizationId   String
  name             String
  websiteUrl       String?
  feedUrls         String[]  @default([])            // up to 5, discovered or typed
  youtubeChannelId String?
  blueskyHandle    String?
  mastodonAcct     String?                           // user@instance
  newsQuery        String?                           // Google News search; defaults to the name
  lastCheckedAt    DateTime?
  lastError        String?                           // one sentence, never a response body
  createdById      String?
  deletedAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId, deletedAt])
}
```

No coordinates are stored. No items table. `SCHEMA_NOTES.md` gets a "Sprint 11 additions" entry that also notes the old Postiz `Trending` tables were dropped on purpose and these are not a revival.

## API Routes

All under `apps/api/src/modules/discover`, authenticated, `@Roles(Role.ADMIN, Role.USER)` unless noted, Zod `.strict()` schemas through `ZodBody` and `ZodQuery`, tenancy through `@CurrentOrg()`.

| Route | Answers |
|---|---|
| `GET /discover/status` | `{ status: { simulation, geocoder: 'nominatim' \| 'off', sources: { trends, news, wikipedia, videos, holidays, social } } }` |
| `GET /discover/locality?lat&lng` | `{ locality }`; coordinates must be rounded (2 decimals) or the schema refuses; 429 `locality_throttled`; 503 `geocoder_off` |
| `GET /discover/locality?tz=Asia/Kolkata` | `{ locality }` at country level from the time zone, no upstream call |
| `GET /discover/locality/search?q=` | `{ localities }` (max 8); 429 `locality_throttled` |
| `GET /discover/feed?kind=trending\|news\|videos\|festivals&country&region&city&lang&tz&topic` | `{ kind, locality, language, groups: [{ id, title, subtitle, attribution, items, stale, fetchedAt }], unavailable }` |
| `GET /discover/settings` | `{ settings }` (null fields when never saved) |
| `PATCH /discover/settings` (admins) | body: any subset of the settings; `{ settings }` |
| `GET /discover/competitors` | `{ competitors }` with `lastCheckedAt` and `lastError` |
| `POST /discover/competitors` | `{ name, websiteUrl?, feedUrls?, youtubeChannelId?, blueskyHandle?, mastodonAcct?, newsQuery? }`; 201 `{ competitor }`; 422 `competitor_private` on an unsafe URL; 422 `competitor_limit` past 20 |
| `PATCH /discover/competitors/:id`, `DELETE /discover/competitors/:id` (delete: admins) | `{ competitor }`, `{ message }`; 404 for another workspace's id |
| `POST /discover/competitors/discover-feeds` | `{ url }`; `{ feeds: [{ url, title, kind }] }`; 5 a minute per workspace |
| `GET /discover/competitors/:id/items` | `{ items, unavailable, fetchedAt, stale }` |
| `POST /discover/read` | `{ url }`; `{ article: { url, finalUrl, title, byline, siteName, language, excerpt, text, image, publishedAt, wordCount, readMinutes } }`; 422 `read_private`, `read_failed`, `read_not_article`; 429 `read_throttled` (10 a minute per workspace) |
| `POST /discover/resolve-link` | `{ url }` (a Google News link); `{ url }` or 422 `link_unresolved` |
| `POST /ai/generate` (existing, `modules/ai`) | gains optional `language` (BCP-47); unchanged otherwise |

Messages live in `discover.messages.ts` in plain words ("We could not find your location. Search for your city instead.").

## Caching And Budgets

Stale-while-revalidate in Redis, shared across tenants because the data is public and keyed by place; single-flight locks; a circuit breaker per source; budgets for Nominatim (1 a second globally), YouTube (8,000 units a day), link decoding (20 a minute); per-workspace throttles for locality (5 a minute), feed discovery (5 a minute) and the reader (10 a minute); a process-wide gate of four upstream fetches at once. Keys and windows are in [`../sprint-11/research/05-approach-on-postgear.md`](../sprint-11/research/05-approach-on-postgear.md) section 4. `RedisService` gains `setIfAbsent`.

## Simulation

`DISCOVER_SIMULATION=true` (new, refused when `NODE_ENV=production`, documented in `.env.example`) binds the engine to recorded fixtures for Chennai (IN-TN, Tamil and English), San Francisco (US-CA, English) and Paris (FR, French), and a simulated geocoder that answers those for nearby coordinates and Worldwide otherwise. Every screen, the e2e suite and the hand checks run on it. AI follows `AI_SIMULATION` as before. Unit tests always inject `fetch`.

## AI Changes

- `generateSchema` and `GenerateRequest` gain `language?: string` (BCP-47, max 16). The content and hook prompts get a `Language` field ("Write in Tamil. Keep brand names and hashtags as they are.") and the simulated client ignores unknown fields, so no new simulation branch is needed.
- `createPipeline` accepts `researchProvider?: ResearchProvider`. The Discover sheet calls `/ai/generate` with `research: true` and the API, when the request came from Discover (`source: 'discover'` plus `sources: [{ title, url, snippet }]` in the body), wraps those related headlines as the research result, so "Backed By Research" lists real links without a Tavily call and `researched` is true.
- No new credit type: `generate_post`.

## Task Breakdown

Ordered checklist; each phase ends with `verify-change`. The phases are the modules in [`../sprint-11/discover-implementation-docs/README.md`](../sprint-11/discover-implementation-docs/README.md).

1. **Engine core, Trends and News** (Module 01): package scaffold and wiring, `Locality`, the editions, languages and region override tables with the generator script, ISO 3166-2 helpers, the geocoder seam (Nominatim reverse and search, time zone, simulated), the Google Trends and Google News sources, the feed composer, `buildBrief`, recorded fixtures, tests on injected fetch.
2. **API, place and feed** (Module 02): the Discover module with `status`, `locality`, `feed` for Trending and News, the cache (stale-while-revalidate, single flight, breaker, budgets, gate), throttles, `DISCOVER_SIMULATION`, the fetch adapter over `fetchUrlSafely`, specs; checked with curl.
3. **The page and the place flow** (Module 03, Demo 1): rail entry and title, the page, chips and popover, Use My Location, city search, time zone guess, `localStorage` memory, Trending and News tabs with cards, skeletons, empty and error states, attribution, mirrored types and the API client, title-case test, `/dev/components` demos.
4. **Create Post** (Module 04, Demo 2): `language` through the AI stack, the research seam, the Create Post sheet reusing the generate components, `publishAt` for festivals, the `?topic=` quick path, credits.
5. **More sources** (Module 05): Wikipedia, YouTube with the daily budget, Bluesky and Mastodon as Worldwide, Festivals (ICS table first, `date-holidays` second) with Plan A Post; the Videos and Festivals tabs.
6. **Settings and data model** (Module 06): `DiscoverSettings`, the settings routes, Save For This Workspace, the settings section, topics and source switches, SCHEMA_NOTES.
7. **Competitors** (Module 07): `Competitor`, CRUD, feed autodiscovery, channel feeds, Google News mentions, the tab.
8. **Website reader** (Module 08): `POST /discover/read` with Readability and linkedom on the injected fetch, the best-effort link decode, the reader sheet, Create Post From This.
9. **Hardening, e2e, closeout** (Module 09): security sweep, edge cases from the stories' section 5, `e2e/discover.spec.ts`, performance and accessibility, local testing guide section 5o, the completion checklist via `sprint-closeout`.
10. **P2** (Module 10, only when Arvind decides): worker pre-warm and competitor polling, saved items, Home card, Instagram Business Discovery, GDELT, Trends CSV via Playwright, SerpApi and NewsData adapters, the Trends API alpha, IP fallback, digest email.

## Definition Of Done

Evidence for each line goes in the completion checklist when the sprint closes.

- [ ] Discover opens from the rail; the first visit shows country-level Trending and News from the browser's time zone with no prompt.
- [ ] Use My Location turns a rounded position into a city, region and country through Nominatim within its policy (one request a second globally, identifying User-Agent, 30 day cache, attribution shown); denied and unavailable states each show their sentence; coordinates are never stored or logged.
- [ ] A typed city (on Enter) becomes a place; Worldwide works; the viewer's choice survives a reload.
- [ ] Trending shows rising searches for the region (country fallback), Wikipedia reads for the language, and Worldwide social topics; each group names its source and place.
- [ ] News shows the city's stories in the place's first language and switches language from the chip; every card links out and shows the publisher.
- [ ] Create Post on any card drafts through `POST /ai/generate` in the chosen language, charges 5 credits (refunded on failure), and Open In Composer opens the draft; a festival draft lands on the festival date.
- [ ] Festivals lists the next 30 days with Public Holiday and Observance badges from the holiday calendar and `date-holidays`, merged and de-duplicated.
- [ ] Videos shows YouTube's most popular for the country when `YOUTUBE_API_KEY` is set and says "not set up" otherwise; the daily budget stops at 8,000 units.
- [ ] A workspace admin saves a default place, languages, topics and sources; members see it on a new device.
- [ ] Competitors: add by website with feeds found automatically, add channel handles, see the latest items per competitor and name mentions from Google News; 20 per workspace; unsafe URLs refused with a sentence.
- [ ] Read opens an article in a sheet from a safe fetch with Readability; private, unreadable and non-article pages each get their sentence; the reader never stores page text; Google News links resolve when they can and fall back to Open.
- [ ] Every upstream call goes through the SSRF-guarded fetch; the cache is shared by place; a resting source shows stale items or `unavailable`, never an error page; no paid call exists in the code.
- [ ] `DISCOVER_SIMULATION=true` runs every screen offline; `e2e/discover.spec.ts` passes under it; unit tests cover every source with injected fetch; `npm run validate` is green.
- [ ] Light, dark and Lilac checked; phone width checked; Tamil, Arabic and Japanese sample items render with `dir="auto"`.

## Deviations

None yet. Record them here as they happen, with the reason.

## Risks

See [`../sprint-11/research/04-legal-limits-and-risks.md`](../sprint-11/research/04-legal-limits-and-risks.md) section 7 for the register. The three that shape the build: Google feeds are unofficial (adapter seam, breaker, clean set), Nominatim is a shared public service (budget, cache, off switch), and non-Latin scripts fall back from Sora (accepted, `dir="auto"`).
