# Sprint 12 Research: The Approach On PostGear

> **Written**: 2026-11-14, **revised 2026-11-17** (render engine is FFmpeg only). How Clips fits the codebase as it is on branch `instagram-direct-and-threads`. The sprint doc (`../../sprint-documents/sprint-12-clips.md`) is the binding version of this; this page explains the reasoning and lists what we reuse, with paths. Every path below was read on 2026-11-14.

## 1. Data Flow

```
Browser                         API (NestJS)                         Worker (Temporal)                 Outside
-------                         ------------                         -----------------                 -------
Paste a link, press Enter ----> POST /clips/links/probe
                                  recognise the link (video-engine)
                                  start clipProbe, wait up to 25 s -> queue postgear-media
                                                                       yt-dlp -J (no download) -------> YouTube, Twitch, Kick
                                <- { link: title, length, formats }
Tick the rights box, Import --> POST /clips/videos
                                  limits, dedup, rights record
                                  rows: ClipVideo, ClipJob(IMPORT)
                                  start clipImport ----------------> fetch the 720p-or-lower rendition
                                                                       remux or encode to H.264 + AAC
                                                                       analysis audio, filmstrip, waveform
                                                                       put files in private storage
                                                                       write ClipAsset rows, job progress
Videos tab ------------------> GET /clips/jobs/:id/events (SSE)
                                  re-reads the job row every 750 ms
                                <- progress ... done

Mark in and out, Create Clip -> POST /clips { videoId, startMs, endMs }
                                  row: Clip (document v1, one segment)
                                  row: ClipJob(SEGMENT), start ------> fetchRange in HD, with handles
Find Clips ------------------> POST /clips/videos/:id/highlights
                                  charge credits
                                  rows: ClipHighlightRun, ClipJob --> loudness, scene, chat tracks
                                                                       pure scorer (video-engine)
                                                                       Clip rows, status NEW, with scores

Editor (PreviewEngine) ------> GET /clips/:id, PATCH /clips/:id { revision, document }
  plays the proxy in a <video> by a signed URL with Range;
  draws crop, zoom, text and stickers from frameState(doc, ms)

Export ----------------------> POST /clips/:id/exports { quality }
                                  row: ClipJob(RENDER) with a frozen
                                  copy of the document, start ------> queue postgear-render
                                                                       buildRenderPlan + compileFfmpeg (pure)
                                                                       ASS files, graph file, argument array
                                                                       loudness pass 1, then ONE FFmpeg run:
                                                                       cut, crop, zoom, text, stickers, mix, encode
                                                                       poster frame
                                                                       put the MP4 in the public media space
                                <- POST /internal/clips/exports/finish (worker to API)
                                  Media row, notification
Preview Export -------------> POST /clips/:id/proof  (360 wide, ultrafast, same compiler)
                                  row: ClipJob(RENDER, proof) -----> postgear-render, a short cheap run
Send To Composer ------------> POST /clips/:id/send { channelIds, caption }
                                  PostsService.create (DRAFT)
                                <- { group }
router.push(/composer?group=...)
```

The API never runs an outside program. It writes rows and starts workflows; the worker runs yt-dlp and FFmpeg and writes status back. This is the existing rule for publishing (`CLAUDE.md`, apps/worker), applied to video.

## 2. Where The Code Goes

