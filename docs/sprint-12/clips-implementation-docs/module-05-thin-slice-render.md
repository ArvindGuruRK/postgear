# Module 05: Thin Slice: Render A Clip To Media

> **Sprint 12, Clips** | Status: Done with gaps (2026-11-18: no Playwright pass; the slice was run for real through the API instead) | Size: L (one full session, may need a second)
> **Depends on**: [Module 04](module-04-import-pipeline.md)
> **Stories**: foundations for CL-10.1 and CL-10.4, CL-5.1; the rule "the editor matches the export closely, and Preview Export shows it exactly"
> **Next**: [Module 06](module-06-clips-home-and-videos.md), [Module 07](module-07-manual-clipping-and-clips-library.md), [Module 08](module-08-editor-shell.md)

## Goal

**Demo 1.** On a bare test page, `/dev/clips`, a simulation link is imported, a 20 second clip is made from it, it plays in a plain `<video>`, and one button exports it with FFmpeg to an MP4 that appears in Media with a poster and its length. This proves the riskiest chain (sharp range, the render compiler, the render queue, the hand-over to Media) before any real screen is built, and it measures how fast the real host renders, which sets the plan limits (decision D12-04, decision D12-05).

There is no browser in the render, no composition package and no second drawing engine to keep in step: the document goes through a pure compiler to one FFmpeg command. The compiler is built here for the Fullscreen layout and speed, and every later module adds its own part of it.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names, the Decision Log).
- Sprint doc: What The Research Settled, The Clip Document, Providers (`Renderer`), Jobs And Queues (SEGMENT, RENDER), API Routes (clips, exports, the internal route).
- Research: [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), **all of it** (every recipe was run on FFmpeg 9.0.2; sections 1, 2, 9, 11, 12 and 13 are this module's spine); [`05-editor-and-render.md`](../research/05-editor-and-render.md), sections 4, 5, 8, 9 and 10 (the compiler, the executor, parity, FFmpeg roles, the two time bases); [`02-libraries.md`](../research/02-libraries.md) (the FFmpeg build and its licence); [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md), the per-platform export settings.
- Code: `packages/video-engine` (the document, `createClipDocument`, the canvases, the time map); `packages/media-tools` from Module 02 (`runTool`, `withScratch`, `probeFile`, the doctor and its render checks); `apps/api/src/modules/media/media.service.ts` (`saveGenerated`, `toView`); `apps/api/src/modules/discover/internal.controller.ts` and `apps/worker/src/automation/gateway-client.ts` (a worker calling an internal route); `apps/web/src/app/dev/` (the production guard); `packages/design-engine/fonts/` and `packages/design-engine/src/fonts/index.ts` (the Studio font files, for the manifest stub); `apps/web/AGENTS.md`.

## Design

### 1. The Compiler (`packages/video-engine/src/render/`, pure)

Strings in, strings out. No Node, no Prisma, no file reads: it runs in Jest, in the API and in the browser. Four pieces, named as in the cookbook:

| Piece | In this module | Added later |
|---|---|---|
| `frameState(doc, outputMs)` | The segment and source frame shown, and each area's frame and crop for the Fullscreen layout. Returns numbers only | Layouts (10), text and stickers (11, 12), zoom and looks (13), sounds (14) |
| `buildRenderPlan(doc, ctx)` | The document plus resolved inputs (`ctx`: for each source the path of the sharp range or proxy, its `sourceOffsetMs` and frame rate; the fonts folder; the quality) to a plain JSON `RenderPlan`: output size and rate, the segment list, the areas in output pixels. No paths except those in `ctx` | One section per later feature |
| `compileFfmpeg(plan, quality)` | `{ inputs, filterComplexScript, assFiles, outputArgs }`: the segment chains, `concat`, the Fullscreen area, the encode flags. Deterministic: the same plan gives the same text, so a render has a fingerprint | The rest of the graph (cookbook section 13) |
| `buildAss(plan)` | A stub that returns no files | Module 11 |

The rules this module puts in place (cookbook section 13, rule numbers in brackets):

- The graph is written to a file and passed as `-/filter_complex graph.txt`. FFmpeg 9.0.2 has no `-filter_complex_script` and no `-vsync` (use `-fps_mode`). All file names in the graph are relative to the job's scratch folder (1, 2).
- **Per segment**: `trim`, the crop, `setpts=(PTS-STARTPTS)/S`, `fps`, `setsar=1` on the picture; `atrim`, `asetpts`, the `atempo` chain, `aresample=48000` on the sound. Then `concat`, one more `fps` and `format=yuv420p`, and `apad=whole_dur` with `-t` on the output so the sound is as long as the picture (an unpadded mix was 16 ms short). `atempo` takes 0.5 to 100 only, so 0.25 is two `atempo=0.5` (3, 4).
- The crop sits before `setpts`, so Sprint 13's crop keyframes stay in source time (5). With one keyframe it is a plain constant `crop`.
- Fractions become pixels **once**, in the plan: positions rounded, sizes to the nearest even number (7). The compiler never converts twice.
- One `-i` per **run of contiguous segments**, opened with `-ss` at the run's start so FFmpeg does not decode from the start of a long file (`trim` decodes from the input's beginning); the compiler subtracts the seek point from every `trim` of that input. Whether input seeking lands on the exact frame is checked by a parity test in this module, not assumed.
- Encode: libx264 High, `yuv420p`, `-r FPS`, a closed GOP of two seconds (`-g`, `-keyint_min`, `-sc_threshold 0`), `-movflags +faststart`, AAC 128k at 48 kHz stereo; `veryfast`, CRF 21 and a `maxrate` for the quality (17).
- A missing input, font or sticker, or a plan limit exceeded, fails the compile with a typed error and a plain message instead of rendering something else (20).

