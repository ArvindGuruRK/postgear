# Module 04: Import Pipeline

> **Sprint 12, Clips** | Status: Done (2026-11-18) | Size: L (one full session)
> **Depends on**: [Module 03](module-03-link-engine.md)
> **Stories**: CL-1.3, 1.4, 1.5, 1.6 (server side); foundations for CL-2.1, CL-3.1
> **Next**: [Module 05](module-05-thin-slice-render.md) (Thin Slice), [Module 06](module-06-clips-home-and-videos.md) (Clips Home And Videos)

## Goal

After this module a link or an uploaded file becomes a ready video in the workspace: a light copy for watching and editing, a small sound file for analysis, a strip of pictures, the sound's shape and a poster, all in private storage, with progress in words, cancel, retry, limits, dedup and a notification. Checked with `curl`; the page is Module 06.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names, job stages, notification types).
- Sprint doc: Jobs And Queues, Database (`ClipVideo`, `ClipAsset`, `ClipJob`), API Routes (the video and upload rows), the limits section.
- User stories: CL-1.3 to CL-1.6; section 5, the import and upload rows.
- Research: [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), sections 6, 7, 11 and 13 (the resolver, the charge, the reversal, the race cases, the sentence per limit); [`05-editor-and-render.md`](../research/05-editor-and-render.md), "FFmpeg Roles" (the proxy settings, the filmstrip, the peaks); [`04-link-import-and-fetch.md`](../research/04-link-import-and-fetch.md), progress parsing and the error list; [`02-libraries.md`](../research/02-libraries.md), the upload rows (Uppy with its S3 plugin); [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md), the rights record and the crafted-upload risk.
- Code: Module 02's `PrivateStorage`, `ClipJobsService`, `job-progress.ts`, `withScratch`, `probeFile`; Module 03's `Downloader`; `apps/api/src/modules/media/media.service.ts:115-218` (the order: check, store, write the row, clean up on failure); `apps/api/src/modules/entitlements/` from Module 01 (`EntitlementResolver`, `UsageService`, the refusal exception); `apps/api/src/modules/discover/ideas.repository.ts` (the `serializable()` helper); `apps/worker/src/activities/analytics.activities.ts` (heartbeats); `apps/api/src/modules/notifications/notifications.types.ts`; `.claude/skills/temporal-workflow/SKILL.md`, `.claude/skills/new-api-module/SKILL.md`.

## Design

### 1. Limits (Through The Resolver And The Usage Meter)

There is no table of clip limits in this module and no `clipLimitsFor`. Every number comes from `EntitlementResolver` and every allowance is charged through `UsageService`, both built in Module 01. A small `ClipLimitsGuard` (a thin adapter, so the call sites read well) answers "may this workspace bring in this video" in this order, and each refusal is the 402 with its `code`, whole-number `details` and its sentence from research 12 section 13:

| Order | Check | Key | Refusal code |
|---|---|---|---|
| 1 | The feature is on for this plan | `clips.enabled` | `clips_not_in_plan` |
| 2 | The probed length is at most the plan's longest video | `clips.max_video_minutes` | `clips_video_too_long` |
| 3 | Video space: `SUM(ClipAsset.bytes)` for the workspace (a gauge) plus the estimate stays under the limit | `clips.storage_gb` | `clips_storage_full` |
| 4 | The import minutes meter is **charged** with the probed length in minutes (a 61 minute 30 second video costs 61.5) | `clips.import_minutes_per_month` | `clips_minutes_used` (renamed from `clips_hours_used`) |
| upload only | The declared size is at most the cap, and the real size again at `complete` | `clips.upload_max_gb` | `clips_upload_too_big` |