| Layer | Path | Notes |
|---|---|---|
| Engine (pure) | `packages/video-engine` (`@postgear/video-engine`) | Like `packages/design-engine`: the clip document schema (Zod, `.strict()`, `schemaVersion`, `upgrade()`), the time map, layout maths, link recognition, the highlight scorer, limits tables, the sticker and sound manifests. No Node built-ins, so the web app may import it. |
| Render compiler (pure) | `packages/video-engine/src/render/` | `frameState(doc, outputMs)`, `buildRenderPlan`, `compileFfmpeg` (inputs, filter graph text, argument array) and `buildAss`. Pure strings in, strings out, so the web app, the API and the tests can import it. |
| Preview (web only) | `packages/video-preview` (`@postgear/video-preview`) | `PreviewEngine`: plays the light copy in a `<video>` segment by segment and draws crop, zoom, looks, text and stickers from `frameState`. Browser code only; replaces the old `video-compositions` package. |
| Storage | `packages/storage` (`@postgear/storage`) | The storage code moved out of `apps/api/src/modules/media/storage/` so the API and the worker share it. Gains a private key space, signed URLs, get-to-file, multipart upload, delete-by-prefix. |
| Tools | `packages/media-tools` (`@postgear/media-tools`) | Node only: the safe process runner, the yt-dlp, FFmpeg and ffprobe adapters, the render executor (runs a compiled plan, reads `-progress pipe:1`, kills on cancel), the HLS playlist slicer, the doctor. Used by the worker, never by the web app or the API. |
| Contract | `packages/scheduling/src/clips.ts` | Queue names, workflow names, workflow ids from row ids, timeouts, retry policy, failure types. Pure, as the package already is. |
| API | `apps/api/src/modules/clips/` | Controller, service, repository, `clips.messages.ts`, `dto/*.schema.ts`, the job events service, the internal controller, specs. Registered in `app.module.ts`. |
| Worker | `apps/worker/src/clips/`, `apps/worker/src/workflows/clip-*.workflow.ts`, `apps/worker/src/render/` | Activities per job kind, the workflows, the render activity (resolve inputs into the job folder, compile, run FFmpeg through `media-tools`, heartbeat from the progress lines). A second and third `Worker` on the new queues, switched by `WORKER_ROLES`. |
| Web | `apps/web/src/app/(dashboard)/[orgId]/clips/`, `apps/web/src/components/clips/`, `apps/web/src/lib/clips-api.ts`, `apps/web/src/types/clips.ts` | The page with its tabs, the video page, the full-window editor. |
| DB | `packages/db/prisma/schema.prisma`, one migration per module that needs one, `SCHEMA_NOTES.md` | `ClipVideo`, `ClipAsset`, `Clip`, `ClipHighlightRun`, `ClipJob`, `ClipPost`, `ClipLayoutPreset`, and three columns on `Media`. |
| Env | `apps/api/src/config/env.ts`, `apps/worker/src/config/env.ts`, `.env.example` | `CLIPS_SIMULATION` and the tool, storage and platform variables listed in the sprint doc. |

## 3. Why These Shapes

- **A pure engine with a render compiler, and a web-only preview package.** `design-engine` proved the pattern: one versioned document, one definition of what is on screen. Video has two drawers: the browser preview (`packages/video-preview`, DOM and a `<video>`) and FFmpeg (the compiler in `video-engine/src/render`). They cannot share drawing code, so they share the **numbers**: `frameState(doc, outputMs)` says what is on screen at a moment, the preview draws it with CSS and the compiler turns the same values into filter expressions. Parity is guarded by `frameState` tests, compiler tests that render a frame with FFmpeg and compare pixels, and Preview Export (the real compiler at low resolution). The engine stays pure so the Temporal sandbox, the API, the worker and the web app can all import it.
- **Segments and a time map, not one in and out range.** A clip is a list of segments of a video, each with a speed. Things that belong to the picture (crops, zooms, and captions in Sprint 13) are stored in the video's own time. Things laid on top (stickers, text, sound) are stored in the clip's time. A split, a deleted middle and a speed change then only change the map, and nothing drifts.
- **Proxy first, HD when a clip is made.** A six hour stream in full quality is many gigabytes and most of it is never used. Import keeps one light copy for watching and editing. The sharp copy of just the clip's range is fetched when the clip is created, with handles on both sides, so the export does not depend on the stream still being online.
- **Private storage for videos.** Today a file's unguessable key is its only protection and every object is public with a one year cache (`apps/api/src/modules/media/storage/s3.storage.ts`). That is fine for a workspace's own uploads. It is not fine for imported videos, so they live in a private space and are reached by short-lived signed URLs. Only an exported clip becomes a `Media` row in the public space.
- **One job table.** Import, segment fetch, highlights, render and download all need the same things: a status, a stage, a progress number, an error, a cancel, a retry and a reconcile when a workflow never started. One `ClipJob` table gives one events service and one reconcile, copied from the automation runs.
- **Separate queues.** The worker has one task queue today, `postgear-publishing` (`packages/scheduling/src/workflows.ts`). A render can hold a CPU for minutes, and a scheduled post must never wait behind it. Video gets `postgear-media` and `postgear-render`.
- **Probe through the worker.** Probing a link needs yt-dlp. Running it in the API would put the tools in the API image. The API starts a short workflow and waits for the answer, so only the media worker carries the tools.
- **AI proposals are clips.** StreamLadder's library shows AI finds and hand-made clips in one list with status tabs. A proposal is a `Clip` with status NEW and a score. Opening it makes it a draft; hiding it keeps it out of the way.

