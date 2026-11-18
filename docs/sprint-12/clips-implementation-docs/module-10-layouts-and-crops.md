# Module 10: Layouts And Crops

> **Sprint 12, Clips** | Status: Done with gaps (see the README Progress row) | Size: L (one full session)
> **Depends on**: [Module 09](module-09-timeline.md)
> **Stories**: CL-6.1, CL-6.2, CL-6.3, CL-5.2 (changing the shape later)
> **Next**: [Module 11](module-11-canvas-handles-and-text.md), [Module 13](module-13-effects-zoom-and-speed.md), [Module 14](module-14-sound.md)

## Goal

**Demo 3.** In the Layouts tab a user picks one of seven layouts (Fullscreen, Blurred, Split, Three, Four, Gameplay, Screen Share), sees the full video beside the clip with one crop box per area, drags and resizes the boxes with snapping, adds an area, changes the clip's shape (Vertical, Horizontal, Square or 4:5), picks a Crop Ratio for Blurred, and saves the arrangement as a layout for the workspace. The export is built by the FFmpeg compiler, with a blurred background that costs almost nothing, and Preview Export shows it exactly.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 6 (the split stage), 8 (Layouts), 13, 15.
- User stories: Journey A step 7; CL-6.1 to 6.3; CL-5.2.
- Sprint doc: The Clip Document (`layout.areas`, `frame`, `crop` keyframes); Database (`ClipLayoutPreset`); API Routes (layouts).
- Research: [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), section 2 (every layout was built and its area centres checked against a gradient source; rounded corners, `shortest=1`, the `format=yuv420` speed rule), section 3 (crop keyframes) and section 12 (pixel rules); [`05-editor-and-render.md`](../research/05-editor-and-render.md), sections 2 and 3 (how the preview draws areas, what it cannot match); [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), the lesson that crops are stored as fractions of the frame so the light copy and the sharp range share one crop; [`01-reference-products.md`](../research/01-reference-products.md), StreamLadder's layouts screen and OpusClip's layout list.
- Code: Module 05's compiler (`frameState`, `compileFfmpeg`) and its benchmark numbers in the README Progress notes; Module 08's stage, `PreviewEngine` and `useStageScale`; `packages/video-engine/src/geometry.ts`; `apps/web/src/components/studio/panel-ui.tsx`; `packages/ui` (`ChoiceTiles`, `Segmented`, `Toggle`, `AlertDialog`); `apps/web/src/components/studio/premium-lock.tsx` (only if a layout is gated, which Sprint 12 does not do).

## Design

### 1. Layouts As Data (`packages/video-engine/src/layout/`, pure)

- `presets.ts`: `LAYOUT_PRESETS`, a table keyed by layout kind and ratio. Each preset is a list of areas with a `name`, a `frame` on the canvas (0 to 1), a `fit` (`cover` or `contain`), an optional corner `radius` (a fraction of the canvas width) and a default crop rule, plus a `base` (`solid` or `blurred`). Everything below is data, not code:

| Layout | Areas (canvas frames at 9:16) | Base | Notes |
|---|---|---|---|
| **Fullscreen** (Fill) | one area filling the canvas, `cover`, crop centred | none | |
| **Blurred** (Fit) | one area showing the video `contain`, full width, centred | blurred | The **Fit crop ratio** picks which part of the video is kept: **Original** (all of it), **4:3** or **1:1** (a centred crop of that shape) |
| **Split** | "Camera" on top (about 38% of the height), "Content" below | solid | Camera crop starts on the video's lower left corner at a typical face-camera size, Content on the centre |
| **Three** | "Top" across the upper half, "Left" and "Right" side by side in the lower half | solid | |
| **Four** | four equal areas in a grid | solid | |
| **Gameplay** | "Game" fills the canvas `cover`; "Camera" is a small rounded box near the top left (about 36% of the width, corner radius about 3% of the width) | none | Camera crop starts on the lower left corner, as in Split |
| **Screen Share** | "Screen" as a wide band in the upper part, "Camera" as a larger rounded box below it | blurred | The camera box is 4:3 |

