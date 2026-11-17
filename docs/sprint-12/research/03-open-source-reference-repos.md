# Sprint 12 Research: Open-Source Reference Repositories

> **Written**: 2026-11-14. For every repository the LICENSE file was read first, then the README, then the source files named below. Stars and last-commit dates are as GitHub showed them on that day. The code was read from shallow copies in a temporary folder outside this repo. Nothing was run, and nothing was copied into PostGear. All logic is described in our own words; the pseudo-code is ours. Two files were read a day later and are marked 2026-11-15.
>
> **Module numbers** follow the [module map](../clips-implementation-docs/README.md): 01 Contracts And Data, 02 Media Runtime, 03 Link Engine, 04 Import Pipeline, 05 Thin Slice, 07 Manual Clipping And The Clips Library, 08 Editor Shell, 09 Timeline, 10 Layouts And Crops, 11 Canvas Handles And Text, 13 Effects: Zoom And Speed, 14 Sound, 15 Export, 16 AI Highlights (Signals), 20 Hardening.

## 1. The Short List

| Repository | Licence | Stack | Use For | Verdict |
|---|---|---|---|---|
| `opencut-app/opencut-classic` | MIT | Next 16, React 19, Zustand, own canvas renderer, Rust and WASM time maths, Mediabunny | Timeline model, ruler, snapping, split, trim, undo, shortcuts, transform handles, waveform | **Adapt** |
| `OpenCut-app/OpenCut` | MIT | Rust core being rewritten, empty web shell | Nothing yet: the editor route says "Coming soon" | **Skip** |
| `xzdarcy/react-timeline-editor` | MIT | React, interactjs, react-virtualized | Pixel maths, snap lines, row virtualising, edge auto-scroll | **Adapt** |
| `reactvideoeditor/free-react-video-editor` | MIT | Next 14, React 18, a Remotion Player (not part of our design) | Only the shape of the item list (start, length, row); a lesson in how not to sync | **Adapt** (little to take) |
| `openvideodev/react-video-editor` | OpenVideo License (custom, source-available) | Next 16, PixiJS 8, WebCodecs, closed `@openvideo/*` packages | Canvas ruler, filmstrip segments, thumbnail cache | **Ideas Only** |
| `ncounterspecialist/twick` | Sustainable Use License 1.0 (custom) | React, fabric.js 6, its own renderer | Snapping as pure functions, split with speed, snapshot undo | **Ideas Only** |
| `trykimu/videoeditor` | AGPL-3.0, or a paid commercial licence | React Router 7, Remotion 4.0.523, BullMQ | Playhead sync guards, handles with scale-corrected pointer maths, render fingerprint | **Ideas Only** |
| `Ektie/react-video-timeline-editor` | AGPL-3.0 | React, plain JavaScript | One pure model module, one undo step per gesture | **Ideas Only** |
| `Vanilagy/mediabunny` | MPL-2.0 | TypeScript library | A dependency (see `02-libraries.md`), not a logic source | **Skip** |
| `hougesen/twitch-highlight-finder` | MIT | Rust services, MongoDB, yt-dlp, FFmpeg | Chat burst maths and window building | **Adapt** |
| `nirvagold/stream-clipper` | MIT | Tauri, Rust, Svelte 5, FFmpeg | Loudness spikes, chat windows, one combined score with reasons | **Adapt** |
| `YBIGTA/24th-de-highlighter` | No licence file | Kafka Streams (Java), Spark, Python | Sliding window with an open and close rule | **Ideas Only** |
| `josec07/clipper` | Not found | None | The address returns 404 today | **Skip** |
| `lay295/TwitchDownloader` | MIT | C#, .NET, FFmpeg | VOD token and playlist flow, chat replay paging, muted parts, retries | **Adapt** |
| `DmitryScaletta/twitch-dlp` | No licence file (`package.json` says MIT) | Node 22, TypeScript | Time range to segment slicing, unmute fallbacks | **Ideas Only** |
| `streamlink/streamlink` | BSD-2-Clause | Python | Twitch ads and low latency (live only), Kick challenge recovery | **Adapt** |
| `yt-dlp/yt-dlp` | Unlicense | Python | The extractor we run as a program; Twitch storyboards; Kick API calls | **Adapt** |
| `remotion-dev/template-render-server` | No licence file | Express 5 | Only the queue shape: one job at a time, a state map, a cancel handle per job | **Ideas Only** (queue idea only; its renderer is not ours) |

### 1.1 What Changed Since The Plan Was Written