- **The charge is idempotent and reversible.** The `ClipJob` id is made in the service before the charge, and the key is `clips.import:<jobId>`, so a double click, a retried request or a replayed workflow carries the same key and charges once. A retry of a FAILED video creates a new job and so a new key. The service reverses the charge in a `finally` if the rows were never written, and **in full** when the import fails, is cancelled, or is refused by the post-download checks (`importInspect`: not a video, no video stream, too long). It does not reverse on a later delete of a finished import (that would allow an import and delete loop). The hourly maintenance backstop of Module 19 reverses any charge older than an hour whose job does not exist.
- **Limits travel with the job.** The worker never resolves entitlements. The API copies what the activities need into the job input at creation: `limits { maxVideoMs, storageBytes, retentionDays }` and the `priority` read from `clips.queue_priority`. A plan change mid-import does not alter a running job.
- **Concurrent imports.** `clips.concurrent_imports` is read when a job is started (`ClipJobsService.start`, Module 02): if the workspace already has that many IMPORT jobs running, the new one stays QUEUED, is not refused, and its card says "Waiting for its turn". The reconcile and the end of any job start the next one, highest `priority` first, then oldest.
- **Retention** is not a refusal: `importStore` sets `expiresAt` from `limits.retentionDays` (Module 19 keeps it moving).
- **Storage race.** Two big imports can both pass the start check. `importStore` rechecks the gauge against `limits.storageBytes`; the loser fails with `clips_storage_full` and its charge is reversed. The overshoot is bounded by `clips.concurrent_imports`.
- `GET /clips/status` returns the resolved `limits` and the meters from the entitlement snapshot (import minutes and AI minutes: `used`, `limit`, `remaining`, `cycleEnd`) plus the storage gauge (`usage.storageBytes`).

### 1b. How Long It Will Take (`etaSeconds`)

Every job view carries `etaSeconds` (null when unknown), so the cards can say "about 4 minutes left". `estimateEtaSeconds(samples, prior)` is a pure function in `packages/video-engine/src/jobs.ts`: from the last few `{ at, progress }` points it takes a rolling average of progress per second, and projects the rest; below 5 percent, or for a stage that reports no number (a YouTube range fetch), it answers null, and before there are enough points it uses `prior`, the median duration of the last 20 finished jobs of that kind in the workspace. The job service keeps the samples in memory per job (the events service already re-reads the row every 750 ms) and writes nothing extra to the database. The estimate may rise as well as fall; the UI rounds up to whole minutes and shows nothing under 30 seconds.

### 2. Routes

