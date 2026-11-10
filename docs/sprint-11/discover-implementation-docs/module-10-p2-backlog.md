# Module 10: P2 Backlog (Only When You Decide)

> **Sprint 11, Discover** | Status: Parked | Size: as picked
> **Depends on**: [Module 09](module-09-hardening-e2e-closeout.md)
> **Rule**: nothing here starts without Arvind's word. Each item is written so it can be a module of its own.

| # | Item | What it adds | Notes |
|---|---|---|---|
| 1 | **Pre-warm in the worker** | The maintenance workflow (every 15 min) calls an internal API endpoint that refreshes the places of workspaces active in the last day, so the first open of the morning is fresh and instant | Reuse the Sprint 10 internal gateway pattern; budgets still apply; no new Temporal schedule |
| 2 | **Competitor polling and "new since you last looked"** | A nightly refresh of every competitor with a count badge on the tab | Same worker hook; a `lastSeenAt` per user per competitor |
| 3 | **Saved items (Ideas)** | A bookmark on any card; an Ideas list; Create Post from it later | A `DiscoverIdea` table (org, user, item snapshot, note); Buffer's Ideas as the placement reference |
| 4 | **Home card "Trending Near You"** | Three trends on Home with Create Post | Reads the same feed endpoint; respects the workspace place |
| 5 | **Instagram Business Discovery** | Competitor rows from public Instagram business accounts through the workspace's own connected Instagram business account (official Graph API) | Needs Meta app review for the permission; only when the workspace has an Instagram Business channel |
| 6 | **Per-user place** | A `DiscoverUserPlace` row so a person's choice follows them across devices | Today it is `localStorage` per org |
| 7 | **Rendered reader fallback** | When Readability finds nothing, render the page in the shared Playwright pool (as the brand extractor does) and try again | Costs CPU; keep the 10 s deadline |
| 8 | **GDELT news source** | Place-aware global news without Google, 65 languages | Strict per-IP limit (both test calls answered 429): single flight and one call per place per hour |
| 9 | **Google Trends CSV via Playwright** | More trends, time windows (4 h, 24 h, 48 h, 7 d) and categories, the way trendspyg's CSV path does | Rate-limit sensitive (8 to 10 sessions in 15 min trip Google); never polled; at most once an hour per country |
| 10 | **Official Google Trends API** | Replace the RSS when the alpha admits PostGear | Apply now; free; application-gated |
| 11 | **SerpApi adapter** | Google News and Trends through a licensed, paid API for workspaces that need it | 250 free searches a month, then $25 a month per 1,000; behind the same `DiscoverSource` interface |
| 12 | **NewsData.io adapter** | A keyed news API with country and language filters (200 credits a day, 48 h delay) | Confirm its commercial terms first |
| 13 | **IP-based first guess** | Country and city from the request IP when the time zone is ambiguous | DB-IP Lite (CC BY 4.0, attribution) or MaxMind GeoLite2 (EULA); monthly file download |
| 14 | **Curated regional festivals** | A checked-in JSON per region (Tamil Nadu: Thiruvalluvar Day, Karthigai Deepam, Tamil New Year...) merged into Festivals | Hand-maintained; dates per year from the state gazette |
| 15 | **Weekly digest email** | "This week where your audience is" with five items and Create Post links | Through the Sprint 8 notifications outbox; respects the email preferences |
| 16 | **Research this competitor** | A Tavily call that summarises a competitor's recent coverage | Only when `TAVILY_API_KEY` is set; costs credits |
| 17 | **Topic interests** | The workspace picks interests (yoga, fintech, ...) and News adds Google News search groups for them | Uses the search feed; cached per query |
| 18 | **Self-hosted Photon or Nominatim** | Type-ahead city search and no dependence on the public instance | A Docker service with a country extract; only when volume justifies it |
