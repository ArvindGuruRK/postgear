# Module 10: P2 Backlog

> **Sprint 11, Discover** | Status: Done with gaps (2026-11-12), not committed | Size: L
> **Depends on**: [Module 09](module-09-hardening-e2e-closeout.md)
> **Started on Arvind's word** (2026-11-12): "implement all the backlogs", with Discover's real feeds turned on in the root `.env` (`DISCOVER_SIMULATION="false"`).

## The Backlog, And What Became Of It

| # | Item | What it adds | Result |
|---|---|---|---|
| 1 | **Pre-warm in the worker** | The maintenance workflow (every 15 min) calls an internal API endpoint that refreshes the places of workspaces active in the last day, so the first open of the morning is fresh and instant | **Built.** `POST /internal/discover/prewarm` (`maintenance.service.ts`), called by the worker's `discoverMaintenance` activity behind the `discover-maintenance` patch. Only in a place's early morning (05:00 to 09:00 in its zone), only copies older than 3 hours, 40 places a run, through the same gate, breakers and budgets as a person |
| 2 | **Competitor polling and "new since you last looked"** | A nightly refresh of every competitor with a count badge on the tab | **Built.** `POST /internal/discover/competitors/refresh` reads competitors nobody looked at for 20 hours (25 a run). `CompetitorView` keeps `lastSeenAt` per user per competitor; `GET /discover/competitors/unseen` feeds the tab's count, `POST /discover/competitors/seen` clears it, and new rows carry a New badge |
| 3 | **Saved items (Ideas)** | A bookmark on any card; an Ideas list; Create Post from it later | **Built** as the **Saved** tab. `DiscoverIdea` (a copy of the card, a note up to 280 characters, who saved it, where it was read); `GET/POST /discover/ideas`, `PATCH/DELETE /discover/ideas/:id`; 200 per workspace; any member may save, note and remove |
| 4 | **Home card "Trending Near You"** | Three trends on Home with Create Post | **Built** (`home/trending-near-you.tsx`): five rising searches for the workspace's place, with See More into Discover. Reads the same feed endpoint |
| 5 | **Instagram Business Discovery** | Competitor rows from public Instagram business accounts through the workspace's own connected Instagram account (official Graph API) | **Built, never run for real.** `Competitor.instagramUsername`; `sources/instagram-business.ts` reads through the workspace's connected Instagram channel. A token or permission problem says Reconnect and stays out of the shared breaker. Needs Meta's app review, and possibly the `instagram_manage_insights` permission the Instagram connection does not ask for today |
| 6 | **Per-user place** | A `DiscoverUserPlace` row so a person's choice follows them across devices | **Built.** `GET/PUT/DELETE /discover/my-place`. Only a person's own choices are kept (found, searched, Worldwide); going back to the workspace's place clears the row. `localStorage` stays as the instant first paint |
| 7 | **Rendered reader fallback** | When Readability finds nothing, render the page in the shared Playwright pool and try again | **Built.** Only for a page that came back `not_article` with under 1,500 characters of visible text; a per-workspace share of renders; every request judged by the pool's guard and the final address judged again; never under simulation. `DISCOVER_READER_RENDER="false"` turns it off |
| 8 | **GDELT news source** | Place-aware global news without Google, 65 languages | **Built** as a News group ("Chennai In The World Press"), with an off switch in settings. One call every 6 seconds for the whole deployment (`discover:budget:gdelt` held with `SET NX`); a held key keeps the copy and is not trouble |
| 9 | **Google Trends CSV via Playwright** | More trends, time windows and categories | **Skipped.** It drives Google's own site in a browser, which its terms do not allow, and 8 to 10 sessions in 15 minutes trip it. Revisit only through #10 |
| 10 | **Official Google Trends API** | Replace the RSS when the alpha admits PostGear | **Skipped.** Application-gated: there is nothing to build until Google admits PostGear. Applying is Arvind's step |
| 11 | **SerpApi adapter** | Google News through a licensed, paid API | **Built, off.** `sources/serpapi-news.ts` behind `DISCOVER_NEWS_PROVIDER="serpapi"` and `SERPAPI_API_KEY`. Never called with a real key (no paid calls locally) |
| 12 | **NewsData.io adapter** | A keyed news API with country and language filters | **Built, off.** `sources/newsdata.ts` behind `DISCOVER_NEWS_PROVIDER="newsdata"` and `NEWSDATA_API_KEY`. Never called with a real key; its commercial terms are still to be confirmed |
| 13 | **IP-based first guess** | A country from the request IP when the time zone is ambiguous | **Built.** `GET /discover/locality/guess`, from a DB-IP Lite country table the operator downloads (`npm run discover:ip-db`, then `DISCOVER_IP_COUNTRY_FILE`). Asked only when the zone names no country; the address is never logged or stored; the page credits DB-IP while that guess is on screen |
| 14 | **Curated regional festivals** | Tamil Nadu's own days merged into Festivals | **Built** for Tamil Nadu (`holidays/curated/tamil-nadu.ts`) plus a table of state days (`state-days.ts`). Where the state's list and the national calendar disagree, the state wins (Deepavali 2027) |
| 15 | **Weekly digest email** | "This week where your audience is" with Create Post links | **Built.** `DiscoverSettings.weeklyDigest` (admin switch), Monday 08:00 to 10:00 in the workspace's zone, one `discover.digest` notification through the Sprint 8 outbox, emailed to members who kept `User.sendDigestEmails` on. A week is claimed with one conditional update, so it is never sent twice |
| 16 | **Research this competitor** | A summary of a competitor's recent coverage | **Built, differently.** One structured AI call over the posts Discover already read (never the open web, so every line can be checked against them), 3 credits like the SEO advice, cached a day per competitor and per set of posts. No Tavily call. Open to every member, like every other AI feature |
| 17 | **Topic interests** | The workspace picks interests and News adds a search group for each | **Built.** `DiscoverSettings.interests` (up to 5, edited in Settings); one Google News search group each, cached per words and edition, shared across workspaces |
| 18 | **Self-hosted Photon or Nominatim** | Type-ahead city search, no dependence on the public instance | **Built.** `DISCOVER_GEOCODER_URL` points the place finder at an operator's Nominatim through `common/http/operator-fetch.ts` (one origin, fixed at boot). With it set, the popover searches as you type; with the public instance it keeps the Search button (its usage policy forbids type-ahead) |