## 4. Storage Layout

| Space | Keys | Who reads it |
|---|---|---|
| Public media (exists) | `YYYY/MM/<32 hex>.<ext>` and `.thumb.webp` | Anyone with the URL, platforms when publishing |
| Private clips (new) | `clips/<orgId>/<videoId>/<kind>-<hex>.<ext>` for video files; `clips/<orgId>/exports/<jobId>/...` while a render runs; `clips/<orgId>/library/<hex>.<ext>` for a workspace's own stickers and audio | The API and the worker; the browser through a signed URL that expires |

Rules: every stored file has a `ClipAsset` row with its size, so a workspace's use is one `SUM`; deleting a video deletes its prefix; the allowlist in `storage-keys.ts` gains the clip patterns in one shared place, since the API and the worker each keep a copy of it today (`apps/worker/src/lib/media-url.ts`). Local disk mode keeps working for development; production needs S3-compatible storage because the API and the worker are separate containers.

## 5. Simulation

`CLIPS_SIMULATION=true` (refused when `NODE_ENV=production`, like the other flags) binds every provider to a stand-in:

| Provider | Real | Simulated |
|---|---|---|
| `Downloader` (probe, fetch, fetchRange) | yt-dlp and FFmpeg | A fixture resolver that knows a few made-up links per platform and answers with the bundled sample videos |
| `HighlightDetector` signal producers | FFmpeg analysis, Twitch chat replay | Recorded signal tracks for the samples, so the same clips are found every time |
| `StickerProvider` (catalogue) | The `ClipSticker` table | The same table with the small library fixtures |
| `Renderer` | FFmpeg on the HD segment through the compiled plan | **The same: real FFmpeg on the generated sample.** There is no stand-in renderer. FFmpeg is cheap and needs no network, so the simulated and the real render are the same code, and parity tests run in simulation |

The sample videos are generated, not downloaded (an FFmpeg test pattern with tone bursts and hard cuts at known times), so there is no licence question and the highlights are predictable. FFmpeg is still needed in simulation; yt-dlp and the network are not. Unit tests inject fakes with or without the flag.

## 6. What We Reuse (With Paths)

