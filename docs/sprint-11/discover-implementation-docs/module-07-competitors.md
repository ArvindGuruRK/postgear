# Module 07: Competitors

> **Sprint 11, Discover** | Status: Done (2026-11-10) | Size: L (one full session)
> **Depends on**: [Module 02](module-02-api-locality-feed-and-cache.md), [Module 06](module-06-settings-and-data-model.md)
> **Stories**: DC-7.1, 7.2, 7.3
> **Next**: [Module 08](module-08-website-reader.md)

## Goal

A workspace follows up to 20 competitors by website and channels. PostGear finds their feeds, shows the latest items per competitor (blog, YouTube, Bluesky, Mastodon, news mentions), and Create Post asks for our own take.

## Read First

- Sprint doc: Database (`Competitor`), API Routes (competitors), Sources And Adapters (Competitors row).
- Research: [`01-sources.md`](../research/01-sources.md) sections 3.6, 3.7, 3.9 and 3.13 (what has no free read); [`04-legal-limits-and-risks.md`](../research/04-legal-limits-and-risks.md) section 5 (hostile feeds, SSRF).
- Blueprint: sections 4 (competitor row) and 7 (empty state).
- User stories: DC-7.x, Journey B, section 5 rows for competitors.
- Code: `apps/api/src/modules/studio/brand-extractor.ts` (`readLink`, the `<link rel="alternate">` scan, `ExtractDeps`), `apps/api/src/modules/studio/brand-kits.service.ts` (`websiteAddress`, `throttle`, `refusal`), `packages/seo-engine/src/crawler/url-guard.ts` (`assertSafeUrl`), Module 01's `feed-parser.ts`, `apps/api/src/modules/webhooks/` (CRUD shape with soft delete and 404 for foreign ids).

## Design

### 1. Schema

The `Competitor` model from the sprint doc, in its own migration `2026MMDDHHMMSS_sprint11_competitors`. SCHEMA_NOTES: add it under "Sprint 11 additions", with the cap (20 live rows per workspace, enforced in the service) and the note that `lastError` is one sentence, never a response body.

### 2. Engine

- `sources/rss.ts`: `createRssSource({ fetch })`, generic RSS and Atom to items (`kind: 'competitor'`, `title`, `url`, `summary` (stripped, 240 chars), `image` from `media:` or `enclosure`, `publishedAt`), newest 10, items older than 30 days dropped.
- `sources/youtube-channel.ts`: the channel feed `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` through the same RSS mapper with `kind: 'competitor'`, `summary` = "YouTube video".
- `sources/bluesky-author.ts`: `GET https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>&limit=10&filter=posts_no_replies`; items from `post.record.text` (first 240 chars), `url` = `https://bsky.app/profile/<handle>/post/<rkey>`, `publishedAt`.
- `sources/mastodon-account.ts`: `GET https://<instance>/api/v1/accounts/lookup?acct=<user>` then `/api/v1/accounts/<id>/statuses?limit=10&exclude_replies=true&exclude_reblogs=true`; items from the status content (stripped), `url`, `publishedAt`.
- Google News mentions: the Module 01 news source's `search(query)` fetcher (`rss/search?q=<quoted name>+when:7d`), `kind: 'competitor'`, `opaqueUrl` set.
- `discover-feeds.ts`: `discoverFeeds(html, baseUrl)`: `<link rel="alternate" type="application/rss+xml|application/atom+xml">` first (title and href resolved), then the common paths (`/feed`, `/feed/`, `/rss`, `/rss.xml`, `/atom.xml`, `/blog/feed`, `/blog/rss`, `/index.xml`) probed with HEAD or a small GET, keeping the ones that parse. Up to 5.
- `buildBrief` for competitor items: "{Competitor} published: '{title}'. Write our own take on this topic for our audience, not a summary of theirs."

### 3. API

