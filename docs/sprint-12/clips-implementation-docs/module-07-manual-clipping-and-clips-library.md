# Module 07: Manual Clipping And The Clips Library

> **Sprint 12, Clips** | Status: Done with gaps (see the README Progress row) | Size: L (one full session)
> **Depends on**: [Module 05](module-05-thin-slice-render.md), [Module 06](module-06-clips-home-and-videos.md)
> **Stories**: CL-3.1, CL-3.2, CL-3.3, CL-2.2; CL-3.4 (Edit A Whole Video)
> **Next**: [Module 08](module-08-editor-shell.md) (Editor Shell)

## Goal

**Demo 2.** A user opens a video, plays it with our own controls, moves around a timeline that shows pictures and the sound's shape, marks a range with I and O, presses Create Clip, and finds the clip in the list beside the video and in the Clips tab with its state. A user can also press **Edit Whole Video** to make a clip over the whole video in one step (up to 30 minutes), and the Clips tab can be filtered by where the video came from and shown as a list or a grid. Edit opens a bare editor page (a plain video that plays the clip's range, and the Export button from Module 05) until Module 08.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 4, 5, 7 (the ruler, zoom and playhead rules), 11, 13, 15 (the new timeline pieces).
- User stories: Journey B; CL-3.x, CL-2.2; section 5.
- Sprint doc: Screens (Video Page), API Routes (the clip rows), Database (`Clip`, `ClipPost`).
- Research: [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), "Patterns That Repeated Across Projects" (pixels per second and zoom, the ruler ladder, drawing only what is visible, playhead sync) and the notes on `xzdarcy/react-timeline-editor` and `opencut-classic`.
- Code: Module 04's asset `meta` types (`packages/video-engine/src/assets.ts`); Module 05's clip routes and export route; `apps/web/src/components/studio/canvas-model.ts` and `ZoomControls` in `editor-canvas.tsx`; `apps/web/src/components/workflows/builder/builder-shortcuts.ts` (a shortcut table and its handler); `apps/web/src/components/studio/studio-editor-model.ts` (`shortcutOf`, ignoring keys while typing); `apps/api/src/modules/studio/studio.service.ts` (list with counts, optimistic `revision`); `apps/api/src/modules/posts/` (how a post group's state is read, for Scheduled).

## Design

### 1. Timeline Maths (`packages/video-engine/src/timeline/`, pure)

Everything the screen needs to turn time into pixels lives in the engine, so it is tested once and reused by the video page and the editor:

- `scale.ts`: `pxPerMs(zoom, base)`, `msToPx`, `pxToMs`, `fitZoom(durationMs, widthPx)` (the smallest zoom shows everything), `zoomAround(zoom, factor, anchorMs)` (zooming keeps the anchor still), and an exponential slider mapping.
- `ruler.ts`: `RULER_STEPS_MS` (the ladder in the blueprint, from one frame up to one hour) and `rulerTicks(fromMs, toMs, pxPerMs, minGapPx = 64)` returning only the ticks in view with their labels.
- `visible.ts`: `visibleRange(scrollPx, widthPx, pxPerMs)` and `tilesInRange(meta, fromMs, toMs)` for the filmstrip.
- Tests for each, including a 6 hour video at the smallest zoom and a 20 second clip at the largest.

### 2. New Design-System Pieces

Each is shown on `/dev/components` first.

- `VideoPlayerBar` (`packages/ui`): ghost icon buttons with `TooltipHint` and shortcuts (back 5 seconds, play or pause, forward 5 seconds), the time as text ("12:04 / 3:42:10"), and a slot on the right. No shadow.
- `TimeRuler`, `Playhead`, `TimelineRow` (`packages/ui`): presentational, driven by props in pixels; rows are `bg-inset`.
- `Filmstrip` and `Waveform` (`components/clips/timeline/`): each a `<canvas>` that draws only the visible range. The filmstrip loads sprite sheets lazily through their signed addresses and draws the tiles for the visible window; the waveform draws mirrored bars from the peaks. Both redraw on scroll, zoom and resize through one `requestAnimationFrame`.

### 3. The Video Page (`/[orgId]/clips/video/[videoId]`)

- Server page: `serverApi` for `GET /clips/videos/:videoId`, `notFound()` on 404; renders `<VideoPage>` inside `ClipsDesktopOnly`. A video that is not READY shows its card state and a link back.
- `PageActions`: the back link ("Videos", secondary, small, left-arrow `MotionIcon`), the title as text, the platform badge and the length.
- `SourcePlayer` (`components/clips/video/source-player.tsx`): a plain native `<video>` on the proxy's signed address (this page plays one file, and a native element scrubs a 6 hour file best; the editor's own `PreviewEngine` from `video-preview` arrives in Module 08 and is a different thing). It exposes `currentMs`, `play`, `pause`, `seek`, and refreshes the signed address shortly before it expires without losing the position.
- `SourceTimeline`: the ruler, the filmstrip, the waveform, the playhead, the marked range (a band with two draggable handles and its length), every existing clip's range as a line, and (from Module 16) the AI marks. Click to seek, drag the playhead to scrub, scroll sideways, zoom with the buttons, **+** and **-**, or Ctrl and the wheel. On open it fits the whole video.
- Marking: **I** and **O** (and their buttons) set the start and end at the playhead; the range is clamped to `CLIP_MIN_MS` and `CLIP_MAX_MS` and the button says why when it is disabled ("A clip needs at least 3 seconds.", "A clip can be up to 30 minutes."). **Create Clip** calls `POST /clips`, adds the clip to the list, clears the range and shows a toast with **Edit**.
- **Edit Whole Video** (story CL-3.4, a secondary button in the `PageActions` row and an item in the video card's menu on the Videos tab): makes a clip over the whole video in one press with no range to mark. It calls `POST /clips` with `{ videoId, whole: true }`; the server builds the document with `createClipDocument({ fromMs: 0, toMs: durationMs })`, titles it "{video title}", and the web goes straight to the edit route. It works for videos up to `CLIP_MAX_MS` (30 minutes, raised in Module 01); for a longer video the button is disabled with the sentence "Edit Whole Video works for videos up to 30 minutes. Mark a range to make a clip." A whole-video clip fetches its sharp range like any other when it is first edited or exported, and that range counts toward video space (`clips.storage_gb`), so the usual `clips_storage_full` sentence applies.
- Shortcuts through one table (`video-shortcuts.ts`): Space, J, K, L, left and right (one second, with Shift five), I, O, Enter (Create Clip when a valid range is marked), +, -. They do nothing while typing or in a dialog.
- The right column: a card with a disabled **Find Clips** carrying the tooltip "Arrives in a later step of this sprint." (Module 16 turns it on and puts its price in AI Minutes in the label, with the AI minutes chip from Module 06 beside it), and `VideoClipList`: this video's clips, each with **Play** (plays just that range in the source player, then stops), **Edit** and the menu.

### 4. Clip Routes Completed

- `GET /clips?status&videoId&source&page&sort`: the list and `counts`. `source` filters by where the video came from (`youtube`, `twitch`, `kick`, `upload`; repeatable) through the clip's `ClipVideo.platform`, and the counts follow the filter. Exported is `lastExportedRevision === revision`; Scheduled is "has a `ClipPost` whose post group still has a post waiting" (one query over the groups on the page, not one per clip); both are worked out in the service and returned as `state` on each `ClipView` (`new`, `draft`, `exported`, `scheduled`, `hidden`). The filter applies the same rules in the query.
- `PATCH /clips/:clipId` `{ revision, title?, status?, document? }`: the revision lock as `Design` has it (409 `clip_changed_elsewhere`); `document` is validated with `parseClipDocument` and `ratio` and `durationMs` are copied from it; opening a NEW clip for editing sets DRAFT.
- `POST /clips` also accepts `{ videoId, whole: true }` (Edit Whole Video): a clip from 0 to the video's length, refused with `clip_too_long` and the sentence above when the video is longer than `CLIP_MAX_MS`.
- `POST /clips/:clipId/duplicate` (a new DRAFT with the same document, " (Copy)" on the name, like a duplicated design), `DELETE /clips/:clipId` (its SEGMENT assets too; an exported `Media` row is left alone).
- A clip's poster for the cards: the proxy frame at the clip's start, cut from the filmstrip tile nearest to it (no new file).

### 5. The Clips Tab And Recent Clips

- `ClipsTab`: the filter row as a `Segmented` with counts (**All**, **New**, **Drafts**, **Exported**, **Scheduled**, **Hidden**), `sort`, a **Source** filter (a `DropdownMenu` with checkboxes: YouTube, Twitch, Kick, Upload; the sentence "Showing clips from 2 sources" when set) and a **list or grid** switch (a two option `Segmented` with icons and tooltips "List" and "Grid"; the choice is remembered per person in the browser, wrapped so a blocked storage never breaks the page). The grid is `ClipCard` (below); the list is a `DataTable` with no shadow: name, source mark, length, shape, state `Badge`, made on, and **Edit** with the same menu. Both views use the same filters, counts and menu. The grid shows `ClipCard` (blueprint section 4): the poster in the clip's shape, a muted hover preview that plays the range from the proxy (not when reduced motion is set), name, "0:42, 9:16", the state `Badge`, **Edit**, and the menu (**Rename** in place, **Duplicate**, **Hide** or **Unhide**, **Delete Clip** with a red confirm).
- `RecentClips` on the Create tab now renders.
- **Edit** goes to `/[orgId]/clips/edit/[clipId]`. This module creates that route as a plain framed page with a native `<video>` that plays the clip's range of the light copy (a small `RangePlayer`: seek to the start, pause at the end), the clip's name and the Module 05 export button, so the flow is complete; Module 08 replaces it with the full-window editor.

### 6. Tests

- Engine: scale, ruler, visible range.
- API: list counts and filters (each state and each source), the whole-video clip (length, the 30 minute refusal), the Scheduled query with fake posts, patch (lock, validation, NEW to DRAFT), duplicate, delete, tenancy.
- Web: `SourceTimeline` (click seeks, I and O mark, clamp messages, zoom keeps the playhead), `video-shortcuts`, `VideoClipList`, `ClipsTab` (filters, counts, rename, hide, delete confirm, the Source filter and its sentence, the list and grid switch and its memory), `ClipCard` states, **Edit Whole Video** (enabled, creates and opens the editor; disabled over 30 minutes with its sentence).

## Scope

**In**: timeline maths in the engine, the player bar and timeline pieces, the video page with marking, Edit Whole Video, the completed clip routes, the Clips tab with its Source filter and list or grid view, Recent Clips, a plain edit route.
**Out**: Find Clips and AI marks (16), the full-window editor and autosave (08), timeline editing (09), export options (15).

## Tasks

- [x] `timeline/scale.ts`, `ruler.ts`, `visible.ts` with tests.
- [x] `VideoPlayerBar`, `TimeRuler`, `Playhead`, `TimelineRow` in `packages/ui`; `Filmstrip`, `Waveform`; playground demos.
- [x] The video page: server page, `SourcePlayer`, `SourceTimeline`, marking, Create Clip, shortcuts, `VideoClipList`.
- [x] `GET /clips` with states, counts and the `source` filter, `POST /clips` with `whole: true`, `PATCH`, duplicate, delete.
- [x] **Edit Whole Video**: the button on the video page, the Videos tab menu item, the over-30-minutes sentence.
- [x] `ClipsTab` with the Source filter and the list or grid switch, `ClipCard`, `RecentClips`, the plain edit route.
- [x] Title-case test green.
- [x] Playwright once under simulation: open the stream sample, mark two ranges, create two clips, see them in the Clips tab, rename and hide one. Screenshots in `screenshots/`.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js timeline
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
```

## Done When

- The video page plays the sample, the pictures and the sound's shape line up with what plays, and zooming keeps the playhead still.
- Scrolling the timeline of the longest sample stays smooth (only the visible range is drawn).
- I, O and Create Clip make a clip of exactly the marked range; a range under 3 seconds cannot be made and says why.
- The Clips tab's counts match its lists; opening a New clip moves it to Drafts.
- Rename, Duplicate, Hide and Delete Clip work, and delete asks first with a red button.
- Every shortcut works and none fires while typing in the rename field.
- Edit Whole Video on the 10 minute stream makes one clip of 10 minutes and opens it in one press; on a video over 30 minutes the button is disabled with its sentence.
- The Source filter narrows the Clips tab and its counts; the list and grid views show the same clips and the choice survives a reload.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin:

1. Videos, Open on the 10 minute stream. Space plays; J, K, L and the arrows move; the time is right.
2. Zoom in and out with + and -; the playhead stays put; the ruler's steps change and never overlap.
3. Press I at 1:00 and O at 1:30: the band says "0:30". Drag an end to 1:45. Press Create Clip.
4. Mark a 2 second range: the button is disabled with "A clip needs at least 3 seconds."
5. The list on the right has the clip; Play plays only that part.
6. Clips tab: the clip is under Drafts with its picture; hover plays it silently. Rename it, duplicate it, hide the copy, delete the copy from Hidden.
7. Edit opens the plain page with the clip playing.
8. On the video page press Edit Whole Video: a 10 minute clip is made and the plain edit page opens on it.
9. Clips tab: switch to the list view and back; reload and see the choice kept. Use Source to show only Twitch clips, then only Upload clips.

## Handoff

Module 08 replaces the plain edit route with the full-window editor (drawn by `PreviewEngine` from `video-preview`) and reuses the engine's timeline maths. Module 09 builds editing on `TimeRuler`, `Playhead`, `TimelineRow`, `Filmstrip` and `Waveform`. Module 16 enables Find Clips and draws marks on `SourceTimeline`. Module 17 writes `ClipPost`, which the Scheduled state already reads.