| Need | Reuse | Path |
|---|---|---|
| Streaming file storage | `StorageBackend`, `createStorage`, `storageConfigFrom`, `publicUrl` | `apps/api/src/modules/media/storage/` (moves to `packages/storage`) |
| Library rows for exports | `Media` model, the upload sequence, `saveGenerated` as the model for `saveRendered`, `findViews`, `toView` | `apps/api/src/modules/media/media.service.ts` |
| Byte sniffing of uploads | `sniffMedia` | `apps/api/src/modules/media/file-type.ts` |
| Workflow start, cancel, reconcile | `startAutomationRun`, `signalAutomationRun`, `attempt()`, the maintenance workflow | `apps/api/src/modules/scheduling/scheduling.service.ts`, `apps/worker/src/workflows/maintenance.workflow.ts` |
| Activity shape | `createActivities(deps)`, `ActivityDeps`, heartbeat with `setInterval`, typed `ApplicationFailure` | `apps/worker/src/activities/index.ts`, `deps.ts`, `analytics.activities.ts`, `webhook.activities.ts` |
| Contract as data | Names, ids from row ids, retry policy objects, failure type lists | `packages/scheduling/src/workflows.ts`, `retry-policy.ts`, `automations.ts` |
| Live progress | A service that re-reads rows and emits SSE; the web hook with a polling fallback | `apps/api/src/modules/automations/runs/automation-run-events.service.ts`, `apps/api/src/common/sse.ts`, `apps/web/src/components/workflows/runs/use-run-stream.ts`, `apps/web/src/lib/sse.ts` |
| Worker to API calls | `InternalTokenGuard`, an `internal/...` controller, the worker's gateway client | `apps/api/src/modules/automations/gateway/internal-token.guard.ts`, `apps/api/src/modules/discover/internal.controller.ts`, `apps/worker/src/automation/gateway-client.ts` |
| Credits | `CreditsService` (`context`, `charge`, `tryCharge`, `refund`), `AI_CREDIT_COSTS`, `AI_LEDGER_TYPES`, the charge, call, refund shape | `apps/api/src/modules/ai/credits/`, `apps/api/src/modules/discover/competitor-research.service.ts` |
| Plan limits and locks | `PLANS`, `EntitlementsService.entitlement`, a 402 with a `code` | `apps/api/src/modules/billing/plans.ts`, `entitlements.service.ts`, `apps/api/src/modules/studio/studio.premium.ts` |
| Simulation wiring | A Zod flag, a production refusal, a factory behind a DI symbol, a boot log line | `apps/api/src/config/env.ts`, `apps/worker/src/config/env.ts`, `apps/api/src/modules/discover/discover.engine.ts`, `discover.module.ts` |
| Link safety | `assertSafeUrl`, `headUrlSafely`, `fetchBinarySafely` (thumbnails only) | `packages/seo-engine/src/crawler/url-guard.ts`, `safe-fetch.ts` |
| Notifications | The type catalogue, rows written by the worker | `apps/api/src/modules/notifications/notifications.types.ts`, `apps/worker/src/activities/publish.activities.ts` |
| Document pattern | `designDocumentSchema`, `upgrade()`, `revision` lock on `Design`, `lastExportedRevision`, the generic undo stack | `packages/design-engine/src/schema.ts`, `history.ts`, `packages/db/prisma/schema.prisma` (`Design`) |
| Full-window route | `immersion()`, `data-immersive`, the page's own back button | `apps/web/src/components/navigation/dashboard-shell.tsx`, `apps/web/src/components/studio/editor-top-bar.tsx` |
| Editor state | `useReducer` with `ApplyChange` and a coalesce key, `Autosave`, the leave guard, `shortcutOf` | `apps/web/src/components/studio/editor-state.ts`, `editor-autosave.ts`, `use-autosave.ts`, `studio-editor-model.ts`, `apps/web/src/lib/leave-guard.ts` |
| Shortcuts sheet | `SHORTCUTS`, `ShortcutsSheet`, `ShortcutKeys` | `apps/web/src/components/workflows/builder/builder-shortcuts.ts`, `shortcuts-sheet.tsx`, `shortcut-keys.tsx` |
| Panels and rails | `PanelSection`, `GroupLabel`, `SwatchPicker`, `PercentSlider`, `ColorField`, the `Tool` button, `ResizeHandle` | `apps/web/src/components/studio/panel-ui.tsx`, `color-field.tsx`, `apps/web/src/components/workflows/builder/tool-rail.tsx`, `apps/web/src/components/workflows/panel/resize-handle.tsx` |
| Fonts | The 52 families, `StudioFonts`, `FontSelect`, `fontStack`, `filesFor` | `packages/design-engine/src/fonts/index.ts`, `apps/web/src/components/studio/studio-fonts.tsx`, `font-select.tsx`, `apps/api/src/modules/studio/studio-fonts.controller.ts` |
| Sortable lists | dnd-kit with `PointerSensor` and announcements | `apps/web/src/components/studio/slides-rail.tsx` |
| Zoom controls | `ZOOM_LEVELS`, `zoomIn`, `zoomOut`, `ZoomControls` | `apps/web/src/components/studio/canvas-model.ts`, `editor-canvas.tsx` |
| Uploads in the browser | `uploadFile` (XHR progress), `useMediaUpload`, `preflightUpload` | `apps/web/src/lib/api.ts`, `apps/web/src/components/media/media-uploader.tsx`, `media-limits.ts` |
| Export and send dialogs | The SSE progress dialog, `downloadFile`, the channel picker and `?group=` push | `apps/web/src/components/studio/export-dialog.tsx`, `send-dialog.tsx`, `studio-editor.tsx` |
| Draft post for the composer | `PostsService.create` with `createPostSchema`, `prepareSend` | `apps/api/src/modules/posts/posts.service.ts`, `apps/api/src/modules/studio/studio.service.ts` |
| Credits and locks in the UI | `CreditsChip`, `useCredits`, the `cannotAfford` alert, `PremiumLockMark`, `PremiumLockDialog` | `apps/web/src/components/ai/credits-meter.tsx`, `use-credits.ts`, `apps/web/src/components/seo/analyze-form.tsx`, `apps/web/src/components/studio/premium-lock.tsx` |
| Page scaffolding | `PageActions`, `Tabs`, `Dialog`, `Sheet`, `Alert`, `Progress`, `Slider`, `ChoiceTiles`, `Segmented`, `EmptyState`, `ErrorState`, `Skeleton`, `TooltipHint`, `MotionIcon`, toasts | `packages/ui` |
| Rail and titles | `RAIL`, `TITLES` | `apps/web/src/components/navigation/dashboard-shell.tsx` |
| Posting rules | `MediaRules`, `validatePost` | `packages/social-core/src/composer/rules.ts`, `validate.ts` |
| Dev preview | The `/dev` routes with the production guard | `apps/web/src/app/dev/` |

