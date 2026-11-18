# Module 13: Effects: Zoom, Speed And Looks

> **Sprint 12, Clips** | Status: Done with gaps (2026-11-19; see the README Progress row) | Size: L (three tools instead of two; one full session, and if it runs long Looks is the half that can move to a second session)
> **Depends on**: [Module 09](module-09-timeline.md)
> **Stories**: CL-8.1, CL-8.2, CL-8.3
> **Next**: [Module 14](module-14-sound.md), [Module 15](module-15-export.md)

## Goal

After this module the Effects tab has three working tools. **Zoom** puts a zoom on a moment of the video, with an amount and a focus point, easing in and out. **Speed Control** sets a part of the clip to 0.25x, 0.5x, 1x, 1.5x, 2x or 4x with natural-sounding pitch. **Looks** gives the whole clip a colour look (Warm, Cool, Vivid, Black And White, Sepia, Vintage, Cinematic) with a strength, a vignette and fades. All three are written into the FFmpeg graph from the same numbers the editor draws with (`frameState`), they stay on their moment through trims, and Preview Export shows the exact result.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 7 (the Zoom row), 8 (Effects), 9 (the focus dot).
- User stories: CL-8.1, CL-8.2, CL-8.3; Journey A step 8, Journey C step 3.
- Sprint doc: What The Research Settled; The Clip Document (`zooms` in the video's time, `segments[].speed`, the `anchor` rule).
- Research: [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), section 1 (segments, speed, the `atempo` chain: verified), section 4 (zoom with `perspective`, the rejected alternatives and their numbers), section 7 (looks and fades: verified on a flat colour) and section 12 (the parity rules); [`05-editor-and-render.md`](../research/05-editor-and-render.md), section 2 (speed in the preview, looks as CSS), section 3 (what the preview cannot match) and section 10 (the two time bases).
- Code: `packages/video-engine/src/time/` (the time map and `setSpeed`), `layout/` (`areaCropAt`), `render/` (Module 05's `frameState` and compiler); `packages/video-preview` from Module 08 (the zoom wrapper and the look filter slot); Module 09's rows and gesture reducers; Module 11's handle layer (for the focus dot) and `TimeField`.

## Design

### 1. Zoom In The Engine (pure)

- A zoom is `{ id, source, from, to, scale, focus, ease }`: `from` and `to` in the video's own time, `scale` from 1.1 to 3, `focus` a point in 0 to 1 of the **clip's canvas**, `ease` the time in milliseconds it takes to move in and out (0, 300 or 800; at most half the zoom's length).
- **Where the maths lives.** A zoom is stored in the video's time, so it needs no re-placing after a trim. For drawing, `zoomWindows(doc)` maps each zoom through the time map into **output-time** windows `[a, b]` (a zoom over several segments that are contiguous in the output is one window; a zoom with a cut in the middle is two windows, each with its own ease), and the ease is measured in **output** milliseconds, clamped to half the window, so a zoom over a 4x part does not snap. `zoomAt(doc, outputMs)` gives `{ scale, focus }` for a frame.
- The curve is the cookbook's smoothstep: `u = min(clip((t-a)/d, 0, 1), clip((b-t)/d, 0, 1))`, `z(t) = 1 + (S - 1) x u x u x (3 - 2u)`, with `d` the ease. A canvas point `p` appears at `q = F + (p - F) x z(t)`: the focus point never moves. `frameState` returns the same numbers the preview and the compiler use, measured at each frame's own time `n / FPS`. Zooms on one source may not overlap; `addZoom` and the drag reducers clamp against neighbours.
- Edits: `addZoom(doc, atOutputMs)` (2 seconds at 1.5x, focus at the centre, placed at the playhead's video moment through `toSource`), `updateZoom`, `removeZoom`, `moveZoom`, `resizeZoom`.
- If a zoom's moment is cut out it never shows; it is kept in the document so undoing the cut brings it back. A zoom whose whole range is outside every segment is drawn greyed on the timeline with a tooltip: "This zoom is on a part that was cut."
- For the timeline, `zoomBars(doc)` maps each zoom through the time map into one or more bars in the clip's time (a zoom over a cut shows as two).

### 2. Zoom In The Compiler (`render/zoom.ts`, pure)

The recipe is cookbook section 4, run on FFmpeg 9.0.2 on a 1080 by 1920 canvas with six discs at known places (mean position error 0.30 px, worst 0.72 px, no jitter: the error changed by at most 0.07 px between frames):

```
perspective=x0='WX':y0='WY':x1='WX+WW':y1='WY':x2='WX':y2='WY+WH':x3='WX+WW':y3='WY+WH':interpolation=cubic:eval=frame:enable='between(t,A_MINUS,B_PLUS)'
```

with `Z = (1+(S-1)*U*U*(3-2*U))`, `U = min(clip((TT-A)/D,0,1),clip((B-TT)/D,0,1))`, `TT = ((in-1)/FPS)`, `WX = fx*CW*(1-1/Z)`, `WY = fy*CH*(1-1/Z)`, `WW = CW/Z`, `WH = CH/Z`, and `A_MINUS = A - 0.02`, `B_PLUS = B + 0.02` so the window covers the ease.

- It goes **after the layout**, so it zooms every area as one picture, and **before** looks, stickers and text, so overlays do not zoom. One `perspective` filter per window, in a row.
- **Always limit it with `enable=between(...)`**: 5.4 s inside a window against 15.6 s with it on for every frame (180 frames). A snapshot test fails if a `perspective` has no `enable`.
- The frame counter is `(in-1)/FPS`, not `in/FPS` (`in` counts from 1 in 9.0.2; the wrong form was one frame late and up to 49 px off) and not `t` (`t` is undefined inside `perspective`). The parity test catches any build that changes this.
- An ease of 0 (Snap) writes the constant `S` and no ease terms. Use `interpolation=linear` for Preview Export and `cubic` for the final export if the benchmark allows (cubic costs about twice linear inside the window).
- **Rejected, with evidence**: `scale ... eval=frame` then `crop` (the crop kept its first size and cut the wrong part), `crop` with expression sizes (evaluated once), `crop` resized by `sendcmd` each frame (a frame late, up to 47 px off), and `zoompan` (up to 3 px of jitter, or 79 s with a pre-scale). Do not revisit them without new evidence.
- Parity cases (added to `render-parity.test.ts`): discs on a plain source, a 1 to 4 s zoom to 2x with a 0.5 s ease, each disc's position against `q` at the ease start, the middle of the ease, a hold, the end and one frame after, within 1 px.

### 3. Speed

- `setSpeed(doc, segmentId, speed)` exists (Module 01). This module wires it through the whole chain:
  - **Compiler**: per segment `setpts=(PTS-STARTPTS)/S` on the picture and `atempo` on the sound after `atrim` and `asetpts`; `aresample=48000` after it. `atempo` accepts only 0.5 to 100, so 0.25x is `atempo=0.5,atempo=0.5` (the rule: while the remaining factor is below 0.5, emit `atempo=0.5` and divide). The speeds the document allows (0.25, 0.5, 1, 1.5, 2, 4) are verified: a five-segment clip at 0.25x, 0.5x, 1x, 2x and 4x came out at exactly the planned 420 frames and 14.000 s, every frame within one source frame of the plan. The sound is exact in length and approximate in fine position: a transient can move up to about 60 ms at 0.5x, and the panel says so. At 0.25x the picture repeats frames (no interpolation).
  - **Preview**: `playbackRate` on the front `<video>` with `preservesPitch` on, so voices do not turn high or low. Browsers may mute sound outside their audible range (Gecko mutes below 0.25 and above 4, so our ends sit at the edge); the export does not mute it. Say in the panel that very slow or very fast sound may sound rough.
  - Zooms and crops are in the video's time (the zoom's ease in output time, section 1), so they follow the picture. Items with `anchor: 'moment'` are re-placed by `replaceItems`; their own length does not change.
- A smooth change of speed inside a part (a ramp) is not in this sprint: a constant rate per part is the supported way, and the panel says to split first. Ramps are in Module 21 (now feasible as a chain of short constant parts).
- Parity cases: the verified five-segment clip with its frame count and a beep-position check (within 60 ms at 0.5x, 20 ms at 2x and 4x).

### 4. Looks, Vignette And Fades (`effects/looks.ts` data, `render/looks.ts` compiler)

- **The document gains** an optional `look: { id, strength, vignette, fadeInMs, fadeOutMs }` (`id` one of none, warm, cool, vivid, black-and-white, sepia, vintage, cinematic; `strength` and `vignette` 0 to 1; fades 0, 500, 1000 or 2000). One look per whole clip in this sprint (the story says a look covers the whole clip); a look per part is a Module 21 item. The field is optional, so `schemaVersion` stays 1.
- **Looks as data**: `LOOKS` maps each id to a function of the strength `s` (0 to 1) returning filter steps, written so **`s = 0` is the identity** (the compiler writes nothing) and the numbers move linearly with `s`:

| Look | Filters at strength `s` |
|---|---|
| Warm | `colortemperature=temperature=6500-2000*s` (4500 K at full) |
| Cool | `colortemperature=temperature=6500+2500*s` (9000 K at full) |
| Vivid | `vibrance=intensity=0.8*s`, `eq=contrast=1+0.08*s` |
| Black And White | `colorchannelmixer` with each row blended between the identity and `.3:.59:.11` by `s` |
| Sepia | the same blend towards the sepia matrix `.393:.769:.189 / .349:.686:.168 / .272:.534:.131` |
| Vintage | a half-strength sepia blend, `eq=contrast=1-0.08*s:saturation=1-0.15*s` |
| Cinematic | `eq=contrast=1+0.15*s`, `colorbalance=rs=0.1*s:bs=-0.1*s` (cooler shadows, warmer lights) |

  The cookbook proves each filter works and what it does to one colour (a flat 96,144,192 became 135 grey, 184,164,128 sepia, 95,122,140 warm, 78,125,191 cool) but did not tune the named looks; **the numbers above are starting points tuned by eye in this module with `clips:stills`**, and the final numbers go in the Decision Log.
- **Vignette** `v` (0 to 1): `vignette=angle=PI/2-(PI/4)*v`, written only when `v > 0` (`PI/4` was verified: corner 8,22,32, centre unchanged).
- **Fades** (Fade In, Fade Out, each a switch with a length of 0.5, 1 or 2 seconds): `fade=t=in:st=0:d=L,fade=t=out:st=OUTSTART:d=L` on the picture and `afade=t=in:st=0:d=L,afade=t=out:st=OUTSTART:d=L` on the sound mix, so the picture, the text and the sound fade together from and to black and silence. The picture fade goes **after** the `ass` filter and the mark; this order is by construction and checked by a parity case here (it was not run in the cookbook). `OUTSTART` is the clip's length minus `L`.
- **Where Effects sit in the graph**: segments, `concat`, layout, **zoom**, **looks and vignette**, stickers, `ass` text, the mark (Module 15), **fades**. Looks run before stickers so a sticker keeps its own colours.
- **The preview draws looks as CSS**, one table `lookToCss(look)`: Warm `sepia(0.25*s) saturate(1+0.1*s) hue-rotate(-10deg*s)`, Cool `hue-rotate(15deg*s) saturate(1-0.05*s)`, Vivid `saturate(1+0.5*s) contrast(1+0.08*s)`, Black And White `grayscale(s)`, Sepia `sepia(s)`, Vintage `sepia(0.5*s) contrast(1-0.08*s) saturate(1-0.15*s)`, Cinematic `contrast(1+0.15*s) saturate(1.05)`; the vignette is a radial gradient over the stage; fades are an opacity ramp to black on the stage and a gain ramp on the sound. The mapping is **approximate on purpose** (CSS `filter` and FFmpeg's `eq`, `hue`, `colorchannelmixer` and `vignette` are different formulas), which is why the panel says "The editor shows a close match. The export may look slightly different." and Preview Export is one press away.
- Tests: `LOOKS` at strength 0 compiles to nothing; each look's filter text at 0.5 and 1 as a snapshot; a render on the cookbook's flat colour (96,144,192) checks Black And White near 135 grey, Sepia near 184,164,128, a half fade at half the length, a vignette dark in the corner and unchanged in the centre, each within 3 levels.

### 5. The Effects Tab (`components/clips/panels/effects-panel.tsx`)

Three rows as cards (an icon tile, a name, a sentence), each opening its controls in place:

- **Zoom** ("Zoom in on a moment"): **Add Zoom** (primary) adds one at the playhead and selects it. For the selected zoom: **Amount** (`Slider`, 1.1x to 3x, shown as "1.5x"), **Ease** (`Segmented`: **Snap**, **Smooth**, **Slow**, for 0, 300 and 800 ms), **From** and **For** (`TimeField`), and "Drag the dot on the clip to choose where it zooms." **Remove Zoom** (secondary).
- **Speed Control** ("Slow down or speed up a part"): works on the selected part of the Video row; with none selected it says "Select a part of the video on the timeline." A `Segmented`: **0.25x**, **0.5x**, **1x**, **1.5x**, **2x**, **4x**. Under it: the part's new length ("8.0 s becomes 4.0 s"), the hint "To change a few seconds only, split the clip first." and, at 0.25x or 0.5x, "Very slow sound may sound rough."
- **Looks** ("Give the whole clip a look"): tiles for **None**, **Warm**, **Cool**, **Vivid**, **Black And White**, **Sepia**, **Vintage** and **Cinematic**, each on a small sample picture (the frame at the playhead with that look's CSS filter). Picking one is one undo step. Below: **Strength** (`Slider`, 0% to 100%, default 100%), **Vignette** (`Slider`, 0% to 100%), **Fade In** and **Fade Out** (`Toggle`s, each with a `Segmented` of 0.5 s, 1 s and 2 s that shows when on). The sentence "The editor shows a close match. The export may look slightly different." sits under the tiles, with a **Preview Export** link that selects the Export tab.
- The two other StreamLadder rows users may look for (word censoring, remove silences, hook title) belong to Sprint 13; do not show placeholders for them.

### 6. On The Stage And The Timeline

- With a zoom selected, the handle layer shows the **focus dot** (a ring with a cross) at `focus`; dragging it sets the focus (snapping to the centre lines), and the clip shows the zoom's full amount while the dot is dragged so the user sees the result.
- The **Zoom** row shows `zoomBars`: drag to move, drag an end to resize (the Module 09 reducers, with the neighbour clamps), Delete removes, the label is the amount.
- The Video row's bars show "2x" and so on when a part is not at 1x, and their filmstrip tiles are spread to match.
- Changing speed keeps the playhead on the same video moment (map it through the time map before and after).
- Looks have no bar: they cover the clip. The Effects card shows the chosen look's name beside the tile grid.

### 7. Tests

- Engine: `zoomWindows` (a zoom inside one part, across a split, across a cut, over a 4x part), `zoomAt` (outside, easing in, holding, easing out, two zooms, a zoom cut by a trim), overlap clamps, `zoomBars` across a split, `addZoom` at the playhead; speed: the plan's segment lengths add up for every speed, the identity holds after speed plus split plus trim, a moment item stays on its moment after a speed change; `LOOKS` and `lookToCss` at strength 0, 0.5, 1.
- Compiler and parity: sections 2 to 4 above (the `perspective` snapshot with `enable`, the `atempo` chain for 0.25, the speed frame count, the looks and fade checks).
- Web: the panel (Add Zoom, sliders, ease, Speed needs a selected part, the new-length line, Looks tiles and sliders, the fade switches), the focus dot drag, the Zoom row's bars, the playhead staying on its moment.
- Stills: `clips:stills` at a frame inside a zoom, inside a 2x part and under each look, set beside the editor by eye.
- A sound check by ear in the Hand Check (pitch at 2x and 0.5x).

## Scope

**In**: zooms in the engine and the compiler, speed through the whole chain with preserved pitch, looks, the vignette and fades (data, compiler and preview), the Effects tab, the focus dot, the Zoom row.
**Out**: smooth speed ramps, reverse and freeze frame, transitions, a look per part, per-look custom curves (Module 21); word censoring, silence removal, hook title, text to speech (Sprint 13).

## Tasks

- [x] `zoomWindows`, `zoomAt`, zoom edits and clamps, `zoomBars`, with tests. (The bars are `zoomWindows` itself; the drags are `dragMoveZoom`, `dragResizeZoomStart` and `dragResizeZoomEnd`.)
- [x] The compiler's `perspective` zoom and its parity cases.
- [x] Speed: the compiler's chain (verified frame-count case), `playbackRate` and `preservesPitch`, filmstrip spread, playhead mapping.
- [x] Looks, the compiler's looks, vignette and fades, and the preview's look, vignette and fade. (Built as one shared colour matrix instead of `LOOKS` filter steps and `lookToCss`, and on the existing `looks` and `fades` fields instead of a new `look` field: see the Decision Log.)
- [x] The Effects panel with all three tools.
- [x] The focus dot and the Zoom row.
- [x] Stills for zoom, speed and the look; the look numbers in the Decision Log; title-case test green. (Every look is measured against FFmpeg in `effects-parity.test.ts`; the browser pass compared Vintage with a vignette by eye.)
- [x] `verify-change`; update the Progress table and the Decision Log.

**Gaps at close (2026-11-19)**: the sound at 2x, 0.5x and 0.25x was not listened to (a headless browser has no ears), so pitch is left to Hand Check 5; only Vintage with a 50% vignette was exported and compared by eye in the browser (the other seven looks are measured by the parity test on a flat colour, worst 3.09 levels); Fade In and Fade Out were checked by the parity test, not in a browser export. The look tiles are drawn on the video's filmstrip picture at the playhead, so they show the look on the video, not on the clip's layout. The From and For fields show a zoom bar's new place on release, not during the drag. With many overlay rows the Zoom row sits low in the dock and needs a scroll. Trimming the clip's start with a zoom on it (Hand Check 4), and the light and Lilac themes, are left to the hand check.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js zoom time render effects
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels apps/web/src/components/clips/timeline
npx jest --config packages/video-preview/jest.config.js
npm run clips:stills
```

## Done When

- Add Zoom puts a 2 second zoom at the playhead; the amount, ease and focus all change the picture live.
- A zoom stays on the same moment of the video after the clip's start is trimmed, and comes back when a cut that removed it is undone.
- The export's zoom matches `frameState` within 1 px at the checked frames, and costs little outside its window.
- A part set to 2x plays in half the time, with a normal-sounding voice, and its bar says "2x"; 0.5x plays in twice the time; 0.25x works.
- Text and stickers set On This Moment are still on their moment after a speed change.
- The clip's parts still add up exactly after any mix of speeds, splits and trims, and the export has the same length.
- Each look changes the picture in the editor and the export, Strength 0% is the same as None, Vignette darkens the corners, and Fade In and Fade Out fade picture, text and sound together.
- The panel says the editor is a close match, and Preview Export shows the real look.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin, in a clip from the stream sample:

1. Effects, Zoom, Add Zoom. Drag Amount to 2x. Drag the dot to a corner of the clip: it zooms toward it.
2. Play through it: it eases in and out. Set Ease to Snap: it cuts in.
3. Drag the zoom's bar along the Zoom row; resize it.
4. Trim five seconds off the clip's start: the zoom is still on the same moment.
5. Split the clip in the middle, select the second part, Speed Control, 2x: the clip is shorter, the bar says "2x", the sound is not squeaky. Try 0.5x and 0.25x.
6. Looks: try each tile, drag Strength down to 0% and back, add a Vignette, turn on Fade In (1 s) and Fade Out (1 s).
7. Export at 720p, or press Preview Export: the zoom, the speeds and the look are as in the editor, and the look may differ slightly in tone.

## Handoff

Module 15 exports these through the same compiler and puts the mark between the text and the fades. Sprint 13's hook clip and Follow The Speaker build on segments and crop keyframes and do not touch zooms. Module 21 holds ramps, reverse, freeze, transitions and a look per part.