Quality here is a small data record, `{ shortSide, fps, preset, crf, maxrate }`, with three entries (720p30, 1080p30, 1080p60) and a fourth for the Proof Preview shape (360 on the short side, `ultrafast`, CRF 28, 2 Mbps, 30 fps; Module 15 turns it on). Module 15 owns the public list. The plan stores every pixel number in the document's own 1080-wide canvas, and the compiler multiplies by the quality's scale once.

### 2. The Executor (`packages/media-tools`, `renderClip`)

Node only, worker only. `renderClip({ plan, quality, scratchDir, onProgress, signal })`:

- Writes `graph.txt` and any `.ass` files into the scratch folder, then runs `runTool('ffmpeg', args)` (Module 02) with `-hide_banner -nostdin -y -loglevel error -progress pipe:1 -nostats`, the working directory set to the scratch folder, and the output `render.mp4.part`.
- **Progress**: read `frame`, `out_time_us`, `speed` and `progress` from each block. `out_time_us` is not monotonic while picture and sound interleave (the percent series ran 96, 90, 93, 100), so keep the running maximum and clamp to 100. Do not read `out_time_ms`: it holds microseconds too. Percent is `out_time_us / (clipSeconds x 1e6)`. The "about N minutes left" figure is `(clipSeconds - outTime) / speed`, where `speed` is a string such as `1.28x` (cookbook section 11).
- **Cancel**: the abort signal kills the process (about 180 ms in the test; no child survives, FFmpeg is one process). A killed run leaves a file with **no `moov`** that `ffprobe` refuses, so the output is always written as `.part`, renamed to `render.mp4` only after `progress=end` and exit 0, and the scratch folder is deleted after a failure or a cancel.
- Keeps the last 8 KB of stderr for the log, never in a message. A non-zero exit becomes a typed `RenderError` (`render_failed`, with the cause in the log).
- The loudness pass and the mark come in Modules 14 and 15; the executor has the hook for a measuring run first (Module 14).

### 3. Clips And The Sharp Range

Unchanged from the first plan, because it never depended on the renderer:

- Minimal clip routes (Module 07 completes them): `POST /clips` `{ videoId, fromMs, toMs }` validates the range against the video and the engine's limits, writes a `Clip` with `createClipDocument` and starts a SEGMENT job; `GET /clips/:clipId` answers the clip, the video, the playing address and `sharp` (`ready`, `fetching` or `gone`).
- `clipSegmentWorkflow` (`postgear-media`): `downloader.fetchRange` for the clip's range widened by `HANDLE_MS` each side (clamped to the video), at the plan's best height; for uploads, an exact cut from the ORIGINAL. The result is already normalised (Module 03: constant frame rate, rotation applied, SDR, even size), stored as a SEGMENT asset with `meta { fromMs, toMs, height, fps }`. If the platform copy is gone: `ClipVideo.hdAvailable = false`, the job ends DONE with `output.gone = true`, and exports fall back to the proxy.
- `sharpSourceFor(clip)` picks the SEGMENT asset that covers every segment's range, or the proxy when there is none, and says which file and what `sourceOffsetMs` it starts at.

### 4. The Render Workflow (`clipRenderWorkflow`, `postgear-render`)

