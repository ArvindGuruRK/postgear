# Module 09: Timeline

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 08](module-08-editor-shell.md)
> **Stories**: CL-5.3, CL-5.5
> **Next**: [Module 10](module-10-layouts-and-crops.md), [Module 11](module-11-canvas-handles-and-text.md), [Module 13](module-13-effects-zoom-and-speed.md), [Module 14](module-14-sound.md) (any order)

## Goal

After this module the dock is a working timeline: trim either end of a part, split at the playhead, delete a part, bring trimmed video back (and ask for more past the handles), with snapping, selection, a time field, every shortcut and the shortcuts sheet. Rows for overlays, zooms and sounds exist and can hold bars, so the next four modules only add their items.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 6, 7, 13, 15.
- User stories: CL-5.3, CL-5.5; section 5 (trimmed past the video we have).
- Sprint doc: The Clip Document (segments, `anchor`, the time map); API Routes (`more-video`).
- Research: [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), "Patterns That Repeated Across Projects" and the per-repo notes on trim, split and snapping (one pixel tolerance turned into time at the current zoom, a pure resolver that says what it snapped to, round once per gesture, split only strictly inside a part); [`05-editor-and-render.md`](../research/05-editor-and-render.md), the two timebases with its worked example, and how the render plan turns them into `trim` ranges and output-time windows (section 4).
- Code: `packages/video-engine/src/time/edits.ts` and `timeline/` (Modules 01 and 07); Module 08's `editor-state.ts`, `playback.ts`, `TimelineDock`; `apps/web/src/components/workflows/builder/builder-shortcuts.ts`, `shortcuts-sheet.tsx`, `shortcut-keys.tsx`; `apps/web/src/components/studio/slides-rail.tsx` (dnd-kit sensors and announcements).

## Design

### 1. Snapping And Gestures In The Engine (pure, tested)

- `timeline/snap.ts`: `snapPoints(doc, exclude)` (the playhead, the clip's start and end, every bar's edges on every row) and `resolveSnap(ms, points, tolerancePx, pxPerMs)` returning `{ ms, snappedTo | null }`. `SNAP_PX = 8`.
- `timeline/gestures.ts`: pure reducers for a drag, each taking the document as it was when the drag began plus the pointer's current time, and returning the new document: `dragTrimStart`, `dragTrimEnd`, `dragMoveItem`, `dragResizeItemStart`, `dragResizeItemEnd`. Working from the start state (not the last frame's) is what keeps a long drag exact.
- `time/edits.ts` gains what the gestures need: `trimSegment` clamps to the segment's neighbours, to `SEGMENT_MIN_MS`, and to the video's own length; trimming outward past the range we hold is allowed up to the video's ends and reported (`needsMoreVideo: { fromMs, toMs }`). `splitAt` refuses within `SEGMENT_MIN_MS` of an edge. `removeSegment` refuses to remove the last one. Every edit ends with `replaceItems` (the `anchor` rule from Module 01).

### 2. The Editing Dock (`components/clips/timeline/`)