- `POST /clips/videos` `{ url, rightsConfirmed }`: recognise and probe again on the server (the cache makes it instant; never trust a `LinkInfo` from the browser), refuse without `rightsConfirmed: true` (`rights_required`), run the checks of section 1, then in a serializable transaction look for a live video with the same `platform` and `externalId`: found, answer 200 `{ video, existing: true }` (and nothing is charged); else create `ClipVideo` (IMPORTING, the rights fields from the signed-in user, `rightsTextVersion` from a constant beside the sentence) and a `ClipJob` (IMPORT, input `{ videoId, link, limits, priority }`), charge the import minutes with the job's id, start it, answer 201.
- Uploads, three calls: `POST /clips/videos/uploads` `{ name, bytes, mimeType }` checks the size against `clips.upload_max_gb` and the storage gauge (and the plan's feature switch), creates the video row (platform UPLOAD, IMPORTING) and a storage upload, and answers `{ videoId, uploadId, partSize }`; `POST .../:uploadId/parts` `{ partNumbers }` answers signed part addresses; `POST .../:uploadId/complete` `{ parts }` completes it, records the ORIGINAL asset with its real size and starts the IMPORT job with input `{ videoId, originalKey }`. An upload not completed in 24 hours is aborted by the cleanup.
- `GET /clips/videos` (newest first, page size 24, `sort`), `GET /clips/videos/:videoId` (the video, a playing address for the proxy that expires in 6 hours, the filmstrip and waveform addresses, the latest job, and its clips), `POST .../retry` (FAILED only; a new job, the rights record kept), `POST .../cancel` (IMPORTING only), `DELETE .../:videoId` (soft delete of the row, `deletePrefix` of its files, its unexported clips removed; Module 06 shows the confirm).
- View mapping in the service (`toVideoView`): never a storage key, never a tool's text; `error.message` is one of our sentences.

### 3. The Workflow (`clipImportWorkflow`, `postgear-media`)

Activities, each heartbeating and reporting through `jobProgress`, all inside one `withScratch`-style folder per attempt:

| Step | Stage and progress | What it does |
|---|---|---|
| `importFetch` | `fetching`, 0 to 70 | Link: `downloader.fetchProxy` (720 for videos up to two hours, 480 above). Upload: `privateStorage.getToFile` of the ORIGINAL |
| `importInspect` | `preparing`, 72 | `probeFile` before anything else opens the file; refuse `upload_not_video`, no video stream, or a length over `limits.maxVideoMs`; write the facts (`durationMs`, `width`, `height`, `fps`, `hasAudio`). **For an upload** the length was not known at the start, so the import minutes are charged here through the internal route `POST /internal/clips/jobs/:jobId/charge-import` (internal token, the same `UsageService.consume` and the same key `clips.import:<jobId>`); a refusal (`clips_minutes_used`) fails the job with its sentence and deletes the uploaded file |
| `importNormalise` | `preparing`, 72 to 85 | If the file is already H.264 with AAC, constant frame rate and at or under the target height: remux with the index first. Else encode to that (the settings in research 05). Uploads keep their ORIGINAL as well |
| `importDerive` | `preparing`, 85 to 97 | In one FFmpeg pass where possible: the analysis sound (16 kHz mono), the filmstrip (160 by 90 tiles, ten by ten per sheet, one picture every 2, 5 or 10 seconds so a video never needs more than about 1,200), the waveform peaks (20 a second, one byte each), the poster (the frame at a tenth of the way in) |
| `importStore` | `preparing`, 97 to 100 | Recheck the storage gauge against `limits.storageBytes`; `putFile` each result, a `ClipAsset` row for each with `bytes` and `meta`, then the video READY with `expiresAt` from `limits.retentionDays`, the job DONE, and a `clip_video_ready` notification row |

- A failure at any step: delete what was stored for this attempt, mark the job FAILED and the video FAILED with one sentence, **reverse the import minutes charge** (`UsageService.reverse`, key `rev:<entryId>`, through the internal route so the worker never holds the ledger), write `clip_video_failed`. Non-retryable types (the list in the contract) do not retry.
- Cancel: the API sends the cancel signal; the workflow cancels the running activity (it sees the abort at its next heartbeat and `runTool` kills the process tree), stored files are deleted, the charge is reversed in full, the job is CANCELLED and the video row is soft deleted.
- A video with no sound: `hasAudio = false`, no analysis sound and an empty waveform; nothing fails.
- Disk: `assertFreeDisk` before `importFetch` with the size from `LinkInfo` when known.
- Formats: the waveform and filmstrip `meta` shapes are types in `packages/video-engine/src/assets.ts` so the web reads them without guessing.

### 4. Notifications

Add `clip_video_ready` and `clip_video_failed` to the catalogue (in-app only, no email), with the title sentence and a link to the video page. The worker writes the rows directly, as publishing does.

### 5. Tests

- Engine: `estimateEtaSeconds` (a steady job, a stalled one, below 5 percent gives null, the prior is used at first, never negative).
- API: limits through a fake resolver (each refusal and its code and sentence, with whole numbers), the import minutes charge (charged once for two identical requests, refused past the allowance with the typed 402, reversed when the job fails, is cancelled or is refused by `importInspect`, **not** reversed after a delete of a finished import, the cycle window), the upload charge at `importInspect` through the internal route, the concurrent import cap (the extra job stays QUEUED and starts when one ends, higher priority first), dedup under two concurrent imports (the second answers `existing`), the rights refusal, the upload start, parts and complete flow against the local private storage, retry and cancel state rules, tenancy and schema specs for every route, the view mapper (no keys, no tool text).
- Worker: each activity with fakes (a fake `Downloader`, a fake `runTool` that writes small files), the FFmpeg argument builders as snapshots, the tile-interval chooser, the failure cleanup, the cancel path. One integration test under `CLIPS_SIMULATION=true` that imports the 3 minute sample for real with FFmpeg and checks every asset exists and the facts are right (skipped when FFmpeg is missing).

## Scope

**In**: limits through the resolver and the import minutes meter (charge and reversal), `etaSeconds`, the video and upload routes, the import workflow and its five activities, cancel and retry, dedup, the rights record, the two notification types, asset meta types.
**Out**: the page and upload UI (06), the sharp range and render (05), highlights (16), downloads (18), expiry cleanup (19).

## Tasks

- [x] `ClipLimitsGuard` over the resolver; the import minutes charge with key `clips.import:<jobId>` and its reversals; `limits`, meters and `usage.storageBytes` in `GET /clips/status`.
- [x] `estimateEtaSeconds` and `etaSeconds` on every job view.
- [x] The concurrent import cap and priority order; the internal charge and reverse routes.
- [x] `POST /clips/videos` with the server-side probe, rights, limits, dedup.
- [x] The three upload routes on `PrivateStorage`.
- [x] List, get (with signed addresses), retry, cancel, delete; the view mapper.
- [x] `clipImportWorkflow` and its activities; the FFmpeg argument builders; asset meta types.
- [x] Failure cleanup and the cancel path.
- [x] Notification types and rows.
- [x] The simulation integration test.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/worker/jest.config.js clips
npx jest --config packages/media-tools/jest.config.js
```

## Done When

- Under simulation, `POST /clips/videos` with the Twitch simulation link and `rightsConfirmed: true` leads to a READY video in under a minute, with five assets in the private bucket and five `ClipAsset` rows whose sizes add up to the usage the status route reports.
- The job's event stream shows `fetching` then `preparing` with rising numbers, then `done`.
- The same link again answers `existing: true` and starts nothing.
- Without `rightsConfirmed` the answer is 422 `rights_required`.
- A cancel during `fetching` ends within a few seconds and leaves no object under the video's prefix.
- A text file uploaded as `video.mp4` ends FAILED with "This file is not a video we can read. Use MP4, MOV, MKV or WebM." and FFmpeg was never given the file.
- The bell shows "Your video is ready".
- The import minutes meter in `GET /clips/status` rose by the video's length after the import, and fell back after a cancelled or failed one; importing the same link again charged nothing; a workspace with too few minutes left gets 402 `clips_minutes_used` with its sentence.
- While a job runs its view carries `etaSeconds` once it is past 5 percent.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin, by `curl` or the console:

1. Import the YouTube simulation link. Watch `GET /clips/jobs/<id>/events`: steps and numbers, then done.
2. `GET /clips/videos/<id>`: READY, a length, a playing address. Open that address in a tab: the video plays and can be scrubbed.
3. The MinIO console: `postgear-clips` has the video's folder with five files.
4. Import it again: `existing: true`.
5. Start the 10 minute stream sample and cancel at once: the folder is gone and the list no longer has it.
6. The bell has "Your video is ready" for the first one.
7. `GET /clips/status`: the import minutes used went up by 10 after the stream sample and back down after the cancel. In psql, `SELECT kind, units, "idempotencyKey" FROM "UsageEntry"` shows the charge and its reversal.

## Handoff

Module 05 reads the PROXY asset for the player and the ORIGINAL (uploads) or the link (others) for the sharp range. Module 06 draws the Videos tab from these routes and builds the upload UI on the three upload calls. Module 07 reads the filmstrip and waveform `meta`. Module 16 reads the ANALYSIS_AUDIO asset. Module 19 uses `expiresAt` and `lastUsedAt` and backstops uncharged-job reversals. Module 06 draws `etaSeconds` on its job cards and the import minutes meter.
