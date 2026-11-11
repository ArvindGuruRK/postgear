# Module 08: Website Reader

> **Sprint 11, Discover** | Status: Done (2026-11-11) | Size: M (one session)
> **Depends on**: [Module 04](module-04-create-post.md) (the sheet); [Module 03](module-03-discover-page-and-location.md)
> **Stories**: DC-8.1, 8.2, 8.3
> **Next**: [Module 09](module-09-hardening-e2e-closeout.md)

## Goal

Read opens a story in a side sheet from a safe fetch with Readability, never stores page text, refuses private and unreadable pages with one sentence each, resolves Google News links when it can, and hands the excerpt to Create Post From This.

## Read First

- Sprint doc: API Routes (`read`, `resolve-link`), Screens (Reader Sheet).
- Research: [`02-libraries.md`](../research/02-libraries.md) sections 1 and 4 (Readability, linkedom, the decoder); [`04-legal-limits-and-risks.md`](../research/04-legal-limits-and-risks.md) sections 2 and 5.
- Blueprint: section 6.
- User stories: DC-8.x, Journey D (unresolvable link), section 5 reader rows.
- Code: `packages/seo-engine/src/crawler/safe-fetch.ts` (`fetchUrlSafely`, `requireHtml`, `maxBytes`, redirects), `packages/seo-engine/src/crawler/html.parser.ts` (`parseHtml().text.content` as the fallback), `apps/api/src/modules/studio/brand-kits.service.ts` (throttle and refusal mapping), `apps/api/src/modules/seo/seo.gate.ts`.

## Design

### 1. Engine

- `reader/extract-article.ts`: `extractArticle(html, url): Article | null` using `linkedom`'s `parseHTML` and `@mozilla/readability` (`new Readability(document, { charThreshold: 500 }).parse()`); returns `{ title, byline, siteName, language, excerpt (first 400 chars of text), text (plain, paragraphs joined by blank lines, capped at 20,000 chars), image (og:image or the first article image), publishedAt (article:published_time or parsed from meta), wordCount, readMinutes }`. `null` when Readability finds nothing and the page's visible text is under 300 words (the caller answers `read_not_article`); when Readability finds nothing but the page is long, fall back to the tokenizer's text with `title` from `<title>`.
- `reader/google-news-link.ts`: `isGoogleNewsLink(url)`, `decodeGoogleNewsLink(id, { fetch })` as research 02 section 4 describes: the local base64 attempt first, then the page fetch for `data-n-a-sg` and `data-n-a-ts`, then the one `batchexecute` POST (the fetch seam gains an optional `method` and `body`), parsing the URL out of the answer. Throws a typed `LinkUnresolvedError` on any failure. No retries.

### 2. API

- `reader.service.ts`: `read(orgId, url)`: `assertSafeUrl` (422 `read_private`), per-workspace throttle 10 a minute (429 `read_throttled`), the gate, cache `discover:read:<sha256(url)>` 24 h; if the URL is a Google News link and `DISCOVER_LINK_DECODE` is on, resolve it first (cache `discover:link:<id>` 7 days, budget `discover:budget:decode:<minute>` cap 20; failure answers 422 `link_unresolved`); `fetchUrlSafely({ requireHtml: true, maxBytes: 1 MiB, timeoutMs: 8000 })` with a 10 s overall deadline; `extractArticle`; 422 `read_failed` on fetch errors and `read_not_article` on null. The article is answered and cached in Redis only.
- `POST /discover/resolve-link`: the decode alone, same budget and cache, `{ url }` or 422.
- Messages: "This page is private or on your own network.", "We could not read this page. Open it in a new tab instead.", "This page is not an article.", "We could not open this story here. Open it in a new tab instead.", "Try again in a moment."
- Logging: `securityLogger.warn('discover.read_private', { orgId, host })`; never the full URL of a private address.

### 3. Web

- `ReaderSheet`: opened from **Read** on any item with `url` or `opaqueUrl`, and from **Read A Page** on the News tab (DC-8.3, an address field with "Enter your page address" and a Read button). Shows the article per the blueprint; failures replace the body with a warning `Alert` and the sentence, keeping **Open**.
- **Create Post From This**: opens the Module 04 sheet with the brief built in the browser from the article: "{title} ({siteName}). {excerpt}" capped at 1,800 characters, language from the article's `language` when it is one of the place's languages, else the chip's.
- Read appears on cards only when the item has `url` or `opaqueUrl`; while resolving a Google link the sheet shows the skeleton with "Opening the story...".

## Scope

**In**: extraction, the decoder, the two routes, the sheet, Read A Page, Create Post From This, tests, fixtures (two article pages, one non-article page, one Google News article page with the two attributes and a recorded batchexecute answer, with Arvind's OK to record it once).
**Out**: browser-rendered pages (P2, the shared pool), storing articles, summarising with AI.

## Tasks

- [x] `extractArticle` with tests (a normal article, a page without `<article>`, a non-article, Tamil text preserved, `readMinutes` rounding, cap).
- [x] `decodeGoogleNewsLink` with tests on recorded bodies (base64 path, page plus batchexecute path, malformed answer throws).
- [x] `reader.service.ts` and routes with specs (private 422 without a fetch, throttle at the 11th call, cache hit skips the fetch, link decode budget, `read_not_article`, `link_unresolved`).
- [x] `ReaderSheet`, Read on cards and competitor rows, Read A Page, Create Post From This; tests (failure sentences, Open kept, brief built from the article, resolving state).
- [x] Playwright once: Read on a Trends card (real URL), Read on a News card (resolves under simulation from the fixture), Create Post From This drafts. Screenshots `s11-43` to `s11-49` (the numbers `s11-13` to `s11-15` were taken; Draft With AI itself was not pressed, see the Progress row).
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/discover-engine/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/discover
npx jest --config apps/web/jest.config.js apps/web/src/components/discover
```

## Done When

- Read on a Trends card shows the article with title, site, byline, time, text; Create Post From This opens the sheet with the article brief.
- Read on a News card resolves the Google link (fixture) and reads; with `DISCOVER_LINK_DECODE=false` it shows the "open it in a new tab" sentence.
- A private address, a 404 page and a home page each show their sentence; nothing is written to Postgres (check the tables).
- Eleven reads in a minute answer "Try again in a moment." on the eleventh.

## Hand Check

1. Chennai, Trending, Read on the first card: the sheet with the article; scroll; Create Post From This; draft.
2. News, Read on a story: "Opening the story..." then the article; set `DISCOVER_LINK_DECODE=false`, restart, Read: the fallback sentence with Open.
3. Read A Page with `http://10.0.0.1/` : the private sentence; with a public home page: "not an article".

## Handoff

Module 09 sweeps the whole module for security and edge cases and writes the e2e spec and the completion checklist.
