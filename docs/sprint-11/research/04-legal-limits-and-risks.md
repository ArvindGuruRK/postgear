# Sprint 11 Research: Legal, Limits And Risks

> **Written**: 2026-11-05. This is not legal advice; it is the engineering reading of each source's terms, what we do about it, and the decisions left to Arvind.

## 1. Attribution, Per Source

| Source | What we show | Where |
|---|---|---|
| Google News | "via Google News" on the tab, the publisher name on every card, every card links out | News tab footer and card |
| Google Trends | "Trending searches via Google Trends" | Trending tab group header |
| Wikipedia | "What people are reading on Tamil Wikipedia", each item links to its article; "Text: CC BY-SA" | Trending tab group header |
| Bluesky, Mastodon | "Worldwide on Bluesky", "Worldwide on Mastodon", items link to the post or tag | Trending tab group header |
| YouTube | YouTube's name, the channel name, a link to the video on YouTube, no altered titles | Videos tab |
| Google holiday calendars, date-holidays | "Dates from public holiday calendars and date-holidays (CC BY-SA)" | Festivals tab footer |
| OpenStreetMap | "Places by OpenStreetMap contributors" linking to osm.org/copyright | Under the location chip, in the city search dialog |
| Publisher feeds | The site name, a link to the post | Competitors tab |

## 2. What We Never Do

- Store or republish article bodies. The reader fetches a page when a person asks, shows an excerpt and the text in a sheet for that person, caches it for 24 hours by URL, and never writes it to Postgres. The AI gets headlines and related headlines, or the reader excerpt the person is looking at, never a crawl.
- Fetch pages that need a login, or anything behind a paywall by tricks.
- Poll Google Trends Explore, drive Chrome against Google, or scrape Google Search.
- Autocomplete against Nominatim, or more than one Nominatim request a second across the whole deployment.
- Send a person's raw coordinates anywhere, or store them.
- Hotlink images in a way that pretends they are ours: images are shown lazily with `referrerpolicy="no-referrer"`, hidden on error, and never proxied or stored.
- Let a feed's text reach the model outside the labelled brief block (prompt injection, section 5).
- Make a paid call. Every key is optional and free; `DISCOVER_SIMULATION=true` is the local default in `.env.example`'s guidance so development never hits the real feeds by accident.

## 3. Rate Limits And Budgets

| Upstream | Published limit | Our budget | Mechanism |
|---|---|---|---|
| Google Trends RSS | none published | one fetch per place per 20 minutes, shared by all tenants | Redis cache, single-flight lock, circuit breaker |
| Google News RSS | none published | one fetch per place, language and topic per 15 minutes, shared | same |
| Wikimedia REST | "reasonable", identify yourself | one fetch per edition per day | cache 24 h |
| YouTube Data API | 10,000 units a day (reported) | cap at 8,000 units a day (`discover:budget:youtube:<date>`), 1 unit a call, cache 60 min per country | budget key; past the cap the tab says the source is resting until tomorrow |
| Nominatim | 1 request a second, cache, identify (policy) | 1 a second globally, 5 a minute per workspace, 30 day cache | budget key, per-org throttle |
| Bluesky public AppView | unpublished, "generous" | one fetch per 10 minutes, shared | cache, breaker |
| Mastodon | 300 per 5 minutes per IP (reported default) | one fetch per 10 minutes, shared | cache, breaker |
| Publisher and YouTube channel feeds | none | one fetch per competitor per 30 minutes | cache per competitor |
| Google News link decode | none, unofficial | 20 a minute globally, 7 day cache per id | budget key |
| Reader (`POST /discover/read`) | n/a | 10 a minute per workspace, 24 h cache per URL, 1 MB page cap, 8 s per request, 10 s total | per-org throttle, `SeoGate`-style process gate (max 4 upstream fetches at once) |

**Circuit breaker**: three failures for one source in a row opens it for 10 minutes; the tab shows "Google Trends is resting; showing what we had" with the stale items, or hides the group if there are none. The feed answer carries `unavailable: ['trends']` so the UI never guesses.

**Single flight**: a Redis `SET key value EX 20 NX` lock per cache key makes a 9 am burst from many tenants one upstream call; the others wait briefly or get the stale copy.

**Stale while revalidate**: cached entries are `{ fetchedAt, items }` with a long keep window (6 hours for feeds) and a short fresh window (15 to 20 minutes). Past the fresh window a request answers the stale copy at once and refreshes in the background (a caught, bounded promise). `stale: true` in the answer lets the UI show "Updated 25 minutes ago".

## 4. The Google Terms Question