- **OpenCut moved.** `OpenCut-app/OpenCut` (98,347 stars) is now a ground-up rewrite with a Rust core. Its web app holds only UI primitives and a placeholder editor route (github.com/OpenCut-app/OpenCut/blob/main/apps/web/src/routes/editor.tsx, read 2026-11-14). The working editor lives in `opencut-app/opencut-classic`, and that is the one studied here.
- **Only two of the editors use Remotion** (the free React Video Editor demo and Kimu); OpenCut classic, OpenVideo and Twick each have their own renderer. PostGear uses neither: since 2026-11-17 the export is FFmpeg only and the editor preview is our own `<video>` plus DOM layers. What stays useful from these editors is the **editor** side: the timeline model, snapping, split and trim rules, handles, undo, the playhead guard. The Remotion-specific lessons (how to wire a Player, `Sequence`, `staticFile`) are dropped.
- **Which projects render with FFmpeg** (the sprint 13 research read them on 2026-11-15 and lists their stacks; not re-read today): `Steezy-code/clipper` (MIT: FFmpeg with ASS captions, silence trim and time remap), `NaufalRizqullah/opensource-clipping` (MIT: FFmpeg, ASS captions), `Anil-matcha/AI-Youtube-Shorts-Generator` (MIT: FFmpeg in its local mode), `kamilstanuch/Autocrop-vertical` (no licence: ideas only). `mutonby/openshorts` renders through Remotion plus a Node render service, so only its non-render logic is relevant. **What to take from the FFmpeg ones**: ASS as the caption format (our `buildAss()`), per-scene crop and a damped camera as crop keyframes, and silence trimming as a list of keep-segments that becomes our segment list. Take nothing as code: ideas and parameters only, ported to TypeScript (section 7). See `../../sprint-13/research/03-open-source-reference-repos.md`.
- **OpenVideo is not MIT and no longer uses Remotion.** Its GitHub description still says "using remotion", but `package.json` depends on closed `@openvideo/core`, `@openvideo/engine-pixi` and `@openvideo/timeline`, and its licence forbids selling a derivative.
- **Three editors are not permissive**: Twick (no hosted service without a commercial deal), Kimu and Ektie (AGPL). They are read for ideas only.
- **`josec07/clipper` does not exist.** The repository page and the API both return 404, and the account's public list has no such project.
- **Nobody uses `react-moveable`.** Each editor wrote its own handles (OpenCut classic, Kimu) or leans on its canvas library (fabric.js in Twick, PixiJS in OpenVideo). This backs the half-day spike that `02-libraries.md` asks for before Module 11 (Canvas Handles And Text) commits to the library; 2.1 and 2.5 show the two own-code routes.

## 2. Web Video Editors (Modules 08, 09, 10, 11)

### 2.1 `opencut-app/opencut-classic`

https://github.com/opencut-app/opencut-classic. MIT ("Copyright 2025-2026 OpenCut"). 298 stars, last commit 2026-05-17. Next 16.1.3, React 19, Zustand 5, Mediabunny, wavesurfer.js as a dependency, time maths compiled from Rust to WASM. The richest and best-factored editor read, and the main source for Module 09.

- **Time is an integer tick count, never a float.** One second is 120,000 ticks, a number that 24, 25, 30, 50, 60 and 120 frames a second all divide exactly. A TypeScript brand makes a plain `number` unassignable to a time field, so every fractional value must pass through one rounding function (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/wasm/media-time.ts and rust/crates/time/src/media_time.rs, read 2026-11-14). Module 01.
- **The model.** A scene has `tracks: { overlay[], main, audio[] }`: one fixed main video track, overlays above, audio below. Every element has `startTime`, `duration`, `trimStart`, `trimEnd`, optional `sourceDuration` and `retime: { rate }`. Geometry sits in `params`, not on the timeline fields (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/types.ts, read 2026-11-14). The invariant, stated in a comment and kept by tests, is `trimStart + duration * rate + trimEnd == sourceDuration`. Module 01.
- **Zoom maths.** `pixelsPerSecond = 50 * zoomLevel`, zoom from 0.1 to 100. The lowest zoom is worked out so the whole timeline fits in a quarter of the view. The slider is exponential (`zoom = min * (max / min) ^ position`), and positions are rounded to the device pixel grid. Ctrl plus wheel zooms and keeps the playhead at the same screen offset (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/zoom-utils.ts, pixel-utils.ts and controllers/zoom-controller.ts, read 2026-11-14). Modules 07, 09.
- **Ruler ticks.** Two ladders, picked by pixel spacing, with labels and ticks chosen apart (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/ruler-utils.ts, read 2026-11-14). Module 09.

```
pxPerFrame = pxPerSecond / fps
label = first of frames [2,3,5,10,15] where step * pxPerFrame >= 120 px,
        else first of seconds [1,2,3,5,10,15,30,60,120,300,600,900,1800,3600] where step * pxPerSecond >= 120 px
tick  = the same search with frames [1,2,3,5,10,15] and 18 px, then nudged so a tick always divides a label
text  = "MM:SS" on a whole second (H:MM:SS past an hour), otherwise "12f"
```