- Ratios: Vertical (9:16), Square (1:1) and 4:5 get all seven. Horizontal (16:9) gets Fullscreen and Blurred only (CL-6.1); the preset table has no entries for the others, so the panel cannot offer them. The Fit crop ratio is stored as `layout.fitRatio` (`'original' | '4:3' | '1:1'`, default `'original'`), an optional field added to the document schema here.
- `applyLayout(doc, kind, videoSize)`: replaces `layout` with the preset's areas, each crop sized to its frame's shape (`fitRect`) so nothing is stretched. Custom changes make `kind: 'custom'`. The older `'fullscreen' | 'blurred' | 'split' | 'custom'` kinds in the sprint doc grow to the seven names; say so in the Decision Log.
- `areaCropAt(area, sourceMs)`: the crop for a moment. Sprint 12 writes one keyframe per area, and this function already interpolates between several (linear, held before the first and after the last) so Sprint 13's Follow The Speaker only writes more keyframes. It evaluates at the source frame that is shown, not at the output time (at 0.5x a source frame appears twice; cookbook section 3).
- `setAreaCrop`, `addArea` (up to `MAX_AREAS` of 4; the new area takes a free strip of the canvas and the others are re-fitted), `removeArea`, `renameArea`, `setFitRatio`, `setCanvasRatio(doc, ratio, videoSize)` (re-fits frames and crops; overlay items keep their relative place, clamped inside the canvas; a layout the new shape does not offer falls back to Blurred).
- Crops are fractions of the video frame, so the same numbers work on the light copy and on the sharp range.
- Tests: each preset at each ratio gives frames that tile or sit inside the canvas without overlap (the rounded camera boxes are allowed to sit over the game area); a crop always has its frame's shape; crops never leave 0 to 1; ratio changes round-trip; Horizontal has exactly two layouts.

### 2. The Compiler's Layout Graph (`render/layout-graph.ts`, pure)

Written from the cookbook's section 2 recipes, each verified by running FFmpeg 9.0.2; the rules below are the verified ones.

- **Base**: a solid `color` source of the canvas size and length, or the Blurred base: `split` the picture, `scale` a copy down to a tenth of the canvas (rounded to even) with `force_original_aspect_ratio=increase`, `crop`, `gblur=sigma=3:steps=2`, `scale` back up to the canvas. This blurs a small copy, so it is cheap, and **no companion file is made**. A darkening step (`eq=brightness`) is allowed if the design wants it.
- **One area**: `crop` to the area's source rectangle, `scale` to the frame (`increase` then `crop` for cover; `decrease` and an overlay centred in the frame for contain), `setsar=1`, then `overlay=x=FX:y=FY:format=yuv420:shortest=1` onto the picture so far. Crop first, scale second, so the scaled picture stays small. The `split` filter feeds one copy of the picture to each area.
- **Rounded corners** (Gameplay and Screen Share cameras): the area is made `format=yuv420p`, an anti-aliased alpha mask is drawn **once** with `geq` on a short grey `color` source (`lum='clip((R-hypot(max(abs(X-FW/2+0.5)-(FW/2-R),0),max(abs(Y-FH/2+0.5)-(FH/2-R),0)))+0.5,0,1)*255'`), looped with `loop=loop=-1:size=1:start=0`, and joined with `alphamerge`. The exact filter text is in cookbook section 2.
- **Two rules that are not optional**: every `overlay` carries `shortest=1` (the Gameplay graph with `shortest=0` ran forever because the looped mask is infinite), and every `overlay` carries `format=yuv420` and the mask path stays in `yuv420p`, never `rgba` on the main picture (without it the same graph took 24.1 s for 8 s of video instead of 9.9 s). A snapshot test fails if either is missing.
- **Pixels**: frames and crops are converted to pixels once in the plan, sizes to the nearest even number; the overlay's `x` and `y` come from the same numbers. Crop keyframes (Sprint 13) go through `sendcmd` only, never a long expression (Module 05's rules).
- **Parity tests** (added to `render-parity.test.ts`): a 1920 by 1080 gradient source (red is x, green is y) through each layout at 1080 by 1920; the centre of every area is compared with the source gradient at the centre of its crop (the 3-level difference in the cookbook is the yuv420p colour round trip, so the tolerance is 4 levels, and the position tolerance is 1 pixel through `frameState`). The rounded camera boxes are checked at a corner (transparent) and at the centre.
- **Cost**: Module 05's benchmark table already holds the Blurred numbers; re-run it here with the real layouts and put the Gameplay and Screen Share rows beside them. The cookbook measured the whole typical graph at 0.69x real time at 1080p30 on a busy laptop, so these are the layouts that decide the production worker's size.

