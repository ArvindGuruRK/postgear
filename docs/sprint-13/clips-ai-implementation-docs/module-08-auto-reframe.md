# Module 08: Auto-Reframe

> **Sprint 13, Clips AI** | Status: Done (2026-11-27) | Size: L (one full session)
> **Depends on**: [Module 07](module-07-face-detection-and-detect-camera.md)
> **Stories**: CA-4.2
> **Next**: [Module 09](module-09-ai-effects.md), [Module 10](module-10-recipes-and-brand-kit.md)

## Goal

**Demo 4.** With **Follow The Speaker** on, a wide shot of one or two people becomes a tall clip whose frame stays on whoever is talking: it moves smoothly, holds still for small movements, cuts instead of sliding when the speaker changes, and holds when it loses them, marking that stretch so the user can fix it by hand. **Show Both** stacks two people instead. Turning it off gives back the user's own crop boxes exactly. The result is nothing more than crop keyframes in the document, which Sprint 12's layout code already draws (the browser preview with `areaCropAt`, the export through a crop expression the compiler writes). Following the speaker is **free**: it uses no AI minutes (the faces come from Module 07, also free).

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) section 6.
- User stories: Journey A steps 2 and 4; CA-4.2; section 5 (no face, the speaker leaves, many faces).
- Sprint doc: The Clip Document, Version 2 (`layout.follow`, crop keyframes).
- Research: [`09-ass-captions-and-edit-cookbook.md`](../research/09-ass-captions-and-edit-cookbook.md) section 9 (**verified**: the crop keyframe methods, why a flat chain fails, the balanced fallback; `sendcmd` is the method, per Sprint 12 research 09) and 14.1 (what the compiler must do).
- Research: [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md), the reframe recipe: a mode per scene, a dead zone, confirming a jump over several detections, a speed cap, cutting on scene changes, smoothing with no lag, reducing to few keyframes; choosing the speaker from the `speech` track and mouth movement without a dedicated model; how AutoFlip and the open clippers do it (ideas only where the licence says so).
- Code: Module 07's `people.ts`, the face file and routes; Sprint 12 Module 10's `layout/` (`areaCropAt` interpolating keyframes, `setAreaCrop`, the crop stage) and the render compiler in `packages/video-engine/src/render/` (`frameState`, `compileFfmpeg`); `packages/video-preview` (`PreviewEngine`); Sprint 12 Module 16's `scene` track; Module 02's `speech` track and words; the timeline rows.

## Design

### 1. Who Is Speaking (`reframe/speaker.ts`, pure)

With no model for it, the speaker is inferred from what we have:

