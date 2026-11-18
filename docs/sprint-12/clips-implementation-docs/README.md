# Sprint 12: Clips, Implementation Modules

This folder splits Sprint 12 (Clips) into **twenty modules plus a UX blueprint and a parked P2 list**. Build them in order, **one module per Claude Code session**. Each module builds, verifies and stops so you can check it by hand before the next one starts. A real video goes from a link to an exported clip in Media by the end of Module 05 (on a bare test page); the page and manual clipping are on by Module 07; the full editor by Module 15; AI by Module 16.

| Document | What it decides |
|---|---|
| [`../../sprint-documents/sprint-12-clips.md`](../../sprint-documents/sprint-12-clips.md) | **How** to build: architecture, the clip document, providers, jobs, data model, API routes, limits |
| [`../../new-modules/user-stories-clips.md`](../../new-modules/user-stories-clips.md) | **What the user experiences**: journeys, acceptance criteria, UX rules, edge cases, completion checklist |
| [`../research/`](../README.md) | **Why**: reference products, libraries, open-source repos, link import, editor and render, signals, legal and cost, the approach |
| [`00-ux-blueprint.md`](00-ux-blueprint.md) | **How it looks and feels**: page anatomy, cards, the video page, the editor, the timeline, panels, copy |
| `module-NN-*.md` (this folder) | **What to do in each session**: scope, design details, tasks, tests, done when, hand check |
| [`../real-test-plan.md`](../real-test-plan.md) | **How Arvind tests it for real** after the build, and the gate before Sprint 13 |

If two documents disagree: user stories win on behaviour, the UX blueprint wins on look and interaction, the sprint doc wins on architecture, the research wins on facts about outside tools and services. Record every such call in the decision log below.

---

## The North Star

> Paste a link, get clips worth posting, and schedule them everywhere, without leaving PostGear and without ever wondering what the machine is doing.