### 3. The Preview Of A Layout

`PreviewEngine` already draws every area from `frameState` as a canvas filled with `drawImage` (Module 08), so presets need no new engine code:

- Rounded boxes are the area's canvas with CSS `border-radius` of the same radius in canvas pixels (scaled by the stage scale).
- The Blurred base is one small canvas drawn from the video at a tenth of the size and scaled up with CSS `filter: blur()` and a slight darkening; the editor is desktop only, so one small blur is cheap. The base differs from `gblur` in detail; Preview Export shows the exact one.
- The Fit crop ratio changes the crop rectangle that `frameState` returns, so the preview and the export agree by construction.

### 4. The Layouts Tab (`components/clips/panels/layouts-panel.tsx`)

- At the top, the shape as a `Segmented`: **Vertical**, **Horizontal**, **Square**, **4:5** (`setCanvasRatio`, one undo step).
- **Layouts**: `ChoiceTiles` with a small drawing of each of the seven (**Fullscreen**, **Blurred**, **Split**, **Three**, **Four**, **Gameplay**, **Screen Share**); Horizontal shows only the first two. The current kind is marked; choosing one is one undo step. Under it, a quiet "Custom" line shows when the boxes were changed by hand.
- When **Blurred** is the layout, a **Crop Ratio** `Segmented` appears under the tiles: **Original**, **4:3**, **1:1** (`setFitRatio`).
- **My Layouts**: saved tiles, each with a menu (**Rename**, **Delete Layout**, red confirm), and **Save Layout** (secondary), which asks for a name in a small `Dialog` ("Enter your layout name").
- While this tab is open the stage splits in two (blueprint section 6): **Video** on the left, the full frame of the video at the playhead with the crop boxes; **Clip** on the right. On other tabs the stage is the clip alone.

### 5. Crop Boxes (`components/clips/editor/crop-stage.tsx`)

- One box per area over the Video pane: a 2 px border in the area's colour (four fixed theme colours), a name tag on its top edge, eight handles. The box keeps its area's shape while resizing (corner and side handles both scale it around the opposite edge), can be moved by its body, and cannot leave the frame.
- Snapping (the **Enable Snapping** `Toggle`, on by default): to the frame's edges and centre lines and to other boxes' edges, within 8 px, with guide lines. Arrow keys move the selected box by 1% (Shift: 5%).
- The Clip pane updates live while dragging; release is one undo step (a coalesce key per area).
- **Add Crop** (secondary) adds an area (up to four) and selects its box; an area's tag has a small menu: **Rename**, **Remove**.
- Pointer movement is divided by the pane's scale (the same rule Module 11's handles follow).

### 6. Saved Layouts

