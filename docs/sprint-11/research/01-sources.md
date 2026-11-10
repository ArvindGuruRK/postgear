# Sprint 11 Research: Data Sources

> **Written**: 2026-11-05. Every row marked **verified** was fetched by Claude on that day and the result is described. Rows marked **reported** come from documentation or secondary sources and were not fetched; the Module 01 fixture-recording script confirms them before they ship.
> **Rule for this sprint**: no paid API, no credit card, no key that costs money. A free key (YouTube Data API, Tavily) is allowed but optional.

## 1. Summary Matrix

| Source | Kind | Place awareness | Language | Key | Verdict |
|---|---|---|---|---|---|
| Google Trends RSS | trending searches | country and ISO 3166-2 sub-region (`IN-TN`, `US-CA`) | follows the region | none | **Pick** (primary for Trending) |
| Google News RSS | news | country edition, any city or place name, topic, search | 10 Indian languages, 40+ worldwide | none | **Pick** (primary for News and competitor mentions) |
| Wikimedia pageviews, top articles | what people read | per language edition (`ta.wikipedia`), not per region | by edition | none | **Pick** (second signal for Trending, legally clean) |
| Google public holiday calendars (ICS) | festivals and holidays | country (232 calendars) | English names | none | **Pick** (primary for Festivals) |
| `date-holidays` (npm) | holidays | country and state where the data exists | local names | none | **Pick** (fallback and state data for Festivals) |
| Bluesky trends | social topics | worldwide only | mostly English | none | **Pick** (labelled Worldwide) |
| Mastodon trending tags | social hashtags | worldwide (per instance) | mixed | none | **Pick** (labelled Worldwide) |
| YouTube Data API, most popular | trending videos | country (`regionCode`) | follows the country | free key | **Pick, optional** (off without a key) |
| Publisher RSS and Atom feeds | competitor posts and blogs | n/a | n/a | none | **Pick** (Competitors) |
| YouTube channel feed | competitor videos | n/a | n/a | none | **Pick** (Competitors) |
| Bluesky public AppView (author feeds, search) | competitor posts | n/a | n/a | none | **Pick** (Competitors) |
| Mastodon public account feeds | competitor posts | n/a | n/a | none | **Pick** (Competitors) |
| Tavily (already wired) | web research | n/a | n/a | free key, 1,000 credits a month | **Keep** for ad-hoc competitor research only |
| GDELT DOC 2.0 | global news search with country filters | country of source | 65 languages | none | **Later** (both test calls hit 429; strict per-IP limits) |
| NewsData.io | news API | country, language | many | free key, 200 credits a day, 48 h delay | **Later** (only keyed news API that may allow commercial use) |
| SerpApi | Google results as JSON | yes | yes | paid; free plan 250 a month | **Later**, paid swap-in |
| trendspyg (Python) | Google Trends | yes | yes | none | **Reference only**, we port its RSS path to TypeScript |
| pytrends (Python) | Google Trends | yes | yes | none | **Reject** (archived 2025-04-17) |
| NewsAPI.org, GNews, Guardian Open Platform | news APIs | varies | varies | free keys | **Reject** for production (development or non-commercial only) |
| Brave Search API | web search | yes | yes | paid (free tier withdrawn for new users) | **Reject** |
| Reddit `.rss` | community posts | subreddit | mixed | none | **Reject** for v1 (blocked from cloud IPs, terms unclear) |
| Instagram, Facebook, X, LinkedIn, TikTok public reads | competitor posts | n/a | n/a | paid or none | **Out of scope** (no free public read; Instagram Business Discovery through a connected business account is a P2 idea) |

## 2. The Four Names Arvind Brought