- One person in the stretch: they are the subject throughout.
- Several people: for each stretch of speech (from the `speech` track and the words' times), score each person by how much their face box changes in its lower half while sound is present (a cheap stand-in for a moving mouth, computed from box height changes at 5 a second), by size, and by how central they are; the highest wins that stretch. Stretches shorter than 1.2 seconds are joined to a neighbour so the frame does not flick between people on a short "yeah".
- With no speech track (the video was never listened to), fall back to the largest face.
- More than four people: return `many`, with thumbnails' boxes for the picker; the user chooses whom to follow, and that person is the subject throughout.
- Returns `SubjectSpan[]`: `{ from, to, personId | null }`; `null` where nobody is found.

This heuristic is the weakest part of the feature. It is isolated in one file with its thresholds in `reframe/tuning.ts`, so a dedicated active-speaker model can replace it later (Module 17) without touching anything else.

### 2. The Camera Path (`reframe/path.ts`, pure)

`followPath(people, spans, scenes, areaShape, options)` returns crop keyframes for one area:

- For each span with a subject: a target crop centred a little above the face's centre (head room), sized so the face is about a third of the crop's height, shaped to the area, clamped to the picture.
- **Dead zone**: the crop does not move while the target stays inside the middle 20% of the crop's width.
- **Smoothing with no lag**: filter the target path forwards and backwards (possible because the whole clip is known), then cap the speed so a pan is never faster than a set fraction of the width a second.
- **Cuts, not slides**: at a change of subject and at every scene cut (from the `scene` track), jump: two keyframes one frame apart.
- **Lost subject**: where a span has no subject, hold the last crop. Stretches longer than 1.5 seconds are returned separately as `lost: Range[]`.
- **Reduce**: drop keyframes that a straight line between their neighbours already explains (within a small tolerance), so a 60 second clip has tens of keyframes, not hundreds.
- `followBoth(people, spans, ...)`: for Show Both, two areas stacked (the Split layout's frames), each following one person with the same rules, ordered left to right by where the people sit.
- Overrides: `layout.follow.overrides` (`{ from, to, rect }` in the video's time) replace the path inside their range, with a cut at each end.
- Tests: a still face gives two keyframes; a slow walk gives a smooth path under the speed cap; small jitter gives none (dead zone); a speaker change gives a cut; a lost stretch holds and is reported; an override replaces its range; the reducer keeps the path within tolerance.

### 3. In The Document

- `enableFollow(doc, { mode, faceAssetId, keyframes })`: saves the user's current layout aside (`layout.follow.saved`, the areas as they were), sets `layout.follow`, and writes the keyframes into the area's (or areas') `crop`. `disableFollow(doc)` restores `saved` exactly. Both are one undo step.
- Keyframes are in the video's own time, so trims, cuts and speed changes need no recomputation in the document. When a clip is extended beyond the stretch the face file covers, the editor asks for faces for the new part and recomputes.
- Each keyframe carries `ease: 'linear' | 'hold'` (`linear` is a pan, `hold` is a jump cut); `followPath` writes `hold` at a change of subject and at a scene cut, and `linear` elsewhere.
- The browser preview needs no change: `areaCropAt` already interpolates, and `frameState` calls it, so `PreviewEngine` moves the crop with a CSS transform.

### 3a. The Crop In The Export (`compileFfmpeg`)

The compiler turns each area's keyframes into one expression for `x` (and `y`) of the `crop` filter, fixed `w` and `h`, in the graph file passed as `-/filter_complex graph.txt`:

- **One method for Sprint 12 and 13: `sendcmd`, one linear expression per interval.** Sprint 12's compiler already writes crop keyframes this way ([Sprint 12 research 09](../../sprint-12/research/09-ffmpeg-render-cookbook.md) section 5, verified exact to half a pixel at 600 keyframes). Follow The Speaker only adds more keyframes to the same code path; it adds no second method. A `linear` key is a ramp interval, a `hold` key is a constant interval, and the last line is a constant at the last keyframe.
- **Never a flat chain.** A flat sum or a nested `if` chain in the `crop` expression fails to start at about 95 terms (`Invalid argument`). The documented fallback, only if `sendcmd` ever misbehaves on a new FFmpeg build, is a balanced `if(lt(t,tm),<left>,<right>)` binary search over the keys with a ramp or step term per key; 480 keyframes were verified on FFmpeg 9.0.2 (research 09 section 9, 21.8 KB of expression). The doctor's version check and the compiler tests (below) are what would notice such a change.
- **Key times stay in source time.** The crop sits after `trim` and before `setpts`, so `t` is the source time and the keys are written as they are in the document; no per-segment conversion is needed, and a clip made of many segments (cuts, a hook, a montage) gets a correct command file per segment run.
- Fractional `x` is truncated to whole pixels: a pan moves in one pixel steps, invisible at 1080 px.
- A test renders a ramp source through a 480 key command file and compares the crop position per frame with the path (within a pixel or two), and a test with a flat 98 key chain documents the failure the compiler never emits.
- Checks use stills: `ffmpeg -ss <t> -frames:v 1` on the export, compared with `frameState`'s crop at the same time. **Preview Export** shows the whole followed clip exactly.

### 4. The Layouts Tab

Per blueprint section 6:

- **Follow The Speaker** (`Toggle` row, shown for vertical and square clips). Turning it on: faces are requested if missing ("Finding faces"), then people, spans and the path are computed in the browser (tens of milliseconds), and applied. The Video pane shows the moving frame as an outline that plays with the clip; crop boxes are not draggable while it is on.
- **Show Both** (`Toggle`, when two people were found): switches to `followBoth`.
- Many faces: a row of small face thumbnails cut from the light copy in the browser (drawn from the video element into a canvas; nothing is uploaded), with "There are many faces here. Pick who to follow."
- None found: "We could not find anyone to follow in this clip." and the switch returns to off.
- The timeline gains `SpeakerStrip` (a new piece, on `/dev/components` first) under the Video row: a coloured stretch per subject and hatched stretches for `lost`. Selecting a hatched stretch shows, in the panel, "We lost the speaker for 3 seconds here." and **Fix By Hand**: a crop box appears in the Video pane for that stretch only; placing it writes an override. A fixed stretch is drawn with a small hand mark and can be cleared.
- Turning the switch off: `disableFollow`, and a toast, "Your own layout is back."
- Clip Setup's **Follow The Speaker** switch (Module 05) is live: clips made with it get faces and a path during the run, for the top clips only (the rest compute on first open).

### 5. Tests

- Engine: sections 1 and 2; enable and disable round-trip exactly; a trim does not change keyframes.
- Web: the switch (on, off restores, undo), Show Both, the many-faces picker, the none-found line, the strip, Fix By Hand writes and clears an override.
- Compiler: the `sendcmd` crop command file (a path with 480 keys compiles and renders; key times stay in source time on a two-segment clip with a speed change; a `hold` key is a jump, a `linear` key a pan), checked by stills (`ffmpeg -ss ... -frames:v 1`) early and late in a followed clip against `frameState`.
- On the `two-speakers` sample the frame switches at the sample's known turn times, within half a second.

## Scope

**In**: speaker choice, the camera path, Show Both, overrides, enable and disable in the document, the Layouts controls, the speaker strip, Fix By Hand, the setup switch.
**Out**: a dedicated active-speaker model, following objects or a ball, zooming with emotion, horizontal reframing of vertical video (Module 17).

## Tasks

- [x] `reframe/speaker.ts`, `reframe/path.ts`, `reframe/tuning.ts`, with tests.
- [x] `enableFollow`, `disableFollow`, overrides in the document (`reframe/follow.ts`; `follow.saved` and `follow.personId` added to the reserved shape).
- [x] The Layouts controls: the switch, Show Both, the picker, the none-found line.
- [x] `SpeakerStrip`, Fix By Hand.
- [x] The setup switch end to end (clips marked `followOnOpen`, faces asked for the top three during the run, the path worked out in the editor on first open: see the Decision Log).
- [x] The `sendcmd` crop command file in `compileFfmpeg` with its 480-key test; stills for a moving crop; the `two-speakers` timing check; title-case test green.
- [x] Playwright once under simulation on the `two-speakers` sample: Clip Setup with the switch, follow on first open, the strip, a lost stretch fixed by hand, Show Both, off and Undo, Preview Export, a 720p export with stills. Screenshots `screenshots/s13-m08-*`. Trimming was checked by the engine tests (keyframes in source time), not by dragging in the browser.
- [x] `verify-change`; update the Progress table and the Decision Log.
- [ ] A real podcast or stream (the real-test plan): needs a real face model (Module 07's real check) and Arvind's video. The thresholds in `reframe/tuning.ts` are tuned once from his marks.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js reframe layout render
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels apps/web/src/components/clips/timeline
```

## Done When

- On the `two-speakers` sample, Follow The Speaker keeps the active marker in the tall frame and cuts to the other at each turn.
- The frame does not jitter on a still subject and never pans faster than the cap.
- A stretch with no subject holds the frame, is hatched on the strip, and can be fixed by hand.
- Show Both stacks the two.
- Turning it off restores the earlier boxes exactly; one undo also does.
- Trimming the clip changes nothing about the path; the export matches the editor closely and Preview Export shows it exactly.

## Hand Check

With the three simulation flags on and the demo admin, in a Vertical clip from the `two-speakers` sample:

1. Layouts, Follow The Speaker: "Finding faces", then the frame follows. Play through two turns: it cuts at each.
2. The strip under the Video row shows two colours. Find a hatched stretch (the sample has one): select it, Fix By Hand, place the box.
3. Show Both: two stacked frames.
4. Trim the start: the frame is still right.
5. Switch it off: "Your own layout is back." and the old boxes return.
6. Press Preview Export with it on, then export at 720p: the frame moves as the editor showed.

## Handoff

Module 10's recipes store the switch and its mode. The real-test plan tries it on a real podcast and a real stream, and its marks tune `reframe/tuning.ts` once. Module 17 holds a dedicated speaker model.