- Routes: `GET /clips/layouts`, `POST /clips/layouts` `{ name, ratio, layout }` (the layout validated with the engine's schema; 50 per workspace), `PATCH /clips/layouts/:id` (rename), `DELETE /clips/layouts/:id`. Workspace-wide; any member may save, rename and delete.
- Applying a saved layout to a video of another size keeps every crop at the same fractions and re-fits its shape. A layout saved for one ratio is offered for that ratio.

### 7. Tests

- Engine: presets, `applyLayout`, `areaCropAt` (one keyframe, interpolation between two for Sprint 13, evaluation at the shown source frame), `setCanvasRatio` including the fallback, `setFitRatio`, add and remove area.
- Compiler: the layout graph text for each layout as a snapshot; the `shortest=1` and `format=yuv420` rules asserted on every overlay; no `rgba` on the main picture; the render parity cases above (skipped without `ffmpeg`).
- Web: the panel (seven tiles, shape switch, Horizontal offers two, Crop Ratio only for Blurred, save dialog), the crop stage (drag and resize keep the shape and stay inside, snapping on and off, keyboard moves, one undo step per drag), saved layouts (apply, rename, delete confirm).
- API: the layout routes (schema refusal, the limit, tenancy).

## Scope

**In**: layouts as data (seven presets, four shapes, the Fit crop ratio), the compiler's layout graph with its parity tests, the preview of areas and rounded boxes, the Layouts tab, crop boxes with snapping, add and remove area, the shape switch, saved layouts and their routes.
**Out**: Detect Camera and Follow The Speaker (Sprint 13), crops that change over time by hand, layout animation between presets.

## Tasks

- [x] `layout/presets.ts` (seven layouts, four ratios, the Fit crop ratio), `applyLayout`, `areaCropAt`, `setAreaCrop`, add, remove, rename, `setFitRatio`, `setCanvasRatio`, with tests.
- [x] `render/layout-graph.ts`: base, areas, rounded masks, the two overlay rules; snapshot tests; parity cases per layout.
- [x] `PreviewEngine` areas, rounded boxes, the blurred base canvas.
- [x] The Layouts panel: shape, seven tiles, Crop Ratio, My Layouts, Save Layout.
- [x] The split stage and the crop boxes with snapping and keys.
- [x] Layout routes and the client.
- [ ] The benchmark re-run with real layouts; `clips:stills` for each layout; title-case test green.
- [x] Playwright once under simulation: Vertical, Split, move both boxes, save the layout, apply it to another clip, export. Screenshots in `screenshots/`.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js layout render
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels apps/web/src/components/clips/editor
npx jest --config packages/video-preview/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npm run clips:stills
npm run clips:benchmark
```

## Done When

- Each of the seven layout tiles changes the clip at once and can be undone; Horizontal offers Fullscreen and Blurred only.
- In Split, dragging the Camera box over the corner of the video puts that corner in the top area of the clip, live.
- In Gameplay and Screen Share the camera box has smooth rounded corners in the editor and in Preview Export.
- Blurred offers Original, 4:3 and 1:1, and the export keeps the same part as the editor.
- Boxes keep their shape, snap with guides, and cannot leave the video.
- An area can be added (up to four) and removed; the clip re-fits each time.
- Switching Vertical, Horizontal, Square and 4:5 re-fits the layout and nothing is stretched.
- A saved layout appears for another member of the workspace and applies to another clip in one click.
- Every layout's parity case passes: each area shows the part of the gradient its crop names, within the stated tolerance.
- The exported Blurred clip's render time is close to the Fullscreen one (the benchmark shows it), and no companion file is made.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin, in a Vertical clip from the stream sample:

1. Layouts: pick Blurred. The whole video sits in the middle over a soft copy of itself. Try Crop Ratio 4:3 and 1:1.
2. Pick Split. The stage shows Video and Clip side by side with two boxes, Camera and Content.
3. Drag Camera to the lower left corner of the video and make it smaller: the top of the clip follows. It snaps to the edges; turn snapping off and it moves freely.
4. Pick Gameplay: the game fills the clip with a small rounded camera box; move the box's crop onto the face.
5. Pick Three, Four and Screen Share once each. Add Crop on Split and remove it again.
6. Save Layout as "My Stream". Open another clip, Layouts, My Layouts: apply it.
7. Switch the shape to Square, 4:5, Horizontal and back to Vertical.
8. Press Preview Export on Blurred, Split and Gameplay clips: the result is the same as the editor.

## Handoff

Sprint 13's Follow The Speaker writes more keyframes into `areas[].crop` and reads them through `areaCropAt`; its Detect Camera sets the Camera area's crop. Module 15 re-runs the benchmark with the whole graph. Module 21 holds extra layouts.
