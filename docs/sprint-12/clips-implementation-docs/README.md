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
| 01 | [Contracts And Data](module-01-contracts-and-data.md) | L | - | foundations (plans, entitlements, the AI minutes ledger, the library and channel tables); CL-1.1 (rail, small-screen sentence), CL-13.1 (the plan values) | Not started |
| 02 | [Media Runtime](module-02-media-runtime.md) | L | 01 | foundations; CL-13.3 | Not started |
| 03 | [Link Engine](module-03-link-engine.md) | L | 02 | CL-1.2 (server side), CL-1.7 (server side: the channel lister), CL-13.4 | Not started |
| 04 | [Import Pipeline](module-04-import-pipeline.md) | L | 03 | CL-1.4, 1.5, 1.6 (server side) | Not started |
| 05 | [Thin Slice: Render A Clip With FFmpeg](module-05-thin-slice-render.md) | L | 04 | foundations for CL-10.1 and CL-10.4 | Not started |
| 06 | [Clips Home And Videos](module-06-clips-home-and-videos.md) | L | 03, 04 | CL-1.1 to 1.6, CL-1.7 (UI), CL-1.8, CL-2.1, 2.3, 2.4, CL-2.5 | Not started |
| 07 | [Manual Clipping And The Clips Library](module-07-manual-clipping-and-clips-library.md) | L | 05, 06 | CL-3.1 to 3.4, CL-2.2 | Not started |
| 08 | [Editor Shell](module-08-editor-shell.md) | L | 05, 07 | CL-5.1, 5.2, 5.4 | Not started |
| 09 | [Timeline](module-09-timeline.md) | L | 08 | CL-5.3, 5.5 | Not started |
| 10 | [Layouts And Crops](module-10-layouts-and-crops.md) | L | 09 | CL-6.1 to 6.3 | Not started |
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
| 01 | Not started | | | |
| 02 | Not started | | | |
| 03 | Not started | | | |
| 04 | Not started | | | |
| 05 | Not started | | | |
| 06 | Not started | | | |
| 07 | Not started | | | |
| 08 | Not started | | | |
| 09 | Not started | | | |
| 10 | Not started | | | |
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
