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
- [ ] At least one connected platform (whichever has the simplest metrics API among Sprint 3's providers) shows real follower/engagement data, not placeholder numbers.
- [ ] Per-post analytics modal shows likes/shares/comments/clicks where the platform API provides them.

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
- [ ] Submitting a real URL returns a composite score + letter grade + all four sub-scores within ~30 seconds.
- [ ] The crawler safely rejects/ignores attempts to target internal/private network addresses (verify with a `localhost`/`169.254.169.254`-style test URL — must fail closed, not silently succeed).
- [ ] AI advice output is prioritized (Critical/Warning/Info), not a flat list.
- [ ] Re-running an analysis on the same URL after changes shows a trend line, not just the latest number.

## Risks
- Playwright on JS-heavy or bot-protected sites can hang or get blocked — enforce the 30s timeout strictly and fall back to a lightweight HTML-only parse (no headless browser) rather than blocking the whole request.
- SSRF is a real, exploitable risk for this specific feature (arbitrary user-supplied URL, server-side fetch) — do not ship Part B without the private-IP-range rejection test passing.