**Reference products** (ideas only, never code or art): StreamLadder for the flow (paste, find clips, layouts with crop boxes, the tab order of the editor, the clips library with status tabs); OpusClip for the link box that reads many sites and for scores on AI clips; VidsSave for the link card with a quality list. **Open-source projects** read for logic are listed with their licences in [`../research/03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md); only permissively licensed logic may be adapted, with the source named in the module that uses it.

---

## Module Map

| # | Module | Size | Depends on | Stories | Status |
|---|---|---|---|---|---|
| 00 | [UX Blueprint](00-ux-blueprint.md) (read, do not build) | - | - | all UI stories | Reference |
| 01 | [Contracts And Data](module-01-contracts-and-data.md) | L | - | foundations (plans, entitlements, the AI minutes ledger, the library and channel tables); CL-1.1 (rail, small-screen sentence), CL-13.1 (the plan values) | Done |
| 02 | [Media Runtime](module-02-media-runtime.md) | L | 01 | foundations; CL-13.3 | Done |
| 03 | [Link Engine](module-03-link-engine.md) | L | 02 | CL-1.2 (server side), CL-1.7 (server side: the channel lister), CL-13.4 | Done with gaps |
| 04 | [Import Pipeline](module-04-import-pipeline.md) | L | 03 | CL-1.4, 1.5, 1.6 (server side) | Done |
| 05 | [Thin Slice: Render A Clip With FFmpeg](module-05-thin-slice-render.md) | L | 04 | foundations for CL-10.1 and CL-10.4 | Done with gaps |
| 06 | [Clips Home And Videos](module-06-clips-home-and-videos.md) | L | 03, 04 | CL-1.1 to 1.6, CL-1.7 (UI), CL-1.8, CL-2.1, 2.3, 2.4, CL-2.5 | Done with gaps |
| 07 | [Manual Clipping And The Clips Library](module-07-manual-clipping-and-clips-library.md) | L | 05, 06 | CL-3.1 to 3.4, CL-2.2 | Done with gaps |
| 08 | [Editor Shell](module-08-editor-shell.md) | L | 05, 07 | CL-5.1, 5.2, 5.4 | Done with gaps |
| 09 | [Timeline](module-09-timeline.md) | L | 08 | CL-5.3, 5.5 | Done with gaps |
| 10 | [Layouts And Crops](module-10-layouts-and-crops.md) | L | 09 | CL-6.1 to 6.3 | Done with gaps |
| 11 | [Canvas Handles And Text](module-11-canvas-handles-and-text.md) | L | 09 | CL-7.1 | Not started |
| 12 | [Stickers And GIFs](module-12-stickers-and-gifs.md) | L | 11 | CL-7.2 to 7.5 | Not started |
| 13 | [Effects: Zoom, Speed And Looks](module-13-effects-zoom-and-speed.md) | M | 09 | CL-8.1 to 8.3 | Not started |
| 14 | [Sound](module-14-sound.md) | L | 09 | CL-9.1 to 9.4 | Not started |
| 15 | [Export](module-15-export.md) | M | 05, 08 | CL-10.1 to 10.4 | Not started |
| 16 | [AI Highlights (Signals)](module-16-ai-highlights.md) | L | 04, 07 | CL-4.1 to 4.4 | Not started |
| 17 | [Send To Composer](module-17-send-to-composer.md) | M | 15 | CL-11.1 to 11.3 | Not started |
| 18 | [Download In Any Format](module-18-download-in-any-format.md) | M | 03, 06 | CL-12.1, 12.2 | Not started |
| 19 | [Retention, Quotas, Safety And The Operator Screens](module-19-retention-quotas-and-safety.md) | XL | 04, 15 | CL-13.1, 13.2, 13.5, CL-13.6, 13.7 | Not started |
| 20 | [Hardening, E2E, Worker Image, Close-Out](module-20-hardening-e2e-worker-image-closeout.md) | L | 01 to 19 | section 6 checklist | Not started |
| 21 | [P2 Backlog](module-21-p2-backlog.md) | S | 20 | extras | Parked |

```text
01 -> 02 -> 03 -> 04 -> 05 --------------------> 08 -> 09 -> 10
                   |      '-> (with 06) -> 07 ---^      |-> 11 -> 12
                   |-> 06 ----------------^             |-> 13
                   |                                    '-> 14
                   |                     05, 08 -> 15 -> 17
                   |                     04, 07 -> 16
                   |                     03, 06 -> 18
                   '-------------------- 04, 15 -> 19
                                         01 to 19 all done -> 20 -> (21)
```

After 09, Modules 10, 11, 13 and 14 are independent of each other; 16 and 18 can run any time after 07. Keep the numbered order unless you are running sessions in parallel.

Size guide: M fits one session easily, L fills one, XL may need a second session ("continue Module NN"). Each module lists its tasks as checkboxes so a second session can pick up exactly where the first stopped.

**Demos** (what Arvind can try as the build goes): Demo 1 after Module 05 (`/dev/clips`: a sample link becomes an exported clip in Media), Demo 2 after Module 07 (paste, import, mark, create a clip), Demo 3 after Module 10 (a vertical clip with a Split layout), Demo 4 after Module 15 (the whole editor, exported), Demo 5 after Module 16 (Find Clips).

---

## How To Run A Module

1. Docker services up (`docker compose up -d`), on branch `sprint-12-clips`, working tree clean (commit the previous module first; see below).
2. Open a fresh Claude Code session in the repo and paste the **Kickstart Prompt** below with the module number filled in.
3. When it finishes: do the module's **Hand Check**, then ask it to commit (`Module NN: <title>` as the subject line).
4. The session updates the **Progress** table and the **Decision Log** in this README before it stops. That is the memory the next session reads.

### Kickstart Prompt (copy, set the module number, paste)

```text
We are building Sprint 12, Clips, module by module.

Read, in this order:
1. CLAUDE.md
2. docs/sprint-12/clips-implementation-docs/README.md (rules, names, progress, decision log)
3. docs/sprint-12/clips-implementation-docs/module-NN-*.md (this session's module, in full)
4. Whatever that module's "Read First" section lists (the UX blueprint sections, the sprint doc sections, the research pages, the user stories, the code files).

We are doing Module NN only. Before writing code:
- Check the Progress table and the Decision Log, and confirm the modules this one depends on are Done. If one is not, stop and tell me.
- Check the branch is sprint-12-clips (Module 01 creates it from instagram-direct-and-threads, which is pushed but not merged) and the tree is clean.
- Give me a short plan (10 lines or fewer): what you will build, in what order, and anything in the module doc you think is wrong or risky. Then start building without waiting, unless something blocks you.

While building:
- Follow the module's Design and Tasks. Tick each task checkbox in the module doc as you finish it.
- Use the project skills the module names (prisma-change, new-api-module, new-page, temporal-workflow, verify-change).
- UX follows docs/sprint-12/clips-implementation-docs/00-ux-blueprint.md. Never copy another product's code or art.
- Everything runs under CLIPS_SIMULATION=true (the fixture links, the sample videos, the fixture channels and the small library fixtures) with AI_SIMULATION=true and BILLING_SIMULATION=true. The render is real FFmpeg, so it needs FFmpeg 9.0.2 on the PATH (npm run clips:doctor says). Never fetch a real video from YouTube, Twitch or Kick, call a real platform list, or run the library ingest against an outside source unless I say so in this session. No paid call, ever.
- Outside programs (yt-dlp, FFmpeg, ffprobe) are only ever started through the process runner in packages/media-tools, with an argument array. Never a shell string. The FFmpeg graph is written to a file and passed as -/filter_complex graph.txt.
- Limits are read only through EntitlementResolver and charged only through UsageService, never from plans.ts or a constant. Every meter charge has an idempotency key and a reversal.
- If the module doc and the code disagree, trust the code, make the smallest sensible choice, and write it in the Decision Log.

Before you stop:
- Run the verify-change skill for the touched workspaces.
- Update the module's Status line, the Progress table and the Decision Log in the README.
- Tell me what to check by hand (the module's Hand Check), what is not done and why, and suggest the commit message. Do not commit or push unless I ask.
```

To continue an XL module in a second session, use the same prompt and add: `Module NN is partly done. Its unticked task boxes are what is left.`

---

## Rules For Every Module

**Project rules** (from `CLAUDE.md`, repeated because they are easy to forget):

- No em dash and no middle dot anywhere (code, comments, docs, commits). A hook blocks them.
- Names in Title Case ("Import Video", "Find Clips", "Send To Composer"); sentences in sentence case. No all-caps.
- No in-page titles or taglines; pages open with a `PageActions` row.
- Placeholders read "Enter your ...", never a sample link.
- Clickable icons are animated (`MotionIcon`); decorative and state icons stay lucide.
- Warnings and failures use the design-system `Alert`; deletes are solid red with a confirm. Violet is for AI only (Find Clips).
- Big surfaces use `bg-chrome`; read-only boxes inside a card use `bg-inset`; check light, dark and the Lilac theme.
- Dropdowns, tabs and toggles have no shadow. Icon-only buttons on a bar or panel are `Button variant="ghost"`.
- Validation with the Zod pipe and `.strict()` schemas; every route authenticated; tenancy through `@CurrentOrg()`.
- Run migrations and `db:generate` yourself in development.
- Clips is desktop only (1366 px and up), like Workflows and Studio: no phone layout, no small-screen checks.

**Module rules**:

- `packages/video-engine` is pure: no Node built-ins, no Temporal, no Prisma, no other `@postgear/*` package. The web app, the API, the worker and workflow code may all import it. The render compiler (`src/render/`: `frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`) is pure too: strings in, strings out, no file access and no process.
- **The compiler is pure and never builds a shell string.** It returns `{ inputs, filterComplexScript, assFiles, outputArgs }`; the graph is written to a file and passed as `-/filter_complex graph.txt` (FFmpeg 9.0.2 has no `-filter_complex_script` and no `-vsync`; use `-fps_mode`). Names are relative to the job's scratch folder.
- **`frameState(doc, outputMs)` is the single definition of what is on screen.** The browser preview, the compiler tests and the parity tests all read it; nobody re-derives a crop, a zoom, a position or a gain somewhere else.
- `packages/video-preview` is web only: it imports React, `@postgear/video-engine` and nothing from the worker or `media-tools`. It is an approximation of the export, never the export.
- `packages/media-tools` is Node only and is imported by the worker alone (it executes a compiled plan). The API never starts an outside program.
- **Entitlements are read only through `EntitlementResolver`**, and AI and import minutes are charged only through `UsageService`; never from `plans.ts` for Clips, never from a constant in a module. Every meter charge has an idempotency key made from a job id and a reversal on failure or cancel. Refusals are 402 with a snake_case `code` and whole-number `details`.
- Library items (sounds and stickers) come in only through the operator's ingest command and pass the licence guard; no route accepts an outside address from a user. Search reads only `ACTIVE` rows.
- The API writes rows and starts workflows. The worker does the work and writes status back. Activities pass storage keys, never file paths, and clean their scratch folder in `finally`.
- Imported videos and working files live in the private space and are reached only through signed addresses that expire. Only an exported clip becomes a `Media` row.
- The clip document stores video-anchored things (crops, zooms) in the video's time and overlays (text, stickers, sound) in the clip's time, in whole milliseconds. Never store frames.
- Exported and Scheduled are never stored on a clip; they are read from `lastExportedRevision`, `exportedMediaId` and `ClipPost`.
- Every refusal is one plain sentence from `clips.messages.ts` with a next step. Never a tool's own output, never a path, never a platform's raw error.
- The UI says **video**, **clip**, **layout**, **sticker**, **sound**, **look**, **export**, **AI minutes**; never "source", "proxy", "segment", "asset", "job", "render", "ingest", "transcode", "entitlement", and never "credits" for Clips.
- Everything runs under `CLIPS_SIMULATION=true` locally (the fixture links, the two generated sample videos, the fixture channels and the small library fixtures) with `AI_SIMULATION=true` and `BILLING_SIMULATION=true`; the render is real FFmpeg. A real platform, a real channel list or an outside library source is touched only in Module 03's spike and in the real-test plan, each time with Arvind's OK.
- Logic adapted from an open-source project names the project and its licence in the module's Decision Log row. Nothing is copied from StreamLadder, OpusClip or Postiz.
- Small UI tweaks: the user checks by hand, so skip Playwright for those. Bigger flows (import, the editor, export): use Playwright once, save screenshots to `screenshots/` (never committed).

---

## Names Everyone Uses

| Thing | Name |
|---|---|
| Branch | `sprint-12-clips`, cut from `instagram-direct-and-threads` (pushed, not merged; Sprint 13 is cut from `sprint-12-clips`) |
| Packages | `@postgear/video-engine` (`packages/video-engine`; pure; gains `src/render/` and `src/pricing.ts`), `@postgear/video-preview` (`packages/video-preview`; web only; replaces the old `video-compositions`), `@postgear/storage` (`packages/storage`), `@postgear/media-tools` (`packages/media-tools`; Node only; runs the compiled plan), `@postgear/entitlements` (`packages/entitlements`; new, pure: registry, validation, resolution, cycle, messages) |
| API modules | `apps/api/src/modules/clips`, `apps/api/src/modules/entitlements` (`EntitlementResolver`, `UsageService`, `GET /entitlements/me`), `apps/api/src/modules/admin` (the operator routes, `PlatformAdminGuard`) |
| Render code | `packages/video-engine/src/render/` (`frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`), `apps/worker/src/render/` (the activity that runs it), fonts built by `clips:fonts:build` with a font manifest (a missing font fails with `font_missing`) |
| Contract | `packages/scheduling/src/clips.ts`: queues `MEDIA_TASK_QUEUE = 'postgear-media'`, `RENDER_TASK_QUEUE = 'postgear-render'`, reserved `MEDIA_PY_TASK_QUEUE = 'postgear-media-py'`; workflow id `clip-job:<jobId>`; probe id `clip-probe:<hash of the link>` |
| Workflows | The six with a job row or a waiting caller: `clipProbeWorkflow`, `clipImportWorkflow`, `clipSegmentWorkflow`, `clipHighlightsWorkflow`, `clipRenderWorkflow` (also runs Preview Export, with `proof: true`), `clipDownloadWorkflow`; `clipListChannelWorkflow` is a seventh waiting-caller helper like the probe (03). Small helpers: `clipRuntimeCheckWorkflow` (02), `clipSoundCheckWorkflow` (14), `clipSaveDownloadWorkflow` (18), `mediaVideoFactsWorkflow` (19). Cleanup (`reconcileClipJobs`, `sweepClips`) rides on the maintenance workflow |
| API module | `apps/api/src/modules/clips` |
| Worker | `apps/worker/src/clips/`, `apps/worker/src/workflows/clip-*.workflow.ts`, `apps/worker/src/render/` |
| Web routes | `/[orgId]/clips` (`?tab=create|streams|videos|clips|downloads`), `/[orgId]/clips/video/[videoId]`, `/[orgId]/clips/edit/[clipId]`, `/dev/clips`, `/operator` (operators only, in the `(operator)` group), `/credits/clips` (public) |
| Web components | `apps/web/src/components/clips/` (`home/`, `video/`, `editor/`, `timeline/`, `panels/`) |
| Web client and types | `apps/web/src/lib/clips-api.ts`, `apps/web/src/types/clips.ts` |
| Models | Module 01 adds all of these in one go. Clips: `ClipVideo`, `ClipAsset`, `Clip` (with `lastExportedFingerprint`), `ClipHighlightRun`, `ClipJob`, `ClipPost`, `ClipLayoutPreset`; `Media.durationMs`, `Media.fps`, `Media.origin`. Plans and usage: `PlanEntitlement`, `OrgEntitlementOverride`, `EntitlementChange`, `UsageEntry` (and enums `EntitlementChangeAction`, `UsageKind`). Library: `ClipLibrarySource`, `ClipSound`, `ClipSticker`, `ClipFavourite`, `ClipLibraryRun`, `ClipLibraryDeny`, `ClipLibraryMiss` (enums `ClipSoundKind`, `ClipStickerKind`, `ClipLibraryStatus`; generated `tsvector` columns). Channels: `ClipChannel`, `ClipChannelHidden`. Later: `ClipJob.priority` (02), `ClipVideo.expiryNoticeAt` and `ClipBlockedVideo` (19). No `Plan.clips` |
| Entitlement keys | `clips.enabled`, `clips.max_video_minutes`, `clips.import_minutes_per_month` (meter), `clips.storage_gb`, `clips.retention_days`, `clips.export_max_quality` (720p, 720p60, 1080p, 1080p60; 4k reserved), `clips.export_watermark`, `clips.ai_minutes_per_month` (meter), `clips.concurrent_imports`, `clips.upload_max_gb`, `clips.downloads_per_day` (daily meter), `clips.queue_priority`, `clips.browse_channels` (FREE 1, STANDARD 3, PRO 5, TEAM 10, ULTIMATE 20). The default table is in the sprint doc |
| Env flags | `CLIPS_SIMULATION` (refused when `NODE_ENV=production`), `CLIPS_PLATFORMS` (default `youtube,twitch,kick`; YouTube is switched on in production only after the legal read, D12-15), `WORKER_ROLES` (default `publishing,media,render`), `WORKER_MEDIA_CONCURRENCY` (default 2), `RENDER_CONCURRENCY`, `YTDLP_PATH`, `YTDLP_JS_RUNTIME` (default Deno), `YTDLP_PROXY`, `YTDLP_COOKIES_FILE`, `YTDLP_EXTRACTOR_ARGS`, `YTDLP_SELF_UPDATE` (default `false`), `FFMPEG_PATH`, `FFPROBE_PATH`, `CLIPS_SCRATCH_DIR`, `CLIPS_PRIVATE_BUCKET`, `CLIPS_URL_SECRET`, `CLIPS_TWITCH_CHAT` (default `false`), `TWITCH_CHAT_QUERY` (optional override), `OPERATOR_EMAILS` (comma list; in production `isSuperAdmin` counts only for these), `ENTITLEMENTS_SOURCE` (`db` default; `seed` in an emergency), `CLIPS_LIBRARY_INGEST` (default `false`; the ingest command refuses to start without it), `CLIPS_INGEST_OPENVERSE_OK` (default `false`; set only after Openverse's written OK), `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (a dedicated Twitch application for channel lists), `CLIPS_YOUTUBE_API_KEY` (a separate Google project from the publishing credentials). Removed from the first plan: `CLIPS_GIF_SEARCH`, `KLIPY_API_KEY`, `REMOTION_LICENSE_KEY` |
| Scripts | `npm run clips:doctor`, `clips:samples`, `clips:benchmark`, `clips:stills`, `clips:remove`, `clips:fonts:build` (TTF and OTF twins of the 52 Studio fonts, plus the manifest), `clips:library:ingest`, `clips:library:publish`, `clips:library:remove` (operator only, behind `CLIPS_LIBRARY_INGEST`), `operator:grant`, `operator:revoke` (in `packages/db/scripts`; they set `User.isSuperAdmin` and write a log line) |
| AI Minutes | The meter `clips.ai_minutes_per_month` replaces the `clip_highlights` credit type; there is no `clip_*` credit type any more. Rates in `packages/video-engine/src/pricing.ts` `aiMinutesCost(kind, ms)`: `signals` 0.25 per video minute (charged only for a signals-only Find Clips; a run that also listens includes it free in Sprint 13), `listen` 1.0 (at least 2), `read` 0.25, `action` 0.5, `translate` 0.25 per clip minute, `voice` 1 per 1,000 characters; price = ceil(minutes x rate), at least 1; following the speaker and Detect Camera are free; a stretch is charged once per step. Keys: `clips.import:<jobId>`, `clips.ai:<step>:<jobId>`, `clips.download:<jobId>`, reversal `rev:<entryId>`. Labels: "Find Clips (15 AI Minutes)", chip "38 of 300 AI minutes left". Existing AI credits stay for text and image AI |
| Private keys | `clips/<orgId>/<videoId>/<kind>-<hex>.<ext>`, `clips/<orgId>/exports/<jobId>/...`, `clips/<orgId>/proofs/<jobId>/...` (Preview Export, removed after 24 hours), `clips/<orgId>/library/<hex>.<ext>` (workspace uploads) |
| Public library keys | `library/sounds/<2 hex>/<sha256>.m4a`, `library/stickers/<2 hex>/<sha256>.apng` or `.png`, `library/previews/<2 hex>/<sha256>.webp` (in the public media bucket, immutable) |
| Job stages | IMPORT: `fetching`, `preparing`; SEGMENT: `fetching`; HIGHLIGHTS: `loudness`, `scenes`, `chat`, `scoring`; RENDER: `fetching`, `rendering`, `finishing` (a `proof` render has only `rendering`, shown as "Making the preview"); DOWNLOAD: `fetching` |
| Signal tracks | `loudness`, `scene`, `chat`, `replayed` (each with a version; the tuning set is `signals-v1`); reserved for Sprint 13: `speech`, `faces`, `motion` |
| Notification types | `clip_video_ready`, `clip_video_failed`, `clip_export_ready`, `clip_export_failed`, `clip_video_expiring`, `clip_video_removed`, `clip_storage_over_limit` (after a downgrade) |
| Simulation links | `https://www.youtube.com/watch?v=simtalk0001` (a 3 minute talk), `https://www.twitch.tv/videos/900000001` (a 10 minute stream with chat), `https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000001` (the same stream), plus one private, one live and one missing link per platform. Simulation channels: `acme` on Twitch and Kick and `@acme` on YouTube, about 30 items each |
| Error codes | `link_unsupported`, `link_not_a_video`, `link_private`, `link_live`, `link_not_found`, `platform_resting`, `platform_paused`, `probe_throttled`, `rights_required`, `clips_not_in_plan`, `clips_video_too_long`, `clips_minutes_used` (was `clips_hours_used`), `clips_storage_full`, `clips_upload_too_big`, `clips_quality_requires_plan`, `clips_ai_minutes_used`, `clips_downloads_today`, `channel_not_found`, `channel_limit`, `channel_listing_failed`, `library_item_gone`, `font_missing` (a render, never shown raw), `upload_not_video`, `clip_range_invalid`, `clip_changed_elsewhere`, `clip_not_exported`, `export_running`, `highlights_running`, `format_gone`, `clip_does_not_fit`, `downloads_busy`, `clips_busy`, `tool_failed` (never shown raw). `gif_search_off` and `upload_too_big` are gone (the library is always on; `clips_upload_too_big` replaces the old upload code). The entitlement codes are 402 with whole-number `details` |

---

## Additions Beyond The Sprint Doc

Strike one out here if you do not want it.

| Addition | Module | Why |
|---|---|---|
| `/dev/clips`, a bare test page that runs a sample link to an exported clip | 05 | Proves the riskiest path before the editor exists, and stays as the place to compare the preview with the export |
| A real-network spike report (`../research/14-link-spike-report.md`), written once with Arvind's OK | 03 | The only way to know how each platform treats our server today; fixtures cover the rest |
| A host benchmark (render seconds for each second of clip, at each quality, and for Preview Export), written next to the cookbook's laptop figures | 05 | The plan limits and the "4K or not" answer should come from a number; until then the planning figure is 1.5 to 3 times the clip's length at 1080p30 |
| `packages/entitlements`, the operator screen and a Change Log, built for Clips but generic | 01, 19 | Plans become data an operator edits; every later module reuses it (research 12) |
| The open sound and sticker library with its licence guard, ingest command and credits page | 01, 12, 14, 19 | A real catalogue instead of a handful of files, with licence evidence per item (research 10) |
| My Channels and the Streams tab | 03, 06 | Add a channel by name and import with one click, as StreamLadder's Streams page does (research 11) |
| Preview Export | 05, 15 | The truth check for the browser preview, using the same compiler |
| New design-system pieces (`ColorPicker`, `TimeField`, the timeline family, `TransformBox`, `AiMinutesChip`, `ChannelRow`, `StarButton`), shown on `/dev/components` first | 06, 07, 09, 11, 12, 14 | The editor needs them and Studio can use the colour picker later |
| A poster and a length for every video in Media (new exports, then older uploads) | 05, 19 | The Media library shows a blank tile for video today |
| The real-test plan and the exit gate | after 20 | Arvind's way to test every module for real before Sprint 13 starts |

---

## Progress

Each session updates its row. Status: Not started, In progress, Done, Done with gaps (say which).

| # | Status | Date | Commit | Notes (exports, endpoints, gaps) |
|---|---|---|---|---|
| 01 | Done | 2026-11-18 | uncommitted | video-engine (document, time map, geometry, pricing, jobs), entitlements (registry, 65 seed rows, resolver, usage ledger, `GET /entitlements/me`), Clips, library and channel tables, the rail entry and four tabs. Gap: no specs yet for `EntitlementResolver` and `UsageService` (cache, stamps, consume, reverse, the Postgres race); they go into the testing pass after Module 20 |
| 02 | Done | 2026-11-18 | uncommitted | `packages/storage` (public and private, signed `/clips/files/:token` with Range), media-tools runner and doctor, worker roles on four queues (`postgear-media-quick` added), clip jobs with events, `GET /clips/status`, the reconcile |
| 03 | Done with gaps | 2026-11-18 | uncommitted | `recogniseLink`, the yt-dlp and fixture bindings, the probe (`POST /clips/links/probe`) with breaker, throttle and cache, My Channels with Helix, YouTube Data, flat and simulated listers, the keys guide (`docs/sprint-12/clips-keys-guide.md`). Gap: the real-platform spike and `14-link-spike-report.md` wait for Arvind's OK |
| 04 | Done | 2026-11-18 | uncommitted | Limits guard and import minutes ledger, the concurrent cap with priority, `/clips/videos` (import, uploads, list, get, retry, cancel, delete), the import workflow (proxy, poster, filmstrip, waveform), failure cleanup, the bell rows, the simulation integration test. Real run: the 3 minute talk imported in about 5 s |
| 05 | Done with gaps | 2026-11-18 | uncommitted | The compiler (`frameState`, `buildRenderPlan`, `compileFfmpeg`), `renderClip`, `POST /clips`, `GET /clips/:clipId`, the SEGMENT and RENDER jobs, `POST /clips/:clipId/exports`, `saveRendered`, `/dev/clips`, the parity test. Real run under simulation: a 20 s clip exported at 1080p in 14 s as H.264 High 1080 by 1920 at 30 fps, 600 frames, AAC 48 kHz, index first, JPEG poster, in Media; frame-exact against the source counter; a second export 409 `export_running`; cancel stopped in 5.3 s leaving no scratch. Benchmark (i7-10850H laptop, FFmpeg 9.0.2, x real time): Fullscreen 720p 3.04, 1080p 1.92, 1080p60 1.18, proof 3.73; Blurred 720p 2.14, 1080p 1.28, 1080p60 0.87, proof 3.43; peak memory 192 to 785 MB. Gap: no Playwright pass on `/dev/clips` |
| 06 | Done with gaps | 2026-11-18 | uncommitted | The Clips page (Create, Streams, Videos, Clips, Downloads tabs), the link card and probe, uploads (own multipart uploader), the video cards with live progress, storage meter and AI minutes chip, My Channels (chips, lists, Add A Channel, Browse dialog, hide with Undo), Try A Sample, `/dev/components` specimens. 141 web tests (home, channels). Playwright pass: the Twitch sample link (card, the rights box, import, ready), the same link again, the private, live and Vimeo sentences, Try A Sample ("You already have the sample video."), `simstreamer` added, a stream hidden, shown and imported, the 3 minute file uploaded, a video deleted (the meter fell 651 to 507 MB). Found and fixed: the link card's picture was refused by the browser (see the Decision Log), and every card's menu was named "More Actions" (now "More for {title}"). Gaps: going offline mid-upload, the Free workspace limits and the Clips page in light and Lilac are left to the hand check |
| 07 | Done with gaps | 2026-11-18 | uncommitted | The video page (`/clips/video/:videoId`: player, mark start and end, Create Clip, the timeline with filmstrip and sound, the clips list, Edit Whole Video, `?clip=` opens at a clip), the Clips tab (state filter with counts, Platform filter, sort, grid or list, rename, duplicate, hide, delete), Recent Clips, the API's list, update, open, duplicate, delete, more-video and layouts routes (247 API tests). Playwright pass: the stream sample opened, two ranges marked with I and O, two clips made and listed, one renamed and hidden in the Clips tab (All 4 to 3, Hidden 1). Web tests added: 99 across the video page model, shortcuts, VideoClipList, SourceTimeline, ClipCard and ClipsTab. Found and fixed: Rename from a clip's menu left the name field without the cursor (it now opens after the menu closes), a clip row now gives the name the whole width, and a duplicate is named "(Copy)" |
| 08 | Done with gaps | 2026-11-18 | uncommitted | `clips/edit/:clipId` in the whole window (`navigation/immersion.ts`), the store with history (`editor-state.ts`, `video-engine` `history.ts`), `packages/video-preview` (`PreviewEngine`, two videos, area canvases, scrubbing), `PlaybackStore`, the frame (top bar, tab rail, panel with Back and Next, stage with `useStageScale`, transport, read-only dock with `ResizeHandle`), `ClipAutosave` with the lock, the conflict, refused and sharp-gone alerts, the leave guard, Undo and Redo keys, the shape dialog (`meta.shapeChosen`), the Export tab (Module 05's export). Tests: store 20, autosave 15, frame and shape 13, immersion 5, history 11. Playwright pass: the editor opens from a deep link and plays; Vertical picked; a rename undone and kept after a reload; dark, Classic light and Lilac at 1366 and 1920 with nothing wider than the window. Canvas cost spike on `/dev/clips` (headless Chromium, i7-10850H laptop, one area at 1080 by 1920): 239 frames drawn of 239 presented in 7.9 s, about 1.35 ms a draw, on the video frame clock |
| 09 | Done with gaps | 2026-11-18 | uncommitted | The editing timeline: trim either edge (the start stays under the pointer, the end ripples live), split at the playhead, remove, move and resize overlay items, snapping with guides and Alt to drag freely, zoom in and out with the scale held during a drag and scrolling near the sides, keys from one table (`editor-shortcuts.ts`) shown in the sheet, hatched ends past the sharp stretch, More Video (`MoreVideoRequester`) with `held` on `GET /clips/:clipId`, uploads cut a SEGMENT too. Tests: engine gestures, ruler, scale, snap, visible 56; web dock 22, model 24, more video 7, shortcuts 4. Playwright pass: trim both ends, two splits, delete the middle, undo all, redo all, saved; an end dragged past its old handle (to 148 s, inside the 90 to 170 s held stretch, so rightly no More Video). Bug found and fixed in that pass: a press on a grip moved the edge to the pointer (and could snap it) without any drag; a 3 px dead zone and the grab offset fixed it, with 4 tests. Gap: dragging and resizing zoom bars waits for Module 13 |
| 10 | Done with gaps | 2026-11-18 | uncommitted | The Layouts tab (shape switch with its sentence, the seven layouts as drawn tiles, Custom, Crop Ratio for Blurred, My Layouts: save, apply, rename, delete), the split stage (the Video pane with crop boxes beside the Clip), crop boxes that move, resize keeping their shape, snap with guides, nudge with the arrows, rename and remove from their tag, Add Crop up to four, the shade outside the crops, `applySavedLayout` in the engine, `PreviewEngine.onPicture`, `ChoiceTiles` `columns`. Tests: engine 3 more (152 layout), preview 2 more (35), web model 19, panel 11, crop stage 14, editor 20, files route 5 (API). Playwright pass: every layout, both crop ratios, drag, corner resize, snap and Alt, Add Crop and remove, Save Layout "My Stream" applied on a second clip, all four shapes and back without loss, and that clip exported at 1080p (H.264 High 1080 by 1920, 30 fps, AAC 48 kHz, 20.5 s) with a frame matching the editor. Gaps: the benchmark and `clips:stills` were not run again (Module 05 ran them with layouts); zoom drags wait for Module 13 |
| 11 | Not started | | | |
| 12 | Not started | | | |
| 13 | Not started | | | |
| 14 | Not started | | | |
| 15 | Not started | | | |
| 16 | Not started | | | |
| 17 | Not started | | | |
| 18 | Not started | | | |
| 19 | Not started | | | |
| 20 | Not started | | | |
| 21 | Parked | | | |

---

## Decision Log

| Date | Module | Decision | Why |
|---|---|---|---|
| 2026-11-14 | plan | Sprint 12 is the core (link, manual and AI clips, editor, export, composer, download); speech to text, captions and the Python service are Sprint 13 | Arvind's split: ship a go-to-ready feature first, test it for real, then add the AI layer |
| 2026-11-14 | plan | AI in Sprint 12 uses signals only (loudness, scene changes, Twitch chat) | No transcription in this sprint; signals are cheap and suit streams |
| 2026-11-14 | plan | **Superseded 2026-11-17 (FFmpeg only, below).** The first plan had a React video library draw the preview and the export, with FFmpeg only fetching, cutting and analysing | The idea was one drawing for both; the cost was a licence, a headless browser and slow renders |
| 2026-11-14 | plan | **Superseded 2026-11-17 (open libraries, below).** The first plan had our own sticker pack plus an outside GIF search behind a switch | The pack always works; the outside library gave the big choice, but its storage terms were unclear |
| 2026-11-14 | plan | Zoom and speed, sound effects and music, and download in any format are in Sprint 12 | Arvind picked them |
| 2026-11-14 | plan | No Python in Sprint 12; the Node worker runs yt-dlp and FFmpeg | Keeps deployment simple until the AI layer needs Python |
| 2026-11-14 | plan | A clip is a list of segments with a time map; crops and zooms in the video's time, overlays in the clip's time | So trim, split and speed never move things, and Sprint 13 captions fit without a rewrite |
| 2026-11-14 | plan | A light copy at import, the sharp range when a clip is made | Small disks, and an expired stream cannot block an export |
| 2026-11-14 | plan | Imported videos are private with signed addresses; only exports are public `Media` | The existing storage is public to anyone with the address |
| 2026-11-14 | plan | New queues `postgear-media` and `postgear-render`; one worker entry point with `WORKER_ROLES` | A render must never delay a scheduled post |
| 2026-11-14 | plan | A thin slice (link to exported clip) is built at Module 05, before the editor | Proves fetch, cut and render early, where the risk is |
| 2026-11-14 | plan | AI proposals are `Clip` rows with status NEW; no separate candidates table | One library, as StreamLadder shows it |
| 2026-11-14 | plan | The long video is called a "video" in the UI and `ClipVideo` in the data model (the plan draft said `ClipSource` and "Streams") | Clips is for every kind of video, not only streams |
| 2026-11-14 | plan | Items carry `anchor`: stickers, text and sound effects stay on their moment of the video through trims, cuts and speed changes; music stays on the clip | Research 05: a sticker left behind after a cut is the most common complaint in simple editors |
| 2026-11-14 | plan | FFmpeg is a GPL build run as a separate program; the worker image is kept private | Research 02: LGPL builds have no usable H.264 encoder |
| 2026-11-14 | plan | Uploads use S3 multipart (Uppy core with its S3 plugin), not tus | Research 02: the tus server is ESM only and needs a newer Node than the API runs |
| 2026-11-14 | plan | **Dropped 2026-11-17.** Pinning the first plan's render packages to one exact version | There is no such package any more; FFmpeg 9.0.2 is pinned instead (see below) |
| 2026-11-14 | plan | The risk of platform terms on link import is accepted by Arvind; the build records rights, keeps videos private, removes them after a while and has a takedown path | StreamLadder and OpusClip do the same; the mitigations are in research 07 |
| 2026-11-17 | plan | **FFmpeg only.** One pure compiler (`frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`) turns the clip document into an FFmpeg command; the editor's preview (`packages/video-preview`) is a fast approximation drawn from the same `frameState`; **Preview Export** renders the real result at about 360 pixels wide; the promise is "matches closely, and Preview Export shows it exactly" (D12-04) | Arvind's call: no render licence, no headless Chrome, much faster renders (1080p30 about 0.7 times real time on a busy laptop), a lighter image, easy speed ramps and looks. The cost is a second implementation of the look, guarded by `frameState`, the parity tests and Preview Export |
| 2026-11-17 | plan | FFmpeg facts the compiler relies on: `-/filter_complex graph.txt`, `-fps_mode`, `sendcmd` for crop keyframes (one linear expression per interval), `perspective` for zoom, APNG for animated stickers, ASS with TTF and OTF fonts (a missing font is `font_missing`), `format=yuv420` on overlays, progress with a running maximum, output through `render.mp4.part` | Verified by running FFmpeg 9.0.2 on 2026-11-17 (research 09) |
| 2026-11-17 | plan | **Entitlements.** Limits are data: a registry in `packages/entitlements`, per-plan values, per-workspace overrides with an end date, an append-only Change Log, and an operator screen at `/operator`; no `Plan.clips`, nothing read from `plans.ts` for Clips (D12-07) | A real SaaS changes allowances without a deploy; Clips is the first user |
| 2026-11-17 | plan | **AI Minutes** replace every `clip_*` credit type: a metered allowance on an idempotent ledger with reversals; existing AI credits stay for text and image AI (D12-11) | Clips work scales with video length, not with button presses |
| 2026-11-17 | plan | **Open libraries.** `ClipSound` and `ClipSticker` catalogues from CC0, public-domain and (stickers only) CC BY sources, ingested by an operator command behind `CLIPS_LIBRARY_INGEST`, with licence evidence per item; the outside GIF search is dropped; Openverse and Freesound only after written permission (D12-09, D12-10) | Klipy's terms on keeping copies were unclear; the open catalogue is smaller and the UI says so |
| 2026-11-17 | plan | **Branch**: `sprint-12-clips` is cut from `instagram-direct-and-threads` (D12-02) | That is the branch the tree is on; merge it first if you can |
| 2026-11-17 | plan | **S3 in production**: an S3-compatible bucket pair (public media, private clips); MinIO or the local folder in development (D12-05) | The API and worker are separate processes and signed addresses need object storage |
| 2026-11-17 | plan | **My Channels**: add a Twitch, YouTube or Kick channel by name and browse its streams; Twitch Helix and the YouTube Data API with yt-dlp flat listing as the fallback and for Kick; a new key `clips.browse_channels` (D12-17) | The screenshot audit found StreamLadder's Streams page was missing; a dedicated Twitch app and a separate Google project keep the policies apart |
| 2026-11-17 | plan | **Screenshot coverage audit** across all 48 captures: seven gaps added (My Channels, Edit Whole Video, extra layouts, Looks, 720p 60 fps, the media picker's Clips tab, Coming Up) and Try A Sample (D12-17) | Arvind asked whether everything in the screenshots was covered |
| 2026-11-17 | plan | **YouTube production switch**: YouTube import is on in development and staging and switched on in production only after a legal read, by `CLIPS_PLATFORMS` (D12-15) | YouTube's API policy III.E.1.a is the sharpest risk and the switch is one value |
| 2026-11-17 | plan | The module sizes change: 01, 05, 06, 12, 14 become L, 13 stays M (it may need L), 19 becomes XL; Module 12 builds the sticker catalogue ingest and search, 14 the sound catalogue ingest and search, 19 the operator Plans and Library screens | The cookbook and the research made the scope bigger than a first-plan session |
| 2026-11-18 | 01 | Clip storage keys accept seeded slug workspace ids (`seed-demo-org`), not only UUIDs: a lower-case slug of up to 8 parts, 64 characters at most | The seed's workspaces are slugs; UUID-only keys refused every import on a seeded database |
| 2026-11-18 | 01 | A generated `tsvector` column makes `prisma migrate dev` write two `DROP DEFAULT` lines every time; they are deleted by hand from each new migration (SCHEMA_NOTES, "Sprint 12 additions") | Prisma cannot describe a generated column; the drift was confirmed with `prisma migrate diff` against a scratch database |
| 2026-11-18 | 02 | A third media queue, `postgear-media-quick` (8 slots, the `media` role): probe, channel list and the runtime check run there | A person waits on these for up to 25 seconds; on `postgear-media` they could queue behind two four-hour imports |
| 2026-11-18 | 02 | The worker writes job, video, asset and notification rows itself; it calls the API only for the ledger (charge, reverse), finishing an export (the Media row), `settled` (start the next waiting jobs) and the `reconcile`, on `/internal/clips/...` with the internal token | The worker must never read plan values or the ledger; publishing already writes its own rows the same way |
| 2026-11-18 | 02 | A missing yt-dlp never stops the worker's boot (only FFmpeg and ffprobe do, and the render checks when the render role is on); the runtime check reports it | Uploads and simulation work without it |
| 2026-11-18 | 02 | `CLIP_NON_RETRYABLE` in `packages/scheduling` is exactly the engine's 13 non-retryable codes; `RENDER` jobs get 2 hours | The two lists had drifted; a 30 minute clip at 1080p60 measured about 71 minutes on the busy laptop |
| 2026-11-18 | 03 | The channel limit refusal is 402 `channel_limit` (the docs said `clips_channel_limit` in places) | The entitlement refusal codes have no `clips_` prefix for this key; modules 01, 03, 06 and 19 now say `channel_limit` |
| 2026-11-18 | 03 | The simulation channel is `acme`, with `simstreamer` kept as an alias (Kick's sample links use it) | The README Names table says `acme`; the recorded Kick links say `simstreamer` |
| 2026-11-18 | 03 | The web and the API import only the pure parts of media-tools (`@postgear/media-tools/listing`); a guard test keeps Node built-ins out of it. The channel list request and answer types live in `video-engine` | The API must never pull the runner or FFmpeg wrappers into its process |
| 2026-11-18 | 03 | The too-long refusal names only the plan's longest video length, not the video's own | One sentence that is always true; the video's length is on the card already |
| 2026-11-18 | 04 | A job's priority is a column on `ClipJob` (copied from `clips.queue_priority` at creation), not a field of its input; the video list pages with a cursor | The `settled` and reconcile passes order by it in one query; a cursor stays right while imports land |
| 2026-11-18 | 04 | The light copy has a keyframe every 2 seconds; the filmstrip stores one row of tiles per sheet (`FilmstripMeta.sheet`); the waveform is stored as JSON peaks | Fast scrubbing; a sheet per row loads only what is on screen; JSON is read directly by the canvas |
| 2026-11-18 | 04 | Deleting a video removes its clips that were never exported; exported ones stay (their Media rows are the person's) | Media must never lose a file someone may have posted |
| 2026-11-18 | 04 | Notices: a video notice opens `/<org>/clips/video/<id>`, an export notice `/<org>/clips/edit/<clipId>`; the titles, links and the line under them live in `packages/scheduling` so the worker and the API write the same rows | The two sides had drifted (different titles, tab links on one side) |
| 2026-11-18 | 05 | The export poster is a JPEG beside the file (`<job>.thumb.jpg`, public media space), not WebP | Media's library and every platform read JPEG; the poster is taken from the rendered file |
| 2026-11-18 | 05 | The internal finish route is `POST /internal/clips/jobs/:jobId/finish-export` (the doc said `/internal/clips/exports/finish`); a failed render's code is `tool_failed` | Every internal route is keyed on the job, so a retried activity repeats safely; `tool_failed` is the engine's existing code |
| 2026-11-18 | 05 | The SEGMENT or light-copy choice is one pure function, `pickSharpSource` in `video-engine`, used by the API and the worker | The two copies had started to differ (tie-break, which light copy) |
| 2026-11-18 | 05 | The samples' burnt-in counter is sized from the picture height (7.5 percent) so the whole counter fits a centred 9:16 crop | At 96 px it lost its milliseconds to the crop on the 720p samples, which broke the compare check |
| 2026-11-18 | 05 | Benchmark on the dev laptop (i7-10850H, FFmpeg 9.0.2): see the Module 05 Progress note | Module 10, Module 15's plan limits and the worker box size read it |
| 2026-11-18 | 01 | `plans.ts` never had a Clips object, `clipLimitsFor` or an upload constant on this branch, so there was nothing to remove; Clips limits live only in the entitlement tables | The task assumed an earlier draft |
| 2026-11-18 | 02 | The worker's Clips activities take their own `ClipActivityDeps` (both storages, runner, providers, runtime, internal client), not new fields on the publishing `ActivityDeps` | Publishing's activities never see video tools, and a worker without the media roles never builds them |
| 2026-11-18 | 04, 05 | Each heavy job is one Temporal activity (`clipImport`, `clipRender`) whose steps (fetch, proxy, poster, filmstrip, waveform; prepare, render, finish) run inside one scratch folder, with the bookkeeping in the workflow; not one activity per step | A retry starts from a clean scratch folder; files never have to travel between activities on different hosts |
| 2026-11-18 | 04 | A job's words come from its status first (`jobLabel`): "Done", "Failed" or "Cancelled" once over, the step while running, "Waiting for its turn" while queued. `GET /clips/jobs/:jobId` also gives a running job an estimate from the workspace's recent jobs; a queued job's view never shows `startedAt` (on an import that column is the slot claim) | The real run showed a finished import saying "Waiting for its turn", no estimate on the polling fallback, and a queued job with a start time |
| 2026-11-18 | 04 | The worker's boot log under simulation says links come from the recorded samples, instead of "Link import is not ready" | yt-dlp is not needed while simulating, so the line was wrong |
| 2026-11-18 | all | The heavy sharp image specs (`image-processor.spec.ts`, `media.service.spec.ts`) get a 30 s limit; the thumbnail signer's tamper test flips a whole byte of the MAC | Under the full suite's load they passed the 5 s default; swapping the MAC's last letter left it unchanged 1 time in 16. `validate` is green again |
| 2026-11-18 | 06 | The Streams tab sits second (Create, Streams, Videos, Clips, Downloads) | Browsing a channel is a way in, like the link box, so it sits beside Create |
| 2026-11-18 | 06 | Uploads use our own small multipart uploader (`video-uploader.ts`: signs in batches, three parts at a time, five back-offs, waits for the connection without spending a try), not Uppy | Uppy's core and S3 plugin brought a large bundle for about 300 lines of work; the uploader is fully tested with a fake transport |
| 2026-11-18 | 06 | An upload's length is read in the browser with a `<video>` element before it starts, so a video over the plan's length is refused before any byte goes | Saves a 2 GB upload that the API would refuse at the end |
| 2026-11-18 | 06 | The AI minutes chip is neutral and turns to a warning under 10 percent left | One loud colour per page; violet is only Find Clips |
| 2026-11-18 | 06 | `POST /clips/channels/check` resolves a channel name without saving it (Add A Channel's Check) | The dialog shows who the channel is before it is added |
| 2026-11-18 | 07 | The module's Source filter is called **Platform** in the UI (YouTube, Twitch, Kick, Upload) | "Source" is on the list of words the UI never uses |
| 2026-11-18 | 07 | The plain edit route of Module 07 was skipped: Edit opens Module 08's editor directly | The editor landed in the same session |
| 2026-11-18 | 07 | Filmstrip sheets are drawn without `crossOrigin` | The signed file answer carries no CORS header for images; a canvas only needs it when it is read back, which it never is |
| 2026-11-18 | 07 | The video page plays the light copy in a native `<video>` with its own small store (`source-player.ts`), not the `PreviewEngine` | It shows the whole video, not a clip document; the engine stays the editor's |
| 2026-11-18 | 07 | Track A: the timeline zoom has a fixed base of 0.1 px per ms; the largest zoom shows one frame at 24 px; the ruler uses one ladder (frames, then 1 s up to 1 h) and the first step whose labels are 64 px apart; snapping lives inside the drag reducers; item edits are in `time/items.ts` | One maths for the video page and the editor timeline |
| 2026-11-18 | 07 | Track D: a clip's state (new, draft, exported, scheduled, hidden) is worked out on every read, never stored; Scheduled means a scheduled post uses the export of this revision; opening is `POST /clips/:id/open`; a duplicate takes a serializable lock; a rename keeps the export current; More Video is capped at an hour around the clip | A stored state would drift from posts and exports |
| 2026-11-18 | 07 | Known API gaps from Track D, for Module 19 or 20: More Video answers `ready` for an upload, but the export reads only the sharp range or the light copy, so an upload clip trimmed outward can export from the light copy; a deleted clip keeps its proof files; More Video runs no storage check | Found while building, not fixed in this module |
| 2026-11-18 | 08 | `immersion()` moved to `components/navigation/immersion.ts` with its own tests; `clips/edit/{clipId}` (exactly that depth) is `fixed`, Studio and Workflows unchanged | The shell file is a client component with many imports; the rule is now a pure tested function |
| 2026-11-18 | 08 | Undo history is copied into `video-engine` as `history.ts` (`createHistory`, `pushHistory`, `undoHistory` and the rest), not moved out of `design-engine` | Studio stays untouched, and `video-engine` may import no other workspace; the names carry "History" because the index exports everything flat |
| 2026-11-18 | 08 | A history step holds the document and the clip's name together; `meta` is carried onto the version an undo or redo lands on | Undo brings an old name back as it brings back an old trim; the shape answer must survive an undo, or the question would come back on the next open |
| 2026-11-18 | 08 | The editor reuses Studio's pure helpers by import (`editorShortcut`, `keyPlaceOf`, `leaveHref`, `settleWithin`, `saveInWorkspace`) | One behaviour for keys, leaving and the workspace check in both editors |
| 2026-11-18 | 08 | The shape dialog carries its own Back To Video beside Continue | The editor's back button sits under the modal dialog, and the blueprint says the back button is the way out |
| 2026-11-18 | 08 | `ChoiceTiles` takes an optional `drawing` and `line` per option (the shape dialog's pictures and lines) | The blueprint asks for a drawing and a line on each tile; every other use is unchanged |
| 2026-11-18 | 08 | The Export tab's quality is a `Select` listing only what the plan allows | Four qualities do not fit a `w-80` panel as a `Segmented` |
| 2026-11-18 | 08 | A clip whose stored document no longer reads opens a page with one sentence and the way back (`ClipUnreadable`), not the editor | Nothing can be edited, and an editor over a stand-in document could save it over the real one |
| 2026-11-18 | 08 | Track C (D12-PREV-1 to 3): one engine with two `<video>` elements and area canvases drawn from `frameState`; contiguous parts never swap; a join that is not ready holds the last frame and reports buffering. The canvas cost spike's numbers are read on `/dev/clips` (`measure: true`) in the Playwright pass | Research 05 section 2 |
| 2026-11-18 | 06, 07 | Bugs found by the web tests and fixed: a deleted video lowered the count by two in development (a state update inside an updater); a Cancel pressed while the upload's row was being made left the row behind; the channel browser's "Updated N minutes ago" read low on a fresh list; the playground's Add A Channel reached the real routes | StrictMode runs updaters twice; the others were real gaps |
| 2026-11-18 | 09 | `GET /clips/:clipId` answers `held`: the sharp stretch around the clip (the covering SEGMENT, else the one sharing the most time with it; `heldRange` in `video-engine/sources.ts`), mirrored in the web `ClipDetail` | The timeline hatches what lies past it, and a trim's `needsMoreVideo` needs it; `sharp` alone could not say where the stretch ends |
| 2026-11-18 | 09 | More Video on an upload now cuts a SEGMENT from the kept original, like a link | It answered `ready` without one, while an export reads only a SEGMENT or the light copy, so an upload trimmed outward exported soft (the Track D gap, fixed) |
| 2026-11-18 | 09 | More Video always asks for the whole clip range, whenever the saved document reaches past `held` (a drag, an undo, a redo alike), through `MoreVideoRequester`: 600 ms debounce, one request at a time, the newest range wins, the same range once, a 429 waits 10.5 s, a dropped connection is tried three times | An export reads one stored stretch that covers every part, so a tail alone would never make it sharp; asking from the document rather than the gesture covers every way a range can grow |
| 2026-11-18 | 09 | While the sharp video is coming, the editor reads the clip again every 4 seconds (not while the tab is hidden), taking only `sharp` and `held` | The first fetch's job id is not known to the editor; the signed playing address is left alone so the picture never reloads |
| 2026-11-18 | 09 | A start edge trimmed inward stays under the pointer until release (the parts after it are drawn shifted, the playhead too), then the clip closes up; an end edge ripples live; a drag let go where it began is no undo step | The edge follows the hand, as in CapCut; the document underneath is the engine's ripple result all along |
| 2026-11-18 | 09 | The scale holds still during a drag, the dock keeps 96 px after the clip's end at every zoom, and the view scrolls along near its sides | At the fit zoom the clip's end sat on the dock's edge, so it could not be dragged outward |
| 2026-11-18 | 09 | Selecting an item or a zoom opens its panel; selecting a part does not (Enter on a part opens Effects) | A part is selected to split or remove it; moving the panel on every press would throw away what the person had open |
| 2026-11-18 | 09 | The video's own sound is a slim "Video Sound" row under Video; any kind (Overlay, Zoom, Sound) opens a second row of its kind when two of its bars overlap | Overlapping sounds would hide each other just as overlays do |
| 2026-11-18 | 09 | Zoom bars select and remove only; dragging and resizing them is Module 13 | The engine has no zoom gestures yet (zooms live in source time) |
| 2026-11-18 | 09 | The switch is labelled "Snapping" (kept in `localStorage` `postgear.clips.snapping`), and Split and Remove are ghost icon buttons with the reason they are off in their tooltips | A switch's label is a form label (sentence case), one word avoids the clash with "Enable Snapping"; the timeline tools are icon-only ghost buttons, as the workflow step card's delete |
| 2026-11-18 | 09 | `TimelineBar` takes `hatchUntilPx` (a hatched start) beside `hatchFromPx` | A start trimmed back past the stretch we hold is hatched at the bar's left |
| 2026-11-18 | 09 | One key table, `editor-shortcuts.ts` (`clipShortcutFor`, `CLIP_SHORTCUT_GROUPS`); the sheet lists the same table grouped Playback, Editing, Timeline; Ctrl+D is taken only when an item is selected | The sheet can never promise a key that does nothing; with nothing to copy, Ctrl+D stays the browser's |
| 2026-11-18 | 07, 09 | The filmstrip, waveform and card preview are hidden from screen readers by a `display: contents` wrapper | Biome counts `<canvas>` and `<video>` as focusable and refuses `aria-hidden` on them |
| 2026-11-18 | 10 | `ChoiceTiles` and `ChoiceTilesMany` take `columns` (2, 3 or 4) to wrap a longer set into a grid | Seven layouts do not fit one row of a `w-80` panel; one row stays the default everywhere else |
| 2026-11-18 | 10 | The shape switch is a `Segmented` showing the ratios (9:16, 16:9, 1:1, 4:5) with the names as tooltips, and a sentence under it says what the shape is for | Four names do not fit the panel; the ratio is what people know, the sentence names it (4:5 is "Portrait" from `RATIO_LABELS`) |
| 2026-11-18 | 10 | The crop snapping switch reads "Enable snapping" and is kept apart from the timeline's (`postgear.clips.cropSnapping`) | A form label is a sentence; snapping crops and snapping edges are different habits |
| 2026-11-18 | 10 | Crop boxes take the action tones in order (blue, green, violet, yellow), with a thin dark edge and the video shaded outside every crop | A border alone vanished on a picture of the same colour (green on a green wall), found in the Playwright pass; the shade shows what lands in the clip |
| 2026-11-18 | 10 | A corner resize follows whichever direction changes the box more, keeping the shape and the opposite corner; a side handle scales around its opposite edge | Taking the larger of the two widths meant a drag inward could never shrink the box |
| 2026-11-18 | 10 | `applySavedLayout` keeps a saved layout's frames, fits each cover crop inside its saved crop for this video, keeps area ids by place and never reuses a saved id | A layout saved on one video must fit any other video without stretching, and ids must stay unique per clip |
| 2026-11-18 | 10 | The Video pane draws the picture the preview engine already shows (`PreviewEngine.onPicture`), not a third `<video>` | One decode for both panes, and the two always show the same frame |
| 2026-11-18 | 10 | The stage tree is the same on every tab; the Layouts tab only adds the Video pane beside it | Remounting the stage restarted the preview and lost the picture on every tab change |
| 2026-11-18 | 10 | Delete removes a selected crop (never the last one: the tag menu and the key both say "A layout needs at least one crop.") | Delete already removes whatever is selected in the editor |
| 2026-11-18 | 10 | A new crop is named "Crop 3", "Crop 4" (the next number no crop uses), and a spoken name that already says crop is not doubled | The engine's own default, "Area 3", is not a word the UI uses, and a crop renamed "Face Crop" was read as "Face Crop Crop" |
| 2026-11-18 | 07 | A duplicated clip is named "Name (Copy)" | Matches Studio, brand kits and automations, and keeps the name Title Case |
| 2026-11-18 | 06 to 10 | Bugs found by the Playwright pass and fixed: the signed files route sent helmet's `Cross-Origin-Resource-Policy: same-origin`, so the browser refused every video, filmstrip and poster from the API (now `cross-origin` with a `sandbox` CSP, as `/uploads`, with 5 route tests); `ClipsDesktopOnly`, a server component, passed an icon to a client component and crashed every Clips route (now a client component); a deep link opened before the workspace cookie was set answered 500 (the edit and video pages now wait, as Studio does) | None of the three shows in jsdom; each one blocked the module in a real browser |
| 2026-11-18 | 06 | The link card's picture route (`/clips/links/thumbnail`) says `Cross-Origin-Resource-Policy: cross-origin`, set before the fetch so a refusal reaches the page as its real status; only a picture is cached | Helmet's `same-origin` made the browser refuse the picture, and a refusal read as a blocked response; 3 route tests |
| 2026-11-18 | 07 | Rename from a clip's menu opens the name field in the menu's `onCloseAutoFocus` | The open menu's focus trap pulled focus out of the new field and the closing menu gave it back to its button, as the composer's inserts already handle |
