# Sprint 12: Completion Checklist & Test Guide

Companion to [sprint-12-clips.md](../sprint-documents/sprint-12-clips.md), the module index
[clips-implementation-docs/README.md](../sprint-12/clips-implementation-docs/README.md)
(Progress table and Decision Log) and the real-test plan
[real-test-plan.md](../sprint-12/real-test-plan.md).
Status as of **2026-11-19**. Branch `sprint-12-clips`, cut from `master`; Modules 01 to 18 pushed
(e3948b0, 6d41791, bcf41f5, 0a16183), Modules 19 and 20 pushed with this checklist (daf7eef); not merged.

Sprint 12 started from nothing for Clips: no video tables, no video tools, no private storage, no
render queue and no Clips screen. Plan limits lived in `apps/api/src/modules/billing/plans.ts` as
hard-coded numbers read by `EntitlementsService`, and the only ledger was the AI `Credits` table
from Sprint 6. The worker served one queue (`postgear-publishing`).

The **[Pre-existing]** things worth not re-testing: the session guards, RBAC and the org cookie
(Sprint 2), Media and the media picker (Sprint 4), the Temporal worker with its retry policy and
maintenance reconcile (Sprint 5), the SSE transport (Sprint 6), the SSRF guard `fetchUrlSafely`
(Sprint 7), billing, the Stripe webhook handler, `BILLING_SIMULATION` and the notifications bell
(Sprint 8), the Studio fonts (Sprint 9), the internal token guard (Sprint 10), and the design-system
components.

**23 of the 25 Definition of Done items are met, and two are met only in part** (a 2 GB
upload was never sent; S3 has never run against a real bucket). Everything was checked in
simulation (`CLIPS_SIMULATION`, `AI_SIMULATION`, `BILLING_SIMULATION`, `PUBLISH_SIMULATION`),
with a browser pass per module and a test per rule. Nothing in this sprint has run against the
real world:

- no real YouTube, Twitch or Kick video, channel list or chat was ever fetched;
- no paid API was called;
- no real Stripe event was sent;
- no S3 bucket was used (local disk and MinIO only);
- the owner mail on operator saves was printed to the API console, never sent.