| Name | What it is | Verdict and why |
|---|---|---|
| **SerpApi** | A paid service that returns Google results (Search, News, Trends) as JSON. | **Later.** Its pricing page (serpapi.com/pricing, verified 2026-11-05) lists a Free plan of **250 searches a month, 50 an hour**, then Starter at $25 a month for 1,000. 250 a month cannot serve a multi-tenant feed. It stays in the plan as a paid swap-in behind the same source interface, for the day Google's free feeds are not enough or not allowed. |
| **Google News RSS + feedparser** | Google News publishes RSS feeds for its top stories, any city or place, topics and searches, per country and language edition. `feedparser` is the Python library that reads them. | **Pick the feeds.** They are the richest free local-news source there is, verified in Tamil and French (section 3.2). In Node the equivalent of feedparser is `rss-parser` (see `02-libraries.md`). |
| **trendspyg** | A Python library (MIT, v1.9.0, github.com/flack0x/trendspyg) that replaced pytrends. Its `download_google_trends_rss` reads the public Trends RSS feed with no browser; its CSV and Explore functions drive Chrome and are rate-limit sensitive (its README says 8 to 10 fresh browser sessions in 15 minutes trigger Google's 429 page, with recovery taking 35 minutes or more). | **Reference only.** PostGear is Node, so we port the RSS path (a fetch, an XML parse, and its normalised fields: keyword, rank, volume text, volume minimum, started at, news, image) to TypeScript in `packages/discover-engine`. The Chrome-driven CSV path (more trends, time windows, categories) is a P2 idea on the Playwright pool the SEO engine already runs, never polled. |
| **pytrends** | The old Python Google Trends scraper. | **Reject.** The GitHub repository says "This repository was archived by the owner on Apr 17, 2025. It is now read-only." (verified 2026-11-05). It returned 429 errors long before that. |

## 3. Sources In Detail

### 3.1 Google Trends RSS (verified 2026-11-05)

**URL**: `https://trends.google.com/trending/rss?geo=<GEO>` where `GEO` is a country code (`IN`) or an ISO 3166-2 sub-region (`IN-TN`, `US-CA`).

**What came back**:

| Request | Result |
|---|---|
| `geo=IN` | RSS 2.0, "Daily Search Trends", 10 items. First two: "archie brown" (approx traffic 100+), "romelu lukaku" (200+). |
| `geo=IN-TN` | RSS 2.0, 10 items. The first three were international sport ("aek vs real madrid", "fenerbahce vs liverpool", "paris masters"); later items were regional ("weather coimbatore", a Tamil-script "Puducherry" entry, Tamil Nadu weather stories). |
| `geo=US-CA` | RSS 2.0, 10 items ("joe milton" 200+, "sam darnold" 500+, "kervin arriaga" 200+). |

**Fields per item**: `title` (the search term), `ht:approx_traffic` ("200+"), `pubDate`, `ht:picture`, `ht:picture_source`, one or more `ht:news_item` blocks each with `ht:news_item_title`, `ht:news_item_url` (a **real publisher URL**, not a Google redirect), `ht:news_item_source`, `ht:news_item_picture`. `description` and `ht:news_item_snippet` were empty.

**Coverage**: trendspyg's README claims 125 countries plus 51 US states. Sub-region codes are ISO 3166-2 for most countries (the searchapi.io geo list shows `IN-TN` as "Tamil Nadu", `IN-KA`, `IN-MH`, `IN-DL`; some countries use numeric suffixes like `AT-1`). Coverage differs by place: some sub-regions return few or no items. The engine asks for the sub-region first and falls back to the country when the feed is empty.

**Freshness**: vendors report the feed updates roughly hourly. We treat 20 minutes as the fresh window.

**Limits**: none published. It is a public feed meant for feed readers. One request per place per 20 minutes across all tenants (shared cache) is well within what a feed reader would do.

**Terms**: unofficial. Google's Trends pages have historically been for personal use; no commercial licence is offered for the RSS. See `04-legal-limits-and-risks.md`. Google announced an official Trends API alpha on 2025-07-24 (developers.google.com/search/blog/2025/07/trends-api); it is application-gated and still limited as of late 2026 (reported). Apply now.

**Verdict**: **Pick** as the primary Trending signal. It is the only free source that is both place-specific and about search interest.

### 3.2 Google News RSS (verified 2026-11-05)

**URL patterns** (all take `hl` = interface language, `gl` = country, `ceid` = `COUNTRY:language`; the three must agree):

| Feed | URL |
|---|---|
| Top stories | `https://news.google.com/rss?hl=ta&gl=IN&ceid=IN:ta` |
| A place | `https://news.google.com/rss/headlines/section/geo/Chennai?hl=en-IN&gl=IN&ceid=IN:en` |
| A topic | `https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en` (also WORLD, NATION, BUSINESS, ENTERTAINMENT, SPORTS, SCIENCE, HEALTH) |
| A search | `https://news.google.com/rss/search?q=<url-encoded query>&hl=en-IN&gl=IN&ceid=IN:en` (operators such as `when:7d`, `site:`, quotes work; reported) |

**What came back**:

| Request | Result |
|---|---|
| Top stories, `ceid=IN:ta` | Feed title in Tamil ("முக்கியச் செய்திகள் - Google செய்திகள்"), at least 23 items, sources BBC, ABP Nadu, Nakkheeran. Every item has a `description` with an ordered list of related stories (title, link, source). |
| Place "Chennai", `ceid=IN:en` | "Chennai - Latest - Google News", at least 44 items from The Hindu, The New Indian Express and others; pubDates within the day. |
| Place "Chennai", `ceid=IN:ta` | "சென்னை - சமீபத்திய - Google செய்திகள்", at least 48 items from Hindu Tamil Thisai and Puthiyathalaimurai. |
| Place "Paris", `ceid=FR:fr` | "Paris - Dernieres infos - Google Actualites", French items from Actu.fr, Le Parisien, 20 Minutes. |
| Topic TECHNOLOGY, `ceid=IN:en` | "Technology - Latest - Google News", CNET and GSMArena items. |

**Fields per item**: `title` (usually "Headline - Publisher"), `link`, `guid`, `pubDate`, `description` (HTML with the related-stories list), `source` (publisher name and URL). **The `link` is an opaque redirect** of the form `https://news.google.com/rss/articles/CBMi...?oc=5`. Since 2024 the id is not a base64 publisher URL; resolving it needs a call to Google's internal `batchexecute` endpoint (see `02-libraries.md`, section 4). We never depend on that resolution (see `05-approach-on-postgear.md`).

**Coverage**: Google News has editions for roughly 70 countries and 40 languages. India has ten: English, Hindi, Tamil, Telugu, Malayalam, Marathi, Bengali, Gujarati, Kannada and Punjabi (Gujarati and Punjabi added 2023-08, reported from press coverage). The engine ships an editions table seeded from the GNews project's country and language lists (`03-location-and-language.md`, section 6) and the fixture script confirms each `ceid` returns items.

**Freshness**: minutes. Fresh window 15 minutes.

**Limits**: none published. Empty or default-region results are reported when the three locale parameters disagree. Items are not strictly ordered by date.

**Terms**: Google News' older terms say the service is for personal, non-commercial display, and that the full stories belong to the publishers. Feeds are meant to be shown as headlines with attribution and a link to the source. This is the main legal question of the sprint; see `04-legal-limits-and-risks.md`.

**Verdict**: **Pick** as the primary News source and for competitor name mentions (search feed).

### 3.3 Wikimedia Pageviews, Top Articles (verified 2026-11-05)

**URL**: `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/<project>/all-access/<YYYY>/<MM>/<DD>` with `project` such as `ta.wikipedia`, `en.wikipedia`, `fr.wikipedia`.

**What came back** for `ta.wikipedia/all-access/2026/11/03`: JSON with about 971 ranked articles. Skipping the main page and `Special:` pages, the top eight were the list of Tamil films by year (648 views), a Tamil author, the 2026 Tamil film list, an actor, a film sequel, Thirukkural (284), Deepavali (276), Ravana (249). That is a recognisable picture of what Tamil readers care about this week.

**Coverage**: every language edition. Not region-specific: `ta.wikipedia` stands in for Tamil readers everywhere, `en.wikipedia` is worldwide. We show it as "What people are reading on Tamil Wikipedia", not "in Tamil Nadu".

**Freshness**: a day's data is published the next day (UTC). The engine asks for yesterday, then the day before.

**Noise to filter**: `Main_Page`, `Special:*`, `Wikipedia:*`, `File:*`, `Help:*`, `Portal:*`, `Category:*`, the search page, and (optionally) pages whose title is a bare year or a list.

**Limits**: Wikimedia asks for a descriptive User-Agent and reasonable rates (reported). One call per edition per day is nothing.

**Terms**: CC BY-SA 4.0 for text; link each item to its article and name Wikipedia.

**Verdict**: **Pick** as the legally clean second signal in Trending, and the only one that works per language without Google.

### 3.4 Google Public Holiday Calendars, ICS (verified 2026-11-05)

**URL**: `https://calendar.google.com/calendar/ical/<id>%23holiday%40group.v.calendar.google.com/public/basic.ics` where `<id>` is `en.indian`, `en.usa`, `en.uk`, `en.australian`, `en.singapore`, `en.ae`, `en.german`, `en.brazilian`, `en.japanese`, `en.canadian`, `en.french` and so on. A community list maps 232 country codes to ids (gist by seanblanchfield, reported; the ids above for India, the US, the UK, Australia, Singapore, the UAE, Germany, Brazil, Japan, Canada and France are in that list). The `#` and `@` must be URL-encoded.

**What came back**:

| Calendar | Result |
|---|---|
| `en.indian` | `X-WR-CALNAME: Holidays in India`, several hundred `VEVENT`s across years. Each `DESCRIPTION` is "Public holiday" or "Observance". Examples: Diwali/Deepavali 2026-11-08 (Public holiday), Chhat Puja 2026-11-15 (Observance), Christmas 2026-12-25 (Public holiday), **Pongal 2027-01-15 (Observance)**, Republic Day 2027-01-26, Ugadi 2027-04-07 (Observance), Dussehra 2027-10-09, Diwali 2027-10-29. Holi appears on 2026-03-04. Some dates carry several regional names for one occasion (Gudi Padwa, Ugadi, Chaitra Sukhladi on 2024-04-09). |
| `en.usa` | `X-WR-CALNAME: Holidays in United States`. New Year's Day, Martin Luther King Jr. Day, Juneteenth, Independence Day (Public holiday); Valentine's Day, Daylight Saving Time starts (Observance). |

**Coverage**: country level only, English names, both public holidays and observances (which is what a social media manager wants: Valentine's Day and Pongal are posting moments even when they are not days off). **No state-level data** (Tamil Nadu's Thiruvalluvar Day is not there).

**Freshness**: years ahead. Fresh window 7 days.

**Format**: plain `VEVENT`s with `DTSTART;VALUE=DATE`, no recurrence rules, so a 40-line parser is enough (see `02-libraries.md`).

**Terms**: a public calendar Google publishes for subscription. No key, no login. Cache it.

**Verdict**: **Pick** as the primary Festivals source.

### 3.5 `date-holidays` npm (registry metadata verified 2026-11-05; India data read from the repository)

**What it is**: a Node library (ISC code, CC BY-SA 3.0 data from Wikipedia) with holiday rules for 207 countries, states and regions, computed offline. `new Holidays('IN', 'TN').getHolidays(2027)` returns objects with `date`, `name`, `type` (`public`, `bank`, `school`, `optional`, `observance`).

**What the India file holds** (`data/countries/IN.yaml`): 35 state and territory codes, but the national list is six entries (Republic Day, Ambedkar Jayanti, Good Friday as an unnamed placeholder, Independence Day, Gandhi Jayanti, Christmas as a placeholder) and **Tamil Nadu has one placeholder day**. So for India the Google calendar is far richer. For Germany, France, the US, Canada, Australia and most of Europe the library's state data is good.

**Size**: 11 MB unpacked. Load lazily on first use, never at boot.

**Verdict**: **Pick** as the fallback (when a country has no Google calendar id or the fetch fails) and as the state-level source where its data exists. Festivals merges both and de-duplicates by date and normalised name.

### 3.6 Bluesky Trends (verified 2026-11-05)

**URLs**: `https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=10` and `.../app.bsky.unspecced.getTrendingTopics?limit=10`.

**What came back** without any authentication: `getTrends` returned trends with `topic`, `displayName` ("Democratic picks for House speaker", "US data center ban votes", "Bob Dylan meets Pope Leo XIV"), `link` (a feed URL), `startedAt`, `postCount` (234 to 3,055), `status` (`trending` or `cooling`), `category` (politics, culture, entertainment). `getTrendingTopics` returned `topics` (topic, displayName, link, description) and an empty `suggested`.

**Coverage**: worldwide, English-heavy. Not place-aware.

**Terms**: Bluesky's docs say the public AppView (`public.api.bsky.app`) serves read endpoints without authentication and should be used for public web use because it is cached; rate limits are unpublished but "generous". The endpoints are `unspecced`, which means they may change. Vendors report 403s from some datacenter IPs on `searchPosts` (reported).

**Verdict**: **Pick**, shown in a "Worldwide" group inside Trending. Author feeds (`app.bsky.feed.getAuthorFeed`) serve Competitors.

### 3.7 Mastodon Trending Tags (verified 2026-11-05)

**URL**: `https://mastodon.social/api/v1/trends/tags?limit=10` (any instance; `mastodon.social` is the largest).

**What came back**: a JSON array of tags with `name`, `url`, and a seven-day `history` of `uses` and `accounts` per day (counts as strings). The first three were "janosch", "MeerMittwoch", "IgnoreAMovie", which shows the signal is community-flavoured and worldwide.

**Terms**: a public, documented API. Instances may rate limit (300 requests per 5 minutes per IP is the documented default, reported).

**Verdict**: **Pick**, in the Worldwide group, mainly as a hashtag idea source. Account feeds (`/api/v1/accounts/lookup`, `/api/v1/accounts/:id/statuses`) serve Competitors.

### 3.8 YouTube Data API v3, Most Popular (reported)

**Request**: `GET https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=IN&maxResults=25&key=<YOUTUBE_API_KEY>`; `videoCategoryId` narrows it.

**Facts** (Google's quota page, reported): a project gets 10,000 quota units a day free; `videos.list` costs 1 unit a call; quotas reset at midnight Pacific. `regionCode` takes an ISO 3166-1 alpha-2 code and only works with `chart`. Nobody is billed for quota; running out returns an error until the reset.

**Terms**: the YouTube API Services terms require linking to YouTube, showing the channel, not altering metadata, and not caching beyond 30 days (reported from the developer policies). We cache for one hour.

**Key**: a Data API key is **not** the OAuth client PostGear already has for YouTube publishing. It is created in the same Google Cloud project in a minute and costs nothing.

**Verdict**: **Pick, optional.** The Videos tab says "Trending videos are not set up" when the key is missing.

### 3.9 Publisher RSS and Atom Feeds, YouTube Channel Feeds (reported; standard formats)

For Competitors: a brand's website usually links its feed in `<link rel="alternate" type="application/rss+xml" href="...">` (also `application/atom+xml`), and common paths work (`/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/blog/feed`). A YouTube channel's feed is `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (15 most recent videos, reported; intermittent 404s were reported in late 2025). All free, no key.

**Verdict**: **Pick** for Competitors.

### 3.10 Tavily (already in PostGear)

Wired in Sprint 6 behind `TAVILY_API_KEY`, cached in Redis for 10 minutes, never called under `AI_SIMULATION`. Its docs say the Researcher plan gives 1,000 free credits a month (basic search 1 credit). It stays as it is: Discover does not call it for feeds, but the Create Post flow keeps the existing research stage, and a P2 "Research this competitor" action could use it.

### 3.11 GDELT DOC 2.0 (reported; two test calls returned HTTP 429)

`https://api.gdeltproject.org/api/v2/doc/doc?query=Chennai%20sourcecountry:IN&mode=artlist&format=json&timespan=24h` returns articles (url, title, seendate, domain, language, sourcecountry, socialimage) from a free, open global news index with 65 languages. Both calls on 2026-11-05 answered 429, which matches reports of a strict per-IP rate (one request every few seconds). **Later**: a good "clean" news source if Google feeds are dropped, but it needs a careful single-flight budget.

### 3.12 Keyed News APIs (reported)

NewsData.io: 200 credits a day, 48 hour delay, commercial use reported as allowed on the free tier (sources disagree). GNews: about 100 requests a day, non-commercial. NewsAPI.org: development only, $449 a month for production. Guardian Open Platform: 500 calls a day, non-commercial, CORS for localhost only. **Later** for NewsData.io, **Reject** for the rest.

### 3.13 Rejected Or Out Of Scope

- **Brave Search API**: the free tier was withdrawn for new users in 2026; new accounts get about $5 of credit a month and need a card (reported). Reject.
- **Reddit `.rss`**: works for personal feed readers, but cloud IPs are commonly blocked and Reddit's 2023 terms make commercial use unclear. Reject for v1.
- **DuckDuckGo scraping, SearXNG**: scraping DDG breaks its terms; SearXNG is AGPL-3.0 and would be a separate self-hosted service (allowed, since it is a process we talk to over HTTP, not code we copy), but it adds a Docker service and upstream engines block it often. Not for this sprint.
- **Instagram, Facebook, X, LinkedIn, TikTok**: no free public read of another account's posts. X's API is paid; LinkedIn has no public read; TikTok's Research API is for academics. Instagram's **Business Discovery** lets a connected Instagram Business account read public business accounts' recent media through the Graph API (official, free), so it is a P2 idea that rides on PostGear's existing Instagram connection and Meta app review.

## 4. The Clean Set

If Arvind prefers not to rely on Google's unofficial feeds at all, the module still works with: Wikimedia top articles (per language), YouTube most popular (official API), Bluesky and Mastodon trends (worldwide), Google holiday calendars (public subscription feeds) plus `date-holidays`, publisher RSS, and GDELT for place-aware news with a strict budget. What is lost: search-interest trends by state, and the breadth of local news in Indian languages. The sprint doc's source adapters make the switch a configuration change, not a rewrite.
