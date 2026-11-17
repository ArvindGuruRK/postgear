# Sprint 12 Research: Editor Preview And Server Render

> **Written**: 2026-11-17. This replaces the 2026-11-14 version, which described a Remotion design. The render engine is now **FFmpeg only** (decision brief D2, 2026-11-17). Every FFmpeg fact marked "verified 2026-11-17" was produced by running FFmpeg 9.0.2 (gyan.dev "full" build) on the development machine; the commands and numbers are in [`09-ffmpeg-render-cookbook.md`](09-ffmpeg-render-cookbook.md). Browser facts marked "verified 2026-11-17" were read that day from MDN pages or the MDN browser-compat data. Anything not run or read is marked "(reported)" or "(not verified)".
> **Version read**: FFmpeg 9.0.2 (2026-09-18 release; build dated 2026-09-19). Licences and the build choice are in `02-libraries.md`.

## 1. The Idea In One Paragraph

One JSON document describes a clip. Two programs draw it. The **browser preview** (`packages/video-preview`, web only) plays the small light copy in an HTML5 `<video>` and draws crop, zoom, looks, text and stickers with CSS and the DOM. The **export** (`packages/video-engine/src/render`, pure) compiles the same document into one FFmpeg command: a filter graph in a file, ASS subtitle files for text, an argument array. A small pure function, `frameState(doc, outputMs)`, is the one definition of what is on screen at a moment (crop, zoom, looks, each item's position, rotation and opacity, which sounds play). The preview reads it to draw; the compiler tests read it to know what a rendered frame must contain. The preview is a fast approximation of the export, not the export: a **Preview Export** button renders the same graph at 360 pixels wide and is the truth check.

## 2. The Preview In The Browser

### 2.1 What The Browser Gives Us

| Need | API | What the read says | Support (BCD, verified 2026-11-17) |
|---|---|---|---|
| Play the light copy, seek, speed | `HTMLVideoElement`, `currentTime`, `playbackRate`, `preservesPitch` | `preservesPitch` defaults to `true` (MDN, verified 2026-11-17). Audio is muted when the rate is outside a useful range: Gecko mutes outside 0.25 to 4.0, other engines differ (MDN `playbackRate`, verified 2026-11-17). Our speeds are 0.25, 0.5, 1, 1.5, 2 and 4, so they sit at the edge of that range. | Widely available (`playbackRate` since 2015, `preservesPitch` since 2023-12, per MDN) |
| A clock that follows the picture | `video.requestVideoFrameCallback(cb)` with `metadata.mediaTime`, `presentedFrames` | Fires when a new frame is sent to the compositor, at the lower of the video frame rate and the screen's paint rate. `mediaTime` is the frame's timestamp on the `currentTime` timeline. "No strict sync guarantee": the callback can fire one v-sync after the frame was presented (MDN, verified 2026-11-17). | Chrome 83, Edge 83, Firefox 132, Safari 15.4; MDN marks it Baseline 2024, "newly available" |
| Follow an animated sticker with the playhead | `ImageDecoder` (WebCodecs): `new ImageDecoder({ data, type })`, `decode({ frameIndex })`, `tracks.selectedTrack.frameCount`, each result a `VideoFrame` with a `duration` in microseconds | Secure contexts only; also in dedicated workers; MDN marks it "Limited availability" and lists no supported types, so `ImageDecoder.isTypeSupported('image/apng')` is checked at run time (MDN, verified 2026-11-17) | Chrome 94, Edge 94, Firefox 133, Safari 27.3 |
| Draw an APNG with no code | `<img src="x.apng">` | APNG plays natively in every current browser (reported; not looked up today). The animation clock starts when the image loads, so restarting it at the item's start means setting `src` again (or creating a new element). | Reported |
| Looks | CSS `filter`: `brightness()`, `contrast()`, `saturate()`, `hue-rotate()`, `sepia()`, `grayscale()`, `blur()` | MDN lists exactly these functions and their units (verified 2026-11-17). They are close to, not the same as, the FFmpeg filters. | Baseline widely available since 2016-09 |
| Sounds at a time | Web Audio: `AudioContext`, `AudioBufferSourceNode.start(when)`, `GainNode` with `setValueAtTime` and `linearRampToValueAtTime` | Standard; scheduled by the audio clock, which is steadier than a timer (reported; not read today). A context starts suspended until a user gesture. | Widely available (reported) |

### 2.2 `PreviewEngine`

`packages/video-preview` exports one class and a React hook. It has no knowledge of FFmpeg.

- **One clock.** The playhead is the output time of the clip. While playing, the clock comes from the `<video>` through `requestVideoFrameCallback`: the engine maps `metadata.mediaTime` (source time of the proxy) back to output time through the time map (section 10). A small external store holds it, and the timeline subscribes to the store, never to React state (the rule `03-open-source-reference-repos.md` takes from the Remotion docs and Kimu).
- **Segment hand-over.** The document is a list of segments, each with a source range and a speed. The engine keeps two `<video>` elements on the same signed URL. While segment *n* plays on the front element, the back element seeks to segment *n+1*'s start and waits for `seeked`. At the join (output time reached, from the frame callback) the elements swap, the new front starts at its `playbackRate`, and the old one pauses. Segments that are contiguous in the source (a split with nothing removed) are not swapped: the same element keeps playing. If the next segment is not ready at the join, the engine holds the last frame and reports "buffering" instead of drifting.
- **Speed.** `playbackRate` is set to the segment's speed and `preservesPitch` stays `true`. Outside Gecko's 0.25 to 4 audible range the sound may be muted by the browser; the export does not mute it, so this is a known preview difference (section 3).
- **Picture.** Crop and zoom are CSS: the `<video>` sits in a box the size of the layout area with `overflow: hidden`, sized and translated from `frameState` (the same fractions the compiler turns into pixels). The zoom is one `transform: scale()` about a `transform-origin` at the focus point on a wrapper around all areas, which is the same mapping the export uses (`09-ffmpeg-render-cookbook.md`, section 4). The Blurred layout draws a second, blurred, scaled copy of the same `<video>` behind it with CSS `filter: blur()` on a small element (the editor is desktop only, so one blur is cheap).
- **Looks.** Mapped to CSS `filter` strings in one table (`lookToCss`). The mapping is approximate: the export's `eq`, `hue`, `colorchannelmixer` and `vignette` are different formulas (section 3).
- **Text and stickers.** DOM and canvas layers above the video, positioned from `frameState`: centre point in canvas fractions, size, rotation (CSS `rotate()` is clockwise-positive, like FFmpeg's `rotate`), opacity. A text item is a DOM node using the same font family as the export (the web app has the 52 Studio fonts as WOFF2; the worker has TTF twins, `02-libraries.md`, section 2.3). The selection handles are our own pointer code on top (`react-moveable` is the optional spike, `02-libraries.md`).
- **Animated stickers.** Play once or loop, from the item's start. Preferred: `ImageDecoder` on the APNG, drawing frame *k* where `k = floor((outputMs - itemStartMs) / frameMs)` (modulo the frame count when looping) onto a `<canvas>`, so the sticker follows scrubbing exactly like the export does. Fallback where `ImageDecoder` or the APNG type is missing: an `<img>` that is re-created when the playhead enters the item; scrubbing inside the item then shows the animation from its start, which is a documented preview difference.
- **Sounds.** The video's own sound plays through the `<video>` element (its `volume` follows the segment's volume, and `muted` follows a muted segment). Sound effects and music play through Web Audio: each sound is decoded once into an `AudioBuffer`, started with `start(contextTime, offsetSeconds)` when the playhead enters it (and re-started on every seek), with a `GainNode` whose ramps follow the item's volume and fades. Because the `<video>` and the Web Audio graph are separate clocks, they can drift by tens of milliseconds over a long preview; the engine re-aligns the sounds at every seek and every segment hand-over.
- **Remote video needs CORS and Range.** The proxy comes from the private bucket through a signed URL. The bucket needs a CORS rule for the web origin (`GET` and `HEAD`, `Range` allowed; `Content-Range`, `Accept-Ranges`, `Content-Length` and `ETag` exposed; the header list is our own reading, reported, and Module 02 proves it in the browser). The URL must outlive the session or be refreshed by swapping `src` at a segment boundary. A `blob:` URL has no Range support, so a file the user just picked is uploaded and proxied before it is opened in the editor. Stickers and sounds are served from the same signed space, with CORS, because Web Audio and `ImageDecoder` need readable bytes.
- **Browsers.** Chrome, Edge and Firefox are the target (decision D12-12). `ImageDecoder` needs Firefox 133 or newer; `requestVideoFrameCallback` needs Firefox 132 or newer. Safari is best effort and untested: `ImageDecoder` arrived in Safari 27.3 only, and the `<img>` fallback covers the gap.

## 3. What The Preview Cannot Match Exactly

| Thing | Preview | Export | How we manage the gap |
|---|---|---|---|
| Source frame shown | The light copy at its own frame boundaries; the browser picks the frame whose time is current | The sharp copy through `trim`, `setpts` and the `fps` filter; the frame shown can differ by one source frame (verified 2026-11-17: at most 0.033 s of source time) | Accepted; Preview Export shows the exact result |
| Sharpness | 720p proxy, soft at 3x zoom | Sharp range | Said in the export panel |
| Text line breaks | The browser wraps by CSS rules | libass wraps by its own smart wrap (`WrapStyle: 0` balances the lines; verified 2026-11-17) | Same box width, same font, same size; a long caption may break at a different word. Preview Export shows it. The sprint's mitigation is for the compiler and the preview to share one line-breaking pass later (not verified). |
| Font size | CSS pixels (em size) | ASS size, where the size is the line height: `fs = em px x (winAscent + winDescent) / unitsPerEm`. Arial at `\fs100` measured 64 px cap height, Segoe UI 53 px (verified 2026-11-17) | The compiler converts with a per-font table; the preview uses CSS pixels |
| Text outline | `-webkit-text-stroke` is centred on the glyph edge | ASS outline grows outward by its width | Preview draws stroke width 2 x outline with `paint-order: stroke fill` |
| Colour emoji | Colour | Plain outlines: libass does not draw colour glyphs (verified 2026-11-17) | Emoji are placed as images in both (Noto PNG), not as text |
| Looks | CSS filter formulas | FFmpeg filter formulas | Approximate on purpose; the Looks panel states "the export may look slightly different" and Preview Export is one press away |
| Sound at 0.25x and 4x | May be muted by the browser (Gecko mutes outside 0.25 to 4) | Plays, via `atempo` | Known; the speed panel says very slow or fast sound may sound rough |
| Pitch and sound quality at speed | Browser time-stretch | `atempo` (WSOLA); a transient moved by up to about 60 ms at 0.5x in the test (verified 2026-11-17) | Not visible; said in the panel |
| Sound timing against picture | Two clocks (`<video>` and Web Audio), tens of milliseconds of drift | One mix, exact | Re-aligned at seek and hand-over |
| Animated sticker while scrubbing | Exact with `ImageDecoder`, restarts with `<img>` | Exact | `ImageDecoder` first; `<img>` fallback documented |
| Rotation, position, opacity, crop, zoom | Same numbers from `frameState` | Same numbers in filter expressions | Verified within 1 pixel on 540 and 1080 pixel canvases (cookbook, sections 2 to 5); the parity tests keep it so |
| Rounded camera box | CSS `border-radius` | Alpha mask from `geq` | Same radius in canvas pixels |

## 4. The Render Plan And The Compiler

All of this is pure TypeScript in `packages/video-engine/src/render/` (strings in, strings out), so it runs in Jest, in the API and in the browser if ever needed.

| Piece | What it does |
|---|---|
| `frameState(doc, outputMs)` | The single definition of what is on screen. Returns per area `{ frameRect, cropRect, fit }`, the zoom `{ scale, focus }`, the looks, each overlay item `{ id, centre, size, rotationDeg, opacity, textOrImage, localTimeMs }`, and the sounds that play with their gain. Pure; used by the preview and by the parity tests. |
| `buildRenderPlan(doc, ctx)` | Takes the frozen document plus resolved inputs (`ctx`: the path of the sharp range or proxy and its `sourceOffsetMs`, sticker and sound files with their facts, the fonts folder, the plan's quality) and returns a plain JSON `RenderPlan`: output size and frame rate, the segment list in order, crop and zoom pieces in output time, overlay items with their windows, audio items, the watermark if the plan has one. No file paths except those in `ctx`. |
| `compileFfmpeg(plan, quality)` | Returns `{ inputs, filterComplexScript, assFiles, outputArgs }`. `inputs` is the list of `-i` entries with their flags (`-loop 1`, `-stream_loop -1`). `filterComplexScript` is the text of the graph, written to a file and passed as `-/filter_complex <file>` (the older `-filter_complex_script` option does not exist in FFmpeg 9.0.2; verified 2026-11-17). `assFiles` are the `.ass` texts. `outputArgs` are the encode flags. Deterministic: the same plan gives the same text, so a render has a fingerprint. |
| `buildAss(plan)` | Writes one `.ass` file per render for all text items (and, in Sprint 13, captions): `PlayResX` and `PlayResY` equal to the output canvas, one style per distinct look, one `Dialogue` per item with `\an`, `\pos`, `\frz`, `\fad`, `\t`. Section 6. |

The graph, in the order the compiler writes it (every recipe is in the cookbook with its evidence):

1. **Picture per segment**: `trim` (source range, in the sharp file's own time), the crop (a constant `crop`, or `sendcmd` plus `crop` for keyframes), then `setpts` for speed, then `fps`. Crop sits before `setpts` so keyframes are in source time (cookbook, sections 1 and 3).
2. **Sound per segment**: `atrim`, `asetpts`, an `atempo` chain (`atempo` accepts 0.5 to 100 only, so 0.25 is two `atempo=0.5` in a row), `aresample=48000`.
3. **`concat`** of all segments (`v=1:a=1`), then one more `fps` and `format=yuv420p`.
4. **Layout**: the areas are cropped, scaled and overlaid on a base (a solid colour, or a blurred downscaled copy), all with `overlay=...:format=yuv420`. Rounded boxes use an alpha mask made by `geq` on one frame and looped.
5. **Zoom**: one `perspective` filter per zoom, active only inside its time window (`enable='between(t,a,b)'`), after the layout so it zooms all areas as one picture.
6. **Looks and fades**: `eq`, `hue`, `colorchannelmixer`, `colortemperature`, `vignette`, `fade`.
7. **Stickers**: each is a looped or played-once input, `scale`, `rotate` (with transparent corners), `colorchannelmixer=aa=` for opacity, then `overlay` at its centre point inside its time window.
8. **Text**: one `ass=<file>:fontsdir=<folder>` filter, last in the picture chain so text sits on top of everything.
9. **Sound mix**: `adelay` per sound, `volume`, `afade`, then `amix=normalize=0:duration=first` against a silent base of the clip's exact length, then (when the plan says so) `loudnorm` with the numbers from the measuring pass.
10. **Encode**: `libx264` High, `yuv420p`, constant frame rate, a closed GOP of 2 seconds, `-movflags +faststart`, AAC 48 kHz (cookbook, section 9).

**The two clocks and the compiler.** Section 10 keeps the time map. The compiler converts picture items (crop and zoom keyframes, in source time) to the right place in the chain (before `setpts`) and overlay items (in output time) to `enable` windows after `concat`. A zoom that spans several segments is merged into output-time intervals first, with its ease measured in output milliseconds, so a zoom over a 4x part does not snap.

## 5. The Executor

`packages/media-tools` (Node only) runs a compiled plan. The API never does.

- **Safe process runner.** `runTool(file, args, options)` uses `spawn` with an argument array, no shell, a working directory (the job's scratch folder), a time limit, and an output cap on stderr (keep the last few kilobytes). The graph and the `.ass` files are written into the scratch folder first and referred to by **relative** names, so there is no path escaping to get wrong: `-/filter_complex graph.txt`, `ass=captions.ass:fontsdir=fonts` (verified 2026-11-17; on Windows an absolute `C:` path inside a filter needs its colon escaped, which relative names avoid).
- **Progress.** `-progress pipe:1 -nostats` prints `key=value` lines and a block ends with `progress=continue` or `progress=end`. The fields to read are `frame`, `fps`, `out_time_us`, `speed` and `progress`. Percent is `out_time_us / (clipSeconds x 1e6)`. In the test the blocks arrived about twice a second (cookbook, section 11). The activity heartbeats and writes `ClipJob.progress` and the "about N minutes left" estimate (remaining seconds divided by `speed`).
- **Cancel.** `child.kill()` ends the process at once; no child process survives (FFmpeg is one process). The output is always written to `name.part.mp4` and renamed to the final key only after `progress=end` and a zero exit; a cancelled or failed run leaves a file with no `moov` box that `ffprobe` refuses (verified 2026-11-17), which the activity deletes with the scratch folder.
- **Two passes for loudness.** Pass 1 mixes the audio only (no video) through the same sound graph with `loudnorm=print_format=json` and parses the JSON from stderr; pass 2 is the main run with the measured numbers and `linear=true`. Pass 1 costs seconds. The measured result in the test was -13.8 LUFS against a -14 target (cookbook, section 8).
- **One render at a time per worker** (`postgear-render`, concurrency 1). FFmpeg uses all cores by itself.
- **Poster frame.** A second tiny FFmpeg call on the finished file: `-ss <t> -frames:v 1`.
- **No browser.** The worker never starts Chrome. This removes the old image needs (section 11).

## 6. Text And Captions Through ASS

One text pipeline for titles (Sprint 12) and captions (Sprint 13). ASS is a text format libass draws; FFmpeg's `ass` filter burns it into the picture. What was verified on 2026-11-17 (details and numbers in the cookbook, section 6):

- **Font, size, outline, shadow, colour, alpha, box, position, rotation, fade, animation** all work: `\pos`, `\an5`, `\frz`, `\fad(in,out)`, `\t(t1,t2,\fscx200\fscy200)`, `\alpha&H80&`, `\1c`, `\3c`, `\bord`, `\shad`. `BorderStyle 3` draws an opaque box whose colour is the **outline** colour. `\frz` is counter-clockwise for positive numbers, so a clockwise CSS rotation of 30 degrees is `\frz-30`.
- **Scaling.** Set `PlayResX` and `PlayResY` to the canvas (1080 x 1920) and `ScaledBorderAndShadow: yes`; every number is then in canvas pixels. A 720p render uses the same file, scaled by libass.
- **Wrapping.** Each `Dialogue` can carry its own `MarginL` and `MarginR`, and libass wraps inside them even when `\pos` is used: the text box width is `canvas width - MarginL - MarginR`. `WrapStyle: 0` (smart) balances the lines. `\q2` turns wrapping off.
- **Shaping.** libass with HarfBuzz is in the build. Hindi (`हिन्दी`, `क्षत्रिय`) and Tamil (`தமிழ்`) came out joined and reordered correctly with Nirmala UI; with `shaping=simple` the Hindi conjuncts break. Complex shaping is the default; the compiler never sets `shaping=simple`.
- **Emoji.** Segoe UI Emoji drew as plain monochrome outlines. Colour emoji are placed as image overlays by the compiler instead.
- **Fonts.** `fontsdir=<folder>` of TTF and OTF files. WOFF2 is refused. One font file loaded by family name; a missing family falls back silently to another font, so the compiler checks every family it writes against the fonts folder before it renders and fails the job with a clear message.
- **Cost.** libass draws every frame; the cost grows with the number of glyphs that have an outline or a shadow. A caption with a large outline and shadow was the single slowest item in the test (cookbook, section 6). Captions in Sprint 13 should use a modest outline.

## 7. Proof Preview

A **Preview Export** button (Module 15) renders the whole clip through the same compiler at 360 pixels wide with `-preset ultrafast`, on the render queue at lower priority, and plays the result in the editor. It is the truth check for everything in section 3. The measured speed is in the cookbook, section 10. The export panel says: "The editor is a fast preview. Preview Export shows the real result." The preview file is deleted after 24 hours.

## 8. Parity And Tests

Three layers, cheapest first:

1. **`frameState` numeric tests** (pure): crop and zoom at known times, easing values, item position and rotation, the time map (the worked example in section 10 is a test), audio gains.
2. **Compiler tests** (pure): the compiled graph text for a fixed plan equals a stored snapshot; escaping; the `atempo` chain; the keyframe limit (no expression longer than the verified ceiling is ever written: keyframes always go through `sendcmd`).
3. **Render parity tests** (need `ffmpeg` on the PATH, skipped with a message otherwise): render one short clip from a **generated** source whose pixels encode position (a gradient, a frame-number bit pattern, bright discs), then compare with what `frameState` predicts at known times: crop position within 1 pixel, zoom mapping within 1 pixel, sticker centre and rotation within 1.5 pixels, text bounding box within a few pixels, frame times within one source frame, audio level windows within 1 dB. The cookbook shows the harnesses that were used (and their measured errors). A still-frame script (`clips:stills`) writes the same frames as PNG for a human look.

The sprint's wording changes accordingly: the editor "matches the export closely", and Preview Export "shows it exactly".

## 9. FFmpeg Roles

Options below were run or read on 2026-11-17 unless marked "(reported)".

| Role | Flag families | Notes |
|---|---|---|
| Probe | `ffprobe -v error -print_format json -show_format -show_streams` | Runs before anything touches an upload. Reject what is not video, too long, or too large. |
| Every run | `-hide_banner -nostdin -y -progress pipe:1 -nostats`, `-protocol_whitelist` | Progress as key=value lines. Protocol allowlist: `file` only for uploads; `file,http,https,tcp,tls,crypto` for a playlist fetch. **FFmpeg 9.0.2 removed `-vsync` and `-filter_complex_script`** (both gave "Unrecognized option"); use `-fps_mode` and `-/filter_complex <file>`. |
| Remux | `-c copy -movflags +faststart` | Changes the container, not the streams. Fast, lossless. `+faststart` moves the index to the front so range requests can start playing at once. |
| Stream-copy cut | `-ss <start> -i <in> -t <length> -c copy -avoid_negative_ts make_zero` | **Snaps to a keyframe**: the copy begins on one, so the cut starts early. Used only for the padded fetch (the HD range with handles), never for the final cut. (reported) |
| Exact cut | `-ss <start> -i <in> -t <length> -c:v libx264 -preset veryfast -crf 18 -c:a aac -fps_mode cfr -r <fps>` | Re-encodes, so the first frame is exactly `<start>` (reported). Makes the HD file whose first frame is `sourceOffsetSec`. The render then trims inside that file. |
| Proxy | `-vf scale=-2:720,fps=<fps>` + `-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -g <fps> -keyint_min <fps> -sc_threshold 0` + `-c:a aac -b:a 128k -ar 48000 -ac 2` + `-movflags +faststart` | H.264 and AAC in MP4 at a constant frame rate, which every browser plays. A keyframe every second keeps scrubbing fast. |
| Analysis audio | `-vn -ac 1 -ar 16000 -c:a pcm_s16le` | A small mono WAV for the signal tracks now and for transcription in Sprint 13. |
| Filmstrip sprite | `-vf fps=1/<n>,scale=160:-2,tile=<cols>x<rows> -frames:v 1 -q:v 5` | One JPEG grid per stretch of source. `-skip_frame nokey` before `-i` makes long sources much faster at the cost of exact spacing. (reported) |
| Waveform peaks | `-vn -ac 1 -ar 8000 -f s16le pipe:1` | Raw samples piped to Node, which keeps min and max per bucket. No extra program. |
| Loudness | Pass 1: `loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json` to `-f null -`. Pass 2: the same filter plus `measured_I`, `measured_TP`, `measured_LRA`, `measured_thresh`, `offset`, `linear=true` | Verified: -32.6 LUFS input came out at -13.8 LUFS with a true peak of -7.0 dBTP. The JSON is printed on stderr at normal log level. |
| Sticker ingest | `-i in.{gif,webp,apng} -vf "fps=<rate>,format=rgba" -plays 0 -f apng out.apng` | GIF, animated WebP and APNG all decode (`gif`, `webp_anim` and `apng` decoders); alpha and timing survive (cookbook, section 5). |
| Render | the compiled plan | Section 4. |

## 10. The Project File And Its Two Timebases

A clip is cut from a long source. Two clocks are in play:

- **Source time**: seconds from the start of the original video. It never changes, whatever the user edits.
- **Output time**: seconds from the start of the finished clip. It changes with every trim, cut and speed change.

The document stores the timeline as an ordered list of **segments**: `{ sourceRef, sourceIn, sourceOut, speed }`. From that list a pure **time map** is computed:

- a segment lasts `(sourceOut - sourceIn) / speed` in the output;
- its output start is the sum of the lengths before it;
- output to source: `sourceIn + (t - outStart) * speed`;
- source to output: `outStart + (s - sourceIn) / speed` when `s` is inside a kept segment, otherwise "not in the clip".

Things that belong to the **picture** are stored in source time: crop rectangles, zoom keyframes, and in Sprint 13 caption words and face tracks. Things the user **lays on top** are stored in output time: stickers, text, sound effects, music.

**Worked example** (30 fps). A clip is made from 10:00 to 11:00 of a stream: one segment, `sourceIn 600`, `sourceOut 660`, `speed 1`. Output length 60 s. A facecam crop is set (source time, one keyframe). A sticker shows from output 5 s to 8 s. A spoken word sits at source 640.0 to 640.4 (a Sprint 13 caption, used here to show why the design holds).

| Edit | Segments after it | Output length | Where the word at source 640.0 lands | The sticker |
|---|---|---|---|---|
| Start | A `[600, 660] x1` | 60 s | output 40.0 | 5 to 8 s |
| **Split** at output 20 s | A `[600, 620] x1`, B `[620, 660] x1` | 60 s | output 40.0 (nothing moved) | 5 to 8 s |
| Split again at output 30 s, then **delete the middle** | A `[600, 620] x1`, C `[630, 660] x1` | 50 s | output 20 + (640 - 630) = 30.0 | 5 to 8 s |
| Set C to **2x** | A `[600, 620] x1`, C `[630, 660] x2` | 20 + 15 = 35 s | output 20 + (640 - 630) / 2 = 25.0, lasting 0.2 s | 5 to 8 s |

What the table shows. A split changes the list and nothing else. Deleting the middle shortens the output, and the word moves by itself because its position is looked up through the map; a word inside the deleted part maps to "not in the clip" and simply is not drawn. Speed scales output lengths only. The crop never needed touching: it is tied to the picture. The sticker never moved: it is tied to the clip's clock. (The sprint document's `anchor` rule decides which overlay items follow a moment of the video through a cut; the table shows an item that stays on the clip's clock.)

**How it reaches FFmpeg.** Each segment becomes one chain `[0:v]trim=start=<in>:end=<out>,<crop>,setpts=(PTS-STARTPTS)/<speed>,fps=<fps>,setsar=1[vN]` with the matching sound chain, and the chains are joined by `concat` (section 4; verified in the cookbook, section 1: a clip of five segments at 0.25x, 0.5x, 1x, 2x and 4x came out at exactly 420 frames and 14.000 s, every frame within one source frame of the plan). The `in` and `out` values are in the time of the **file** FFmpeg reads: `sourceIn - sourceOffsetSec`, where `sourceOffsetSec` is the source time at which the pre-cut HD file starts (598 if the cut kept a 2 second handle, so segment C's `trim` start is `630 - 598 = 32`). In the browser the proxy starts at the start of the source, so the offset is 0.

**Rules that keep it honest.**

1. The engine works in whole milliseconds. Seconds are written into the graph with at most five decimals; frames are decided by FFmpeg's `fps` filter, so no frame arithmetic is needed in our code, and no gap or overlap can appear at a join (the concat of exact `trim` ranges is gap-free: the frame count matched the plan in every test).
2. Proxy and HD file must show the same picture at the same source time. Both are constant frame rate at the same rate, and the HD cut is re-encoded so it starts exactly where it says it does (section 9).
3. Trimming a segment outward past the fetched HD handles means fetching HD again. The editor may trim freely against the proxy; the export checks coverage first.
4. `speed` is one positive number per segment: 0.25, 0.5, 1, 1.5, 2 or 4. No reverse in Sprint 12. A smooth speed ramp is now feasible (a chain of short constant segments, or an expression), but stays P2.
5. A segment shorter than one output frame is refused by the engine (the shortest segment is 200 ms in Module 09).

## 11. The Worker Image Needs

| Need | Why |
|---|---|
| Debian slim (`node:22-bookworm-slim`) | The worker is Node. FFmpeg itself has no glibc floor beyond its build's (the BtbN Linux builds need 2.28 or newer, `02-libraries.md`). Alpine would work for FFmpeg, but yt-dlp's Linux standalone is glibc, so Debian stays. |
| FFmpeg 9.0.2 GPL static build and ffprobe | One program does the cut, the render, the proxy and the analysis. The doctor checks `-buildconf` for libass, libharfbuzz, libx264, fontconfig. |
| Fonts folder | The 52 Studio fonts as TTF or OTF (WOFF2 cannot be read by libass), Noto Sans Tamil, Noto Sans Devanagari, and an emoji font only as an outline fallback. |
| yt-dlp executable and Deno | Link import (`04-link-import-and-fetch.md`). |
| **No Chrome, no browser libraries, no `/dev/shm` sizing** | The render is not a browser. The long Chromium package list and the `--shm-size` question from the old design are gone. |
| CPU and scratch disk | 4 vCPU not shared with the API; 100 GB of scratch, cleaned per job (`07-legal-limits-cost-and-risks.md`, section 9). Memory need is small: FFmpeg held about 0.7 GB in the test, plus the source. |

## 12. Risks

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| Preview and export differ (a frame off, a different crop, text wraps differently) | Medium | The clip is not what the user saw | `frameState` as the single set of numbers; parity tests that render real frames; Preview Export; the softened promise ("matches closely") |
| A different FFmpeg build or version in the image behaves differently (option names, filters) | Medium | A broken render | Pin 9.0.2; the doctor runs a smoke render; the compiler tests render real frames in CI |
| The filter graph is slower than expected on the host | Medium | Long queues, small plan limits | Measured numbers (cookbook, section 9) show overlay `format=auto` doubles the time and `format=yuv420` fixes it; Module 05 benchmarks the real host; 720p default on Free; Preview Export at 360 wide |
| libass text is slow with large outlines and shadows, and slows with many items | Medium | Slow renders on caption-heavy clips | Modest outline in caption styles; measure in Module 05; text window limited to when text is present (not verified) |
| A font is missing or not TrueType | Medium | Wrong glyphs or a silent fallback | Convert WOFF2 to TTF at image build; the compiler checks every family against the folder and fails loudly |
| Colour emoji | Certain if used as text | Plain outlines in the export | Emoji are placed as images |
| Crop keyframes through a long expression | Certain beyond about 80 keyframes | The graph fails to parse (verified) | Always use `sendcmd` for animated crops; an expression only for a constant |
| Rounding drift between seconds and frames | Low | One-frame flashes at cuts | Whole milliseconds in the engine, `fps` does the frame decision, unit tests over odd speeds, the verified frame-count identity |
| Web Audio and `<video>` drift in the preview | Medium | Sound slightly off in the editor only | Re-align at seek and hand-over; the export has one mix |
| Browsers: `ImageDecoder` missing (Safari before 27.3), `requestVideoFrameCallback` missing (Firefox before 132) | Low in the target browsers | Sticker scrubbing degrades to restart-on-enter; a coarser clock | Fallbacks in `PreviewEngine`; Chrome, Edge and Firefox are the target |
| A cancelled render leaves a half file | Low | Junk in storage | Write to `.part`, rename on success, delete the scratch folder (verified: the partial file has no `moov` and `ffprobe` rejects it) |
| Speed changes sound wrong | Medium | Complaints about audio | `atempo` chains are exact in length but smear transients; offer mute per segment; ramps parked |
| GPL FFmpeg image pushed to a public registry | Low | A source-offer duty | Private registry only (`02-libraries.md`, section 3) |