The real-test plan ([§8](#8-what-remains-for-you)) is the gate to Sprint 13.

---

## Prerequisites

```bash
docker compose up -d                 # Postgres 15, Redis, MinIO, Temporal (:7233), Temporal UI (:8233)
npm install
npm run db:generate
npm run migrate:deploy --workspace=packages/db
#   20261117120000_entitlements_and_usage, 20261117130000_sprint12_clips,
#   20261117140000_sprint12_clip_library_and_channels, 20261119120000_sprint12_clips_retention_and_safety
npm run db:seed                      # adds the 65 PlanEntitlement rows (13 keys x 5 tiers)
npm run clips:doctor                 # FFmpeg 9 with libass, harfbuzz, x264, mp3lame; ffprobe; yt-dlp; Deno
npm run clips:samples                # the local sample videos simulation serves
npm run clips:library:seed           # our own 193 stickers and 92 sounds
npm run operator:grant -- --email demo@postgear.local   # the operator screen for the demo account
npm run dev:api
WORKER_ROLES=publishing,media,render PUBLISH_SIMULATION=true CLIPS_SIMULATION=true AI_SIMULATION=true npm run dev:worker
npm run dev --workspace=@postgear/web
```

The local `.env` keeps `PUBLISH_SIMULATION="false"` for real LinkedIn posts, and dotenv never
overrides a variable the shell already set, so export it as shown for Clips testing.

| Variable | Default | Meaning |
|---|---|---|
| `CLIPS_SIMULATION` | `false` | Links, channels, imports, downloads and chat answer from `packages/media-tools/fixtures/simulation`; refused in production. **Set `true` locally** |
| `CLIPS_PLATFORMS` | `youtube,twitch,kick` | The off switch per platform |
| `CLIPS_URL_SECRET` | empty | Signs `/clips/files/:token` addresses; required in production |
| `CLIPS_PRIVATE_BUCKET` | `postgear-clips` | The private S3 bucket; production refuses the local disk |
| `CLIPS_QUEUE_CEILING` | `500` | Past this many open jobs, new starts answer `clips_busy` |
| `ENTITLEMENTS_SOURCE` | `db` | `seed` answers from the code's seed table (a recovery switch) |
| `OPERATOR_EMAILS` | empty | Production allow-list for `/operator` on top of `isSuperAdmin` |
| `WORKER_ROLES` | `publishing,media,render` | Which of the four queues one worker polls |
| `WORKER_MEDIA_CONCURRENCY`, `RENDER_CONCURRENCY` | `2`, `1` | Media and render slots per worker |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH`, `YTDLP_JS_RUNTIME` | names on PATH | The outside programs |
| `YTDLP_PROXY`, `YTDLP_COOKIES_FILE`, `YTDLP_EXTRACTOR_ARGS` | empty | Ways past a platform's refusal (production only) |
| `YTDLP_SELF_UPDATE` | `false` | Update a copy of yt-dlp in scratch at boot (media role, simulation off) |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `CLIPS_YOUTUBE_API_KEY` | empty | The channel listers; empty falls back to yt-dlp's flat list |
| `CLIPS_TWITCH_CHAT` | `false` | Read Twitch chat for Find Clips; simulation reads a recorded file |
| `CLIPS_LIBRARY_INGEST` and the `CLIPS_*_DIR` and `CLIPS_INGEST_*_OK` group | off | The operator library ingest |
| `OWNER_EMAIL` | empty | Gets a mail on every operator save (console only outside production) |

---

## 1. Plans and allowances: `packages/entitlements`, `apps/api/src/modules/entitlements`

| # | Item | Status |
|---|---|---|
| 1.1 | `PlanEntitlement`, `OrgEntitlementOverride`, `EntitlementChange` and `UsageEntry` tables (`20261117120000_entitlements_and_usage`); `SCHEMA_NOTES.md` explains each | ✅ [New] |
| 1.2 | The key registry: 13 Clips keys with types, units, limits, refusal codes and sentences (`registry.ts`, `messages.ts`); the AI minutes sentence with none left reads "This workspace has used all its AI minutes for this month..." | ✅ [New] |
| 1.3 | The seed: 65 rows (13 keys by FREE, STANDARD, PRO, TEAM, ULTIMATE), idempotent in `npm run db:seed` | ✅ [New] |
| 1.4 | `EntitlementResolver`: override, then plan row, then seed; 15 s cache with a Redis stamp per scope read at most once a second; `GET /entitlements/me` | ✅ [New] |
| 1.5 | `UsageService`: `consume`, `reverse`, `reverseAllFor`, `adjustWithin`; Serializable transactions, P2034 retried three times, P2002 answered as the duplicate; never below zero | ✅ [New] |
| 1.6 | A Stripe-simulated upgrade moves the snapshot a second after the webhook commits (`touchOrgEntitlements`) | ✅ [New] |
| 1.7 | The operator screen `/operator`: Plans, Workspace Overrides, Usage (with Adjust Usage), Change Log; owner mail on save (console only outside production) | ✅ [New] |
| 1.8 | The operator library screen: runs, items, deny list, gaps and credits; Publish Run applies `libraryPublishRefusal` (also the command line's publish) | ✅ [New] |

### 1.9: why every limit goes through the resolver

Plan values change without a deploy (the operator screen writes them), a workspace can have an
override with an end date, and the worker never reads a plan at all: it asks the API's
`/internal/clips/...` routes to charge, reverse, finish and sweep. One reader and one ledger mean
the number a person sees, the number a guard checks and the number the sweep reconciles are the
same number. `limits-audit.spec.ts` fails if a Clips route reads `plans.ts` or a literal.

```bash
npx jest --config apps/api/jest.config.js entitlements admin/entitlements limits-audit plan-change
CLIPS_LEDGER_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js usage.load
```

The second command is the load test against the real Postgres: twenty imports charged at once with
room for three. Expect 3 charged, 17 refused, no 503, the ledger never past the limit or below
zero, and every reversal sent twice at once given back once. Five runs on 2026-11-19 all gave
that. It is skipped in CI (no Postgres service there).

## 2. The engine and packages

| # | Item | Status |
|---|---|---|
| 2.1 | `packages/video-engine`: the clip document and its strict schema, the time map, geometry, layouts, text, stickers, zooms, looks, sound, export plan and fingerprint, downloads, library rules, error sentences, `frameState`, `buildRenderPlan`, `compileFfmpeg` (pure, imports nothing) | ✅ [New] |
| 2.2 | `packages/video-preview`: `PreviewEngine` (two videos, area canvases, the text, sticker, look, zoom and fade layers, `WebAudioLayer`) from the same `frameState` | ✅ [New] |
| 2.3 | `packages/storage`: public media and the private clips space (local and S3), signed `/clips/files/:token` addresses with Range, `clipKeys` with prefix checks | ✅ [New]; **S3 never run against a real bucket** |
| 2.4 | `packages/media-tools`: the runner (argument arrays, no shell, time limits), the doctor, yt-dlp and fixture downloaders, probes, signals (loudness, scene changes, chat), sticker and sound normalising, render execution; the only package allowed `child_process` (`guard.test.ts`) | ✅ [New] |
| 2.5 | `packages/scheduling`: the Clips workflow names, the notices and their sentences, `clipStorageOverLine` rounding like the meter | ✅ [New] |
| 2.6 | `packages/social-core`: video rules per provider, `videoFit` and `videoFitSentence` | ✅ [New] |

### 2.7: the parity tests and CI

The render parity tests (`packages/media-tools/src/render/*parity.test.ts`, 35 tests) render real
frames with FFmpeg and compare them with `frameState`. CI's runner has no pinned FFmpeg with
libass, so they **skip in CI with a warning** and run on every machine that has the tools (the
worker image has them). On 2026-11-19 all 35 passed locally with FFmpeg 9.0.2.

```bash
npx jest --config packages/media-tools/jest.config.js parity
```

## 3. The API: `apps/api/src/modules/clips`, `admin`, `entitlements`

| # | Item | Status |
|---|---|---|
| 3.1 | Links: `recogniseLink`, `POST /clips/links/probe` with breaker, throttle and cache; blocked videos refused with 410 before any fetch | ✅ [New]; **in simulation** |
| 3.2 | My Channels: Helix, YouTube Data, flat and simulated listers; forcing channels `simempty`, `simquota`, `simflaky` | ✅ [New]; **in simulation** |
| 3.3 | Videos: import with the rights tick, resumable uploads probed before use, list, retry, cancel, delete, Download Original | ✅ [New] |
| 3.4 | Clips: create, open, rename, duplicate, delete, more video, layouts, edits with the revision lock, exports, previews, send to the composer, Coming Up | ✅ [New] |
| 3.5 | Find Clips: `GET` and `POST /clips/videos/:videoId/highlights`, one AI minutes charge with its give-back | ✅ [New]; **in simulation** |
| 3.6 | Downloads: create, list, file, Save To Media, delete (row kept as the rights record) | ✅ [New]; **in simulation** |
| 3.7 | Library: stickers and sounds search, favourites, uploads, credits | ✅ [New] |
| 3.8 | Retention and safety: `touchVideo`, the 3 day notice, removal with `Clip.removedAt`, `sweepClips` (notices, expiry, downloads, segments, library, failed imports, charge backstop, storage notice, orphan files, ended overrides, reconcile report), rights removals (`ClipBlockedVideo`, `DELETE /operator/clips/videos/:videoId`, `npm run clips:remove`) | ✅ [New] |
| 3.9 | Limits: `ClipsEnabledGuard` on every controller, the limits guard with one refusal per row, 30 starts a minute per person, `clips_busy` past the ceiling, `timed_out` jobs | ✅ [New] |
| 3.10 | Operator routes: `PlatformAdminGuard` (superadmin, plus `OPERATOR_EMAILS` in production), strict bodies, the 409 conflict, the Change Log, usage adjustments refused below zero (422 `usage_below_zero`) | ✅ [New] |
| 3.11 | Tenancy: 22 id routes answer 404 to another workspace (`clips-tenancy.spec.ts`), plus Coming Up and `/entitlements/me` (`clips-tenancy.security.spec.ts`) | ✅ [New] |

## 4. The worker and its image: `apps/worker`, `infra/docker`

| # | Item | Status |
|---|---|---|
| 4.1 | Four queues by role: `postgear-publishing`, `postgear-media`, `postgear-media-quick`, `postgear-render` | ✅ [New] |
| 4.2 | Workflows: import, segment, render, preview, highlights, download, save download, sticker and sound checks, Media video facts; one activity per heavy job in one scratch folder | ✅ [New] |
| 4.3 | Failure details scrub secrets (`log-redaction.ts`); scratch cleared at boot | ✅ [New] |
| 4.4 | `infra/docker/Dockerfile.worker`: Node 22 bookworm-slim by digest; FFmpeg 9.0.2 GPL static, yt-dlp 2026.10.26 and Deno 2.9.8 by sha256; the font folder rebuilt and matched to the committed manifest; licences in `/licenses`; no browser; non-root uid 10001 under tini; a health check | ✅ [New] |
| 4.5 | The compose profile `worker-image`, which forces every simulation flag on | ✅ [New] |
| 4.6 | `YTDLP_SELF_UPDATE`: updates a copy in scratch at boot, falls back to the image's copy | ✅ [New]; run once for real by the image build (GitHub only) |

### 4.7: the live image proof (2026-11-19)

The host worker was stopped and the image started with
`docker compose --profile worker-image up -d worker`. Its log showed:

- the doctor's ten `[OK]` lines;
- "Video tools are ready.";
- every simulation flag on;
- four `polling "postgear-..."` lines.

The health check read `healthy`. Two jobs then ran through the container:

| Job | Result |
|---|---|
| Kick fixture import | DONE, the video READY at 1280 by 720, 30 fps, 10 minutes, with its poster, proxy, filmstrip, waveform and analysis sound |
| 720p export of a 27 s edited clip | DONE: a 720 by 1280 MP4 of 2.77 MB, loudness evened from -42 to -14 LUFS, saved to Media |

The container was then removed and the host worker restarted. The image is 1.57 GB unpacked
(about 406 MB compressed).

## 5. The screens: `apps/web`

| # | Item | Status |
|---|---|---|
| 5.1 | The Clips page: Create, Streams, Videos, Clips and Downloads tabs; link card; uploads; video cards with live progress; the storage meter and AI minutes chip; My Channels; Try A Sample; Coming Up; the over-limit Alert and sort by size | ✅ [New] |
| 5.2 | The video page: player, I and O, Create Clip, the timeline with filmstrip and sound, Find Clips with picks, scores and reasons | ✅ [New] |
| 5.3 | The editor at `clips/edit/:clipId`, full window: shape dialog, timeline (trim, split, move, snap, zoom), Layouts, Text, Elements, Effects, Audio, Export tabs, autosave with the lock, undo and redo, the shortcuts sheet | ✅ [New] |
| 5.4 | The operator pages under `app/(operator)`: full window, desktop only, `notFound()` for anyone else | ✅ [New] |
| 5.5 | `/legal/copyright` and `/credits/clips` (public) | ✅ [New] |
| 5.6 | Below 1366 px Clips shows "Clips is made for a bigger screen. Open it on a laptop or desktop." (`desktop-only.tsx`) | ✅ [New] |

## 6. Hardening (Module 20)

| # | Item | Status |
|---|---|---|
| 6.1 | The security sweep: a test per line of the Module 20 table in `*.security.spec.ts` and `*.security.test.ts`; ten gaps found and fixed (§[Review findings](#review-findings-fixed-before-closing-2026-11-19)) | ✅ [New] |
| 6.2 | The `security-review` skill on the uncommitted Modules 19 and 20: no finding at confidence 8 or above | ✅ [New] |
| 6.3 | Edge cases: a test per row of the stories' section 5 (`clips-edge-cases.spec.ts`, `clips-edge-cases.test.tsx`, `edge-cases.test.ts` in video-engine, entitlements and the worker); forcing links 900000009 to 900000011, `[simulate:render-fail]`, `[simulate:preview-fail]` and the forcing channels (testing guide §5p) | ✅ [New] |
| 6.4 | Performance: `timeline-performance.test.tsx` (a six hour video draws a screen of ruler marks at any zoom; 50 parts and 100 items redraw a one-item change fast) | ✅ [New]; the hour-long heap run **not done** |
| 6.5 | Accessibility review (WCAG 2.2 AA) and the heuristic look pass in dark, Classic light and Lilac at 1366 and 1920 px: `docs/design-patterns/clips-heuristic-review-2026-11-19.md` (51 of 53 ticked) | ✅ [New]; no screen reader run, no 200% zoom check |
| 6.6 | `e2e/clips.spec.ts` and `e2e/operator.spec.ts` | ✅ [New]; green under simulation on 2026-11-19: `clips.spec.ts` **19 of 19** (the 18 journeys, test 10 in two parts), `operator.spec.ts` **3 of 3**, `clips-limits.spec.ts` **3 of 3**, each ending with a cleanup that proves nothing is left in Postgres. The run found three app bugs, fixed before closing (see Review findings). **Not in CI**: CI runs `npm run validate` only and no e2e spec of any module; these need the Docker services, a seeded database, the API in e2e mode and the worker |

---

## 7. The whole gate: `npm run validate`

On 2026-11-19 (the last run, after the e2e fixes), 71 of 71 tasks passed: lint, typecheck and
test in every workspace, with 12,740 tests passed and 31 skipped. The per-workspace counts include:

| Workspace | Tests passed |
|---|---|
| `@postgear/api` | 3,540 (22 skipped) |
| `@postgear/web` | 2,750 |
| `@postgear/video-engine` | 891 |
| `@postgear/worker` | 795 |
| `@postgear/media-tools` | 467 |
| `@postgear/storage` | 99 (4 skipped, MinIO) |
| `@postgear/entitlements` | 95 |
| `@postgear/video-preview` | 71 |
| `@postgear/scheduling` | 32 |

The first full run had one red test: `maintenance.workflow.test.ts` timed out at 180 s while all
71 tasks ran at once. The time-skipping Temporal test server dropped its connection ("excess
pings") under the load. It passed alone and in the full worker suite (795 of 795). Its status
poll went from 50 ms to 250 ms, and the second run was green. After the e2e fixes one more
load-only red showed: `runner.test.ts` let FFmpeg run 30 s but Jest stopped the test at its
default 5 s; the two FFmpeg tests now have Jest's limit at 30 s too, and the next run was green.

---

## Definition of Done: evidence

| DoD item | Evidence |
|---|---|
| Clips opens from the rail with the five tabs; below 1366 px its one sentence | Module 06 browser pass; `clips-edge-cases.test.tsx` pins the sentence; look pass at 1366 and 1920 |
| Links show the card within about 10 s; each bad link its sentence; nothing fetched while typing | **In simulation.** Module 06 browser pass (Twitch sample, private, live, Vimeo); the forcing links in testing guide §5p |
| My Channels: add, list, Import with the rights tick, live refused, hidden stays hidden, missing, empty and used-up sentences | **In simulation.** Module 06 browser pass (`simstreamer`, hide and show, import); `simempty`, `simquota`, `simflaky` (Module 20) |
| Import: rights tick stored with who and when, progress in words, survives a closed browser, cancel and retry, never twice | **In simulation.** Module 04 and 06; "You already have the sample video." for the same link; the image proof §4.7 |
| Uploads up to 2 GB, resumable, checked as a real video first | **Partly.** A 3 minute file uploaded live (Module 06); the 2 GB cap and the probe are tested (`uploads.security.test.ts`); no 2 GB file was sent |
| Private storage, expiring signed addresses, 404 across workspaces, S3 in production | **Partly.** Local private storage and signed addresses live; 22 id routes 404 (§3.11); production refuses the local disk (tested); **S3 never run against a real bucket** |
| Video page: our controls, filmstrip and sound timeline, I and O, Create Clip, Edit Whole Video | Module 07 browser pass |
| Find Clips: price in the label, steps, scored clips with reasons, give-back on failure, one charge per press, any subset of tracks | **In simulation.** Module 16 browser and API pass (7 picks, meter +3 once, `rev:` on failure and cancel, the talk sample from sound only); chat only from the recorded file |
| Editor: full window, three shapes, trim, split, delete, undo, redo, autosave with the lock, leave guard, shortcuts sheet | Modules 08 and 09 browser passes |
| The seven layouts with crop boxes; a saved layout | Module 10 browser pass, exported and compared |
| Text, stickers, GIFs and uploaded pictures; search, favourites, licence evidence, credits page | Modules 11 and 12 browser passes; **the catalogue is our own 193 stickers** (outside packs wait for the owner's OK) |
| Zoom, speed, Looks and fades in editor and export; items stay on their moment | Module 13 browser pass compared with `clips:stills` at three moments; the sound at other speeds **not listened to** |
| Sound effects, music and own sounds with volume and fades; loudness target | Module 14 browser pass; -14.0 LUFS and -1.4 dBTP from a +2.2 dBTP mix; **our own 92 sounds** |
| Preview Export through the same compiler; parity tests | Module 15 browser pass; 35 parity tests pass locally, skip in CI (§2.7) |
| Export on its own queue, steps and time left, survives a closed browser, MP4 with poster and length in Media, notification | Modules 05 and 15 browser passes; the image proof §4.7 |
| Locked qualities show the plan dialog; the Free mark from the server; every limit refuses with its sentence | Module 15 (Free workspace: only 720p open, the mark); `limits-audit.spec.ts` one refusal per row |
| Operator plan value obeyed within seconds; override end; Change Log; plain "not found" | Module 19 browser pass (`/operator`, member@ 404); `plan-change.spec.ts`; `e2e/operator.spec.ts` 3 of 3 (a plan value edited and the limit moving, an override, the 404 for a member) |
| Ledgers idempotent, reversed, used equals the work, reconcile finds no charge without a job | `usage.service.spec.ts`, `usage.service.security.spec.ts`, the load test (§1.9), `clip-sweep.security.spec.ts` (the backstop also refunds FAILED and CANCELLED jobs) |
| Send To Composer: draft, refusals with reasons, Scheduled, the picker's Clips tab, Coming Up | **In simulation.** Module 17 browser pass (posted to the stand-in) |
| Download in a chosen quality or audio, within the day's limit, kept 24 hours | **In simulation.** Module 18 browser pass (MP4 and MP3 decode, the fourth refused, the Free sixth refused, 410 when expired) |
| Retention with the 3 day notice; rights removal; platform pause; hidden library item never changes a clip silently | Module 19 browser pass (notice, removal, blocked link); `CLIPS_PLATFORMS`; `library-hidden.edge.test.ts` |
| No shell; yt-dlp allowlist and limits; probe before FFmpeg; `-/filter_complex`; `font_missing` | The security sweep (§6.1): `outside-programs.security.test.ts`, `uploads.security.test.ts`, `render.security.test.ts` |
| The screenshot coverage audit re-read | Re-read 2026-11-19, no row moved ([research/13](../sprint-12/research/13-screenshot-coverage.md), last section) |
| `CLIPS_SIMULATION` with no network; e2e pass; unit tests; `npm run validate` green | `npm run validate` green on 2026-11-19: 71 of 71 tasks, 12,740 tests passed and 31 skipped (the MinIO, SEO browser and ledger load suites need services CI lacks); e2e green under `CLIPS_SIMULATION`: `clips.spec.ts` 19 of 19, `operator.spec.ts` 3 of 3, `clips-limits.spec.ts` 3 of 3 (2026-11-19) |
| Light, dark and Lilac at 1366 and 1920; title-case test; no em dash or middle dot | The look pass (§6.5); `title-case.test.ts` in validate; a repo search for both characters found none in the Sprint 12 files |

---

## Deviations from the sprint document, and why

The full list is in the sprint document's
[Deviations](../sprint-documents/sprint-12-clips.md#deviations) section. In short:

| The document said | What shipped | Why |
|---|---|---|
| Text `fontId` and `backing`; sticker `art: {...}` | Module 01's shapes (`style.font`, `outline` or `background`; `ref`) | The schema, validator and compiler already read them |
| Handles with react-moveable | Our own small handle model | Works in the stage's scale and rotation; fully unit tested |
| One activity per step | One activity per heavy job | A retry starts from a clean scratch folder |
| `not_original` | `needs_review` | Not proven bad, only not proven own work |
| Select A Clip reads `status=exported` | `withExport=true` | Scheduled or changed clips still have a file |
| yt-dlp kept current, not pinned | Pinned in the image, `YTDLP_SELF_UPDATE` as the update path | A reproducible image, with fixes when the operator wants them |
| Every check in CI | Parity, load test and image proof run locally only | CI has no pinned FFmpeg, no Postgres service, no Docker build |

## Review findings fixed before closing (2026-11-19)

| Finding | Fix |
|---|---|
| A yt-dlp format id could start with `-` or `.` | Refused (`yt-dlp.args.ts`) |
| The downloader checked only the host | It re-reads the link and needs the same platform, id and address |
| The lister HTTP helper let a user name and password through | Refused (`lister-http.ts`) |
| Render inputs and the scene and loudness passes had no protocol allowlist | `-protocol_whitelist file` everywhere |
| The render executor took any existing name in scratch | A plain safe name is required |
| A stored error code or stage reached a page as written | Allow-listed; anything else reads `tool_failed` or no stage |
| `clipErrorMessage('constructor')` returned a function | Own keys only |
| The charge backstop missed FAILED and CANCELLED jobs | Refunds them too |
| Worker failures and progress errors could repeat a secret | Scrubbed (`log-redaction.ts`) |
| An operator adjustment could take used below zero | 422 `usage_below_zero`, and the dialog says the most it can give back |
| `publishRun` from the command line skipped the licence rule | Applies `libraryPublishRefusal` |
| A stale channel list showed no notice | Carries the `channel_listing_failed` sentence |
| The over-limit sentence said 1.3 GB beside a meter at 1.2 GB | Rounds like the meter |
| Creator copy said "job" | Reworded |
| Look pass: sound names cut, a 16 px resize strip, a 3.71:1 search hint | Panel `w-96` from 1536 px, full names on hover, a 24 px strip, `type-muted` |
| e2e: a just-finished export of a split-layout clip already said "You changed this clip after the last export" (the editor held a crop at 0.24687499999999996, the stored clip read 0.246875: one bit apart on the way in through Prisma) | Fingerprint v2 counts numbers to twelve digits; `fingerprintMatches` (v1 still read the old way) in the editor and in the save route's carry-forward; engine, API and web tests |
| e2e: the open editor never followed a plan upgrade (its 1080p 60 fps tile stayed locked until a reload) | The plan store checks its age every five seconds while the tab is visible and on focus, and asks again past 15 seconds (`entitlements.test.ts`) |
| e2e: the shape dialog had no accessible name (our id on its title replaced the one the dialog points at) | The title keeps its own id; the tiles are labelled "Shape" |

## Known gaps

1. **Nothing has met the real platforms.** No real YouTube, Twitch or Kick video, channel list or chat was fetched. The real-test plan does that, with your OK.
2. **S3 never used.** The private space ran on local disk; the S3 binding is tested against a fake (the MinIO suite skips without MinIO).
3. **The library is our own art only.** 193 stickers and 92 sounds. Noto, Kenney, Open Peeps and OpenGameArt need an outside fetch; Openverse and Freesound stay off.
4. **Operator mail never sent.** Printed to the API console, as asked.
5. **CI skips four things.** The parity tests, the ledger load test, the image proof and the e2e specs run only on a machine with FFmpeg, Postgres, Docker and the running app (CI runs no e2e spec for any module yet).
6. **The app-wide exception filter logs raw stacks without scrubbing** (not Clips only); production should also add an egress rule on the worker for the HLS copy.
7. **Not run:** the hour-long heap check, a screen reader pass, a 200% zoom check, the sound at 2x, 0.5x and 0.25x, and a 2 GB upload.
8. **The worker image carries `@postgear/ai-engine`** although nothing imports it (about 100 MB); removing it needs a lockfile change.
9. **Two small heuristic items open:** the safe zone guide (planned in Sprint 13 Module 03) and the plan lock not naming the plan.

## 8. What remains for you

1. Walk the hand checks in the testing guide §5p with `demo@postgear.local`, one module at a time; `npm run operator:grant -- --email demo@postgear.local` first for `/operator`.
2. Decide the outside library packs (Noto, Kenney, Open Peeps, OpenGameArt) so the shelves grow past our own art.
3. Run the real-test plan ([real-test-plan.md](../sprint-12/real-test-plan.md)) on links you choose, with simulation off, before Sprint 13.
4. Before production: an S3 bucket and `CLIPS_URL_SECRET`, `OPERATOR_EMAILS`, a private registry for the worker image (GPL FFmpeg), and an egress rule for the worker.

---

## Files changed in Modules 19 and 20

**Added: API**
- `apps/api/src/modules/admin/{admin.module,operator-audit.service,operator-write.guard,operator.messages}.ts`, `admin/{clips,entitlements,library}/*` (+ specs)
- `apps/api/src/common/{decorators/platform-admin.decorator,guards/platform-admin.guard}.ts`
- `apps/api/src/modules/clips/retention/*`, `clips/limits/{clips-create,clips-enabled}.guard.ts`, `clips/channels/listers/simulation-switches.lister.ts`
- `apps/api/src/scripts/*` (`clips:remove`); security, edge-case, tenancy, plan-change and load specs

**Added: worker, packages, web, infra**
- `apps/worker/src/clips/{log-redaction,yt-dlp-update}.ts`, `clips/media-facts/*`, `workflows/media-video-facts.workflow.ts` (+ tests)
- `packages/db/{scripts,src/operator-access.ts}`, migration `20261119120000_sprint12_clips_retention_and_safety`
- `packages/scheduling/src/media.ts`; security and edge-case tests in media-tools, video-engine, storage, entitlements
- `apps/web/src/app/{(operator),legal}/*`, `components/{operator,legal}/*`, `components/media/video-still.tsx`, `types/operator.ts`
- `infra/docker/worker/*`, `.dockerignore`, `e2e/{clips,operator}.spec.ts`, `e2e/helpers/clips.ts`
- `docs/design-patterns/clips-heuristic-review-2026-11-19.md`

**Modified**
- `apps/api`: clips (videos, links, downloads, highlights, jobs, internal, limits), entitlements, media, scheduling, security logger, env
- `apps/worker`: maintenance, clip workflows, failures, library store, render, boot
- `apps/web`: Clips page, editor panel and timeline, downloads, meters, media tiles, account menu, workspace provider, global search
- `packages`: video-engine (errors, jobs, library, render types), media-tools (downloader, execute, signals, scratch), storage (list, keys), entitlements messages, db schema
- `infra/docker/Dockerfile.worker`, `docker-compose.yml`, `.env.example`, `CLAUDE.md`, testing guide, Sprint 12 docs
