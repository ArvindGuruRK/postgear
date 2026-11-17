# Module 15: Scale, Cost And Deploy

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 02](module-02-transcription.md), [Module 07](module-07-face-detection-and-detect-camera.md), and Sprint 12 Modules 01 and 19 (the entitlement registry, the usage meter and the operator screen)
> **Stories**: CA-10.1, CA-10.2, CA-10.3
> **Decisions**: D13-02 (AI Minutes, settled and built in Sprint 12 Module 01), D13-03 (the hosted lane), D13-11 (no always-on graphics card)
> **Next**: [Module 16](module-16-hardening-e2e-closeout.md)

## Goal

After this module the AI layer is honest about waiting and about money, and ready to run somewhere other than a laptop. Queued work says it is waiting and for roughly how long; the queue order follows each workspace's `clips.queue_priority` entitlement with a fair scheduler; every job records what it cost; every AI step is audited so its price is shown before the press and charged in the right rate; transcripts, face files and emote exports provably go when their video goes; and the Python service has a real image, a place in the deployment guide, and a documented ladder from "one box" to "a rented graphics card".

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder (the benchmarks in the Progress notes of Modules 02 and 07, and Sprint 12's Module 05).
- User stories: CA-10.x; section 5 (queued, the service is not running).
- Sprint doc: the AI Minutes meter and the entitlement keys.
- Research: [`07-cost-deploy-and-risks.md`](../research/07-cost-deploy-and-risks.md), all of it: cost per hour for each job, the three usage scenarios, the deployment shapes with prices, queues and fairness, privacy. [`05-python-media-service.md`](../research/05-python-media-service.md), the image and the note that a graphics card scaled to zero cannot wait on a Temporal queue, so a rented-by-the-second card is a provider called by the always-on worker. [`04-transcription.md`](../research/04-transcription.md), the break-even table. Sprint 12's [`12-plans-entitlements-and-usage.md`](../../sprint-12/research/12-plans-entitlements-and-usage.md), sections 7 (the meter), 13 (what Clips reads where) and 14.2 (the changes this module makes).
- Code: `packages/entitlements/` and `apps/api/src/modules/entitlements/` (`EntitlementResolver`, `UsageService`), `packages/video-engine/src/pricing.ts` (`aiMinutesCost` and the rate table), `apps/api/src/modules/billing/plans.ts`; Sprint 12's `ClipJobsService`, `scheduling.service.ts` (how jobs are started), Module 11's fair queue; `infra/docker/` (the worker image from Sprint 12 Module 20, `Dockerfile.media` from Module 01); `docs/launch-readiness/` (the hosting guide); `apps/api/src/modules/admin/` (the operator module of Sprint 12 Module 19).

## Design

### 1. Waiting, In Words

- An estimate: `ClipQueueService.estimate(kind, orgId)` counts the jobs of that kind ahead (QUEUED and RUNNING on the same queue, ordered as the scheduler will start them) and multiplies by a rolling average of how long that kind takes for each minute of video (kept in Redis, updated when a job ends). It answers `{ position, aboutSeconds }`, rounded to whole minutes.
- `JobView` gains `waiting: { aboutSeconds } | null` while QUEUED. The web's `stageLabel` shows "Waiting for our turn, about 4 minutes" (or "less than a minute"). When the workspace's priority is `low`, a second line: "Plans with a higher priority go first."
- This covers every Clips job, Sprint 12's included, and the new `EMOTE` jobs of Module 14.

### 2. Priority From The Entitlement, And Fairness

- Module 11 introduced a small scheduler for renders. Generalise it: `ClipSchedulerService` owns starting QUEUED jobs for each queue (`media`, `render`, `media-py`). Rules, as one pure function with tests (`nextJobs(queued, running, limits)`):
  1. Never more than the queue's concurrency.
  2. At most N running per workspace: from `clips.concurrent_imports` for imports (read through the resolver when a job is chosen, so an operator edit applies within about a second), and 2 on `media`, 1 on `render`, 1 on `media-py` for the rest.
  3. Among the workspaces waiting, higher `ClipJob.priority` first (`high`, then `normal`, then `low`). The priority is **copied from `clips.queue_priority` into the job when it is created** (Sprint 12 Module 02), so a plan change in the middle of a render does not alter a running job.
  4. Within a priority, the workspace that has waited longest; within a workspace, the oldest job first.
  5. Aging: a `low` job that has waited more than 30 minutes is treated as `normal` for ordering, so a busy paid queue cannot starve a Free workspace forever.
- It runs when a job ends (the worker's finish path calls an internal route) and from the maintenance pass as a safety net.
- The Sprint 12 limits (Module 19) are already read through the resolver; `limits` here is the one place that combines them with the queue constants.

### 3. What Each Job Cost, And The Cost Table

- When a job ends, record in its `output`: seconds of video worked on, seconds it ran, which provider did it, and for hosted calls the units billed (audio seconds, model tokens, pictures). `ClipCostService.estimate(job)` turns that into a cost in US cents from a small price table in config (research 07's figures, each with its source and date), and stores it in `output.costCents`.
- An operator route, `GET /admin/clips/costs?from&to`, sums cost by job kind and by workspace and, next to it, the `UsageEntry` totals by meter and workspace (units charged, reversed, net), so Arvind can see whether the AI Minutes allowances cover the bills. Add it to the operator Usage tab if Sprint 12 Module 19's screen has room, otherwise the route and a table in the admin area. Nothing about cost is shown to users.

The cost table this module fills in, one row per thing that costs us something. Figures come from the benchmarks, never from guesses: a cell the benchmarks cannot fill stays "measured in the real test" with the method.

| Cost driver | What we pay | Where the number comes from |
|---|---|---|
| Import and render (FFmpeg) | Processor seconds and storage per minute of video | Sprint 12 Module 05 and 20 benchmarks |
| Listen (own machine or hosted lane) | Processor seconds per minute, or the hosted bill per audio minute | Module 02 benchmark, the provider's price page |
| Read (the language model) | Tokens in and out per run | Module 05 simulated and real runs |
| Look For Action | Processor seconds, plus pictures if the vision check is on | Module 06 |
| Faces | Processor seconds per minute | Module 07 benchmark |
| Translate, voice | Model tokens; voice processor seconds | Modules 03 and 09 |
| **Emote export** (`EMOTE`) | A few processor seconds: at most six encodes per size at 112 px or below, no AI | Module 14 spike (three real clips); recorded here when known |
| **Schedule picture** | One headless-browser screenshot in the API's existing exporter and one Twitch call (cached 10 minutes) | Studio exporter timing; Twitch calls are free |
| **Editor seat** | No compute of its own. The cost is what the Editor uses from the workspace's meters (already counted) plus support. The seat price is a plan decision (`members.editors_max`); this module shows the usage per Editor through `UsageEntry.meta.by` | Module 14 sets `meta.by`; the cost route groups by it |
| Storage and egress | Per GB held, per GB served, in the S3-compatible bucket pair | The provider's price page (R2 or S3), dated |

### 4. The AI Minutes Audit (Prices Shown Before The Press)

The decision is made (D13-02): the meter is **AI Minutes**, built in Sprint 12 Module 01 (`clips.ai_minutes_per_month`, `UsageService.consume`, reversal entries, the chip "38 of 300 AI minutes left"). The `clip_*` credit types are not created. This module only checks the work, in tests that fail if it drifts:

- **The rate table.** `packages/video-engine/src/pricing.ts` holds `aiMinutesCost(step, amount)` with the rates of the brief: `signals` 0.25 per video minute (free when the run also listens), `listen` 1.0 (minimum 2), `read` 0.25, `action` 0.5, `translate` 0.25 per clip minute, `voice` 1 per 1000 characters; price is `ceil(minutes x rate)`, at least 1; following the speaker, Detect Camera, Upload SRT, hook titles, emote exports and schedule pictures are free. A table test pins every rate and the rounding and the minimums, so a drive-by edit fails the build.
- **One test per AI route** (Find Clips, Add Captions, Clip Setup, Look For Action, Translate Captions, Make The Voice, Auto-Edit Video if it spends): the price the preview endpoint returns equals what `consume` charged, the button label and the Summary card show the same number ("Find Clips (15 AI Minutes)"), a "too few minutes left" state disables the press with the missing number, the idempotency key is the documented one (`clips.ai:<step>:<jobId>`), a repeat press with the same key charges once, a failure before output reverses in full, and a partial run reverses the unused share. A stretch already listened to charges nothing for listening.
- **Where the number shows.** The Clips page chip, Clip Setup's Summary, the Captions tab, and the billing page's plan card list the allowance (`previewTier`). The AI credits chip for text and images stays separate and is labelled "AI credits"; the clip chip is labelled "AI minutes".
- **No route runs free.** A test calls every worker-facing and internal route without the web path and asserts none starts AI work without a `consume` entry.
- **Queue priority** is Section 2. The Free plan's line in Section 1 comes from the entitlement, not from the plan name.
- Where the user stories or the UX blueprint still say "credits" about Clips AI, fix the copy and note it in the Decision Log.

### 5. The Hosted Fast Lane

- Module 02 built the Groq binding. Here it becomes a rule, not an all-or-nothing switch: `TRANSCRIBER=auto` uses our own machine for stretches under a threshold and the hosted one above it (`TRANSCRIBE_HOSTED_ABOVE_MINUTES`, default from Module 02's benchmark: the length at which our machine would take longer than about ten minutes), when a key is set. Hosted failures fall back to our own machine.
- The privacy text (the page Sprint 12 Module 19 created, or the app's privacy page) names the provider when the lane is on.
- An optional second lane, documented and stubbed but not switched on: a provider that calls a graphics card rented by the second (research 07 compares three with prices). The always-on Python worker would call it; the queue `postgear-media-gpu` stays reserved for an always-on card (D13-11). Write the steps into the deployment guide; do not build the provider (Module 17 item 19).

### 6. Deleting What AI Made

- Transcripts and face files are `ClipAsset` rows under the video's prefix, so Sprint 12's `removeVideo` deletes them. Prove it: a test that creates a video with a transcript (two languages), a face file, stills and a made voice, removes the video, and asserts no object and no row is left, including word fixes (they live in the asset's `meta`).
- Emote exports live under `clips/<orgId>/exports/<jobId>/`. Prove they are swept by the retention rule of Sprint 12 Module 19 the same way other export files are, and that a removed video's emote jobs lose their signed links.
- The made voices and library items that belonged only to removed clips are swept by Sprint 12's unused-library rule.
- The help or privacy page gains three plain sentences: what is made from a video (text of what is said, where faces are), that faces are positions and never identities, and that both are deleted with the video.

### 7. Images And The Deployment Guide

- `infra/docker/Dockerfile.media`, finished: a slim target (base packages, for simulation and for running with the hosted lane only) and a full target (the model libraries and a model baked in or fetched into a cache volume at first start; state which and why), a non-root user, a health command, the licences folder. Build both; note their sizes. The worker image of Sprint 12 Module 20 has FFmpeg, yt-dlp, Deno and the fonts and no browser; this module adds nothing to it.
- A `docker compose` profile that runs the media image beside the worker image against the local services, used in the Hand Check.
- `docs/launch-readiness/`: add a section for Clips and Clips AI: the three processes video needs (the media worker, the render worker, the Python service), what each needs in memory and processor from the benchmarks, which can share a box, S3-compatible storage as a requirement, and the ladder from research 07 with the trigger for each step (one box with the hosted lane; a separate media box; a rented card by the second; an always-on card only at thousands of hours a month).
- `.env.example` and the keys guide: every new variable and how to get each key.

### 8. Tests

- `nextJobs` (every rule, including priority from the entitlement, concurrency from `clips.concurrent_imports`, aging), the estimate, cost recording and the admin sums (job cost and usage totals), the rate table, one price test per AI route, the no-free-route test, the `auto` lane (threshold, fallback), the deletion tests, the scheduler started by a job's end.
- Web: the waiting line and the low-priority line; the AI minutes chip and the too-few state.

## Scope

**In**: the waiting estimate, one scheduler with fairness and priority from the entitlement, cost per job and an operator view, the AI Minutes audit, the `auto` fast lane, proof of deletion, images, the deployment guide, the cost table.
**Out**: actually deploying, autoscaling, building the rented-card provider, charging for storage, changing the meter (it is built).

## Tasks

- [ ] `ClipQueueService.estimate`, `JobView.waiting`, the labels.
- [ ] `ClipSchedulerService` and `nextJobs`; priority read from the job, concurrency from the entitlement, aging; Module 11's and Sprint 12's limits folded in.
- [ ] Cost per job, the price table, the admin route with usage totals; the cost table above filled from the benchmarks.
- [ ] The AI Minutes audit: the rate table test, one test per AI route, the no-free-route test, the copy fixes.
- [ ] `TRANSCRIBER=auto`, the threshold, the fallback; the privacy text.
- [ ] The deletion proof tests (including emote exports); the three sentences on the help or privacy page.
- [ ] `Dockerfile.media` (both targets), the compose profile.
- [ ] The deployment guide section, `.env.example`, the keys guide.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips apps/api/src/modules/entitlements apps/api/src/modules/billing apps/api/src/modules/admin
npx jest --config packages/video-engine/jest.config.js pricing
npm run test --workspace=apps/media
npx jest --config apps/web/jest.config.js apps/web/src/components/clips
docker build -f infra/docker/Dockerfile.media --target slim -t postgear-media:slim .
```

## Done When

- A queued job shows "Waiting for our turn" with a rough time, and the low-priority line when it applies.
- With two workspaces queuing, the one with the higher `clips.queue_priority` starts first, neither can hold the queue alone, and a `low` job that has waited 30 minutes is not starved.
- Every finished job has its cost recorded, and the admin route sums it with the usage totals.
- Every AI route's price is shown before the press and equals what was charged; the rate table is pinned by a test; no route starts AI work without a charge.
- A long stretch goes to the hosted lane under `auto` and falls back if it fails.
- Removing a video leaves no transcript, face file, still, word fix or emote export link behind (the tests prove it).
- Both media images build; the compose profile runs captions on a sample through the images.
- The deployment guide says what to run where, and when to move up the ladder; the cost table has a source for every figure.

## Hand Check

1. Queue three Find Clips runs in one workspace: the second and third show the waiting line with a time.
2. In the operator screen set one workspace to `low` and another to `high` priority; start one job from each while a job runs: the `high` one goes first.
3. Open the admin costs route for today: rows by kind and by meter.
4. Check the price before each AI button matches what was charged in AI minutes, and that a failed run gave the minutes back (the chip goes up again).
5. Remove a video with captions: its folder in the private bucket is gone.
6. `docker compose --profile media-image up` (stop the local Python service first): add captions to a sample clip through the image.
7. Read the new section of the deployment guide and the cost table.

## Handoff

Module 16 sweeps and closes. The real-test plan measures real speeds and costs and may move the hosted threshold and the AI Minutes allowances. Module 17 holds the rented-card provider and autoscaling.