## 7. What Does Not Exist Yet

Stated here so no session hunts for it:

| Missing | Where it is built |
|---|---|
| Any outside program at all (no FFmpeg, ffprobe, yt-dlp, no `child_process` anywhere in `apps` or `packages`) | Module 02 |
| Storage access in the worker (it has no credentials and no SDK; it only builds public URLs) | Module 02 |
| A private key space and signed URLs | Module 02 |
| MinIO bucket creation and CORS in `docker-compose.yml` | Module 02 |
| Real Dockerfiles (`infra/docker/Dockerfile.*` are placeholders) | Module 20 (the worker image) |
| Video facts on `Media` (no duration, no poster; `thumbnail` is null for video) | Module 05 writes them for exports, Module 19 backfills |
| WebM uploads (refused by `file-type.ts`) and anything over 250 MB (`media.messages.ts`) | Module 04 adds the clips upload path with its own limits |
| A video player with our own controls, a timeline, a waveform view, on-canvas handles | Modules 08, 09, 11 |
| A colour picker and a time-code field in the design system | Modules 09 and 11 |
| Clip limits in the plans (`Plan` has `channels`, `aiCredits`, `members`) | Module 01 |
| Length and shape rules for video per platform in `social-core` | Module 17 |
| Notification types for videos and exports | Module 04 and Module 15 |

## 8. Page Layout

```
Top bar: Clips                                                               (global search)
+----------------------------------------------------------------------------------------+
| PageActions:  [ Create v ]                                  12.4 GB of 30 GB   Credits  |
+----------------------------------------------------------------------------------------+
| Tabs:  Create | Videos | Clips | Downloads                                             |
+----------------------------------------------------------------------------------------+
| Create                                                                                 |
|   [ Enter your YouTube, Twitch or Kick link                         ] [ Find Video ]   |
|   [ Upload A Video ]                                                                   |
|   Recent Videos    [card] [card] [card]                                                |
|   Recent Clips     [card] [card] [card] [card]                                         |
+----------------------------------------------------------------------------------------+

Video page (/clips/video/<id>): player on the left, the clips found so far on the right,
a timeline under the player with the filmstrip, the waveform and the highlight marks.

Editor (/clips/edit/<id>), the whole window:
+--+---------------------+-----------------------------------------------+
|  | panel for the open  |  top bar: back, name, saved, undo, redo, Export |
|T |   tab               |                                                 |
|a | (Layouts, Elements, |              the clip (PreviewEngine)           |
|b |  Text, Effects,     |                                                 |
|s |  Audio, Export)     |  transport: play, time, zoom                    |
|  |                     +-------------------------------------------------+
|  |                     |  timeline dock: video, overlays, audio          |
+--+---------------------+-------------------------------------------------+
```

The editor is desktop only (1366 px and up), like Studio and Workflows. See `../clips-implementation-docs/00-ux-blueprint.md`.
