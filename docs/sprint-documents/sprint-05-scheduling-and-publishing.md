# Sprint 5 — Scheduling & Auto-Publishing Engine

> **PRD Coverage**: Section 5.4 (Scheduling & Auto-Publishing Module).
> **Depends on**: [Sprint 3](sprint-03-social-integrations.md) (providers to publish through), [Sprint 4](sprint-04-post-composer-and-media.md) (posts/drafts to schedule).
> **Reference repo**: `D:\rk-personal-projects\postiz-app-main` (study only).

## Sprint Goal

A scheduled post reliably publishes at its target time — surviving server restarts, retrying transient failures with backoff, and supporting an immediate "post now" override — plus a calendar UI to schedule/reschedule visually.

## Reference Study Guide

| Concept | Postiz Reference (study, don't copy) | What to Extract |
|---|---|---|
| Why durable workflows over a plain job queue | `complete_codebase_and_architecture_analysis.md` section 7 (already in this repo) explains the reasoning; source is `apps/orchestrator/src/workflows/post-workflows/` | Core insight: a Redis-backed queue (BullMQ) risks eviction/drift for jobs scheduled weeks out; Temporal's durable `sleep()` survives restarts with zero polling. `project_structure.md` already commits PostGear to Temporal for this reason — this sprint is where that decision gets implemented. |
| Current publish workflow | `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.5.ts` (function `postWorkflowV105`) — confirmed as the **live** version because `apps/orchestrator/src/activities/post.activity.ts` calls `client.workflow.signalWithStart('postWorkflowV105', ...)`. Earlier versions (`v1.0.1`–`v1.0.4`) exist only for in-flight backward compatibility. | Study `v1.0.5` only — it's the current logic. Note the **versioned-workflow-name** pattern: when you change publish logic later, ship it as a new named workflow function rather than mutating the old one, so already-running (long-sleeping) workflows keep executing their original version. |
| "Post now" override | `signalWithStart` + a `poke` signal referenced in the architecture doc's sequence diagram | A running/sleeping workflow can be woken immediately by a signal rather than cancelled and recreated — this is how "Post Now" on an already-queued post should work in PostGear too. |
| Retry/backoff on platform errors | `apps/orchestrator/src/activities/post.activity.ts`, `apps/orchestrator/src/activities/integrations.activity.ts` | Temporal's built-in activity retry policy handles 429/5xx backoff; a 401 (auth failure) instead triggers the token-refresh workflow rather than a blind retry — model PostGear's error branching the same way (retryable vs. needs-reauth). |
| Token refresh workflow | `apps/orchestrator/src/workflows/refresh.token.workflow.ts` | Ties back to Sprint 3's per-provider `refreshToken()` — this sprint is where it actually gets scheduled/executed on a timer. |
| Calendar UI | `apps/frontend/src/components/launches/{calendar.tsx,calendar.context.tsx,time.table.tsx,filters.tsx}` | Month/week/day view + drag-to-reschedule pattern, plus a separate `calendar.context.tsx` for shared state — a clean split between rendering and state worth mirroring structurally in `apps/web/src/components/calendar/`. |
| RSS auto-posting (P1) | `apps/orchestrator/src/workflows/autopost.workflow.ts`, `apps/orchestrator/src/activities/autopost.activity.ts` | Out of this sprint's DoD (PRD marks it P1) — noted here so the workflow structure this sprint builds doesn't preclude adding it later. |

## PostGear Implementation Plan

Target locations: `apps/worker/src/{workflows,activities}/` (Temporal, already scaffolded), `apps/api/src/modules/scheduling/`, `apps/web/src/components/calendar/`, `apps/web/src/app/(dashboard)/[orgId]/calendar/`.

### Task 1 — Temporal wiring
- Stand up the local Temporal server via Sprint 1's docker-compose addition.
- `apps/worker/src/workflows/post-publish.workflow.ts`: PostGear's own publish workflow (single current version — no need to pre-invent a versioning scheme until the first real logic change happens).
- `apps/worker/src/activities/social-publisher.activities.ts`: calls into `packages/social-core` providers from Sprint 3.

### Task 2 — Scheduling trigger from the API
- `apps/api/src/modules/scheduling/`: on "schedule post", start the workflow with `publishDate` as the sleep target; on "post now", signal the workflow (or start with zero delay) rather than bypassing it.
- Retry policy: transient errors (429/5xx) retry with exponential backoff (Temporal activity `RetryPolicy`); 401 branches to the token-refresh workflow from Sprint 3.

### Task 3 — Token refresh workflow
- `apps/worker/src/workflows/token-refresh.workflow.ts`: proactive refresh ~30 min before `Integration.tokenExpiration` (the schema's actual field, per [Sprint 1](sprint-01-foundation-and-data-model.md)), calling the provider's `refreshToken()`.

### Task 4 — Calendar UI
- `apps/web/src/app/(dashboard)/[orgId]/calendar/page.tsx` + `apps/web/src/components/calendar/`: month/week/day views, drag-and-drop reschedule (calls the reschedule endpoint, which internally re-signals or restarts the workflow with the new time), queue list view.

## Definition of Done

> **Completion checklist**: [sprint-05-completion-checklist.md](../sprint-completion-checklists/sprint-05-completion-checklist.md) — what shipped, a test command for every item, the live evidence for each DoD line, and the known gaps.

- [x] A post scheduled for 2+ minutes out publishes automatically without any process being kept alive by the browser/client. **Verified live**: the timer is a Temporal durable timer; the post published on time with no browser open.
- [x] Killing and restarting the worker process mid-wait does not lose or duplicate the scheduled post. **Verified live**: the worker was killed with two timers due while it was down; on restart both posts published within seconds, a third at its time, each exactly once.
- [x] A simulated 429 response triggers a visible retry with backoff instead of an immediate failure state. **Verified live**: `[simulate:429x2]` showed "Retrying · attempt 1 of 5", then attempt 2 after 30 s, then Published after a further 60 s — the policy in `@postgear/scheduling`.
- [x] "Post Now" on a queued post publishes within seconds. **Verified live** (~3 s), including the branch where one channel's token is dead and ends as "needs reconnecting" while the other publishes.
- [x] Drag-and-drop reschedule on the calendar updates the actual publish time. Browser test: `calendar.spec.ts` › *drag-and-drop moves a post to another day and the API records the new time*.

### Added beyond the original scope

- [x] **A pure contract package, `@postgear/scheduling`** — workflow and signal names, deterministic ids, the retry policy as data, and the publish-status JSON — so the API and the worker never import each other.
- [x] **Per-channel publish status in the UI**: "Scheduled / Publishing / Retrying (attempt n of 5, next try 10:32) / Published / Failed (why)", with partial outcomes ("Published to 1 of 2 channels") on the calendar card, the queue row and the detail dialog.
- [x] **A scheduler status pill** on both pages: online / no worker running / unreachable — the one failure that leaves no trace in the data.
- [x] **Publish simulation** (`PUBLISH_SIMULATION=true`) with `[simulate:…]` directives, so the whole engine can be exercised without a developer app; refused in production.
- [x] **A maintenance workflow** that reconciles every queued row and refreshable channel every fifteen minutes, so a scheduler outage during a save delays a post rather than losing it.
- [x] **Reschedule dialog with the channels' configured posting times** as one-click suggestions; a clicked calendar slot opens the composer at that time (`?at=`).
- [x] **Four seeded posts in four states**, so the calendar and queue show every treatment on a fresh clone.

### Deviations from this document, and why

| This doc said | What shipped | Why |
|---|---|---|
| Versioned workflow function names | One version, with the versioning rule written at the top of `post-publish.workflow.ts` | No publish logic has changed yet; the discipline is documented where the next change will be made |
| The reference's `poke` signal, and terminate-and-restart on edit found by search attribute | `wake` / `publishNow` / `cancel` signals against a deterministic id per channel root row | The workflow re-reads the row after every wake, so reschedule, delete and disconnect are each one idempotent `signalWithStart`; no listing, no terminate race, no Elasticsearch |
| Study the reference calendar (react-dnd, dayjs) | dnd-kit (already a dependency) and hand-written local-time date maths | One drag library in the app; `startOfWeek` is not worth a date library on the page |

## Risks
- Temporal has a real operational learning curve (worker deployment, task queues, versioning discipline) — budget extra time here if this is your first time running it. The payoff (no missed posts on restart) is exactly PostGear's core reliability promise, so it's worth the investment rather than falling back to a plain cron/BullMQ approach. **Outcome**: the `auto-setup` image in docker-compose plus one task queue was enough; the worker waits for Temporal at boot, and the first real logic change is the moment to introduce a second named workflow version.
- **Nothing has reached a real platform through the scheduler yet.** The engine was proven against the stand-in; the first connected channel (LinkedIn, per docs/local-testing-guide.md) is where `PUBLISH_SIMULATION=false` gets its first real run.
