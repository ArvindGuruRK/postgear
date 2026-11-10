# Module 05: More Sources, Wikipedia, Social, Videos And Festivals

> **Sprint 11, Discover** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 03](module-03-discover-page-and-location.md) (and [Module 04](module-04-create-post.md) for Plan A Post; without it the row's button stays disabled)
> **Stories**: DC-2.2, DC-2.3, DC-5.1, DC-5.2, DC-6.1
> **Next**: [Module 06](module-06-settings-and-data-model.md)

## Goal

Trending gains the Wikipedia and Worldwide groups; the Videos and Festivals tabs come alive. Festivals merge Google's public holiday calendar with `date-holidays`, and Plan A Post lands the draft on the festival date.

## Read First

- Research: [`01-sources.md`](../research/01-sources.md) sections 3.3 to 3.8; [`02-libraries.md`](../research/02-libraries.md) sections 1.3 and 1 (date-holidays, the ICS parser); [`04-legal-limits-and-risks.md`](../research/04-legal-limits-and-risks.md) sections 1 and 3 (attribution, YouTube budget).
- Sprint doc: Sources And Adapters (the table), Caching.
- Blueprint: sections 2, 4 (Wikipedia row, social chip, video card, festival row), 7.
- User stories: DC-2.2, 2.3, 5.x, 6.1; section 5 rows for YouTube, holidays, Wikipedia.
- Code: Module 01's `sources/`, Module 02's `discover.service.ts` and cache, Module 03's `discover-view.tsx`, Module 04's sheet; `packages/seo-engine/src/authority/authority.ts` (a keyed provider with a budget, for the YouTube shape).

## Design

### 1. Engine Sources

- `wikipedia.ts`: `createWikipediaSource({ fetch })`. Project `<lang>.wikipedia` (map `pt-419` to `pt`, `es-419` to `es`, `zh-Hans` to `zh`, else the primary subtag); URL `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/<project>/all-access/<y>/<m>/<d>` for yesterday UTC, then the day before on 404; filter `Main_Page`, `Special:`, `Wikipedia:`, `File:`, `Help:`, `Portal:`, `Category:`, `Talk:`, and the search page; take the first 10; items `kind: 'wiki'`, `title` with underscores turned to spaces, `url` = `https://<lang>.wikipedia.org/wiki/<article>`, `signal.views`, `source: { id: 'wikipedia', name: 'Wikipedia', url }`.
- `bluesky.ts`: `createBlueskySource({ fetch })`, `GET https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=10`; items `kind: 'social'`, `title` = displayName, `url` = `https://bsky.app` + link, `signal.posts`, `summary` = category.
- `mastodon.ts`: `createMastodonSource({ fetch, instance = 'mastodon.social' })`, `GET /api/v1/trends/tags?limit=10`; items `kind: 'social'`, `title` = `#name`, `url`, `signal.label` = uses over the last 7 days.
- `youtube.ts`: `createYoutubeSource({ fetch, apiKey })`, `videos.list?part=snippet,statistics&chart=mostPopular&regionCode=<cc>&maxResults=25&key=`; items `kind: 'video'`, `title`, `url` = `https://www.youtube.com/watch?v=<id>`, `image` = the medium thumbnail, `summary` = channel title, `signal.views`, `publishedAt`. The source reports `unitsUsed: 1` in `warnings` metadata for the budget.
- `holidays/ics.ts`: a small parser (unfold lines, split events, read `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `UID`); `holidays/google-calendar.ts`: the `countryCode -> calendarId` table (seeded from the community list, every id hand-checked by the fixture script against `X-WR-CALNAME`), the fetch, and the mapping to `kind: 'festival'` with `date`, `observance = DESCRIPTION starts with 'Observance'`; `holidays/date-holidays.ts`: lazy `Holidays(country, regionWithoutCountryPrefix)` and `getHolidays(year)` for this and next year, types `public` and `bank` as holidays, `observance` and `optional` as observances; `holidays/index.ts`: `createHolidaysSource({ fetch })` merges both, keeps one row per date and normalised name (strip diacritics, lower-case, remove "day", "/" splits like "Diwali/Deepavali" match either side), the stronger badge wins, window: 7 days back to 30 days ahead in the place's time zone.

### 2. API

- `discover.engine.ts` builds the new sources; `status.sources` flips `wikipedia`, `social`, `holidays` to true and `videos` to `Boolean(YOUTUBE_API_KEY)`.
- `feed(kind)`: Trending now fans out to trends, wikipedia, bluesky, mastodon (four groups; Bluesky and Mastodon merge into one "Worldwide On Bluesky And Mastodon" group with `attribution` naming both); `videos` and `festivals` kinds replace the 501 placeholder. Cache windows per the sprint doc (`wiki` 24 h, `social` 10 min, `videos` 60 min, `festivals` 7 days).
- YouTube budget: `discover:budget:youtube:<YYYY-MM-DD UTC>` incremented per upstream call; at 8,000 the source is skipped with `unavailable: ['youtube']` and the group sub-line "YouTube is resting until tomorrow."
- Festivals answer also carries `today` (in the place's zone) so the web computes "in 3 days" consistently.

### 3. Web

- Trending tab: add `WikipediaGroup` (rows) and `SocialGroup` (chips) under the trends group, with their attribution sub-lines ("Yesterday's most-read articles. Wikipedia, text CC BY-SA.", "Not local: what the whole network is talking about.").
- Videos tab: `VideoCard` grid; without a key the `EmptyState` from the blueprint; past the budget, the stale note.
- Festivals tab: `FestivalRow` list grouped by week ("This Week", "Next Week", "Later This Month", "Just Happened"), badges, "in N days"; **Plan A Post** opens the Create Post sheet with `publishAt` = the festival date at 10:00 in the place's zone (the day before at 18:00 for public holidays, since people post ahead), and the brief from `buildBrief` for festivals.
- Group switches (Module 06) are respected when present; until then all groups show.

## Scope

**In**: the five sources, the ICS parser, the calendar id table, the API kinds, budgets, the three new groups and two tabs, Plan A Post, tests, fixtures for the three places.
**Out**: settings switches (06), competitors (07), reader (08), per-region curated festivals (P2).

## Tasks

- [ ] Engine: wikipedia, bluesky, mastodon, youtube sources with tests on recorded bodies (filtering, mapping, day fallback, budget metadata).
- [ ] Engine: ICS parser with tests (folded lines, VALUE=DATE, multi-day, odd line endings); calendar id table with a test for the demo countries; date-holidays adapter (lazy init, India TN placeholder ignored); merge and de-dup tests (Diwali/Deepavali, Pongal observance, a date with two names).
- [ ] Record fixtures for the three places (Wikipedia `ta`, `en`, `fr`; Bluesky; Mastodon; the three calendars; YouTube `IN`, `US`, `FR` only if Arvind provides a key, else a hand-written sample marked as such).
- [ ] API: status flags, the kinds, YouTube budget, cache windows, specs (budget stops at 8,000; Bluesky down hides only its chips; festivals window and de-dup through the service).
- [ ] Web: `WikipediaGroup`, `SocialGroup`, `VideoCard`, `FestivalRow`, the two tabs, Plan A Post with `publishAt`; tests (grouping by week, badge choice, "in N days" in the place's zone, Plan A Post passes the date).
- [ ] Playground rows for the new card and row types.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/discover-engine/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/discover
npx jest --config apps/web/jest.config.js apps/web/src/components/discover
```

## Done When

- Trending for Chennai shows four groups: Rising Searches In Tamil Nadu, What People Are Reading On Tamil Wikipedia, Worldwide On Bluesky And Mastodon (the third and fourth merged).
- Festivals for Chennai in early November shows Deepavali (Public Holiday, in N days) and the next 30 days; Paris shows Armistice Day; San Francisco shows Thanksgiving.
- Plan A Post on Deepavali opens the sheet, and Open In Composer opens the composer on the day before Deepavali.
- Videos says "not set up" without a key, and shows 25 cards with a key (checked once with Arvind's key if he makes one).
- `GET /discover/status` reports the five sources truthfully.

## Hand Check

1. Chennai, Trending: scroll through all groups; Wikipedia rows link to `ta.wikipedia.org`; social chips link out.
2. Festivals: the week groups and badges read right; Plan A Post on the first festival lands on the right date in the composer.
3. Paris: Festivals in French names from `date-holidays` merge with the calendar's English names without doubles (check the week of 11 November).
4. Videos tab without a key: the empty state. (With a key, once: real cards, then switch the key off.)

## Handoff

Module 06 adds the group switches and the workspace default; Module 07 adds the Competitors tab in the same view.
