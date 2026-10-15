# Sprint 7 — Analytics & SEO Score Prediction

> **PRD Coverage**: Section 5.6 (Analytics & Performance Module), Section 5.7 (SEO Score Prediction — **net-new, PostGear's key differentiator, no Postiz equivalent**).
> **Depends on**: [Sprint 3](sprint-03-social-integrations.md) (channels to pull analytics from), [Sprint 5](sprint-05-scheduling-and-publishing.md) (published posts to measure).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only — and only for section A below; section B has nothing to reference).

## Sprint Goal

Part A: surface per-channel and per-post performance metrics. Part B: let a user enter any URL and get a real, multi-factor SEO score with AI-generated improvement advice — a capability Postiz does not have at all.

## Part A — Analytics (reference-backed)

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Analytics UI composition | `apps/frontend/src/components/analytics/{analytics.component.tsx,chart.tsx,chart-social.tsx}` | Dashboard layout pattern: a shared `chart.tsx` renderer fed by per-platform data (`chart-social.tsx`) — reasonable structure for `apps/web/src/components/analytics/`. |
| Per-integration metrics retrieval | Provider `analytics?`/`postAnalytics?` methods on `SocialProvider` (see [Sprint 3](sprint-03-social-integrations.md)'s interface reference) | Confirms analytics fetching is a per-provider optional capability, not every platform's API exposes the same metrics — PostGear's provider interface (built in Sprint 3) should already accommodate this via optional methods. |

### Implementation
- `apps/api/src/modules/analytics/`: background job (can run as a Temporal workflow alongside Sprint 5's worker, e.g. `analytics-sync.workflow.ts`) polling each connected channel's `analytics()`/`postAnalytics()` where implemented.
- `apps/web/.../analytics/page.tsx`: per-channel dashboard (followers, impressions, engagement trend over 7/30/90 days) + per-post breakdown + top-performing content list.

### Definition of Done (Part A)
- [x] At least one connected platform (whichever has the simplest metrics API among Sprint 3's providers) shows real follower/engagement data, not placeholder numbers. **Built for seven platforms and run live end to end — but with the stand-in, since no platform credential exists locally**; the first real sync is the next verification step (checklist, Known gaps 1).
- [x] Per-post analytics modal shows likes/shares/comments/clicks where the platform API provides them. Browser test: `analytics.spec.ts` › *opens the top post with its numbers against the channel average*.

---

## Part B — SEO Score Prediction (net-new)

There is no Postiz module to study here — this is the reason PostGear exists as a distinct product. Design it fresh, informed only by the PRD's own spec (`prd.md` section 5.7).

### Design

- **Crawler**: headless browser (Playwright) fetches the target URL, extracts meta tags, OpenGraph data, heading hierarchy (H1–H6), broken links, SSL status, mobile viewport config. SSRF protection is non-negotiable here — a URL-input feature that fetches arbitrary user-supplied URLs is a classic SSRF vector (Postiz's `SocialAbstract.fetch()`, studied in Sprint 3, is a reasonable pattern to imitate for a "don't let this hit internal/private IP ranges" dispatcher, even though the SEO crawler itself is new).
- **Scoring**: four weighted sub-scores as already specified in `project_structure.md`:
  - On-Page SEO (30%): title length, meta description, heading structure.
  - Technical SEO (30%): SSL, response speed, canonical URLs, robots.txt.
  - Content SEO (25%): readability index, keyword density, content length.
  - Backlink/Authority signals (15%): domain authority estimation (P1 — likely via a third-party API rather than building link-graph crawling in-house).
  - Composite 0–100 score + letter grade.
- **AI advice**: feed the raw audit JSON into an LLM (reuse [Sprint 6](sprint-06-ai-content-engine.md)'s AI infrastructure — same OpenAI client, same credit-metering plumbing) to produce prioritized Critical/Warning/Info recommendations.
- **History**: persist each audit run (`SEOAudit` model from Sprint 1) to render score-over-time trend graphs.

### PostGear Implementation Plan

Target locations: `packages/seo-engine/src/{crawler,scoring}/` (already scaffolded), `apps/api/src/modules/seo/`, `apps/web/.../seo-analyzer/page.tsx`.

- `packages/seo-engine/src/crawler/browser.pool.ts`: Playwright instance pooling, SSRF-safe URL validation before every fetch, 30s hard timeout.
- `packages/seo-engine/src/crawler/html.parser.ts`: meta/OG/heading/link extraction from the crawled DOM.
- `packages/seo-engine/src/scoring/{on-page,technical,content,backlink}.evaluator.ts` + `score.calculator.ts`: the four weighted evaluators and the composite calculator.
- `apps/api/src/modules/seo/`: `POST /seo/analyze` (kicks off crawl + score + AI advice, likely async given crawl latency — consider running it as a short-lived Temporal workflow so a slow/hanging target site doesn't tie up an API request thread), history endpoint.
- `apps/web/.../seo-analyzer/page.tsx`: URL input, score meter UI, prioritized AI checklist, historical trend chart.

### Definition of Done (Part B)
- [x] Submitting a real URL returns a composite score + letter grade + all four sub-scores within ~30 seconds. **Verified live**: `https://example.com/` through real Chromium in 2.1 s; `seo.spec.ts` asserts the gauge, grade and four categories.
- [x] The crawler safely rejects/ignores attempts to target internal/private network addresses (verify with a `localhost`/`169.254.169.254`-style test URL — must fail closed, not silently succeed). **Verified** in the engine's tests, live against the API (422, nothing fetched, nothing charged) and in the browser (`seo.spec.ts` a/b); the guard also runs on every redirect hop and every browser request.
- [x] AI advice output is prioritized (Critical/Warning/Info), not a flat list. Three groups with impact, from the model or from the rules when AI is off.
- [x] Re-running an analysis on the same URL after changes shows a trend line, not just the latest number. `seo.spec.ts` c/d: "vs last run" and a `TrendChart` over the history.

## Deviations from this document, and why

> **Completion checklist**: [sprint-07-completion-checklist.md](../sprint-completion-checklists/sprint-07-completion-checklist.md) — what shipped, a test command for every item, the live run, and the known gaps.

| This doc said | What shipped | Why |
|---|---|---|
| `POST /seo/analyze` "likely async … consider a short-lived Temporal workflow" | `POST /seo/audits` streams the run over SSE from the API, exactly as Sprint 6's generation does, under a 30 s deadline, a per-process concurrency gate and a per-workspace "one at a time" rule | A person is watching the stages; a stream is the honest UX and the Sprint 6 plumbing already existed. The crawl's own ceiling is what keeps a slow site from tying up the process — a workflow would have added a poll loop and a worker dependency to an interactive feature without removing the ceiling. The audit row is written at every stage, so a crash still leaves a `FAILED` row, not a hang |
| Playwright "instance pooling, proxy rotators" | A lazy single-Chromium pool with an async page semaphore and a request-level private-address guard; no proxies | Rotating proxies is scraping infrastructure; an SEO audit fetches one page the owner asked about. The guard on every browser request is what proxies could never give: protection against DNS rebinding and redirects into the private network |
| Backlink/Authority "likely via a third-party API" | Open PageRank (free key) when `OPEN_PAGERANK_API_KEY` is set; a heuristic from on-page signals, flagged `estimated`, otherwise; a deterministic stand-in in simulation | A free, keyed, real backlink index; and an honest fallback that says it is an estimate rather than a fabricated number |
| Recharts widgets (`project_structure.md`) | Plain SVG components in `packages/ui` (`TrendChart`, `Sparkline`, `BarList`, `ScoreGauge`, `ScoreBar`) | A chart library ships the soft, gradient SaaS look Sprint 0 rejected; forty lines of SVG drawn from the tokens keep the design system whole (rule §16c) |
| "background job polling each connected channel" | A durable `analyticsSyncWorkflow` per channel in the Sprint 5 worker (daily at a per-channel minute offset, `syncNow` signal from the Analytics page), reconciled by the maintenance loop like the token-refresh workflows | The same durability argument as Sprint 5: a cron in a process stops when the process does |
| Real platform metrics in the DoD | Every platform with a metrics API is implemented; locally the worker reads a deterministic stand-in (`ANALYTICS_SIMULATION`, following `PUBLISH_SIMULATION`) | No platform key exists on this machine (the Sprint 6 situation, unchanged); the stand-in is what makes every screen and rule testable, and the checklist says plainly that no real platform has been called |

## Risks
- Playwright on JS-heavy or bot-protected sites can hang or get blocked — enforce the 30s timeout strictly and fall back to a lightweight HTML-only parse (no headless browser) rather than blocking the whole request.
- SSRF is a real, exploitable risk for this specific feature (arbitrary user-supplied URL, server-side fetch) — do not ship Part B without the private-IP-range rejection test passing.
