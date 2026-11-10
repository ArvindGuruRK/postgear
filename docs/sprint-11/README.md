# Sprint 11: Discover (Location-Aware Trending Content For AI Posts)

> **Status**: Documents written 2026-11-05, awaiting Arvind's review. No code has been written.
> **The idea** (Arvind, 2026-11-05): show every user what is trending today where their audience is (news, search trends, festivals, competitor activity), in the local language, and let the AI turn any of it into a post with one click. Generic for every country, state and city. Zero spend: open-source libraries and free public sources only.

## What Is In This Folder

| Document | Read it for |
|---|---|
| [`research/01-sources.md`](research/01-sources.md) | Every data source evaluated, what each one returned when fetched on 2026-11-05, cost, terms, verdict. Includes the verdict on the four names Arvind brought (SerpApi, Google News RSS with feedparser, trendspyg, pytrends). |
| [`research/02-libraries.md`](research/02-libraries.md) | The Node libraries we will use, with version, licence and whether they load under the API's CommonJS build, and the ones we rejected. |
| [`research/03-location-and-language.md`](research/03-location-and-language.md) | "Use My Location" in the browser, reverse geocoding with Nominatim and its policy, the fallbacks, and how a place becomes a list of languages for any country. |
| [`research/04-legal-limits-and-risks.md`](research/04-legal-limits-and-risks.md) | Attribution, caching ceilings, rate limits, privacy, the Google terms question, and what we never do. |
| [`research/05-approach-on-postgear.md`](research/05-approach-on-postgear.md) | How it fits this codebase: the engine package, the API module, the cache, the Create Post handoff, and what we reuse. |
| [`../sprint-documents/sprint-11-discover.md`](../sprint-documents/sprint-11-discover.md) | **The sprint doc**: architecture, screens, data model, API routes, task breakdown, definition of done. |
| [`../new-modules/user-stories-discover.md`](../new-modules/user-stories-discover.md) | **The user stories**: personas, journeys, acceptance criteria, UX rules, completion checklist. |
| [`discover-implementation-docs/README.md`](discover-implementation-docs/README.md) | **The build plan**: ten modules, one per Claude Code session, with the kickstart prompt. |

## Reading Order

1. This page.
2. The sprint doc (the shape of the thing).
3. The user stories (what people will do with it).
4. `research/01-sources.md` and `research/04-legal-limits-and-risks.md` (the two documents that carry decisions Arvind should make).
5. The module index, then the modules in number order when building.

## The Pitch In One Paragraph

A user in Chennai opens **Discover**. The page already knows the audience is in Tamil Nadu (from the browser, a city search, or a saved workspace setting). The **Trending** tab shows the searches rising in Tamil Nadu right now, what Tamil readers are looking up on Wikipedia, and the worldwide chatter on Bluesky and Mastodon. The **News** tab shows Chennai stories from Tamil publishers, with a switch to English. **Festivals** lists Deepavali, Karthigai Deepam and Pongal with the days to go. **Competitors** shows what three rival brands published this week. Any card has **Create Post**: the AI drafts in Tamil or English for the chosen channels, and the draft opens in the composer. The same page works for Paris, Lagos, San Francisco or Tokyo, because every source is chosen by country, region and language, not hard-coded.

## Open Points For Arvind

These are listed again where they matter, but here they are in one place:

1. **Name**: Discover (recommended), or Trends.
2. **Rail position**: after Workflows (recommended; only the first four rail items reach the phone tab bar, so placing it earlier pushes Queue off phones).
3. **Branch**: which branch `sprint-11-discover` is cut from. The tree is on `workflows-page-revamp`.
4. **Google feeds**: ship Google Trends and Google News with attribution and a swappable adapter (recommended), or start from the "clean set" only (Wikipedia, YouTube API, Bluesky, Mastodon, publisher RSS). See `research/04-legal-limits-and-risks.md`.
5. **Google Trends API alpha**: apply now (free, gated, no commitment).
6. **YouTube key**: create a free Data API key on the Google Cloud project that already holds the YouTube OAuth client, or leave the Videos tab off.