## Also Done In This Module

- **Module 09's look gaps:** the country and region picker when the place finder is off (`place-picker.tsx`, `GET /discover/locality/pick`); a fade at the edge of the phone tab bar; the card menu no longer drops onto its own row; the reader no longer shows an empty picture box while it loads; the skeleton pulse and the sheet fade stop under reduced motion.
- **The page revamp:** ranked trend cards with a search-volume bar and a wide lead card around its picture; calendar tiles on Festivals; tab counts (Saved, New competitors); the title of a card is its link out, so a card has one row of actions (Create Post, Read, Save, menu); the phone language chip shows the language's own name.
- **Next.js:** `loading.tsx` (the page's skeleton as the Suspense fallback) and `error.tsx` (Try Again through `retry`, with the digest) for the Discover route.
- **Fault-tolerant calls:** every Discover request from the web has a deadline and is cancelled when it is no longer needed, and a request that failed in transit (no answer, 502, 503, 504) is tried again before the page says so.
- **Real feeds on locally:** `DISCOVER_SIMULATION="false"` in the root `.env`.

## Keys And Accounts

What each optional key switches on, what it costs and how to get it, step by step: [discover-keys-guide.md](../discover-keys-guide.md).

## Known Gaps

1. Instagram Business Discovery, SerpApi and NewsData have never made a real call. Each is unit tested against recorded or hand-written answers only.
2. In simulation, an interest's search group has no recording, so it is left out quietly (a 404 from the stand-in).
3. Trends uses Google's older region codes: a region Google does not list falls back to its country (France's Ile-de-France shows France).
4. The news provider is not part of the feed cache key, so switching `DISCOVER_NEWS_PROVIDER` serves the old provider's copies until they expire.
5. The GDELT spacing has no spec of its own; it is one `SET NX` with a 6 second expiry.
