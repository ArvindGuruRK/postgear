# Module 11: Montage And Batch Export

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 03](module-03-captions.md) (document version 2); Sprint 12
> **Stories**: CA-7.1, CA-7.2
> **Next**: [Module 12](module-12-more-sources-and-platforms.md)

## Goal

After this module people work on many clips at once. Ticking clips in the Clips tab brings up a bar with **Export All**, **Create Montage**, **Hide** and **Delete**. Export All renders each ticked clip, shows a list with progress, lets one failure pass without stopping the rest, and sends one notice at the end. Create Montage stitches two to fifteen clips, from one video or several, into a single clip that opens in the editor and exports like any other.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) section 9.
- User stories: Journey C steps 4 and 5; CA-7.x; section 5 (locked qualities in a batch, different shapes in a montage).
- Decisions: D13-16 (the FFmpeg compiler). Research: [`09-ass-captions-and-edit-cookbook.md`](../research/09-ass-captions-and-edit-cookbook.md) section 8 (**verified** montage: per-segment chains then `concat`, the `xfade` and `acrossfade` Fade join, the 0.3 s per join shortening) and 14.1. Sprint 12 research [`12-plans-entitlements-and-usage.md`](../../sprint-12/research/12-plans-entitlements-and-usage.md) section 13 (`clips.queue_priority`, `clips.export_max_quality`).
- Sprint doc: The Clip Document (`sources[]`, reserved for this in Sprint 12).
- Research: [`01-reference-features.md`](../research/01-reference-features.md) (StreamLadder's montage maker); Sprint 12's [`05-editor-and-render.md`](../../sprint-12/research/05-editor-and-render.md) (the render compiler, one input per source, the preview).
- Code: Sprint 12 Modules 05 and 15 (the export route, `clipRenderWorkflow`, the render's prepare step and `sharpSourceFor`, the render queue and its abuse limits in Module 19), Module 07 (the Clips tab and cards), `packages/ui` (`BulkActionBar`), `apps/web/src/components/studio/slides-rail.tsx` (a sortable list), the engine's `time/` and `captions/map.ts`, the render compiler in `packages/video-engine/src/render/` (`frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`) and `packages/video-preview`.

## Design

### 1. Selecting Clips

- `ClipsTab` cards gain a tick box (top left; visible on hover, always visible once any is ticked; Shift-click ticks a range). Selection is page state, cleared on a filter change.
- `BulkActionBar` (from the design system): "8 selected", **Export All** (primary), **Create Montage** (secondary; enabled from two), **Hide**, **Delete** (danger, with the usual red confirm naming the count), and a clear button.
- `PATCH /clips/bulk` `{ clipIds, status }` and `DELETE /clips/bulk` `{ clipIds }` (up to 50 ids, all in the workspace or the whole request is refused).

### 2. Export All

- `POST /clips/exports` `{ clipIds (up to 30), quality }`: for each clip, the same checks and freezing as the single route (Sprint 12 Module 15). A clip whose plan does not allow the quality is exported at the best allowed one and marked so in the answer; a clip that is already exported and current is skipped and marked so; a clip with an export already running is left alone. Creates a batch id (a UUID stored in each job's `input.batchId`) and answers `{ batchId, jobs: [{ clipId, jobId | null, note }] }`.
- Sprint 12's per-workspace limit of three queued renders is replaced by a fair queue for batches: jobs are created QUEUED, and a small scheduler in the API (run when a render ends and from the maintenance pass) starts the next job so that each workspace has at most one render running and workspaces take turns. The turn order reads the entitlement **`clips.queue_priority`** (`low`, `normal`, `high`; Sprint 12 research 12): it is copied into `ClipJob.priority` when each job is created (so a plan change mid-batch does not reorder running work), higher priority workspaces are picked first, and equal ones take turns oldest first. A paid plan's batch therefore overtakes a free plan's, and no workspace can starve another. Quality is checked per clip against `clips.export_max_quality` (a clip above it is exported at the best allowed quality and noted; the 402 `clips_quality_requires_plan` is kept for the single route). Record this change in the Decision Log, since it alters a Sprint 12 rule. Module 15 audits it under load.
- The notice: when the last job of a batch ends, one `clip_export_ready` notification ("8 clips are ready", or "6 clips are ready, 2 could not be exported") instead of one per clip. The per-clip notification is suppressed for jobs with a `batchId`.
- `GET /clips/exports/batches/:batchId`: the jobs with their states, for the list.
- The dialog (blueprint section 9): the quality tiles, the clips with their notes, **Export**. Then the same dialog becomes a list with a `Progress` per clip, live through one SSE stream for the batch (a small extension of the job events service that follows several jobs). It can be closed and reopened from a small "Exporting 8 clips" chip in the Clips page's `PageActions`.
- When the clips share a recipe with an export quality, that quality is preselected.

### 3. Montage In The Engine (`packages/video-engine/src/montage/`, pure)

`createMontage(clips, { ratio, transition, titleCard })` returns a new document:

- `sources`: the union of the clips' sources, re-keyed so ids do not collide.
- `segments`: each clip's segments in order, clip after clip. Hook segments are dropped (a hook belongs to a single clip).
- `layout`: the montage has one layout for the whole document, but each clip was framed its own way. So crops must travel with the segments: add an optional `layoutOverride` to a segment (`areas` with frames and crop keyframes) in the version 2 schema; when present, `buildRenderPlan` and `frameState` use it for that segment, and the compiler writes that segment's own chain (its own crop expression with segment-relative key times). Each montage segment carries its clip's layout as an override. The montage's own `layout` is the first clip's, used for anything without an override.
- `zooms` and `bleeps`: copied with their sources re-keyed (they are in the video's time, so they simply follow).
- `tracks`: overlay and sound items are copied with their start shifted by the length of the clips before them, `anchor` kept. A captions track: if every clip with captions uses the same transcript language, one captions track per source transcript is needed; simplify by allowing several captions tracks in a montage document (one per transcript asset) with the style of the first. State this in the schema.
- `transition`: `'cut'` adds nothing. `'fade'` is a 300 ms picture and sound mix at each join, held as a `joins` list on the document (`[{ beforeSegment, kind: 'fade', ms: 300 }]`) and drawn by the compiler (section 4). **A fade join overlaps the two sides, so it shortens the clip by 0.3 s per join** (a montage with fades lasts `sum(durations) - 0.3 x joins`): the time map in `time/` includes the overlap, so every later caption, bleep, sticker and sound moves 0.3 s earlier per earlier join (research 09 section 8, last bullet). `createMontage` shifts each clip's items by the length of the clips before it **minus** the overlap of the joins before it, and `frameState`'s output-time map uses the same rule, so preview and export agree.
- `titleCard` (optional): a 2 second opening scene with the given line in the first clip's hook look over a dark background, drawn by the compiler from a `color` source plus an ASS text event with silent `anullsrc` sound (the same card Module 10's outro uses; build it once in `render/` and share it).
- Shapes: clips of different shapes cannot be stitched as they are. The dialog asks for one shape; each clip is re-fitted to it with `setCanvasRatio`'s rules before stitching.
- Limits: 2 to 15 clips, and the total within a montage maximum of 20 minutes (`MONTAGE_MAX_MS`); the single-clip maximum does not apply to documents with `origin: MONTAGE`.
- Tests: order and lengths add up (with fades, minus 0.3 s per join); sources re-keyed; an item on a moment in clip three is still on its moment, also after two fade joins; captions from two videos both show at the right output times; different shapes are re-fitted; hooks dropped; the limits.

### 4. Montage In The API, The Render And The UI

- `POST /clips/montages` `{ clipIds (in order), ratio?, transition, titleCard? }`: loads the clips (all in the workspace), 422 `montage_shapes_differ` when shapes differ and no `ratio` is given, builds the document with `createMontage`, writes a `Clip` with `origin: MONTAGE` (`prisma-change` for the enum value), `videoId` set to the first clip's video and a `meta.videoIds` list for the rest, and answers `{ clip }`.
- The montage is a snapshot: later changes to the original clips do not change it. Say so in the dialog ("Changes you make to these clips later will not change the montage.").
- Rendering: `sharpSourceFor` and the render's prepare step handle several sources already in principle (one file per source); make them fetch each source's sharp range (the union of that source's segments plus handles), and prove it with a two-video montage in the tests. The compiler then opens each run of each source as its own `-ss` input and builds **a chain per segment** (`trim`, `setpts=PTS-STARTPTS`, that segment's layout and crop, then `scale`, `setsar=1`, `fps` and `format=yuv420p` to the output size, and audio `aformat=sample_rates=48000:channel_layouts=stereo`), so every segment ends in the same size, SAR, frame rate and pixel format. A segment of a different shape gets its own fit (a blurred fit is a downscaled blurred copy behind the picture). The segments join with `concat` for a **Cut**, or, for a **Fade**, with `xfade=transition=fade:duration=0.3:offset=<computed>` chained for the picture and `acrossfade=d=0.3:c1=tri:c2=tri` chained in the same order for the sound. The offset is in the output of the previous join, so the compiler **computes** it (sum of the earlier durations minus the earlier fades), never by hand. `xfade` needs equal size, frame rate, pixel format and SAR on both inputs, which the chain endings guarantee. All verified on FFmpeg 9.0.2 (research 09 section 8): a Fade montage of 8 s of parts came out 7.400 s with the pictures mixed at the joins. The compiler asserts the output duration against the plan and fails the job when the file differs by more than one frame. A montage costs more to compile than a clip (the fade version took about 1.5 times the CPU of the cut version in the spike), which Module 15's cost lines count.
- **In the editor**, `PreviewEngine` plays the montage segment by segment and shows a fade as a quick mix of the two pictures; it is an approximation, and **Preview Export** shows the join exactly. When a montage's videos include one that was removed, the montage cannot be opened or exported: "One of the videos in this montage was removed."
- Removal rules (Sprint 12 Module 19): a montage is an unexported clip of every video it uses; removing any of them removes the montage unless it was exported (its `Media` file stays).
- The dialog (blueprint section 9): a sortable list of the ticked clips (drag to order; each with its length; the total at the foot), **Between Clips** (`Segmented`: **Cut**, **Fade**), an optional title ("Enter your title"), **Shape** (shown only when shapes differ), the snapshot line, **Create**. Then the editor opens on the montage.
- In the editor a montage behaves as a clip with many parts. The timeline's Video row shows a thin divider and each original clip's name at its first part. Layout tools act on the selected part's override.
- Clip cards show a small "Montage" badge.

### 5. Tests

- Engine: section 3.
- API: bulk routes (all-or-nothing tenancy), the batch (notes for locked, current and running clips; fair starting order with two workspaces; one notice; a failure does not stop the rest), montage creation (order, shapes, limits, tenancy), removal rules.
- Worker and compiler: a two-video montage fetches two sharp ranges; a real-FFmpeg render of a cut montage and a fade montage of different-shaped parts has the plan's exact duration (the fade one shorter by 0.3 s per join) and a frame stamped at a known output time shows the right part (before, during and after a join); a part with a `layoutOverride` is cropped by its own expression; the title card shows its text; the batch notice.
- Preview: `frameState` for a fade montage agrees with the compiler's offsets at the joins.
- Web: ticking and Shift-click, the bar, the Export All dialog and list, the chip, the montage dialog (sorting, shape, limits), the divider on the timeline.

## Scope

**In**: selection and the bulk bar, bulk hide and delete, Export All with a fair queue (priority from `clips.queue_priority`) and one notice, montage in the engine, the API, the render and the editor.
**Out**: a montage that updates when its clips change, transitions other than a cut and a fade, automatic "best of the week" montages (Module 17), exporting a batch as one zip.

## Tasks

- [ ] Tick boxes, `BulkActionBar`, bulk hide and delete.
- [ ] `POST /clips/exports`, the fair scheduler reading `clips.queue_priority`, the batch notice, the batch events stream, the dialog, list and chip.
- [ ] `montage/`: `createMontage`, `layoutOverride`, `joins` and the fade overlap in the time map, several captions tracks, the title card, limits, with tests.
- [ ] `POST /clips/montages`, `MONTAGE` origin, `meta.videoIds`, removal rules.
- [ ] Several sources in `sharpSourceFor` and the render's prepare step; per-segment chains, `concat` and the `xfade` plus `acrossfade` Fade join in `compileFfmpeg`.
- [ ] The montage dialog; the editor's dividers and badge.
- [ ] Title-case test green.
- [ ] Playwright once under simulation: tick three clips, Export All, see one notice; tick two clips from two videos, Create Montage with Fade, export. Screenshots in `screenshots/`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js montage time render
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/worker/jest.config.js render clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/home
```

## Done When

- Ticking clips shows the bar; Hide and Delete act on all of them, with a confirm for Delete.
- Export All exports each ticked clip, one after another, with a live list, and the bell shows one notice with the counts.
- A clip the plan cannot export at the chosen quality is exported at the best allowed one, and the list says so.
- Two workspaces exporting at once take turns, and a workspace with higher `clips.queue_priority` is started first.
- A montage of clips from two videos opens in the editor, plays in order with the chosen join, keeps each clip's framing, text and captions, and exports; with Fade it is 0.3 s shorter per join and every caption still sits on its word.
- Clips of different shapes ask for one shape first.

## Hand Check

With the three simulation flags on and the demo admin:

1. Clips tab: tick three drafts (Shift-click the third). The bar says "3 selected".
2. Export All at 720p: the list shows each clip's progress. Close it: the chip stays. When done, the bell has one notice.
3. Tick two clips from different videos, one vertical and one square: Create Montage asks for a shape. Pick Vertical, Fade, a title, Create.
4. The editor opens: the timeline shows two named groups of parts; play through the join.
5. Export the montage; play it.
6. Tick two clips and Delete: the confirm names the count.

## Handoff

Module 15 measures batch load, audits the fair queue and the montage cost lines. Module 17 holds automatic weekly montages.