**The facts**: Google News' terms (an older copy at google.com/intl/en_ie/terms_google_news.html, reported) say the content may be displayed for personal, non-commercial use, that Google does not own the stories, and that feeds are meant to send readers to the source. Google's general terms say the services are for personal use unless an agreement says otherwise (reported, 2011 copy). No commercial licence is offered for the Trends RSS; the official Trends API is an alpha you apply for (announced 2025-07-24).

**The common practice**: feed readers, dashboards and many SaaS products show Google News headlines with attribution and outbound links, which is what the feeds exist for. The risk is not a lawsuit; it is Google blocking a server IP or changing the feeds without notice.

**Arvind's options** (the docs are written so any of them works):

| Option | What ships | Trade-off |
|---|---|---|
| **A. Ship with attribution and the seam** (recommended) | Trends and News from Google feeds, attribution and outbound links, short caches, nothing stored, source adapters behind one interface, Trending still works from Wikipedia and social when Google is dark | Best product on day one; accepts the unofficial-feed risk |
| B. Clean set only | Wikipedia, YouTube API, Bluesky, Mastodon, holiday calendars, publisher RSS, GDELT with a strict budget | No Google risk; loses state-level search trends and local-language news breadth |
| C. Paid later | A plus a SerpApi adapter (Google News and Trends endpoints, $25 a month for 1,000 searches) for the workspaces that need it | Spend; only when revenue justifies it |

**Do now, whichever option**: apply for the Google Trends API alpha (free, a form), and create a free YouTube Data API key on the existing Google Cloud project.

## 5. Security

- **SSRF**: every stranger URL (competitor sites, discovered feeds, the reader) goes through `assertSafeUrl` first and `fetchUrlSafely` after (pinned IP, redirects re-checked, size cap). `WEBHOOK_ALLOW_PRIVATE_URLS` must not reach this path: Discover has its own `allowPrivate` that is always false.
- **Hostile feeds**: XML bombs and huge bodies are stopped by the 1 MB cap and, if `fast-xml-parser` is chosen, `processEntities: false`. HTML inside feed descriptions is stripped server-side with the SEO engine's tokenizer; the web app never uses `dangerouslySetInnerHTML` for feed text.
- **Prompt injection through headlines**: feed text is data. It goes into the labelled brief block of the content prompt (the same block a user's topic goes into), after `stripControlChars`, truncated to the brief size; never into the system prompt. A headline that says "ignore your instructions" is just an odd headline.
- **Datacenter IPs**: Google may answer a server with 429 or a consent page. The breaker handles it, the shared cache keeps the rate tiny, and the honest `PostGearBot` User-Agent is the recommended choice (recorded in the decision log either way).
- **Tenancy**: the feed cache is shared on purpose (it holds public data keyed by place), but settings, competitors and reader throttles are per workspace through `@CurrentOrg()`.
- **Secrets**: `YOUTUBE_API_KEY` stays server-side; the status endpoint says only whether it is set.

## 6. Privacy

- Coordinates are rounded in the browser, used once, never stored. The settings row stores city, region, country and time zone.
- The chip tells people this in plain words before they click.
- No third-party client-side geocoder (BigDataCloud's free endpoint is funded by collecting IP and coordinate pairs; that is why it was not chosen).
- Images are loaded with no referrer; publishers still see the viewer's IP when an image loads, which is normal for any feed reader and is noted here.

## 7. Risks Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google changes or blocks the RSS feeds | medium | Trending and News lose their main source | breaker, stale copies, Wikipedia and social still fill Trending, adapter seam, SerpApi later, Trends API alpha application |
| Google News link decode breaks | high over time | Read on News items fails | best effort behind a flag; Open always works; Trends items carry real URLs |
| Nominatim withdraws access or throttles | low | Use My Location fails | time zone guess and country picker remain; `DISCOVER_GEOCODER=off`; self-host Photon or Nominatim |
| Sub-region trends sparse for some places | medium | Trending looks thin | fall back to the country feed, say so in the group header |
| Holiday calendars miss regional festivals | certain for some states | Festivals incomplete | date-holidays state data where it exists; P2 curated additions per region |
| Bluesky `unspecced` endpoints change | medium | Worldwide group empty | breaker, `unavailable`, no error page |
| YouTube quota exhausted mid-day | low | Videos tab empty | budget cap, "resting until tomorrow" message |
| Non-Latin scripts render in a fallback font | certain | Looks different from Sora | accepted exception, `dir="auto"`, line-height checked |
| A feed contains hostile content | low | model misled or UI broken | stripped text, labelled brief, no raw HTML |
| Zero-cost promise slips | low | spend | every key optional; simulation default locally; no paid adapter in the sprint |