- `competitors.service.ts`, `competitors.repository.ts`, `dto/competitors.schema.ts`.
- Routes per the sprint doc: list, create (201), patch, delete (admins, soft), `discover-feeds` (members, 5 a minute per workspace, `assertSafeUrl` first, then `fetchUrlSafely` with `requireHtml: true`, 10 s total), `:id/items`.
- Create and patch validation: `name` 1 to 80, `websiteUrl` http or https and `assertSafeUrl` (422 `competitor_private`, mapped the way `BrandKitsService.refusal()` does), `feedUrls` at most 5, each safe, `youtubeChannelId` matches `^UC[A-Za-z0-9_-]{22}$`, `blueskyHandle` a domain-like handle, `mastodonAcct` `user@instance`, `newsQuery` 2 to 80. 20 live competitors per workspace (422 `competitor_limit`).
- `items(id)`: cache `discover:competitor:<id>` 30 min fresh, 24 h keep; fan out over the competitor's feeds, channel, accounts and the news search with allSettled; `unavailable` names the kinds that failed; `lastCheckedAt` and `lastError` (one sentence) updated on the row; the breaker and gate from Module 02 apply per upstream host.
- Foreign ids answer 404.

### 4. Web

- Competitors tab: `EmptyState` with **Add Competitor** when none; otherwise one group per competitor ("Latest From {Name}") with `CompetitorRow`s, a group menu (Edit, Remove), and the per-kind stale note.
- `CompetitorDialog`: Name, Website ("Enter your competitor's website"); on blur or Find Feeds, calls `discover-feeds` and lists results with checkboxes (or "No feeds found. You can paste a feed address." with a field); YouTube channel id, Bluesky handle, Mastodon account, News search phrase (prefilled with the name). Private address: the sentence from the stories. Save creates or patches.
- Remove: solid red, confirm "Remove {Name}? Their items disappear from Discover."
- Create Post on a row opens the Module 04 sheet with the competitor brief.

## Scope

**In**: the model and migration, four engine sources plus the news search and feed discovery, the routes, the tab, dialog, tests, fixtures (one sample RSS, one Atom, one YouTube channel feed, one Bluesky author feed, one Mastodon statuses answer).
**Out**: Instagram Business Discovery, polling in the worker, Tavily research action (P2).

## Tasks

- [x] Schema, migration, `db:generate`, SCHEMA_NOTES (use `prisma-change`).
- [x] Engine sources and `discoverFeeds` with tests on recorded bodies (RSS and Atom mapping, 30 day cut, YouTube channel feed, Bluesky author feed, Mastodon lookup then statuses, autodiscovery from `<link>` and from common paths, relative hrefs resolved).
- [x] Repository, service, schemas, routes with specs (cap at 20, private URL 422 without a fetch, foreign id 404, member delete 403, items fan-out with one feed failing, `lastError` is a sentence).
- [x] Web: tab, rows, dialog, remove confirm, Create Post wiring; tests (feeds listed after Find Feeds, private sentence, remove confirm text, stale note per kind).
- [x] Playground: `CompetitorRow`.
- [x] Playwright once under simulation: add a competitor from a fixture website, see feeds found, save, see items; remove. Screenshots `s11-36` to `s11-42` (the numbers `s11-10` to `s11-12` were taken; see the Decision Log).
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/discover-engine/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/discover
npx jest --config apps/web/jest.config.js apps/web/src/components/discover
```

## Done When

- A competitor can be added by website with two discovered feeds, a YouTube channel and a Bluesky handle; its group shows items of each kind with badges; Create Post uses the "our own take" brief.
- A private address is refused with the sentence and no row is created; the 21st competitor is refused with the cap sentence.
- A feed that fails shows the per-kind stale note and nothing else changes.
- Members can add and edit; only admins can remove.

## Hand Check

1. Add "Acme" with the fixture site (simulation serves `fixtures/competitors/acme/`): feeds found, save, items appear with Blog, YouTube, Bluesky, News badges.
2. Edit: untick one feed; the group updates after Refresh.
3. As the member: Remove is absent; as the admin: Remove, confirm, gone; the API answers 404 for the id.
4. Try `http://127.0.0.1:3000` as a website: the private sentence.

## Handoff

Module 08 gives competitor rows a Read action for items with a real URL.