| Step | Stage and progress | What it does |
|---|---|---|
| `renderPrepare` | `fetching`, 0 to 10 | Read the frozen document from the job's input; wait for a running SEGMENT job if there is one; download the sharp source (or the proxy) to scratch; resolve every input with `sharpSourceFor`; check the fonts folder against the manifest (section 6); call `buildRenderPlan` |
| `renderClip` | `rendering`, 10 to 90 | `compileFfmpeg`, then the executor; progress maps FFmpeg's percent into 10 to 90 and heartbeats the activity; writes `render.mp4` |
| `renderFinish` | `finishing`, 90 to 100 | Take a poster (`-ss 1 -frames:v 1`, WebP); `putFile` both to the public media space under normal media keys; call `POST /internal/clips/exports/finish` |

No remux step exists: `-movflags +faststart` is part of the encode, so the index is already first.

- `POST /internal/clips/exports/finish` (worker only): `MediaService.saveRendered({ orgId, key, posterKey, facts, name })` creates the `Media` row (`type: 'video'`, `origin: 'clip'`, `durationMs`, `fps`, `width`, `height`, `thumbnail`), sets `Clip.lastExportedRevision` and `exportedMediaId`, and writes the `clip_export_ready` notification. A failed render writes `clip_export_failed` and stores nothing.
- `POST /clips/:clipId/exports` `{ quality }`: 409 `export_running` if a RENDER job for this clip is QUEUED or RUNNING; freezes `document` and `revision` into the job's input, with a boolean `proof` that is always false here (Module 15 adds Preview Export). Plan locks and the mark arrive in Module 15; here every quality is allowed.
- One render at a time per worker (`postgear-render`, concurrency 1): FFmpeg uses all the cores by itself.

### 5. The Test Page (`/dev/clips`)