- **Snapping.** The tolerance is one constant, 10 screen pixels, turned into time at the current zoom. Snap points come from small source functions (playhead, every other element's start and end, bookmarks, keyframes) and one resolver picks the nearest (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/snapping/threshold.ts and resolve.ts, element-snap-source.ts, read 2026-11-14). The first click on the ruler does not snap to edges, "to avoid a jarring jump"; frame snapping is always on (controllers/playhead-controller.ts). Module 09.

```
tolerance = SNAP_PX / pixelsPerSecond                    // a pixel constant, converted once per gesture
points    = playhead + start and end of every item not being dragged (+ markers)
best      = nearest point with |candidate - point| <= tolerance
result    = best ? best.time : candidate                 // also return which point, to draw the guide line
```

- **Split and trim round once.** Split refuses a time on or outside the element's edges. The left half keeps the id, the right half gets a new one. The source-side split point is rounded once and the other half is found by subtraction, so the two halves always add up (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/commands/timeline/element/split-elements.ts, read 2026-11-14). Trim clamps the drag by the neighbour and by the source's real length, snaps the delta to a frame once, then clamps again (timeline/group-resize/compute-resize.ts). Modules 09, 13.

```
if not (start < t < start + duration): leave the item alone
leftVisible = t - start;                  rightVisible = duration - leftVisible
leftSource  = round(leftVisible * rate);  rightSource  = totalSource - leftSource
left  = { ...item, duration: leftVisible, trimEnd: trimEnd + rightSource }
right = { ...item, id: new, startTime: t, duration: rightVisible, trimStart: trimStart + leftSource }
```

- **Undo is a command stack.** Each command has `execute`, `undo`, `redo` and keeps the track list from before it ran. A new command clears the redo stack. A finished drag is pushed without running again. Selection is restored on undo only for commands that changed it (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/core/managers/commands.ts, read 2026-11-14). Module 08.
- **Playback clock and playhead.** Time while playing is `startTime + (now - wallClockAtStart)`, rounded to a frame, on `requestAnimationFrame`. Per-frame listeners are kept apart from state-change listeners, and the playhead line is moved by writing its `left` style straight to the element, not through React state (core/managers/playback-manager.ts, timeline/controllers/playhead-controller.ts). Module 08.
- **Shortcuts** (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/actions/definitions.ts, read 2026-11-14): Space or K play and pause; J and L seek one second; Left and Right step a frame; Shift plus arrows jump five seconds; Home or Enter to the start; End; S split; Q split and drop the left; W split and drop the right; Backspace or Delete; Ctrl+C, V, A, D; N toggle snapping; Escape cancel; Ctrl+Z; Ctrl+Shift+Z or Ctrl+Y. Bindings are user-editable and stored with versioned migrations. Module 09.
- **Canvas handles are their own code**, no library: a transform controller, a hit test, and snap guides with an 8 screen-pixel tolerance; rotation snaps to 90 degree steps when within 5 degrees; the lowest scale is 0.01 (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/preview/preview-snap.ts and controllers/transform-handle-controller.ts, read 2026-11-14). Module 11.
- **Waveform and filmstrip.** A peak summary is built once per source (one peak per 128 samples), cached, then resampled into 1 px bars with a 1 px gap for the visible part of the clip only, on a canvas sized by the device pixel ratio (media/waveform-summary.ts, timeline/components/audio-waveform.tsx). The filmstrip is a single thumbnail repeated as a CSS background at `trackHeight * 16 / 9` wide (timeline/components/timeline-element.tsx): cheap, but not a real strip. Modules 04, 09.
- **A limiter on the final mix, only when needed.** If the mixed audio's peak is under 0.98 nothing is done. Otherwise the mix goes through a hard limiter (threshold -1 dB, ratio 20, 1 ms attack, 120 ms release) and a 0.98 output gain, so stacked music and sound effects cannot clip (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/media/audio-mastering.ts, read 2026-11-15). Module 14.
- **Also worth knowing**: the project file has had 31 schema migrations (services/storage/migrations/transformers), and moving between tracks goes through one "resolve drop target" function that returns the track, whether a new track is needed, and above or below (timeline/components/drop-target.ts, timeline/group-move/resolve-move.ts).

### 2.2 `xzdarcy/react-timeline-editor`

https://github.com/xzdarcy/react-timeline-editor. MIT ("Copyright (c) 2021 zdarcy"). 801 stars, last commit 2026-01-25. React, interactjs, react-virtualized. A general timeline component, not a video editor.

- **Model**: rows of actions with `start` and `end` in float seconds, plus `minStart`, `maxEnd`, `movable`, `flexible` (github.com/xzdarcy/react-timeline-editor/blob/master/packages/engine/src/interface/action.ts, read 2026-11-14). Module 09.
- **Pixel maths in four pure functions**: `px = startLeft + (time / scale) * scaleWidth` and its inverse, where `scale` is seconds per ruler mark and `scaleWidth` is pixels per mark (160 by default, 10 sub-divisions) (github.com/xzdarcy/react-timeline-editor/blob/master/packages/timeline/src/utils/deal_data.ts and interface/const.ts, read 2026-11-14). Module 09.
- **Snap tolerance 8 px**, working in pixels: both the left and the right edge of the dragged block are tested against the other blocks' edges and the cursor, and a guide line is drawn where a moving edge equals a target (packages/timeline/src/components/row_rnd/row_rnd.tsx, edit_area/hooks/use_drag_line.ts). Module 09.
- **Rows are virtualised** with a react-virtualized `Grid` (one column, 10 rows of overscan) (packages/timeline/src/components/edit_area/edit_area.tsx). **Edge auto-scroll** speeds up with the distance past the edge, capped at 3 px a tick (row_rnd/hooks/useAutoScroll.ts). Module 09.
- **The engine clock** caps one tick's delta at 1 second, so a background tab does not jump the time, and fires enter and leave events per action (github.com/xzdarcy/react-timeline-editor/blob/master/packages/engine/src/core/engine.ts, read 2026-11-14). Module 08.

### 2.3 `reactvideoeditor/free-react-video-editor`

https://github.com/reactvideoeditor/free-react-video-editor. MIT (the copyright line is still the template's placeholder). 141 stars, last commit 2025-02-15. Next 14.2.7, `remotion` and `@remotion/player` ^4.0.208. One 489-line component, offered as a demo of a paid product.

- **Model**: `{ id, start, duration, row }` in frames, plus `src` or `text` (github.com/reactvideoeditor/free-react-video-editor/blob/main/types/types.ts, read 2026-11-14).
- **Item list**: every item is a start and a length on a row; the total length is the largest `start + duration` (components/react-video-editor.tsx). That is the whole timeline contract in thirty lines. Module 05 uses the same idea for its overlay list, in output time.
- **What not to take**: the playhead is updated by polling `getCurrentFrame()` on a 33 ms interval into React state, and item positions are percentages of the total length, so there is no zoom. No trim, split, snap, undo or drag exists.

### 2.4 `openvideodev/react-video-editor` (Formerly `designcombo/react-video-editor`)

https://github.com/openvideodev/react-video-editor. OpenVideo License: free for individuals and for-profit organisations of up to 3 people, a paid company licence above that, and no selling of a derivative. 1,836 stars, last commit 2026-06-30. Next 16.2.6, React 19, PixiJS 8, Mediabunny, Zustand. Ideas only.

- **Time in integer microseconds**: a clip has `display: { from, to }`, `trim: { from, to }`, `duration`, `sourceDuration`, `playbackRate`; tracks hold `clipIds` (github.com/openvideodev/react-video-editor/blob/main/src/types/timeline.ts, read 2026-11-14). Module 01.
- **The ruler is one canvas** that draws only the visible range: the main interval is the first of `[0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]` seconds that is at least 60 px wide, with 2, 4 or 5 sub-ticks, dropped when they fall under 6 px (src/components/editor/timeline/ruler.tsx). Module 09.
- **Filmstrip in segments**: thumbnails are laid out in segments about 1,200 px wide; only segments on screen plus a backlog on each side are filled; a fallback image is drawn first; each wanted time is matched to the nearest thumbnail that exists; an LRU cache holds 500 images (src/components/editor/utils/filmstrip.ts, thumbnail-cache.ts, timeline/items/video.ts). Module 09.
- **Shortcuts**: Space, Ctrl+B split, Ctrl+X cut, Ctrl+= and Ctrl+- zoom, arrows nudge (src/hooks/use-editor-hotkeys.ts). Zoom steps through a fixed list of levels, with a "fit" level worked out from the canvas width (src/components/editor/utils/timeline.ts).

### 2.5 `trykimu/videoeditor`

https://github.com/trykimu/videoeditor. AGPL-3.0, or a commercial licence from the authors. 2,300 stars, last commit 2026-09-10. React Router 7, React 19, all `remotion` packages pinned to 4.0.523, a BullMQ render queue. The closest stack to ours. Ideas only.

- **Playhead sync with guards.** The playhead listens to the player's frame and `seeked` events (ours: `requestVideoFrameCallback` and `seeked` on the `<video>`). Two flags stop a feedback loop: "I am seeking" (set when a drag calls `seekTo(frame)`, cleared on `seeked`) and "this update came from the Player". Player updates are ignored while dragging (github.com/trykimu/videoeditor/blob/main/app/hooks/useRuler.ts, read 2026-11-14). Module 08.

```
player.on("frameupdate", f => if not dragging and not seeking: playhead = f)
on playhead drag: seeking = true; player.seekTo(frame); playhead = frame
player.on("seeked", () => seeking = false)
```

- **Handles correct at any preview size.** Selection outlines and four corner handles sit over the preview and every pointer delta is divided by the preview scale, so a drag is correct at any size (in Kimu the divisor is Remotion's `useCurrentScale()`; ours is the width of the preview box over the canvas width) (github.com/trykimu/videoeditor/blob/main/app/video-compositions/DragDrop.tsx, read 2026-11-14). Module 11.
- **Render fingerprint.** Before queueing a render, the timeline is hashed after dropping UI-only fields (drag flags, local preview URLs) and rounding numbers; an equal hash reuses the stored file. The worker runs one render at a time (app/lib/render-fingerprint.ts, app/videorender/videorender.ts). Module 15.
- **A warning.** The saved timeline stores each clip's `left` and `width` in pixels (app/components/timeline/types.ts), so zoom, snapping and export all convert back and forth. Its snap tolerance is `max(4, 10 / zoom)` px with grid points every second (app/hooks/useSnapPoints.ts).

### 2.6 `ncounterspecialist/twick`

https://github.com/ncounterspecialist/twick. Sustainable Use License 1.0: no hosted service or SaaS without a commercial agreement. 548 stars, last commit on main 2026-05-07. A monorepo of React packages: fabric.js 6 canvas, its own player and renderer. Ideas only.

- **Snapping is two pure functions**: `snapTime(time, targets, tolerance)` and "pixels to seconds", with 10 px as the default; targets are 0, the total length, the playhead, and every other element's start and end (github.com/ncounterspecialist/twick/blob/main/packages/timeline/src/utils/snap.ts and packages/video-editor/src/helpers/snap-targets.ts, read 2026-11-14). Module 09.
- **Split respects speed**: the second half's source start is `sourceStart + (splitTime - elementStart) * playbackRate` (packages/timeline/src/core/visitor/element-splitter.ts). The shortest element is 0.1 s (packages/video-editor/src/helpers/constants.ts). Modules 09, 13.
- **Undo is whole-document snapshots** (`past`, `present`, `future`), capped at 20 (packages/timeline/src/context/undo-redo-context.tsx). Module 08.
- **Playhead follow**: scroll only when the playhead comes within 80 px of a view edge, by just enough (packages/video-editor/src/hooks/use-playhead-scroll.ts). Filmstrip: at most 24 thumbnails a clip, each 40 to 96 px wide (components/track/timeline-media-strip.tsx). Rotation uses fabric's built-in snapping control (packages/canvas/src/components/element-controls.tsx).

### 2.7 `Ektie/react-video-timeline-editor`

https://github.com/Ektie/react-video-timeline-editor. AGPL-3.0. 3 stars, last commit 2026-09-21. React and plain JavaScript. Ideas only. Modules 08, 09, 10.

- **All edits live in one pure model file** in integer milliseconds: move, trim, split, ripple, speed, with snap points and tolerance passed in as arguments (github.com/Ektie/react-video-timeline-editor/blob/main/packages/editor/src/TimelineClipModel.js, read 2026-11-14). The UI turns 8 px into milliseconds at the current zoom (TimelineEditor.js). Module 09.
- **The shortest clip is 200 ms**, and split refuses to cut closer than that to either edge. Module 09.
- **A crop is a rectangle in fractions of the source frame** (`x`, `y`, `w`, `h` from 0 to 1), never in pixels, so one crop fits every rendition. The smallest side is 0.05; a full-frame rectangle counts as "no crop"; changing the ratio keeps the largest box of that ratio around the current centre, then clamps it inside the frame (github.com/Ektie/react-video-timeline-editor/blob/main/packages/editor/src/mediaCrop.js, read 2026-11-15). Module 10.
- **One undo step per gesture**: drag frames are transient, and closing the drag writes one history entry (limit 60). The reducer does no saving, because a save inside a state updater ran twice under React StrictMode (packages/editor/src/useTimelineEngine.js). Module 08.

### 2.8 `Vanilagy/mediabunny`

https://github.com/Vanilagy/mediabunny. MPL-2.0. 7,498 stars, last push 2026-11-14. Its own examples were not read. Its use was read through OpenCut classic, which opens a file, reads duration, display size and the average packet rate (frame rate), and grabs one frame for a thumbnail (github.com/opencut-app/opencut-classic/blob/main/apps/web/src/media/mediabunny.ts, read 2026-11-14). Module 04 (own-file upload checks in the browser).

## 3. Stream Highlight Finders (Module 16)

### 3.1 `hougesen/twitch-highlight-finder`

https://github.com/hougesen/twitch-highlight-finder. MIT (file `LICENCE`, "Copyright (c) 2022 Mads Hougesen"). 9 stars, last commit on main 2024-02-27. Rust services with MongoDB; an undergraduate thesis project. Chat only.

- **Message score**: split on spaces, drop `@mentions`, look each word up in an emote table scored 0 to 10; the score is `(10 + highestEmoteScore) / 10`, so 1.0 for plain text and up to 2.0 for a hype emote (github.com/hougesen/twitch-highlight-finder/blob/main/analyzer/src/analysis/mod.rs, read 2026-11-14).
- **Burst detection** (github.com/hougesen/twitch-highlight-finder/blob/main/highlight-finder/src/finder/mod.rs, read 2026-11-14). A comment in the code already asks whether a sliding window would be better.

```
bucket[t - t % 10 s] += messageScore
busy  = buckets with at least 1 message a second (score >= 10)
limit = 2 * max(P95 of all buckets, mean of busy buckets, 10)
hot   = buckets above limit
clips = runs of hot buckets that touch; start = first bucket, end = last bucket
```

- **Cutting**: 10 s is added on each side, the stream address comes from `yt-dlp -g`, and FFmpeg cuts with `-ss` and `-t` before `-i` (clipper/src/main.rs, clipper/src/clipping/mod.rs). The padding matters: chat reacts after the moment, so the window must reach back.

### 3.2 `nirvagold/stream-clipper`

https://github.com/nirvagold/stream-clipper. MIT ("Copyright (c) 2024 Stream Clipper"). 4 stars, last commit 2025-12-31. Tauri desktop app, Rust, Svelte 5, FFmpeg. The only one that combines loudness and chat, which is exactly Module 16.

- **Loudness spikes** (github.com/nirvagold/stream-clipper/blob/main/src-tauri/src/audio/analyzer.rs and types.rs, read 2026-11-14):

```
chunks = RMS and peak for each 0.5 s of 22,050 Hz mono audio
base   = median(RMS);  sd = spread around base
limit  = percentile(RMS, 75 | 82 | 90 | 95 by sensitivity); if limit <= 1.15 * base: limit = base * (1 + 0.35 * sensitivity)
keep a chunk if RMS > limit and (voice detected or 3+ of: jump > 1.5 * mean jump, peak / RMS > 2,
                                 next chunk > 1.2 * base, RMS > base + 1.5 * sd)
merge kept chunks less than 3 s apart; drop runs shorter than 2 s
score  = clamp((peakRMS / base - 1) * 30, 0, 40) + quality bonus + voice bonus      // 0 to 100
```

- **Chat spikes**: fixed 5 s windows holding message count, unique users, keyword hits, emote density and capitals ratio. The baseline is the median count. A window is a spike when the count is over 3 times the baseline, or 3 or more keyword hits, or emote density over 0.3; touching spike windows merge (src-tauri/src/chat/analyzer.rs, chat/types.rs). The parser accepts TwitchDownloader's chat JSON (a `comments` array) (chat/parser.rs).
- **One score, with reasons**: where a loudness spike and a chat spike overlap, the clip is the union and the score is `(audio * 0.6 + chat * 0.4) * 1.5`, capped at 100; alone, each is multiplied by its weight. Every highlight carries a list of plain reason strings. Highlights that overlap by more than half of the shorter one are merged, then padded before and after and clamped to the video (github.com/nirvagold/stream-clipper/blob/main/src-tauri/src/highlight/scorer.rs, merger.rs and types.rs, read 2026-11-14).
- **Do not take**: on its free tier it shuffles the results at random so each run differs. Our scorer must be pure and repeatable.

### 3.3 `YBIGTA/24th-de-highlighter`

https://github.com/YBIGTA/24th-de-highlighter. No licence file. 11 stars, last commit on main 2024-08-25. Kafka Streams in Java, Spark, Python; live YouTube chat. Ideas only.

- **A real sliding window**: 20 s windows that advance by 1 s, counting chat messages. An event opens at the first window over a fixed threshold and closes at the first window under it. Events shorter than 30 s are dropped; longer than 60 s are cut to 60 s from the start (github.com/YBIGTA/24th-de-highlighter/blob/main/highlighter-sliding-window/src/main/java/kafkastreams/example/KStream/KStreams.java, read 2026-11-14).
- **Weakness**: the threshold is a fixed number, not relative to the channel. The README says the range is then refined with speech-to-text, which is Sprint 13 ground.

### 3.4 `josec07/clipper`

Not found on 2026-11-14 (404 from the page and from the API). Nothing to record.

## 4. Twitch And Kick Access (Modules 03, 04)

### 4.1 `lay295/TwitchDownloader`

https://github.com/lay295/TwitchDownloader. MIT ("Copyright (c) lay295"). 4,024 stars, last commit 2026-10-06. C# on .NET, FFmpeg. The fullest written-down account of how a Twitch VOD is fetched.

- **Token and playlist flow** (github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/TwitchHelper.cs, read 2026-11-14):

```
token   = POST gql.twitch.tv/gql, query PlaybackAccessToken_Template(vodID)     -> { value, signature }
          (the web player's public client id; "Authorization: OAuth ..." only for sub-only videos)
master  = GET usher.ttvnw.net/vod/v2/{id}.m3u8?token&sig&allow_source=true&allow_audio_only=true
variant = pick a rendition; segments are about 10 s each
```

- **What breaks, and how it recovers.** A null token means the video is deleted or expired. A 403 body with `vod_manifest_restricted` or `unauthorized_entitlements` means sub-only, and is reported as its own error. An old muted highlight whose playlist address ends in `-muted-...` fails, and is retried with that suffix removed (TwitchDownloaderCore/VideoDownloader.cs). Each segment gets 5 attempts with a jittered wait (Tools/VideoDownloadThread.cs).
- **Muted parts.** A segment whose name contains `-muted` has silent audio (a copyright match). The tool first asks for the same name without `-muted`; a 403 means it is really muted, and that try does not count as an attempt.
- **Trimming.** Walk the segment list adding durations to find the first and last segment, and keep the leftover as a start offset. "Safe" mode keeps whole segments; "Exact" applies the offset. Segments are joined with FFmpeg's concat demuxer and `-avoid_negative_ts make_zero`, with one retry.
- **Chat replay.** The persisted query `VideoCommentsByOffsetOrCursor`: the first call sends `contentOffsetSeconds`, later calls send the last edge's `cursor`, until `hasNextPage` is false. Every comment carries `contentOffsetSeconds`, which is the chat-rate signal. Errors back off by `1 s * errorCount` and give up above 10. Long videos are split into time ranges fetched side by side (github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/ChatDownloader.cs, read 2026-11-14). The query's hash is hard-coded and Twitch can rotate it: this is the part most likely to break.
- **Do not take**: on a TLS failure it falls back to a third-party proxy. Other query names seen: `VideoAccessToken_Clip`, `ShareClipRenderStatus`, `VideoPlayer_ChapterSelectButtonVideo` (chapters).

### 4.2 `DmitryScaletta/twitch-dlp`

https://github.com/DmitryScaletta/twitch-dlp. No LICENSE file; `package.json` declares MIT. 169 stars, last commit 2026-11-08. Node 22, TypeScript, zero heavy dependencies. Ideas only, by our rule.

- **Time range to segments**: give each segment a running `offset`; the first wanted segment is the last one with `offset <= start`, the last is the first with `offset >= end`. If the playlist has an init segment (fragmented MP4), it is always put in front (github.com/DmitryScaletta/twitch-dlp/blob/master/src/utils/getFragsForDownloading.ts, read 2026-11-14). Module 03.
- **Unmute rules**: try an unmute only when the video is under 7 days old (src/utils/getTryUnmute.ts). Try the same rendition without `-muted`; if that fails, try the same segment in other renditions and accept a different quality (src/utils/getUnmutedFrag.ts). Module 03.
- **Token call**: `PlaybackAccessToken` with `playerType: site`, `platform: web`, then `usher.ttvnw.net/vod/{id}.m3u8` (src/api/twitch.ts).

### 4.3 `streamlink/streamlink`

https://github.com/streamlink/streamlink. BSD-2-Clause. 11,921 stars, last push 2026-11-13. Python.

- **Twitch: ads and low latency are live-only problems.** Ad segments are found by `EXT-X-DATERANGE` entries with class `twitch-stitched-ad`, or a segment title containing "Amazon", and are filtered out. Low latency uses `EXT-X-TWITCH-PREFETCH` segments (github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/twitch.py, read 2026-11-14). A VOD has neither.
- **Twitch: the client-integrity token is live-only too.** For a live stream the plugin first asks for the access token without it, and on an error opens a real browser to get one and caches it. Its own comment says a VOD does not need one. This backs the plan's choice to leave live streams out of Sprint 12.
- **Kick: a 403 means a browser challenge.** The plugin queries `kick.com/api/v2/channels/{channel}/livestream`, `web.kick.com/api/v1/channels/{channel}/videos/{vod}` and `kick.com/api/v2/clips/{clip}`. On a 403 it launches Chromium, lets it solve the JavaScript challenge, caches the request headers, and retries once (github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/kick.py, read 2026-11-14). It also uses a custom TLS context. Module 03.

### 4.4 `yt-dlp/yt-dlp` (`twitch.py` And `kick.py`)

https://github.com/yt-dlp/yt-dlp. Unlicense. 207,773 stars, last push 2026-11-04. Python. This is the program Module 03 runs, so these files say what we will get.

- **Twitch VOD**: a `videoPlaybackAccessToken` query (`platform: web`, `playerType: site`), then `usher.ttvnw.net/vod/{id}.m3u8` with `allow_source`, `allow_audio_only` and `supported_codecs=av1,h265,h264`. A 403 with `vod_manifest_restricted` or `unauthorized_entitlements` becomes "subscriber-only", with a login hint. AV1 renditions are forced into MP4 because MPEG-TS cannot carry them well (github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitch.py, read 2026-11-14). Module 03: ask for H.264.
- **Twitch storyboards are free.** The extractor returns the seek-bar preview sprite sheets (`VideoPlayer_VODSeekbarPreviewVideo`) as a `storyboard` format with rows, columns and tile size. Module 04 can show a filmstrip for a Twitch video before any video data is fetched.
- **No Twitch chat.** The file has no chat replay code today (the word "rechat" does not appear). Module 16 must make its own GraphQL call, as in 4.1.
- **Kick**: a VOD is a POST to `web.kick.com/api/v1/stream/{uuid}/playback`, which returns `playback_url.vod` (an HLS playlist); a clip is `kick.com/api/v2/clips/{id}` with `clip_url` (HLS or MP4). Every call is made with browser impersonation switched on, and a `session_token` cookie becomes a bearer token. Subscriber-only videos are detected and reported (github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/kick.py, read 2026-11-14). Note that Streamlink and yt-dlp use different VOD endpoints: Kick's API moves.

## 5. A Render Server Template (Queue Shape Only) (Module 15)

### 5.1 `remotion-dev/template-render-server`

https://github.com/remotion-dev/template-render-server. No LICENSE file; `package.json` says `UNLICENSED` and the README points to the Remotion licence. 14 stars, last commit 2026-11-02. Express 5. **Ideas only, and only the queue**: since 2026-11-17 the render is FFmpeg, so its renderer, bundle step and Chrome Dockerfile are not relevant.

- **Queue shape**: a `Map<jobId, state>` where the state is `queued`, `in-progress` (with `progress`), `completed` (with the file address) or `failed` (with the error). The queue is one promise chain, so one render runs at a time. Each job owns a cancel handle; cancelling a queued job just deletes it (github.com/remotion-dev/template-render-server/blob/main/server/render-queue.ts, read 2026-11-14). Our `ClipJob` row and the `postgear-render` queue at concurrency 1 are the durable form of this; the cancel handle becomes `child.kill()` on the FFmpeg process (`09-ffmpeg-render-cookbook.md`, section 11).
- **Their timeline model** (remotion-dev/remotion, `building-a-timeline.mdx`, read 2026-11-14): `Track { name, items[] }` with items that have a start and a length. The same shape as our `tracks`.
- **Their sync rule**: subscribe to the player clock in a component that sits beside the player, never in the component that renders it, or the whole editor re-renders every frame (packages/docs/docs/player/current-time.mdx). The idea carries over: the `<video>` clock is read through `requestVideoFrameCallback` into a small external store (Module 08).

## 6. What We Take, By Module

| Finding | From | Module | How It Changes The Design |
|---|---|---|---|
| Integer time in the project file | OpenCut classic, Ektie, OpenVideo | 01 | Confirms Module 01's integer milliseconds (`fromMs`, `msToFrame`). No float seconds, no pixels. Frames appear only where the document meets FFmpeg (the `fps` filter and the encode) |
| The trim invariant, with round-once | OpenCut classic | 01, 09, 13 | The time map tests assert `sourceIn + duration * speed == sourceOut` after every trim, split and speed change |
| Many schema upgrades are normal | OpenCut classic (31 so far) | 01 | `upgrade()` gets a test per version from the first day |
| Impersonation and browser challenges | yt-dlp, Streamlink (Kick) | 02, 03 | The doctor checks that yt-dlp can impersonate a browser; a Kick 403 is its own error with "update yt-dlp" as the fix |
| Token, playlist, rendition flow | TwitchDownloader, yt-dlp, twitch-dlp | 03 | The Twitch `fetchRange` strategy, and three typed errors: gone, sub-only, muted parts |
| Time range to segments, with a leftover offset | TwitchDownloader, twitch-dlp | 03, 05 | Whole segments are fetched with handles; the exact cut uses the offset; an init segment is always kept |
| Muted segments | TwitchDownloader, twitch-dlp | 03, 16 | `LinkInfo` records muted spans; the loudness signal skips them, so silence is not read as "boring" |
| Five tries per segment, jittered | TwitchDownloader | 03, 04 | Segment retries sit inside the activity; the Temporal retry is for the whole step |
| Twitch storyboards | yt-dlp | 04 | The filmstrip for a Twitch video can come from the platform's sprite sheets first |
| Peaks made once, drawn for the visible part | OpenCut classic, stream-clipper | 04, 09 | Import writes one peaks file that feeds both the waveform and the loudness signal; the browser never decodes audio |
| One render at a time, a state per job, a cancel handle | Render server template | 05, 15 | One `postgear-render` task queue at concurrency 1; the cancel handle is the FFmpeg child process |
| Render fingerprint | Kimu | 15 | "Stale export" is a hash of the frozen document without UI-only fields |
| Zoom to fit, exponential slider, ruler up to an hour | OpenCut classic | 07, 09 | One zoom model serves a 6-hour video and a 30-second clip; the ruler ladder must go past the blueprint's 1 minute step |
| Playhead sync with guards | Kimu, Remotion docs | 08 | A `usePlaybackClock` hook beside the `<video>` (`requestVideoFrameCallback`); "seeking" and "dragging" flags; no polling |
| One undo entry per gesture | OpenCut classic, Ektie, Twick | 08 | The existing `history.ts` stack, fed on pointer-up; selection kept out of history; a cap of about 50 |
| One pixel tolerance, pure resolver | OpenCut classic, Twick, xzdarcy, Ektie | 09 | `SNAP_PX = 8` in one file; `resolveSnap()` in `video-engine`; N toggles it |
| Two-ladder ruler | OpenCut classic, OpenVideo | 09 | `getRulerConfig(pxPerSecond, fps)` as a pure, tested function |
| Split and trim rules, shortest clip | OpenCut classic, Twick, Ektie | 09 | Split only strictly inside; the shortest segment is 200 ms |
| Shortcut set | OpenCut classic, OpenVideo | 09 | The list in 2.1, shown in the shortcuts sheet |
| Follow the playhead, edge auto-scroll | Twick, xzdarcy | 09 | Scroll only near the edge (80 px), by just enough |
| Crops as fractions of the frame | Ektie | 10 | Crop boxes are stored from 0 to 1 of the video frame, so the light copy and the sharp range share one crop |
| Handles divided by the preview scale | Kimu, OpenCut classic | 11 | Whatever draws the handles must divide by the preview box scale; 8 px guides; rotation snaps within 5 degrees |
| A limiter only when the mix would clip | OpenCut classic | 14 | The export loudness pass checks the peak first and adds a limiter only when needed |
| Burst maths, combined score, reasons | hougesen, stream-clipper, YBIGTA | 16 | See the scorer notes in section 8, lessons 10 to 12 |
| Chat replay paging | TwitchDownloader | 16 | Our own GraphQL call behind the switch, with the query hash in config |

## 7. The Licence Rule

- **MIT, BSD, Apache, Unlicense**: logic may be adapted. The notice is kept, and the module doc names the repository and the file it came from. In this list: OpenCut classic, `xzdarcy/react-timeline-editor`, the free React Video Editor, `hougesen/twitch-highlight-finder`, `nirvagold/stream-clipper`, TwitchDownloader, Streamlink, yt-dlp.
- **GPL, AGPL, custom source-available, or no licence file**: read for ideas only. Nothing is copied, not a function, not a constant table. In this list: Kimu and Ektie (AGPL), Twick, OpenVideo, `YBIGTA/24th-de-highlighter`, `twitch-dlp`, the Remotion render-server template.
- **Nothing is taken from StreamLadder, OpusClip or Postiz.** Postiz is AGPL; the other two are closed products.
- **Only permissive code ships inside PostGear.** yt-dlp and FFmpeg run as separate programs (a GPL FFmpeg build is a separate process on our own servers, see `02-libraries.md` section 3). Nothing Remotion is used.
- **Even with "Adapt", port, do not paste.** Most of the adaptable logic is Rust, C# or Python, and ours is TypeScript, so every piece is rewritten against our own types and tests.

## 8. Patterns That Repeated Across Projects

1. **Store time as an integer, convert at the edges.** OpenCut classic uses 120,000 ticks a second, OpenVideo microseconds, Ektie milliseconds, Remotion's docs frames. The two that store floats or pixels (Twick, Kimu) carry rounding and conversion code everywhere. Frames are right at the render edge and wrong in the saved file, because a source and a clip can have different frame rates.
2. **An item is a start, a length, and a window into its source.** Every editor has the same three facts under different names (`trimStart` and `trimEnd`, `trim.from` and `trim.to`, `trimBefore` and `trimAfter`). The plan's segment (`sourceIn`, `sourceOut`, `speed`) is the same idea with less to keep in step.
3. **Round once per gesture.** Round the drag delta or the split point one time, and derive every other field from it. Rounding each field on its own lets halves drift apart by a tick.
4. **Snapping tolerance is a pixel constant, defined once, converted to time at the current zoom.** It is 8 px (xzdarcy, Ektie) or 10 px (OpenCut classic, Twick). Snap points are always the playhead plus other items' edges; the dragged items are left out; the resolver is a pure function that also says what it snapped to, so the guide line can be drawn.
5. **Zoom is one number that scales a base "pixels per second".** Bases seen: 50 (OpenCut classic), 100 (Kimu). The good ones work out a fit-to-view minimum, use an exponential slider, and keep the playhead still on screen while zooming.
6. **Ruler ticks come from a fixed ladder and a minimum pixel gap**, never from maths on the fly: frames first, then seconds up to an hour. Draw only the visible range.
7. **The playhead never goes through app state while playing.** The Player (or the clock) is the source of truth; the timeline listens to `frameupdate`; a drag calls `seekTo` and sets a flag so the echo is ignored. Polling on a timer is the one approach to avoid.
8. **Undo is snapshots, one per finished gesture.** Three of four editors keep whole-document copies with a cap (20 to 60); only OpenCut classic has command objects, and even those keep a full copy of the tracks. Our documents are small, so snapshots through the existing `history.ts` are enough.
9. **Edit logic is pure and sits outside React.** Ektie's single model file, Twick's `snap.ts`, OpenCut classic's `ruler-utils.ts` and `compute-resize.ts` all take plain data and return plain data, and that is where their tests are. This is the case for putting trim, split, snap and ruler maths in `packages/video-engine`.
10. **Highlights are "unusual for this stream", not "loud" or "busy".** Every finder compares a window with the stream's own baseline: a median, a percentile, or twice the 95th percentile. A fixed threshold (YBIGTA) is the weak version.
11. **Windows are short, then merged and padded.** 0.5 s for loudness, 5 to 20 s for chat; neighbours within about 3 s are merged; runs under 2 s are dropped; then padding is added, more before than after, because chat reacts late.
12. **Signals are combined by weight plus a bonus for agreeing**, and each result keeps its reasons as plain text (stream-clipper: 0.6 loudness, 0.4 chat, times 1.5 when both fire). That maps straight onto `Clip.score` and `Clip.reasons`.
13. **Platform access breaks at the token and the persisted query, and tools recover by updating, not by cleverness.** Typed errors for "gone", "sub-only" and "muted" cover most Twitch failures. Kick needs a real browser fingerprint. Both are reasons to keep our own code thin and let yt-dlp carry the churn.
