# Module 15: Scale, Cost And Deploy

> **Sprint 13, Clips AI** | Status: Done 2026-11-28, one session (a real Groq call, the real `large-v3-turbo` benchmark and real job speeds wait for the owner) | Size: L (one full session)
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
| **One vCPU second** (the unit every processor row uses) | $0.0000072 (a CCX33 at EUR 0.1891 an hour for 8 dedicated vCPU, at $1.10 a euro: $0.026 a vCPU hour). Railway's about $20 a vCPU month (about $0.027 a vCPU hour) agrees. A job's processor seconds are the seconds it ran times the vCPU its slot takes (export 4, listening on our box 8, faces and voice 4, the rest 2) | Research 07 section 1 (Hetzner, verified 2026-11-14; the euro rate is the header's assumption); the hosting guide section 1 (Railway, reported 2026-11-12). The table in code: `apps/api/src/modules/clips/costs/clip-prices.ts` (`CLIP_PRICES_DATE` 2026-11-14) |
| Import and render (FFmpeg) | **Export**: a 60 s 1080p clip at the measured worst case (481 CPU seconds) is $0.0035; at real time on a 4 vCPU slot (240 vCPU seconds) $0.0017. A Fade montage costs about 1.5 times a Cut one. The file is held a month: a 30 MB export is $0.00045. **Import**: storage from research 07 (0.9 GB of proxy at 2 Mbit/s per source hour) is $0.0135 a month kept; the import's processor seconds are **measured in the real test**: import a one hour and a ten minute video on the media box and read the Import row of the Costs tab (seconds it ran times 2 vCPU; its files' bytes from `ClipAsset`) | Sprint 12 Module 05 benchmark (i7-10850H, FFmpeg 9.0.2, times real time: Fullscreen 720p 3.04, 1080p 1.92, 1080p60 1.18; Blurred 720p 2.14, 1080p 1.28, 1080p60 0.87; peak memory 192 to 785 MB); Sprint 12 Module 15 (gameplay and heavy text: 720p 3.27, 1080p 1.81, 1080p60 1.06); research 07 section 2 (481 CPU seconds, measured 2026-11-17; storage assumption); Module 11 Decision Log (Fade 1.5 times). Sprint 12 Module 20 proved the worker image but took no timing, and no import was ever timed |
| Listen (own machine or hosted lane) | **Our box, `small`**: 0.17 s per second of sound on 4 processors, so about 0.68 vCPU seconds a second: $0.018 an audio hour ($0.0003 a minute). **Our box, `large-v3-turbo`** (the default): at 1 times real time on 8 vCPU, $0.21 an audio hour ($0.0035 a minute) when the box is billed for it, nothing extra on a box already running; its real speed is **measured in the real test**: listen to the one and ten minute recordings with `large-v3-turbo` on the media box and read the Listen row (seconds it ran times 8 vCPU). **Groq turbo**: $0.04 an audio hour ($0.00067 a minute), at least 10 s billed a request (`large-v3` $0.111); the Listen row prices the seconds Groq heard | Module 02 benchmark (i7-8750H, 4 processors, faster-whisper `small` int8, the 60 s Verideck narration: 10.2 s, 5.9 times real time, 4.7 s to load, 997 MB peak); research 07 sections 1 and 2 (Groq, verified 2026-11-14; the turbo speed is research 04's assumption) |
| Read (the language model) | 16,000 tokens in and 2,500 out a pass for each source hour read, two passes: 32,000 in and 5,000 out an hour, $0.021 an hour on `gpt-4.1-mini` ($0.40 in, $1.60 out per 1M), $0.0057 on `gpt-6-luna`. Plus the run's own FFmpeg time (2 vCPU, less the time it waited for its listening job). Every Read cost is marked estimated: the AI engine returns no token counts. The real count is **measured in the real test**: run Find Clips over one hour of a real stream with the real model and compare OpenAI's usage for that hour with the Find Clips row | Research 07 sections 1 and 2 (prices verified 2026-11-14; the token counts are its assumption: 150 words a minute, 12,000 transcript tokens, overlap, a second pass for titles and reasons). Module 05's runs were simulated and priced 8 AI Minutes for the whole stream, no tokens |
| Look For Action | **Motion**: 3 vCPU minutes a source hour (2 fps, 360p), $0.0013. **Vision check** (when on): at most 12 bursts of 4 stills, 48 pictures at 500 tokens: 24,000 tokens in, at most $0.0096 a run on `gpt-4.1-mini`. The real OpenCV decode time is **measured in the real test**: Look For Action on a one hour stream on the media box, read in the Find Clips row (the run's seconds include the motion and stills steps) | Module 06 under simulation (recorded levels, no real decode): the motion measure ran in 36 ms, 28 stills cut in 44 ms; research 07 section 2 (motion and vision assumptions; vision $0.01 to $0.05 for 20 candidates of 4 frames); `CLIP_STILL_BURSTS_MAX` and `CLIP_STILLS_PER_BURST` in `@postgear/scheduling` |
| Faces | 3 vCPU minutes a source hour at 5 fps (10 ms a frame at 360p), $0.0013; a tenth of that on clip ranges only, which is how Find Faces runs. The real detector's speed is **measured in the real test**: Find Faces on a real face-cam clip on the media box, read in the Find Faces row (seconds it ran times 4 vCPU) | Research 07 section 2 (assumption). Module 07 took no benchmark: the real detector never ran here |
| Translate, voice | **Translate**: about 200 tokens in and 200 out a minute (150 words a minute), $0.0004 a minute, $0.024 an hour on `gpt-4.1-mini`. It runs inside the API (no `TRANSLATE` job), so the Costs tab shows its AI Minutes but no job cost; its real tokens are **measured in the real test**: translate a ten minute transcript with the real model and read OpenAI's usage. **Voice**: Kokoro on our media box, no hosted bill; at most 24 vCPU seconds for a 2 s line, $0.00017. The real Kokoro time is **measured in the real test**: Make The Voice for a 10 s line on the media box, read in the Make The Voice row (seconds it ran times 4 vCPU) | Module 03 (translation inline, charged `clips.ai:translate:*`); research 07 section 2 (150 words a minute); Module 09's browser pass (a 2 s voice on the sound row in 6 s, end to end) |
| **Emote export** (`EMOTE`) | A few processor seconds: at most six encodes per size at 112 px or below, no AI. Files held a day: the largest 7TV set (3.9 MB APNG) costs under $0.000002. The encode time is **measured in the real test**: Make An Emote from a real face-cam clip, read in the Emote row (seconds it ran times 2 vCPU) | Module 14 spike (local samples, 3 s at 112 px, GIF KB per ladder step: talk 145.5 to 37.4, busy `life` 327.7 to 117.2, Verideck 75.6 to 24.2, green screen 170.4 to 44.2; stills 3 to 22 KB; 7TV at 256 px up to 1421.7 KB GIF, 670.5 KB WebP, 3893.9 KB APNG). No timing was taken |
| **Schedule picture** | One headless-browser screenshot in the API's existing exporter and one Twitch call (cached 10 minutes, free). It makes no Clips job and no meter charge (Module 14), so it is not on the Costs tab. Its time is **measured in the real test**: time the export request in the API log on the staging box and price it at the vCPU second above | Module 14 (the Studio exporter, not metered); Twitch calls are free |
| **Editor seat** | No compute of its own. The cost is what the Editor uses from the workspace's meters (already counted) plus support. The seat price is a plan decision (`members.editors_max`). The Costs tab's Usage By Person table shows each Editor's charged, reversed and net units from `UsageEntry.meta.by` (a reversal counted under its charge's person); times the meter's Cost Per Unit, that is the Editor's cost. Support time is not measured | Module 14 sets `meta.by`; `GET /operator/clips/costs` groups by it |
| Storage and egress | **R2**: $0.015 a GB a month, the first 10 GB free, egress free. Each job records its GB months: import files and exports a month, previews, downloads and emotes a day. A source hour (0.9 GB proxy, 0.3 GB clips) is $0.02 a month kept. **Railway volume** (only if files sit on Railway): $0.15 a GB a month, $0.05 a GB served. **S3**: neither research 07 nor the hosting guide prices it; if S3 is chosen, its price is read from its page then, dated | Research 07 sections 1 and 2 (R2 verified 2026-11-14); the hosting guide sections 1 and 6 (R2: 10 GB, no egress fees; Railway reported 2026-11-12) |

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

- [x] `ClipQueueService.estimate`, `JobView.waiting`, the labels.
- [x] `ClipSchedulerService` and `nextJobs`; priority read from the job, concurrency from the entitlement, aging; Module 11's and Sprint 12's limits folded in.
- [x] Cost per job, the price table, the admin route with usage totals; the cost table above filled from the benchmarks (rows a real machine must time say "measured in the real test").
- [x] The AI Minutes audit: the rate table test, one test per AI route, the no-free-route test, the copy fixes.
- [x] `TRANSCRIBER=auto`, the threshold, the fallback; the privacy text (a real Groq call is not made: it needs `GROQ_API_KEY` and the owner's word).
- [x] The deletion proof tests (including emote exports); the three sentences (in Clip Setup's privacy hint: the app has no privacy page).
- [x] `Dockerfile.media` (both targets), the compose profile.
- [x] The deployment guide section, `.env.example`, the keys guide.
- [x] `verify-change`; update the Progress table and the Decision Log.

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