Non-production only (the same guard as `/dev/components`). Three steps on one page, each a button with the job's progress under it: **Import Sample** (a `Select` of the simulation links), **Make A 20 Second Clip**, **Export**. Between them, a plain HTML5 `<video>` playing the proxy of the clip's range (the editor's `PreviewEngine` arrives in Module 08; nothing here depends on it). After the export, the exported file plays in a second `<video>` beside it, with five buttons (the start, a quarter, the middle, three quarters, the last second) that seek both to the same moment, for comparing by eye. Module 03's sample videos carry a burnt-in time counter; make sure it sits in the middle of the picture so a centred 9:16 crop keeps it, and change the sample generator if it does not.

### 6. The Font Manifest And The TTF Twin Stub

libass cannot read WOFF2, so the 52 Studio fonts need TTF or OTF twins (cookbook section 6). The full text pipeline is Module 11; this module only lays the ground:

- The manifest shape, in `packages/video-engine/src/render/fonts.ts`: one entry per family `{ family, file, unitsPerEm, winAscent, winDescent }`, the numbers Module 11 uses for `fs = cssPx x (winAscent + winDescent) / unitsPerEm`. `checkFonts(plan, manifest)` returns the families a plan needs that the manifest lacks; the compiler fails with `font_missing` before rendering.
- A stub for `npm run clips:fonts:build` that lists the Studio families and writes an empty manifest with the right shape. The conversion itself (WOFF2 to TTF, and reading the three metrics from each file) lands in Module 11.
- `renderPrepare` already calls `checkFonts`; with no text in the document the list is empty and it passes.

### 7. Benchmark, Stills And The First Parity Test

- `npm run clips:benchmark`: renders the same 20 second sample at **720p30, 1080p30, 1080p60 and the Proof Preview shape**, each once Fullscreen and once with a Blurred background (the worst base: a downscaled copy, `gblur`, scaled back up, then the picture overlaid with `format=yuv420` and `shortest=1`; the helper that writes it is the start of Module 10's layout graph), and prints for each: seconds of render per second of clip ("x realtime"), peak memory, and the CPU count. Paste the table into the README's Progress notes. Module 10, Module 15's plan limits and the production worker box size read it. Until it is run on the real host, plan with 1.5 to 3 times the clip length at 1080p30 (cookbook section 9; the busy test laptop measured 1.04x real time at 720p30, 0.69x at 1080p30, 0.42x at 1080p60, and 2.4x for the Proof Preview shape, so every figure there is pessimistic).
- `npm run clips:stills`: with `ffmpeg -ss` writes five stills of the proxy and five of the exported file into `screenshots/`, for a human look. Later modules add one still per feature.
- The first parity test, `render-parity.test.ts` (Jest, skipped with a message when `ffmpeg` is not on the PATH): build a one-segment document, generate a self-describing source with `lavfi` (a gradient whose red channel is x and green channel is y), compile and run it for two seconds, read frames back, and check the crop's centre against `frameState` within 1 pixel and the frame count against the plan. Every later feature adds a case to this file (cookbook section 12).

## Scope

**In**: the compiler for Fullscreen and speed (`frameState`, `buildRenderPlan`, `compileFfmpeg`, the `buildAss` stub), `renderClip`, minimal clip create and get, the SEGMENT job, the RENDER job and its internal finish route, `saveRendered`, `/dev/clips`, the font manifest shape and build stub, the benchmark, the stills script and the first parity test.
**Out**: the real pages (06, 07), the editor and its preview engine (08 onward), other layouts (10), text and stickers (11, 12), zoom, looks and fades (13), sound mixing and loudness (14), plan locks, the mark and Preview Export (15), platform checks (17).

## Tasks

- [x] `video-engine/src/render/`: `frameState`, `buildRenderPlan`, `compileFfmpeg`, the `buildAss` stub, the quality record, the typed compile errors, with tests (graph snapshot, the `atempo` chain, even sizes, determinism, missing input).
- [x] `fonts.ts`: the manifest shape, `checkFonts`, the `clips:fonts:build` stub.
- [x] `media-tools`: `renderClip` with `.part`, progress parsing as a running maximum, cancel, scratch cleanup, tests with a fake runner and one real run guarded by `ffmpeg` being present.
- [x] `POST /clips`, `GET /clips/:clipId`, `sharpSourceFor`.
- [x] `clipSegmentWorkflow` with the gone fallback.
- [x] `clipRenderWorkflow` and its three activities.
- [x] `POST /clips/:clipId/exports`, the internal finish route, `MediaService.saveRendered`, the export notifications.
- [x] `/dev/clips`.
- [x] `clips:benchmark`, `clips:stills`, the first parity test; the benchmark table in the Progress notes.
- [ ] Playwright once on `/dev/clips` under simulation; screenshots in `screenshots/`.
- [x] `verify-change`; update the Progress table and the Decision Log (record the input-seek result and the benchmark).

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js render
npx jest --config packages/media-tools/jest.config.js render
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips apps/api/src/modules/media
npx jest --config apps/worker/jest.config.js clips render
npm run clips:benchmark
```

## Done When

- `/dev/clips` goes from Import Sample to an exported MP4 without leaving the page, under simulation, with no network.
- The exported file is H.264 High with AAC at 48 kHz, the right size for its quality, starts playing at once (the index is first), has a constant frame rate, and is 20 seconds long to the frame.
- It is in the Media library with a poster and its length shown.
- At the five compared moments the proxy and the export show the same moment of the sample's counter.
- A second export while one runs answers 409 `export_running`; two exports from two clips run one after the other, never together.
- Cancelling an export stops FFmpeg within a few seconds and leaves no `.part` file and no scratch folder.
- With the platform copy marked gone, the export still succeeds from the proxy.
- The parity test passes, and the compiler's snapshot test shows the graph passed as `-/filter_complex` and no `-filter_complex_script` or `-vsync` anywhere.
- The benchmark table (four shapes, with and without Blurred) is in the README Progress notes, with the host it was run on.
- The repository holds no browser-based render code: no composition package, no Chrome or Chromium install step.

## Hand Check

With `CLIPS_SIMULATION=true`, at `/dev/clips`:

1. Import Sample (the Twitch one): progress, then ready.
2. Make A 20 Second Clip: the video plays; play, pause, scrub.
3. Export at 1080p: "Getting the sharp video", "Rendering" with a number, "Finishing", done.
4. Press the five compare buttons: the counter in the preview and in the exported video match each time.
5. Open Media: the clip is there with a picture and "0:20".
6. The bell says "Your clip is ready".
7. Start another export and press cancel (through the dev page's button): it stops and nothing is left in Media.
8. Run `npm run clips:benchmark` and note the 1080p30 number, the 1080p60 number and the Blurred number.

## Handoff

Module 07 completes the clip routes. Module 08 builds the browser `PreviewEngine` and a stage that draws from `frameState`. Modules 10 to 14 add their parts to the compiler, each with a parity case. Module 11 finishes the font manifest and `buildAss`. Module 15 adds plan locks, the mark, Preview Export, the out-of-date notice and the export dialog on top of the route built here. The benchmark numbers go to Arvind for the plan limits and the media worker box size.