- Rows from blueprint section 7: **Video**, **Overlay** (a second overlay row appears when two items overlap in time), **Zoom**, **Sound**. A row with nothing on it still shows, slim, with its label, so users learn where things go. Rows and their items are derived from the document by one selector.
- `TimelineBar`: positioned in pixels from the engine's scale; bordered, no shadow; the selected one has the 2 px ring. It has a body (drag to move, for items) and two edge grips (drag to trim or resize). Pointer capture on the grip; the cursor shows the direction. Bars are focusable; arrows move a selected item by a frame, Shift by a second.
- The Video row's bars show the filmstrip (tiles chosen for each part's own video range) and the speed when it is not 1x. Under the Video row, the video's own waveform, cut to the parts.
- Trimming: during the drag the engine's gesture reducer gives a preview document that the bar reads and that the stage draws through `frameState` (the preview engine runs in its scrubbing mode); on release it is applied as one undo step. The time under the pointer shows in a small label by the grip. The playhead follows the dragged edge (scrubbing mode) so the user sees the frame they are cutting on.
- Split: **S** or the scissors button splits the part under the playhead; nothing happens (and the button is disabled with a tooltip) within `SEGMENT_MIN_MS` of an edge.
- Delete: **Delete** or **Backspace** removes the selected part or item; the last part cannot be removed ("A clip needs at least one part.").
- Snapping: on by default, with a thin guide at the snapped point; **Alt** held turns it off for that drag; the **Enable Snapping** `Toggle` in the tools row turns it off for the session (kept in `localStorage`).
- Zoom and scroll: as on the video page (the engine's `zoomAround`, fit on open, Ctrl and the wheel); the dock scrolls to keep the playhead in view while playing.
- Announcements for screen readers on select, move and trim, in the `slides-rail.tsx` style ("Part 2, from 12 seconds, 8 seconds long").

### 3. More Video

- When a trim reports `needsMoreVideo`, the bar draws a hatched tail for the part we do not hold in sharp quality and a quiet line under the dock says "Getting more of the video". The editor calls `POST /clips/:clipId/more-video` once per gesture end (debounced), which starts a SEGMENT job for the wider range (Module 05's workflow, widened by the handles again). The proxy already covers the whole video, so playback never waits; only the export does.
- `sharp` on the clip becomes `fetching` until the job ends; if the platform copy is gone the Module 08 alert appears.
- Uploads never need this (the original is kept).

### 4. The Time Field (`packages/ui`, shown on `/dev/components` first)

`TimeField`: a small field that shows a time as "0:04.0", accepts typing ("4", "4.5", "1:02.3"), steps by one frame with the up and down arrows (Shift: one second), and is clamped by `min` and `max`. Used in the dock's tools row for the playhead's position, and by later modules for an item's start and length.

### 5. Shortcuts And The Sheet

One table, `editor-shortcuts.ts`, in the shape of `builder-shortcuts.ts`:

| Keys | Does |
|---|---|
| Space | Play or pause |
| Left, Right | Back or forward one frame (Shift: one second) |
| Home, End | Start or end of the clip |
| S | Split at the playhead |
| Delete, Backspace | Remove the selected part or item |
| Ctrl+D | Duplicate the selected item |
| Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| +, - | Zoom the timeline |
| Shift+Z | Fit the clip in the dock |
| Alt (held) | Snapping off while dragging |
| Escape | Clear the selection |
| ? | Open this list |

All are ignored while typing and inside dialogs. The **Keyboard Shortcuts** sheet (the `ShortcutsSheet` from Workflows with this table, grouped Playback, Editing, Timeline) opens from the top bar's button and **?**. Tooltips on the matching buttons show the same keys through `TooltipHint`'s `shortcut`.

### 6. Tests

- Engine: `resolveSnap` (inside and outside the tolerance, nearest wins), each gesture reducer (clamps, the minimum length, working from the start state), `trimSegment` outward with `needsMoreVideo`, split refusal near an edge, remove refusal for the last part, and the `anchor` rule after each (a moment sticker stays on its moment; music does not move). After every edit the render plan's segment lengths add up to `outputDuration(doc)` (a compiler test over random trims, splits and speeds, so the export is never a frame longer or shorter than the timeline).
- Web: the row selector (overlap makes a second row), `TimelineBar` (drag trims, release is one undo step, arrows nudge, Alt disables snapping), split and delete through keys and buttons, the more-video call (once per gesture), `TimeField` (parsing, stepping, clamping), the shortcut handler (ignored while typing), the sheet lists every row of the table.

## Scope

**In**: snapping and gesture maths, the editing dock with all rows, trim, split, delete, more video, `TimeField`, shortcuts and the sheet.
**Out**: making items (text 11, stickers 12, zooms and speed 13, sounds 14); multi-select, ripple options and reordering parts (Module 21).

## Tasks

- [ ] `snap.ts`, `gestures.ts`, the edits' clamps and `needsMoreVideo`, with tests.
- [ ] The row selector, `TimelineBar`, the Video row with filmstrip and waveform, empty rows for Overlay, Zoom and Sound.
- [ ] Trim with live preview, split, delete, selection, keyboard moves, announcements.
- [ ] Snapping with the guide, Alt and the toggle; zoom, fit and follow-the-playhead.
- [ ] `more-video`: the route, the hatched tail, the status line.
- [ ] `TimeField` with a playground demo.
- [ ] `editor-shortcuts.ts`, the handler, the sheet, tooltip shortcuts.
- [ ] Title-case test green.
- [ ] Playwright once under simulation: trim both ends, split, delete the middle, undo all, redo all, drag past the handle. Screenshots in `screenshots/`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js timeline time
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/timeline apps/web/src/components/clips/editor
npx jest --config packages/ui/jest.config.js time-field
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
```

## Done When

- Dragging an end trims the clip and the picture follows the edge; releasing is exactly one undo step.
- S splits at the playhead; a selected part is removed with Delete and the rest closes up; the last part cannot be removed.
- Edges snap to the playhead and to each other with a guide line, and Alt lets them move freely.
- Dragging an end outward brings video back; past the range we hold, the tail is hatched and "Getting more of the video" shows until it arrives.
- Every key in the table works and is listed in the sheet; none fires while typing.
- After a long session of trims and splits the parts still add up exactly to the clip's length (the identity test in the engine guards this). The compiled export has the same length (the plan test guards it).

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin, in a clip from the 10 minute stream:

1. Drag the left end right by a few seconds: the picture shows the frame under the edge; release; the length changes; Ctrl+Z restores it.
2. Move the playhead to the middle, press S, select the second half, press Delete, then undo both.
3. Split twice and delete the middle part: the clip closes up.
4. Drag an end near the playhead: it snaps with a line; hold Alt: it moves freely.
5. Drag the right end 40 seconds past where the clip ended: a hatched tail, "Getting more of the video", then the tail fills in.
6. Press ?: the sheet lists every shortcut. Type in the rename field and press S: nothing splits.
7. Type "0:05.0" in the time field: the playhead jumps there.

## Handoff

Modules 11, 12, 13 and 14 put their bars on the Overlay, Zoom and Sound rows with `dragMoveItem` and the resize reducers, and use `TimeField` for exact times. Module 10 uses selection `kind: 'area'`. Module 21 holds multi-select and part reordering.
