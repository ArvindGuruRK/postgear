# Sprint 5 — Completion Checklist & Test Guide

Companion to [sprint-05-scheduling-and-publishing.md](../sprint-documents/sprint-05-scheduling-and-publishing.md).
Status as of **2026-10-11**.

Sprint 5 started from stubs: `apps/worker/src/index.ts` printed a TODO, every
workflow and activity file was an empty function, `apps/api/src/modules/scheduling/`
held a `.gitkeep`, and the Calendar and Queue pages were `return null`. Temporal
was named in `project_structure.md` and `.env.example` but nothing ran it.

The **[Pre-existing]** things worth not re-testing: the `Post` row model and its
`State` enum (Sprint 4), the providers and their error classes (Sprint 3), the
composer's queue validation (Sprint 4), and the design-system components.

**All five Definition of Done items are met and were exercised live** against a
real Temporal server, with the worker killed and restarted mid-wait. The
platform call itself ran against a stand-in (see [§1.4](#14--publish-simulation-why-it-exists)),
because the seeded channels hold fake tokens; everything around it is real.

---

## Prerequisites

```bash
docker compose up -d          # Postgres, Redis, MinIO — and now Temporal + its UI
npm install
npm run db:generate
npm run db:migrate            # no new migration: Post.error / releaseURL and the Errors
                              # and Notifications tables were already in the schema
npm run db:seed               # now also seeds four posts in four states
```

Then, in one terminal:

```bash
npm run dev                   # docker compose up -d, then API (:3001), worker and web (:3000) together
```

or one process per terminal: `npm run dev:api`, `npm run dev:worker` (new),
`npm run dev --workspace=@postgear/web`.

The Temporal web UI is at <http://localhost:8233>: every scheduled post is a
workflow there, with its timer, signals and retries laid out.

`.env` gained three variables (all defaulted in `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `TEMPORAL_HOST` / `TEMPORAL_NAMESPACE` | `localhost:7233` / `default` | Where the API signals and the worker polls |
| `WORKER_MAX_CONCURRENT_PUBLISHES` | `5` | Posts one worker publishes at once |
| `PUBLISH_SIMULATION` | `false` | Publish to a stand-in instead of real platforms — set to `true` locally; refused in production |

Seeded posts on `seed-demo-org` (re-seeding resets them):

| Post | State | Why it is there |
|---|---|---|
| "Tomorrow we open the doors…" (thread, LinkedIn + X) | `QUEUE` tomorrow 10:00 | Something to drag, publish now, and watch |
| "Yesterday: the first post…" (LinkedIn) | `PUBLISHED` | The success treatment, with a permalink |
| "This one never made it…" (X) | `ERROR` needs reconnect | The failure treatment, matching the X channel seeded broken |
| "Draft: ideas for next week" (LinkedIn + Instagram) | `DRAFT` | The draft treatment; movable anywhere |

---

## 1. The worker and its workflows (Tasks 1 and 3)

| # | Item | Status |
|---|---|---|
| 1.1 | `docker-compose.yml`: Temporal (`auto-setup`, SQL visibility in the shared Postgres) + UI on :8233 | ✅ [New] |
| 1.2 | `packages/scheduling` — the pure API↔worker contract: workflow/signal names, deterministic ids, retry policy, publish-status JSON | ✅ [New] |
| 1.3 | `apps/worker`: real Temporal worker, one task queue, graceful shutdown, waits for Temporal at boot | ✅ [New] |
| 1.4 | `postPublishWorkflow` — durable sleep until `publishDate`, re-reads the row on every wake, `publishNow` / `wake` / `cancel` signals | ✅ [New] |
| 1.5 | Retry policy as data: 30 s → 1 → 2 → 4 min, five attempts, each recorded for the UI | ✅ [New] |
| 1.6 | Error branching at the activity boundary: Retryable → policy; RefreshToken → refresh once, then `needs_reconnect`; BadBody → `rejected`; scopes → `needs_permissions`; disabled/unconfigured/disconnected → `channel_unavailable`; an attempt cut off mid-call → `interrupted` | ✅ [New] |
| 1.7 | `tokenRefreshWorkflow` — refreshes 30 min before `tokenExpiration`, re-reads after every sleep, stops and flags on failure | ✅ [New] |
| 1.8 | `maintenanceWorkflow` — every 15 min, every queued root row and refreshable channel gets its workflow (an idempotent `start`; never a wake, which would grow every sleeping workflow's history) | ✅ [New] |
| 1.11 | Signals honoured *during* the publish: a move or unqueue while the policy is backing off cancels the attempt and the wait starts over | ✅ [New] |
| 1.12 | Exactly-once guard across a crash mid-call: an `in_flight` marker before the platform call, heartbeats every 15 s, an 11-minute graceful shutdown, and a retry that finds the marker fails as `interrupted` instead of posting twice | ✅ [New] |
| 1.9 | `Post.error` holds structured status (`retrying` with next attempt / `failed` with reason); `Errors` and `Notifications` rows written | ✅ [New] |
| 1.10 | Publish simulation (`PUBLISH_SIMULATION=true`) with `[simulate:…]` directives | ✅ [New] |

### 1.12 — what a crash in the middle of a platform call does

The one thing a durable timer cannot make safe is the platform call itself: a
worker killed *after* LinkedIn accepted the post but *before* the row was
written would, on retry, post it again. So the activity writes an `in_flight`
marker on the root row just before the call and replaces it with the outcome
after; heartbeats let Temporal notice a dead worker within a minute; a graceful
stop waits for an in-flight call to finish; and a retry that finds the marker
left behind by an earlier attempt does not post — it fails as **interrupted**,
which the queue shows as "Interrupted mid-publish — check the account before
retrying". Better a post a person has to check than one that went out twice.

### 1.4 — the database is the truth; signals only wake

The workflow never trusts its own memory of when to publish. It reads the row,
waits until that time or until a signal, then **reads the row again** before
acting. So a reschedule, a move to drafts, a delete or a channel disconnect need
the API to do nothing more than write the row and send `wake` — and a missed
signal only delays the correction to the next wake-up; it can never publish a
time the row no longer holds. "Post now" is the one signal with meaning of its
own. Wakes are *counted*, not flagged, so one arriving while the row is being
read still interrupts the wait that follows.

The reference wakes with a `poke` and otherwise trusts the workflow's memory;
on edit it terminates and restarts the workflow. PostGear's one-workflow-per-root
with a deterministic id (`post-publish:<rootRowId>`) makes every operation a
single idempotent `signalWithStart`, with no listing and no terminate.

### 1.4 — publish simulation, why it exists

Nothing about the scheduler can be exercised locally against real platforms: a
fresh clone has no developer apps, and the seeded tokens would all 401. The
stand-in replaces **only the final HTTP call**; the Temporal timer, the retry
policy and its backoff, the status written for the queue, the refresh branch and
its `refreshNeeded` flag all run for real. A post can ask for a failure:

| Directive in the text | Stand-in behaviour |
|---|---|
| `[simulate:429]` | `RetryableError` every attempt (ends as `retries_exhausted` after 5) |
| `[simulate:429x2]` | Fails attempts 1 and 2, then publishes |
| `[simulate:401]` | `RefreshTokenError` → refresh branch → `needs_reconnect` |
| `[simulate:400]` | `BadBodyError` → `rejected` at once |
| `[simulate:403]` | `NotEnoughScopesError` → `needs_permissions` |
| `[simulate:slow:5]` | Five seconds, then publishes |

Validation still runs against the **real** provider's rules. The env schema
refuses the flag when `NODE_ENV=production`.

**How to test:**

```bash
cd apps/worker && npx jest
```

Expect **33 passed** across five suites. `post-publish.workflow.test.ts` runs the
real workflows against Temporal's time-skipping test server (downloaded on
first run) with mocked activities: waits then publishes; post-now interrupts a
30-day wait; cancel; wake re-reads and skips a post that left the queue; two
transient failures then success; five failures → `retries_exhausted`; dead
token → refresh → publish; refresh fails → `needs_reconnect`; rejected content
fails at once; a publish whose own write failed is recorded by the retried
activity; token refresh loop and its failure exit.

```bash
cd packages/scheduling && npx jest     # 7 passed: backoff, status round trip, in-flight marker, ids
```

---

## 2. The API's scheduling trigger (Task 2)

| # | Item | Status |
|---|---|---|
| 2.1 | `SchedulingService`: `schedulePublish`, `publishNow`, `cancelPublish`, `ensureTokenRefresh`, `status()` — all best-effort | ✅ [New] |
| 2.2 | Every post save syncs the scheduler: queued roots woken/started, drafted roots cancelled, dropped channels cancelled | ✅ [New] |
| 2.3 | `PUT /posts/:group/schedule` (reschedule; ERROR → QUEUE; past refused for queued; published locked) | ✅ [New] |
| 2.4 | `POST /posts/:group/publish-now` (QUEUE/ERROR → now; published channels untouched) | ✅ [New] |
| 2.5 | `GET /posts/calendar?from&to` (≤ 62 days) and `GET /posts/queue` (state, channel, dates, sort, pages of 20) | ✅ [New] |
| 2.6 | `GET /scheduling/status` — reachable? worker polling? retry policy | ✅ [New] |
| 2.7 | Channel connect / entity selection / manual refresh start or wake the token-refresh loop; disconnect cancels the drafted posts' workflows | ✅ [New] |
| 2.8 | Per-channel `state`, `releaseURL`, `publishStatus` on every post the API returns | ✅ [New] |

### 2.1 — a scheduler outage never fails a save

Every scheduler call returns whether it reached Temporal and logs
`scheduling.unavailable` when it did not. The row is already written; the
worker's maintenance loop (§1.8) reconciles it within fifteen minutes, and the
status pill (§3) says "Scheduler unreachable" in the meantime. This is the
difference between a post that is late and a person who could not save.

**How to test — the whole flow against the real stack** (API, worker with
`PUBLISH_SIMULATION=true`, Temporal). Verified today, in this order:

| Step | Verified result |
|---|---|
| `GET /scheduling/status` | `reachable: true, workerOnline: true`, the policy `30000 / 2 / 600000 / 5` |
| `GET /posts/queue` | 4 seeded posts, soonest first, per-channel states and `publishStatus` |
| `GET /posts/calendar?from=…&to=…` (11 days) | the same 4; a 334-day range → **400** |
| Create a `QUEUE` post **2 minutes out** (LinkedIn) | **201**; `post-publish:<rootId>` Running in Temporal |
| Create `[simulate:429x2]`, then `POST …/publish-now` | queue shows `retrying` attempt 1, then attempt 2 ~30 s later, then **PUBLISHED** ~60 s after that |
| `POST …/publish-now` on the seeded thread (LinkedIn + X) | within seconds: LinkedIn **PUBLISHED** with permalink; X **ERROR** `needs_reconnect` (refresh branch ran, fake token could not refresh); group reads `ERROR` with "Published to 1 of 2 channels" |
| `PUT …/schedule` on the draft → Nov 20 | **200**, still `DRAFT` |
| `PUT …/schedule` a queued post into the past | **422** "…Use "Post now"…" |
| `POST …/publish-now` on a draft | **422** |
| `PUT …/schedule` on the published post | **409** locked |
| Create a post **3 minutes out**, then `taskkill` the worker process mid-wait; restart it ~2 min later | the two posts whose timers had fired while it was down published **within 4 s of the restart**; the third published **at its time**; **each exactly once** (one `Notifications` row per post, one `releaseId`) |

The `Errors` table held exactly the two simulated 429 attempts and the X
reconnect failure; `Notifications` held one "Published to…" per success and
one "Could not publish…" for X.

```bash
cd apps/api && npx jest src/modules/posts src/modules/channels src/modules/scheduling
```

Expect **81 passed**: the scheduling service against a fake Temporal client
(idempotent ids, post-now signal, missing-workflow cancel, unreachable → false
then reconnect, status), plus Sprint 4's posts and channels suites, which still
pass with the new fields.

---

## 3. Calendar and queue (Task 4)

| # | Item | Status |
|---|---|---|
| 3.1 | `/[orgId]/calendar`: month / week / day views, Monday weeks, viewer's local time, URL-synced (`?view=&date=`) | ✅ [New] |
| 3.2 | Drag-and-drop reschedule (dnd-kit; grip handle; optimistic move, reverted on refusal) | ✅ [New] |
| 3.3 | Past slots textured and undroppable; "+" on a future slot opens the composer with `?at=` prefilled | ✅ [New] |
| 3.4 | Post card: time, state badge, colored edge by tone, preview, channel avatars with per-channel status dots | ✅ [New] |
| 3.5 | Detail dialog: per-channel standing, retry/failure messages, permalinks, Edit / Reschedule / Post now (or Retry now) / Delete | ✅ [New] |
| 3.6 | Reschedule dialog with the channels' configured posting times as one-click suggestions | ✅ [New] |
| 3.7 | Channel filter pills; live refresh while a post in view is publishing or retrying | ✅ [New] |
| 3.8 | `/[orgId]/queue`: state tabs, channel / date-range / direction filters in the URL, rows grouped by day, pagination | ✅ [New] |
| 3.9 | Queue row: time, state, the worker's own status line ("Attempt 2 of 5 failed · next try 10:32"), permalink, actions menu | ✅ [New] |
| 3.10 | Scheduler status pill on both pages: online / no worker / unreachable, with an explanation | ✅ [New] |
| 3.11 | `Badge` gained a `success` variant (the one new design-system token use); shown in the playground | ✅ [New] |
| 3.12 | Composer accepts `?at=` and defaults the publish time to it | ✅ [New] |

### 3.2 — why the grip, not the card

Making the whole card the drag handle turns Space and Enter — which open a
button — into drag starts for keyboard users, and a tap into an ambiguous
gesture. The card body opens the details; a separate grip drags, and is also
what dnd-kit's keyboard sensor binds to. The Reschedule dialog is the precise
keyboard path.

### 3.4 — one vocabulary for "how is this post doing"

`components/posts/post-status.ts` turns four database states into the six
situations a person sees — draft, scheduled, **publishing** (queued and due),
**retrying** (the worker is backing off), published, failed (with "Published to
1 of 2 channels" for a partial) — and the card, the row and the dialog all read
it, so none can disagree.

```bash
cd apps/web && npx jest
```

Expect **34 passed**: calendar date maths (Monday weeks, six-week grids,
drop keeps time-of-day / minutes, past slots, composer time for a clicked slot),
post status presentation, queue filter URL round trip, and Sprint 4's composer
suite.

```bash
npm run test:e2e -- e2e/calendar.spec.ts e2e/queue.spec.ts
```

`calendar.spec.ts`: the seeded posts across the three views with the status
pill; **drag-and-drop moves a post to the next day and the API records the new
time**; the detail dialog + Reschedule to a typed time; a clicked slot opens the
composer at that time. `queue.spec.ts`: ordering and the state tabs; "Post now"
moves a post to the current minute; delete removes it for every channel.

---

## Definition of Done — evidence

| DoD item | Evidence |
|---|---|
| A post scheduled 2+ minutes out publishes automatically with no client alive | §2: the 2-minute post published on time with no browser involved; the timer lives in Temporal, not in any process of ours |
| Killing and restarting the worker mid-wait loses or duplicates nothing | §2: three posts across a kill/restart, each published exactly once, two of them within seconds of the restart |
| A simulated 429 triggers a visible retry with backoff, not an immediate failure | §2: `[simulate:429x2]` showed `retrying` attempt 1 then 2 in the queue, then published; backoff 30 s → 60 s as the policy states |
| "Post Now" on a queued post publishes within seconds | §2: the seeded thread's LinkedIn channel published within ~3 s of the request; X failed for the right reason |
| Drag-and-drop reschedule updates the actual publish time | §3 / `calendar.spec.ts`: the API's `publishDate` equals the drop target, and the workflow is woken to read it |

---

## Deviations from the sprint document, and why

| The document said | What shipped | Why |
|---|---|---|
| Versioned workflow names when logic changes | One version, with the rule written at the top of the workflow file | No logic has changed yet; the discipline is documented where the next change will be made |
| Reference's `poke` signal | `wake` (re-read the row), `publishNow`, `cancel` | A wake that re-reads makes reschedule/delete/disconnect a single idempotent call each; `publishNow` is the one signal that carries intent |
| Reference terminates and restarts the workflow on edit, found by search attribute | Deterministic workflow id per root row; `signalWithStart` everywhere | No listing, no terminate race, no custom search attributes — and therefore no Elasticsearch in docker-compose |
| Token refresh "~30 min before `tokenExpiration`" | Exactly that, plus a 6-hour floor between refreshes | A provider that returns a token with no later expiry would otherwise loop immediately |
| "Study `apps/frontend/.../calendar.tsx`" (react-dnd, dayjs) | dnd-kit (already a dependency) and hand-written date maths | One drag library in the app, and `startOfWeek` is not worth a date library on the page |

---

## Review findings fixed before closing (2026-10-11)

Three subagents reviewed the sprint — a code review of the diff, a visual
review of both screens in both themes and at phone width, and a run of the
browser suite. What they found, and what changed:

| Finding | Fix |
|---|---|
| A worker killed between the platform call and the row write could post twice on retry | §1.12: in-flight marker, heartbeats, graceful shutdown, `interrupted` |
| The reconcile loop *woke* every sleeping workflow every 15 min, growing its history until Temporal would terminate a weeks-out post | Reconcile now `start`s only; "already started" is the expected answer |
| A reschedule, unqueue or "post now" during a retry backoff was accepted by the API and ignored by the workflow | The publish phase watches for signals and cancels the attempt (§1.11) |
| "Retry now" on a post whose channel had since been disconnected left it "Publishing" forever | `channel_gone` now fails as `channel_unavailable`; disconnect drafts failed rows too |
| A transient error during a token refresh flagged the channel as needing reconnection | Transient refresh errors are rethrown for Temporal's retry; only a refusal flags |
| An unknown failure after a successful refresh was reported as `needs_reconnect` and flagged a healthy channel | Reported as `unexpected`, channel left alone |
| A half-published post (one channel out, one failed) offered Edit/Delete/drag that the API refuses with 409 | Reschedule moves only the pending channels; the UI locks Edit/Delete once any channel has published |
| Scheduler calls had no deadline; a half-open connection could hang a save | Five-second deadline on every call; discarded connections are closed |
| The worker's activity cap rationed *every* activity, so slow uploads could starve the quick reads other timers needed | Many activity slots, one semaphore around the platform call (`WORKER_MAX_CONCURRENT_PUBLISHES`) |
| Queue paging had no tiebreaker; the count loaded every row | Group id breaks ties; count by `groupBy` |
| Two concurrent saves could abort each other's serializable transaction and return a 500 | A create retries three times on a serialization failure |
| A superadmin with no active workspace hit a 500 (`org.id` of undefined) on every org route | The guard's superadmin bypass requires a resolved workspace; otherwise 403 |
| **The focus ring never painted — on any component since Sprint 0.** Tailwind v4's bare `outline` only re-reads the variable `outline-none` set to `none` | `focus-visible:outline-solid` in all 63 uses; rule §8 corrected; `auth.spec.ts` asserts the ring's style and width |
| Hour labels and dates rendered in the server's locale, so React reported a hydration mismatch and re-rendered the tree (dropping the theme class on the queue page) | Locale-dependent parts render after mount (`useMounted`); the server sends a skeleton |
| The week/day grid's "open at 7:00" scrolled the whole page, hiding the header | Scrolls its own container only |
| Phone-width week and month grids collapsed to unreadable slivers | Both scroll sideways inside their frame (§11) |
| Past-slot halftone texture invisible in dark mode (`bg-halftone` mixed from `--color-outline`, which stays near-black) | Mixed from `--color-ink`, which flips with the theme — also fixes `Panel` and `Progress` in dark |
| Dialogs full-bleed on phones; a busy hour stretched the whole week row; the "+" covered a card's corner and added 168 tab stops; draft tone invisible in dark; `bg-primary` inside a dialog; reschedule dialog opened on a past time with no message | All addressed: `w-[calc(100%-2rem)]`, "+N more" at 3 per hour in week view, "+" bottom-right and out of the tab order, draft edge from `ink`, dialog surface `bg-secondary`, next-hour default with a `FormErrorMessage` |
| Several e2e specs created posts before signing in, took bounding boxes of off-screen slots, or matched Radix's duplicated toast text | Specs corrected; the onboarding spec's `calendar$` URL assertions widened for the calendar's `?view=&date=` |

## Known gaps

1. **Platforms have still not received a real post from the scheduler.** The
   stand-in replaces the final HTTP call. Switch `PUBLISH_SIMULATION` to
   `false` once a real channel is connected (see docs/local-testing-guide.md §7);
   nothing else changes.
2. **One task queue.** The reference shards a queue per platform for per-platform
   concurrency limits. `WORKER_MAX_CONCURRENT_PUBLISHES` caps a worker; per-account
   platform limits are left to each provider's own `fetch` retry.
3. **Recurring posts, RSS auto-posting, bulk scheduling, "find best slot"** are
   P1 and not built. The workflow structure does not preclude them: a repeat is a
   child workflow started after a publish, as the reference does.
4. **Keyboard drag on the calendar is coarse** (dnd-kit's arrow-key sensor moves
   by pixels across a grid). The Reschedule dialog is the precise keyboard path.
5. **Timezone is the viewer's browser.** `User.timezone` (a UTC offset) is not
   consulted; the Sprint 1 note about an IANA zone column still stands.
6. **Notifications are written, not shown.** `Notifications` rows exist for every
   success and failure; the bell UI is Sprint 8's.
7. **The worker is a second encryption boundary.** Refreshing a token writes a
   new ciphertext from `apps/worker/src/activities/integration.activities.ts`,
   following the channels repository's rules; it is documented there.
8. **The E2E suite is still not in CI** — unchanged from Sprint 2.
9. **A published post cannot be deleted**, by design (Sprint 4's rule). The
   queue's "Post now" browser test therefore leaves one published row behind
   per run when a worker is running; re-seeding resets the demo workspace.
10. **`[simulate:401]` flags the real seeded channel** as needing reconnection
    (the stand-in cannot refresh a fake token), so later posts to it fail until
    the next `npm run db:seed`. That is the branch working as designed; it is
    just worth knowing before trying it.

---

## Files changed in this pass

**Added — `packages/scheduling`** (new workspace package)
- `src/{index,workflows,retry-policy,publish-status}.ts`, `src/scheduling.test.ts`

**Added / rewritten — worker**
- `src/index.ts`, `src/config/env.ts`
- `src/lib/{temporal,publisher,publish-details,media-url}.ts` (+ three test files)
- `src/activities/{index,deps,publish.activities,integration.activities,maintenance.activities}.ts`
- `src/workflows/{index,post-publish.workflow,token-refresh.workflow,maintenance.workflow}.ts`, `post-publish.workflow.test.ts`
- Removed the Sprint 6/7 stubs (`analytics-sync`, `seo-crawler`, `crawler`, `notification`) and `queues/`

**Added — API**
- `src/modules/scheduling/{scheduling.module,scheduling.service,scheduling.controller}.ts`, `scheduling.service.spec.ts`

**Added — web**
- `src/components/calendar/{calendar-context,calendar-view,calendar-toolbar,channel-filter,month-view,time-grid-view,calendar-slot,post-card}.tsx`, `calendar-math.ts` (+ test)
- `src/components/queue/{queue-view,queue-row}.tsx`, `use-queue.ts`, `queue-filters.ts` (+ test)
- `src/components/posts/{post-detail-dialog,reschedule-dialog,delete-post-dialog,post-actions-menu,scheduler-status,channel-stack}.tsx`, `use-post-actions.ts`, `post-status.ts` (+ test)

**Added — infra, tests, docs**
- `infra/temporal/dynamicconfig/development-sql.yaml`
- `e2e/calendar.spec.ts`, `e2e/queue.spec.ts`
- this file

**Modified**
- `docker-compose.yml` — Temporal + UI, Postgres healthcheck
- `apps/api` — posts repository (`findRoots`, `listCalendar`, `listQueue`, `reschedule`, `publishNow`; release/error columns), service, controller, schema, messages, module; channels service/repository/module (refresh loop hooks, disconnect cancels); `env.ts`; `app.module.ts`; posts/channels specs
- `apps/web` — calendar and queue pages; `types/post.ts`; composer `?at=`; playground badge row
- `packages/ui/src/components/badge.tsx` — `success` variant
- `packages/db/prisma/seeds/index.ts` — four posts
- `tsconfig.json`, `apps/api/tsconfig.json`, `apps/worker/{package.json,tsconfig.json}`, root `package.json` (`dev:worker`), `.env.example`
