# Sprint 12 Research: The FFmpeg Render Cookbook

> **Written**: 2026-11-17. Every recipe below was run, not recalled. The machine: Windows 11, Intel Core i7-10850H (6 cores, 12 threads, `NUMBER_OF_PROCESSORS` is 12), 31.6 GB of memory, FFmpeg 9.0.2 (`ffmpeg version 9.0.2-full_build-www.gyan.dev`, gcc 16.2.0). Only synthetic sources were used (`lavfi` `testsrc2`, `color`, `sine`, `aevalsrc`, `nullsrc`); nothing was downloaded. During the speed runs other programs on the machine used roughly 25 to 60 percent of the CPU (measured with Windows performance counters), so **every speed below is pessimistic** and the real host is benchmarked in Module 05. The scripts that ran the tests are throwaway files in the session scratch folder and are not part of the repository; the recipes here carry everything needed to rebuild them.
> **Build check** (`ffmpeg -buildconf`, verified 2026-11-17): `--enable-gpl --enable-version3 --enable-libass --enable-libharfbuzz --enable-libfribidi --enable-libfreetype --enable-fontconfig --enable-libx264 --enable-libwebp --enable-libzimg --enable-libopus --enable-libmp3lame`. All of libass, libharfbuzz, libx264, fontconfig, libfreetype are present.
> **Things that changed since older FFmpeg versions** (each hit while testing): `-filter_complex_script` and `-vsync` are **gone** in 9.0.2 ("Unrecognized option"); the graph file form is `-/filter_complex <file>` and the frame-rate option is `-fps_mode`. `atempo` accepts only 0.5 to 100. `-filter_complex` cannot be combined with `-vf` on the same output.
> **How to read the recipes**: `UPPER_CASE` words are placeholders the compiler fills. All coordinates are in output-canvas pixels (the canvas is 1080 x 1920 unless a recipe says otherwise); the compiler converts fractions to pixels once, with the rules in section 12. Every graph is written to a file and every file is referred to by a relative name from the job's scratch folder.

## 1. Segments, Speed And Concat

**Recipe** (one chain pair per segment *i*; `SIN` and `SOUT` are seconds in the time of the file FFmpeg reads, `S` the speed):

```
[0:v]trim=start=SIN:end=SOUT,setpts=(PTS-STARTPTS)/S,fps=FPS,setsar=1[vI];
[0:a]atrim=start=SIN:end=SOUT,asetpts=PTS-STARTPTS,ATEMPO_CHAIN,aresample=48000[aI];
...
[v0][a0][v1][a1]...concat=n=N:v=1:a=1[vc][ac];
[vc]fps=FPS,format=yuv420p[v];
[ac]apad=whole_dur=DUR[a]
```

with `-map [v] -map [a] -t DUR` on the output. `ATEMPO_CHAIN` is empty for 1x, `atempo=S` for 0.5 to 100, and for 0.25 it is `atempo=0.5,atempo=0.5` (rule: while the remaining factor is below 0.5, emit `atempo=0.5` and divide). Speeds the document allows: 0.25, 0.5, 1, 1.5, 2, 4; only 0.25 needs a chain.

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17): a 1280x720, 30 fps, 20 s source whose pixels encode the source frame number (a 10-bit pattern of black and white blocks, read back with a script) and whose sound has an 880 Hz beep at every whole second. Five segments: 0 to 1 s at 0.25x, 2 to 4 s at 0.5x, 5 to 7 s at 1x, 8 to 12 s at 2x, 12 to 20 s at 4x. Plan length 4 + 4 + 2 + 2 + 2 = 14 s.

| Output | Frames | Duration | Worst gap between the frame shown and the plan | Frames beyond one source frame of the plan |
|---|---|---|---|---|
| 30 fps | 420 (plan: 420) | 14.000 s | 0.033 s of source time (one source frame) | 0 |
| 60 fps | 840 (plan: 840) | 14.000 s | 0.029 s of source time | 0 |

- `atempo=0.25` and `atempo=0.4` both fail with "Value out of range [0.5 - 100]"; `atempo=0.5` and `atempo=100` work; 101 fails. `atempo=4` as a single filter works (older documents say 2.0 is the cap; that is not true in 9.0.2).
- **Audio length**: without `apad` the audio was 13.984 s (one AAC frame short) against 14.000 s of video; with `apad=whole_dur=14` and `-t 14` both were exactly 14.000 s (60 fps run, verified).
- **A/V sync**: the beeps (silence detection on the output) started at 4.000, 8.000 and 9.000 s where the plan says 4.0, 8.0 and 9.0, and at about 10.49, 10.99 and 11.49 s in the 2x part (plan 10.5, 11.0, 11.5) and every 0.25 s within 20 ms in the 4x part. One beep in the 0.5x part started at 5.94 s against a plan of 6.0 s: `atempo` (a time-stretch) can move a transient by up to about 60 ms at 0.5x. The video is exact; the sound is exact in length and approximate in the fine position of fast sounds.
- A 20 s speed-changing graph encodes as fast as a plain one (about 3 s for 14 s of 720p30 at `veryfast`).

**Caveats**: (1) `trim` after decode reads the file from its start; the input is therefore the pre-cut HD range, never the whole source (`-ss` before `-i` is also an option, not tested here). (2) Source frame rate may differ from the output: `fps` resamples; at 0.25x the picture repeats frames (verified: the 60 fps run shows each source frame several times), no interpolation. (3) Variable-frame-rate sources and phone rotation metadata were not tested (not verified): normalise at import (the proxy and HD cut are constant frame rate).

## 2. Crop Areas And Layouts

**Recipe**. Everything is built from four parts: a base canvas, one `crop`+`scale` per area, one `overlay` per area, and an optional rounded mask.

```
[vsrc]split=K[s0][s1]...;
# base: solid colour
color=c=black:s=CWxCH:r=FPS:d=DUR[base];
# base: blurred (blur a downscaled copy, scale it back up)
[s0]scale=DW:DH:force_original_aspect_ratio=increase:flags=bilinear,crop=DW:DH,gblur=sigma=3:steps=2,scale=CW:CH:flags=bicubic,setsar=1[base];
# one area, cover fit (DW = CW/10 rounded to even)
[sK]crop=CPW:CPH:CPX:CPY,scale=FW:FH:force_original_aspect_ratio=increase:flags=bicubic,crop=FW:FH,setsar=1[aK];
# one area, contain fit (Fit crop ratio): same without the last crop, and the overlay centres it
[sK]crop=CPW:CPH:CPX:CPY,scale=FW:FH:force_original_aspect_ratio=decrease:flags=bicubic,setsar=1[aK];
[prev][aK]overlay=x=FX:y=FY:format=yuv420:shortest=1[oK]        # contain: x=FX+(FW-w)/2:y=FY+(FH-h)/2
```

`CPX, CPY, CPW, CPH` are the crop in source pixels, `FX, FY, FW, FH` the area's frame in canvas pixels. **Rounded corners (Gameplay camera box, Screen Share camera)** use an anti-aliased alpha mask drawn once and looped:

```
[sK]crop=...,scale=FW:FH:...,crop=FW:FH,setsar=1,format=yuv420p[arK];
color=c=white:s=FWxFH:r=30:d=0.04,format=gray,geq=lum='clip((R-hypot(max(abs(X-FW/2+0.5)-(FW/2-R),0),max(abs(Y-FH/2+0.5)-(FH/2-R),0)))+0.5,0,1)*255',loop=loop=-1:size=1:start=0,setpts=N/(30*TB)[mK];
[arK][mK]alphamerge[aK]
```

(`R` is the radius in canvas pixels; the rest is as above.)

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17): a 1920x1080 source with the red channel equal to x and the green channel equal to y (a gradient), canvas 1080x1920, crops given as fractions of the frame converted to even pixel sizes. The centre of each area was compared with the source gradient at the centre of its crop.

| Layout | Areas (canvas frame, crop) | Result at each area centre (red, green: got versus expected) |
|---|---|---|
| Fullscreen (Fill) | 1 area, 9:16 crop of the source, cover | 125,125 vs 128,128 |
| Blurred (Fit) | blurred base + the whole picture, 1080 x 608, centred | 125,126 vs 128,128 |
| Split | 2 areas 1080 x 960, stacked, crops from the left and right quarters | 80,126 vs 81,128; 173,125 vs 174,128 |
| Three | one 1080 x 960 on top, two 540 x 960 below | within 3 of expected on every area |
| Four | four 540 x 960 areas | within 3 of expected on every area |
| Gameplay | game fullscreen + 389 x 389 camera box at (0.04, 0.03) with a 36 px radius | game 127,126 vs 128,128; camera 212,48 vs 217,51 |
| Screen Share | blurred base + a 1080 x 608 screen band + a rounded 864 x 648 camera | 125,125 vs 128,128; 214,124 vs 217,128 |

The 3-unit difference is the limited-range colour round trip of the test source (yuv420p), not a position error. A picture of the Gameplay, Screen Share, Blurred and Three results was looked at: rounded corners are smooth, the blurred base is seamless, areas are exact.

**Caveats and numbers**:
- **`shortest=1` is mandatory** on every overlay. The Gameplay graph with `shortest=0` ran forever (the looped mask is infinite and nothing ended the output); with `shortest=1` and the finite `color` base it ends on time.
- **The overlay pixel format decides the speed.** With the default `format=auto` and an `rgba` mask path, a 1080x1920 layout took 24.1 s for 8 s of video; with `format=yuv420` on every overlay, `format=yuv420p` on the area before `alphamerge`, the same graph took 9.9 s (measured twice with the same inputs; the machine was busy, treat as a ratio). **The compiler always writes `format=yuv420` on overlays and never converts the main picture to rgba.**
- Even sizes: `scale` and `crop` for yuv420p want even numbers; the compiler rounds to the nearest even number once and uses that everywhere.
- The Blurred base is cheap: a 108 x 192 blur and one upscale.
- `crop` first, then `scale`: cropping before scaling keeps the scaled picture small (the crop is a fraction of the source).
- The preview's rounded camera box is CSS `border-radius` with the same radius in canvas pixels.

## 3. Time-Varying Crop (Crop Keyframes)

**Recipe (recommended): `sendcmd` with one linear expression per interval.** In the segment chain, before `setpts` (so `t` is **source** time):

```
[0:v]trim=start=SIN:end=SOUT,sendcmd=f=cropN.txt,crop=w=CPW:h=CPH:x=X0:y=Y0:exact=1,setpts=(PTS-STARTPTS)/S,fps=FPS[vI]
```

`cropN.txt` (times in the stream's own time, before `setpts`; subtract the file offset first):

```
0.0000-1.0000 crop x '100+800*(t-0.0000)', crop y '0+0*(t-0.0000)';
1.0000-2.5000 crop x '900+-400*(t-1.0000)', crop y '0+0*(t-1.0000)';
2.5000 crop x '300', crop y '0';
```

The **last line must be a constant at the last keyframe**: an expression set by `sendcmd` keeps evaluating after its interval ends (verified: `x='100+500*(t-1)'` kept growing after t = 2, so at t = 2.5 the crop was at 850, not 600). `X0, Y0` is the first keyframe. With one keyframe (the Sprint 12 case) write a plain constant `crop` and no `sendcmd`.

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17): a 1920x1080 source with a pseudo-random luma texture along x, so the crop position can be recovered by matching one row against the source row. A 608x1080 window moves between random keyframes over 10 s (300 frames); the recovered position was compared with the ideal piecewise-linear position at each frame's time.

| Keyframes | Nested `if(lt(t,..))` expression | Flat sum of `between()` terms | `sendcmd` one expression per interval | Splitting into sub-segments and `concat` |
|---|---|---|---|---|
| 2 | 31 chars, error max 0.49 px | 51 chars, 0.49 px | 0.49 px | 0.49 px |
| 10 | 371 chars, 0.50 px | 479 chars, 0.50 px | 0.50 px | **17 px, 184 of 300 frames off** |
| 60 | 2,532 chars, 0.49 px | 3,190 chars, 0.49 px | 0.49 px | **206 px, 281 frames off** |
| 80 | 3,401 chars, 0.50 px | 4,279 chars, 0.50 px | 0.50 px | not run |
| 100 | **fails to parse** ("Missing ')' or too many args") | **fails** ("Failed to configure input pad on Parsed_crop") | 0.50 px | not run |
| 200 and 600 | fails | fails | 0.50 px (600 keyframes ran, 300 frames, same error) | not run |

- Wall time per run was the same for all that work (2 to 4 s for 300 frames at 1080p; the machine was busy). The crop position is rounded to the nearest whole pixel (error never above 0.5 px, mean 0.25 px).
- **The expression forms hold up to about 80 keyframes and break between 80 and 100** (the limit is the parser's nesting or term count, not the string length: 4,275 characters failed, 4,279 passed at 80). Do not depend on that ceiling.
- **Sub-segments are not robust**: with keyframe times that fall between frames the pieces do not line up (errors of tens to hundreds of pixels). Not used.
- **Keyframes stay in source time.** Verified through `trim`, `sendcmd`, `crop`, `setpts` with speed 2 (90 frames as planned, max error 0.33 px) and speed 0.5 (180 frames, max error 0.33 px **when the ideal is evaluated at the source frame that is shown**). At 0.5x each source frame is shown twice, so the crop of a frame is the crop at that source frame's time, not at the output time; compared at output time the error was up to 19 px during a fast pan. `frameState` therefore evaluates the crop at `floor(sourceMs x sourceFps / 1000) / sourceFps`.
- `crop y` through `sendcmd` also works (a combined x and y move was exact at 0.5 s and 1.5 s).
- **Windows path**: `sendcmd=f=cropN.txt` with a relative name; an absolute path with a drive colon needs escaping. In the job's scratch folder this never arises.
- The compiler writes the file with a small helper from the keyframe list; no string-length limit applies.

## 4. Zoom Into A Focus Point, With Ease

**Definition** (the numbers the preview and the compiler share). A zoom has an output-time window `[a, b]` (seconds), a peak scale `S`, a focus point `F = (fx x CW, fy x CH)` in canvas pixels, and an ease `d` (seconds). With `u = min(clip((t-a)/d, 0, 1), clip((b-t)/d, 0, 1))`, the scale is `z(t) = 1 + (S - 1) x u x u x (3 - 2u)` (smoothstep in and out). A canvas point `p` appears at `q = F + (p - F) x z(t)` (continuous coordinates: pixel *i* covers `[i, i+1]`), which is a window of the canvas `CW/z` wide whose left edge is `F.x x (1 - 1/z)`. The focus point never moves.

**Recipe (recommended): `perspective`, evaluated per frame, limited to the zoom's window**, placed after the layout so it zooms all areas as one picture:

```
perspective=x0='WX':y0='WY':x1='WX+WW':y1='WY':x2='WX':y2='WY+WH':x3='WX+WW':y3='WY+WH':interpolation=cubic:eval=frame:enable='between(t,A_MINUS,B_PLUS)'
```

with `Z = (1+(S-1)*U*U*(3-2*U))`, `U = min(clip((TT-A)/D,0,1),clip((B-TT)/D,0,1))`, `TT = ((in-1)/FPS)`, `WX = fx*CW*(1-1/Z)`, `WY = fy*CH*(1-1/Z)`, `WW = CW/Z`, `WH = CH/Z`. The compiler writes `A_MINUS = A - 0.02` and `B_PLUS = B + 0.02` so the window covers the ease. Several zooms are several `perspective` filters in a row, each with its own `enable` and its own numbers.

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17): a 1080x1920 canvas with six bright discs at known positions, a 1 to 4 s zoom to 2x with a 0.5 s ease, focus (0.3, 0.6), 180 frames. Position of each fully visible disc measured as a weighted centroid and compared with `q` at each frame.

| Method | Mean position error | Worst error | Worst frame-to-frame change of the error | Time for the 180 frames (decode alone: 3.4 s) | Verdict |
|---|---|---|---|---|---|
| `perspective`, linear, every frame | 0.30 px | 0.72 px | 0.07 px | 15.6 s | works, slow if always on |
| `perspective`, cubic, every frame | 0.30 px | 0.72 px | 0.07 px | 31.4 s | works, slowest |
| **`perspective` with `enable` over the zoom window** | **0.30 px** | **0.72 px** | **0.07 px** | **5.4 s** (linear) | **works; the cost is paid only inside the zoom** |
| `zoompan` (`d=1`, per frame `z`, `x`, `y`) | 0.45 px | 6.07 px | 3.42 px | 3.15 s | works with caveat: integer crop positions cause up to 3 px of jitter per frame, but it is almost free |
| `zoompan` after a 4x pre-scale | 1.08 px (before a coordinate fix) | 2.18 px | 0.68 px | 79 s | works, far too slow |
| `scale ... eval=frame` then `crop` | disc not found at any zoomed frame | n/a | n/a | n/a | **does not work**: only `scale`, `format` and `null` may change the frame size inside a graph; `crop` kept its first size and cut the wrong part |
| `crop` with `w`, `h` expressions per frame | n/a | n/a | n/a | n/a | **does not work**: `w`, `h` are evaluated once ("Error when evaluating the expression" when they contain `t`) |
| `crop` with `w`, `h` changed by `sendcmd` every frame, then `scale` | mean 1.64 px | **46.7 px** | 46.3 px | 5.6 s | **not robust**: the size change takes effect a frame late at the start and end of each ease |

- **`in` counts input frames starting at 1** in 9.0.2: using `in/FPS` was one frame late (errors up to 49 px), and `(in-1)/FPS` matched exactly. The counter keeps counting while `enable` has the filter off (a window starting at 0.9 s with `(in-1+0)/30` was exact; adding an offset made it wrong). The compiler writes `((in-1)/FPS)` and parity tests catch any change in a different build.
- `t` is **not** available inside `perspective` expressions ("Undefined constant"); use the frame counter.
- Smoothness: the error changes by at most 0.07 px from frame to frame, so there is no visible jitter. `perspective` interpolates at sub-pixel positions; `crop` and `zoompan` cannot.
- Use `interpolation=linear` for Proof Preview and `cubic` for the final export if the benchmark allows it (cubic costs about twice linear inside the zoom).
- A window at the canvas edge: `WX` is never negative and `WX + WW` never exceeds `CW` for a focus inside the canvas.
- Easing in the preview: `transform: scale(z)` with `transform-origin` at `F`, `z` from the same function (same mapping).

## 5. Overlay Items: Stickers, Animated Stickers, Animated Ingest

**Recipe, one item** (`IW` and `IH` the item's size in canvas pixels, `ANG` degrees clockwise, `OP` 0 to 1, `CXP` and `CYP` the centre in canvas pixels, `A` and `B` the window in output seconds, `LOOP` and `ANIM` flags):

```
# still image: input flags  -loop 1 -framerate FPS -i sticker.png
# animated, loops:          -stream_loop -1 -i sticker.apng
# animated, plays once:     -i sticker.apng
[N:v]format=rgba,scale=IW:IH:flags=bicubic,rotate=a=ANG*PI/180:c=none:ow='2*ceil(hypot(iw,ih)/2)':oh='2*ceil(hypot(iw,ih)/2)',colorchannelmixer=aa=OP[stN];
# animated only, start its animation at the item's start:
[stN]setpts=PTS-STARTPTS+A/TB[stN];
[prev][stN]overlay=x='CXP-w/2':y='CYP-h/2':enable='between(t,A,B)':shortest=1:format=yuv420[oN]
```

For "play once", set `B = A + animationSeconds` (or earlier) and keep `eof_action=repeat` (the default): the last frame then holds until the window closes. Do **not** use `eof_action=pass` for this.

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17), on a 540x960 canvas with a 256x256 sticker (an opaque disc with a white marker at 12 o'clock and transparent corners), centre (162, 672), width 216, rotation 30, opacity 0.5, window 1 to 3 s:
- Outside the window the pixel equals the background (47,47,47 vs 48; yuv rounding); inside, the pixel near the centre was 138,57,46, a 50 percent blend; the corners of the rotated bounding box stayed exactly background (transparent corners work with `c=none` and the enlarged `ow` and `oh`).
- Marker centroid: expected (195.3, 614.3), measured (194.5, 613.9). **Positive angle is clockwise** (the marker moved to the right of the centre, like CSS `rotate(30deg)`).
- Animated APNG (20 frames at 10 fps, the disc colour cycles), window 0.5 to 4.5 s: with `setpts=PTS-STARTPTS+A/TB` and `-stream_loop -1` the disc colour at seven sample times matched the expected phase (88 vs 88, 146 vs 148, 88, 67 vs 68, 88, 150 vs 151, 67 vs 68). `-itsoffset 0.5` instead of `setpts` gave identical values. **Without the shift** (enable only) the animation started at its middle (150 at t = 0.55 instead of 88): the shift is required.
- Play once, ending at 2.5 s: with `eof_action=pass` the last frame (2.4 to 2.5 s) was missing already at 2.45 s; with `eof_action=repeat` and `enable` ending at 2.5 the last frame stayed until 2.49 s and was gone at 2.52 s.
- `-stream_loop -1` works on an APNG although `ffprobe` reports its duration as N/A.
- Speed: the stickers added about 2 s to an 8 s 1080p30 render (unoptimised path) and little once overlays use `format=yuv420`.

**GIF, animated WebP, APNG decode and ingest** (verified 2026-11-17):

| Input | Decoder in 9.0.2 | Result |
|---|---|---|
| APNG | `apng` | decodes; 20 frames, 10 fps; the file's loop count is ignored by default (demuxer option `ignore_loop` is true; the other setting was not tested), so looping is done with `-stream_loop -1` |
| GIF | `gif` | decodes; 1-bit transparency survives; **delays under 2 hundredths of a second are raised to 10** (demuxer `min_delay` 2, `default_delay` 10) |
| Animated WebP | `webp_anim` (native) | decodes (pix_fmt argb); 20 frames, 10 fps, alpha kept |
| Variable-delay GIF (1.0, 0.12, 0.08, 0.52 s) | `gif` | after `fps=15` the APNG has 26 frames, 1.733 s, against 1.72 s of input |

**Ingest command** (all three types, to an APNG with full alpha and constant frame rate):

```
ffmpeg -hide_banner -nostdin -y -i in.gif -vf "fps=15,format=rgba" -plays 0 -f apng out.apng
```

Alpha was checked at a corner pixel (alpha 0), the disc centre (255) and the marker (255) for APNG to APNG, GIF to APNG and WebP to APNG: all kept. Use `fps=<the sticker's own rate>` with a cap of 30; long delays become repeated frames (a larger file). A size cap (`scale='min(512,iw)':-2`) and a frame cap are advised but **not verified**. Still PNG, still WebP and JPEG stay as they are.

**Caveats**: (1) Rotation of an animated sticker keeps `rotate` in the chain (cost grows with the sticker's pixel count, small for stickers). (2) The overlay's `x` and `y` expressions are truncated to whole pixels: the measured centre error is under 1 pixel; the compiler uses even `IW` and `IH` and an even enlarged box so `w/2` is whole. (3) A sticker whose window starts before 0 or ends after the clip is clipped by the compiler.

## 6. Text Through ASS

**Recipe**. One file per render, written by `buildAss()`; one `ass` filter last in the picture chain:

```
[Script Info]
ScriptType: v4.00+
PlayResX: CW
PlayResY: CH
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: sN,FAMILY,ASS_SIZE,&HAABBGGRR,&H000000FF,&HAABBGGRR,&HAABBGGRR,BOLD,0,0,0,100,100,0,0,BORDERSTYLE,OUTLINE,SHADOW,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,H:MM:SS.CC,H:MM:SS.CC,sN,,BOXL,BOXR,0,,{\an5\pos(PX,PY)\frz-ROT\fad(IN,OUT)}Text with \N line breaks
```

Filter: `ass=captions.ass:fontsdir=fonts` (relative names; the `subtitles` filter gave the same picture and takes the same options). Colours are `&HAABBGGRR` (blue, green, red order; alpha 00 is opaque, FF is transparent). Escape `\`, `{`, `}` in the text; a line break is `\N`; commas in the last field are fine.

**What was verified** (FFmpeg 9.0.2 gyan full build, 2026-11-17, canvas 1080x1920, picture looked at and measured):

| Feature | Result |
|---|---|
| Font, size, outline, shadow, colour | work (`Segoe UI`, `Arial`, `Nirmala UI` from `fontsdir`) |
| Box (`BorderStyle` 3) | works; the box colour is the **outline** colour (red outline gave a red box); `Outline` is the padding (24 gave a 24 px margin) |
| Alpha (`\alpha&H80&`) | half transparent text |
| `\pos` with `\an5` | centre of the text at the given point (measured centre 538.5 vs 540); `\an4` left-aligns at `x` (measured 300) |
| `\frz30` | rotated **counter-clockwise** (the right end of a bar went up). A CSS or FFmpeg clockwise angle `ROT` is written `\frz-ROT` |
| `\fad(1000,1000)` | half transparent at 1.5 s of a 1 to 4 s event, as expected |
| `\t(1000,3000,\fscx200\fscy200)` | 125 percent at 1.5 s, as expected |
| Scaling to the canvas | `PlayResX/Y` equal to the canvas and `ScaledBorderAndShadow: yes` make every number a canvas pixel |
| Wrapping | `WrapStyle: 0` wraps and balances lines inside the event's own margins even with `\pos`: with `MarginL` and `MarginR` of 200 the text was 556 px wide inside a 680 px box; with 300 and 300 and `\an4` it started at x 300 and stayed inside. `\q2` disables wrapping (text ran off the canvas). Rule: `MarginL = boxX`, `MarginR = CW - boxX - boxW`, and `\pos` at the anchor inside the box |
| Hindi and Tamil | **joined correctly**: `हिन्दी`, `क्षत्रिय` and `தமிழ்` in Nirmala UI; the `shaping=simple` option broke the Hindi conjuncts, so HarfBuzz is doing the shaping. Never set `shaping=simple` |
| Emoji | `😀🔥` in Segoe UI Emoji drew as **monochrome outlines**, not colour glyphs (libass draws no colour glyphs). Colour emoji must be images |
| WOFF2 fonts | **do not load**: "Error opening memory font" for `anton-400.woff2` and `bodoni-moda-var.woff2`. Ship TTF or OTF |
| Font size meaning | ASS `Fontsize` is the **line height**: `fs` = em px x (`usWinAscent` + `usWinDescent`) / `unitsPerEm`. Arial (2048 units, 1854 + 434) at `\fs100` gave a cap height of 64 px (predicted 64.1); Segoe UI (2210 + 514) gave 53 px (predicted 52.6). To match a CSS `font-size` of `P` px use `fs = P x (winA + winD) / upm`. Read the three numbers from each font file at image build time |

**Cost** (verified, noisy machine): one `ass` filter on a 1080x1920 30 fps render added about 3.4 s to 8 s of video (12.0 s with it, 8.6 s without; +40 percent) with two events. A four-line paragraph with a 6 px outline and a 6 px shadow cost about 15 s more per 8 s of video than the same paragraph without outline and shadow (~0), because libass draws and blends an image per glyph and layer. Keep caption outlines modest; measure in Module 05.

**Font lookup**: a family name that is not in `fontsdir` falls back silently. The compiler lists every family it wrote and checks each against the folder before it renders.

## 7. Looks, Fades

**Recipes** (applied to the whole picture after the layout and zoom and before the text, except `fade`: the editor's Fade In and Fade Out fade the picture and the text together, so `fade` goes after the `ass` filter; it was verified on a plain picture, the order with `ass` is by construction and not separately tested):

```
eq=brightness=B:contrast=C:saturation=S:gamma=G
hue=h=DEG:s=SAT
colorchannelmixer=.3:.59:.11:0:.3:.59:.11:0:.3:.59:.11                       # black and white
colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131            # sepia
colortemperature=temperature=4500                                              # warm; 9000 is cool
vibrance=intensity=0.8                                                         # vivid
curves=preset=increase_contrast,colorbalance=rs=0.1:bs=-0.1                    # cinematic (starting point)
vignette=angle=PI/4
fade=t=in:st=0:d=1,fade=t=out:st=OUTSTART:d=1
afade=t=in:st=0:d=1,afade=t=out:st=OUTSTART:d=1
```

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17), a flat colour (96,144,192) 5 s clip, pixel at the centre:

| Look | Result | Check |
|---|---|---|
| none | 95,144,191 | ok |
| `eq` brightness 0.1, contrast 1.2, saturation 1.5 | 102,179,247 | brighter, more saturated |
| `eq` gamma 1.5 | 133,182,229 | lighter mid tones |
| `hue` h 30, s 1.2 | 120,124,223 | hue turned |
| Black and white mixer | 134,134,134 | expected 134.9 |
| `hue=s=0` | 135,135,135 | same grey |
| Sepia matrix | 184,164,128 | expected 185,165,128 |
| `colortemperature` 4500 / 9000 | 95,122,140 / 78,125,191 | warm (blue and green down) / cool (red down) |
| `vibrance` 0.8 | 48,151,250 | much stronger colour |
| `curves` + `colorbalance` | 72,138,205 | contrast and cooler shadows |
| `vignette` angle PI/4 | centre 95,144,191, corner 8,22,32 | corners dark, centre unchanged |

Fades (verified): `fade=t=in:st=0:d=1,fade=t=out:st=3.5:d=1` on the flat colour gave 0,0,0 at 0.0 s, 47,70,95 (half) at 0.5 s, 95,144,191 at 2 s, 46,71,95 at 4.0 s and 8,13,19 at 4.4 s. `afade` in and out ramps were checked in the audio mix (section 8).

**Caveats**: the exact strength of each named Look (Warm, Cool, Vivid, Cinematic, Vintage) is a design choice not tuned here: the table shows the filters work and what they do to one colour. `eq` and the others run in yuv; `vignette` is the only one that needed no format change. The preview maps each Look to a CSS `filter` string and does not match to the pixel (`05-editor-and-render.md`, section 3).

## 8. Audio: Sounds, Volume, Mix, Loudness

**Recipe**:

```
anullsrc=r=48000:cl=stereo,atrim=duration=DUR,asetpts=PTS-STARTPTS[base];
[VID]volume=VV,aresample=48000,aformat=channel_layouts=stereo[v];                       # the clip's own sound, scaled (omit for muted)
[K:a]aresample=48000,aformat=channel_layouts=stereo,volume=SV,afade=t=in:st=0:d=FI,afade=t=out:st=OUTSTART:d=FO,adelay=MS|MS[sK];     # a sound placed at MS milliseconds
[M:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=DUR,asetpts=PTS-STARTPTS,volume=MV,afade=t=in:st=0:d=1,afade=t=out:st=DUR-2:d=2[m];
[base][v][s1]...[m]amix=inputs=N:normalize=0:duration=first:dropout_transition=0[mix]
```

Two-pass loudness: pass 1 runs the same sound graph on its own with `loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json` to `-f null -` and parses the JSON block from stderr; pass 2 appends `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..:offset=..:linear=true` to the mix and writes 48 kHz audio.

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17): three sources (a 330 Hz "voice" tone scaled to 0.5, an 880 Hz effect of 1.5 s placed at 3.0 s with volume 0.8 and 0.3 s fades, a 220 Hz music bed with volume 0.2, a 1 s fade in and a 2 s fade out), clip length 12 s.
- Output: 48000 Hz, 2 channels, **12.000000 s** exactly (the silent `anullsrc` base with `duration=first` fixes the length).
- Level windows (RMS) against the sum of the three tones' powers: 0.0226 at 0.2 to 0.8 s (music fading in), 0.0238 at 2 to 2.9 s (voice and music), 0.0426 at 3.4 to 4.1 s (all three) and 0.0238 again at 4.6 to 6 s (effect over). The expected figures, with the source tone's default amplitude of 1/8 taken into account, were 0.0225, 0.0238, 0.0426, 0.0238: all four match.
- `amix` with `normalize=0` leaves levels as set (without it each input is divided by the number of inputs).
- Loudnorm: pass 1 printed `input_i -32.62`, `input_tp -25.67`, `input_lra 3.10`, `input_thresh -42.62`, `target_offset 0.31`. Pass 2 with `linear=true` ("Normalization Type: Linear") gave **-13.8 LUFS** by an independent `ebur128` measurement (target -14, LRA 3.0, true peak -7.0 dBFS). A single dynamic pass gave -14.3 LUFS. The JSON arrives on stderr at normal log level: do not run pass 1 with `-loglevel error`.

**Caveats**: (1) `adelay` takes one value per channel (`MS|MS`) or `MS:all=1`. (2) `loudnorm` uses `linear=true` only when the input's loudness range fits the target; otherwise FFmpeg falls back to dynamic mode and says so on stderr: log it. (3) A limiter is added only when the mix would clip (`OpenCut classic` practice, `03-open-source-reference-repos.md`). (4) The preview does no loudness normalisation: it only sums the gains.

## 9. Encoding For Social Platforms

**Recipe**:

```
-map [v] -map [a] -t DUR -r FPS
-c:v libx264 -profile:v high -pix_fmt yuv420p -preset PRESET -crf 21 -maxrate MAXRATE -bufsize 2xMAXRATE
-g 2xFPS -keyint_min 2xFPS -sc_threshold 0
-c:a aac -b:a 128k -ar 48000 -ac 2 -movflags +faststart
```

`MAXRATE`: 5M at 720p30, 8M at 1080p30, 12M at 1080p60 (YouTube's suggested figures, `07-legal-limits-cost-and-risks.md`, section 7).

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17, the 20 s typical graph below, `ffprobe` on the 1080x1920 outputs): H.264 **High**, level 4.0 at 30 fps and 4.2 at 60 fps, `yuv420p`, `r_frame_rate` 30/1 and 60/1, 600 and 1200 frames, duration 20.000 s; key frames at 0, 2, 4, ... 18 s (10 in 20 s); x264 reported `keyint=60 open_gop=0 scenecut=0 bframes=3 vbv_maxrate=8000`, so the GOP is closed; AAC LC, 48000 Hz, 2 channels; box order `ftyp moov free mdat` (the index is first). All the platform rules in the legal file (moov first, closed GOP, 4:2:0, constant frame rate, 48 kHz AAC) hold.

**Speed** (the typical graph, 20 s of video, 9:16): base picture is a 1920x1080 `testsrc2` source (a hard, noisy synthetic: real footage may encode faster), a fullscreen game area, a rounded camera box, two stickers (one animated), two ASS texts with outline and a fade, an audio mix of three sources, 20 s long. Machine: i7-10850H, 12 threads, busy with other work (25 to 60 percent). One run each.

| Output | `veryfast` (seconds, x realtime) | `medium` (seconds, x realtime) | File size at CRF 21 (veryfast) |
|---|---|---|---|
| 720 x 1280, 30 fps | 19.3 s, **1.04x** | 20.7 s, 0.96x | 5.1 MB (2.0 Mbps) |
| 1080 x 1920, 30 fps | 29.1 s, **0.69x** | 35.3 s, 0.57x | 7.8 MB (3.1 Mbps) |
| 1080 x 1920, 60 fps | 47.8 s, **0.42x** | 54.3 s, 0.37x | 7.1 MB (2.9 Mbps) |

"x realtime" is video seconds made per wall second (1.0 means a 20 s clip takes 20 s). The first version of this graph, with `overlay=format=auto` and an `rgba` mask, was twice as slow: 28.4 s and 37.3 s at 720p, 59.7 s and 61.8 s at 1080p30, 99.9 s and 109.9 s at 1080p60 (0.70x to 0.18x). The two fixes were `format=yuv420` on every overlay and a `yuv420p` mask path (section 2).
- Where the time goes (1080p30, `veryfast`, 8 s clip, first version): layout alone 15.5 s, rounded mask +8.6 s (fixed), `ass` +5.7 s (+3.4 s after the fix), stickers +2.1 s. After the fixes: whole graph 12.0 s, without text 8.6 s, with the old `format=auto` 24.4 s.
- `veryfast` against `medium` changes the time by only 5 to 20 percent here because the graph, not x264, dominates; `medium` gives 3 to 6 percent bigger files. Recommended: `veryfast` for the export, `ultrafast` for Preview Export.
- Decoding the 20 s 1080p source alone took 3.2 s; a bare crop, scale and encode to 720x1280 at `veryfast` took 8.9 s (5.5 s at `ultrafast`) on the same busy machine: that is the floor for this source.
- File size: CRF 21 gave 2 to 3 Mbps on this smooth synthetic source; `-maxrate` only bites on busy footage. **A real 8 Mbps file was not produced** (not verified): a size cap for Instagram's 300 MB limit comes from the maxrate and the clip length, as the legal file says.
- **Planning figures until Module 05 measures the real host**: allow 1.5 to 3 times the clip length for 1080p30 and 2.5 to 5 times for 1080p60 on a shared 4 to 6 core machine (the laptop above ran 1.4x and 2.4x at `veryfast` while shared); a dedicated host should do better. **No hardware encoder was tried** (the build has `h264_nvenc`, `h264_amf` and `h264_qsv`; none tested; not verified).

## 10. Proof Preview

**Recipe**: the same plan through the same compiler with the canvas scaled to 360 x 640 (every pixel number scaled by one factor, fonts and outlines included; `PlayResX/Y` stay 1080x1920 so libass scales the text itself), `-preset ultrafast -crf 28 -maxrate 2M`, 30 fps, audio unchanged.

**Evidence** (verified, same graph and busy machine as section 9): **8.4 s for 20 s of video, 2.4x realtime**, 3.2 MB (1.26 Mbps). About 3.2 s of that is decoding the 1080p source, so Preview Export from the 720p proxy instead of the sharp range would be faster (not verified); but the proxy is not the exact picture, so the compiler keeps the real input unless a benchmark says otherwise.
- The proof differs from the export only in resolution, bitrate and preset: same crop, zoom, text, stickers, looks and audio mix.

## 11. Progress And Cancel

**Recipe**: `ffmpeg -hide_banner -nostdin -y -loglevel error -progress pipe:1 -nostats ...` and read stdout.

**Evidence** (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17, a 20 s 720p to 1080p re-encode, 33 blocks):
- A block is a set of `key=value` lines ending in `progress=continue` (or `progress=end` for the last one). Fields: `frame`, `fps`, `stream_0_0_q`, `bitrate`, `total_size`, `out_time_us`, `out_time_ms`, `out_time`, `dup_frames`, `drop_frames`, `speed`, `progress`. **Read `frame`, `out_time_us`, `speed`, `progress`.** `out_time_ms` holds the same number as `out_time_us` (microseconds, despite the name): do not use it.
- Blocks arrived every 0.48 to 0.59 s.
- **`out_time_us` is not strictly increasing** while video and audio interleave: the percent series ran 96, 90, 93, 100. The executor keeps the maximum seen so far and clamps to 100.
- **Cancel**: `child.kill()` ended FFmpeg within 180 ms of the call (SIGTERM; on Windows this is a hard terminate), exit code null with signal SIGTERM; no `ffmpeg` process was left. The output written to `x.part.mp4` was 1 MB with **no `moov` atom** (`ffprobe` exit 1: "moov atom not found"): an unusable file, so the activity writes to `.part`, renames only after `progress=end` with exit 0, and deletes the scratch folder after a cancel.
- ETA for "about N minutes left" is `(DUR - out_time) / speed`; `speed` is a string like `1.28x`.

## 12. Parity Design: One `frameState` For The Preview And FFmpeg

`frameState(doc, outputMs)` is pure. Both the preview and the compiler tests call it. It returns numbers only; the preview draws them with CSS, the compiler writes them into filter text, the parity tests compare rendered pixels with them. The rules (every one was checked in sections 1 to 8 unless marked):

| Quantity | Rule |
|---|---|
| **Time of output frame *n*** | `outputMs = round(n x 1000 / FPS)`; FFmpeg's frame *n* has time `n / FPS`. |
| **Source time and frame shown** | `srcMs = sourceIn + (outputMs - outStart) x speed` through the segment; the frame shown is the source frame at `floor(srcMs x srcFps / 1000)` (within one source frame of FFmpeg, section 1). |
| **Pixel conversion** | One function converts fractions to pixels: positions `round(f x size)`; sizes the nearest **even** number; computed once in the plan, never twice. |
| **Crop keyframes** | Linear interpolation in source time between keyframes, held before the first and after the last; evaluated at the shown source frame's time (section 3); position rounded to the nearest whole source pixel (error at most 0.5 px). |
| **Zoom** | `z` and the focus mapping of section 4, in **output** time (a zoom over several segments is merged into output intervals first; `ease` is output milliseconds), measured at the frame's own time `n / FPS`. `q = F + (p - F) x z` in continuous pixel coordinates. |
| **Item centre and size** | Centre `(cx, cy)` in canvas fractions; width as a fraction of the canvas width; height from the image's aspect; pixel width `even(round(w x CW))`. Overlay `x = cx x CW - W'/2` with `W' = 2 x ceil(hypot(w, h) / 2)` (the rotated bounding box, section 5). |
| **Rotation** | `rotationDeg` is **clockwise**-positive, as CSS `rotate()` and FFmpeg `rotate=a=deg*PI/180`; ASS `\frz` is `-rotationDeg`. |
| **Opacity** | 0 to 1. FFmpeg `colorchannelmixer=aa=OP`; ASS `\alpha&H<hex of round((1-OP) x 255)>&`; CSS `opacity`. |
| **Item window** | Output milliseconds `[start, end)`; FFmpeg `enable='between(t,A,B)'` with `B = end - 0.001` (the `between` test includes both ends; not verified at the exact edge). |
| **Animated sticker frame** | `k = floor((outputMs - startMs) / frameMs)`, modulo the frame count when looping; held on the last frame (or hidden, per the item) when playing once; APNG at a fixed rate from ingest. |
| **Text position and box** | ASS `\pos(cx x CW, cy x CH)` at the item's anchor (`\an`), event margins from the box (section 6); `PlayRes` equals the canvas. |
| **Text size** | `fs = cssPx x (winA + winD) / upm` per font (section 6). |
| **Text rotation, fade, animation** | `\frz-ROT`, `\fad(in, out)`, `\t(t1, t2, tags)`; times in milliseconds from the event start. |
| **Sound placement** | `adelay` whole milliseconds; gains linear; fades linear (`afade` default curve); the preview's `GainNode` uses `linearRampToValueAtTime`. |
| **Looks** | The export uses the FFmpeg filters of section 7; the preview's CSS mapping is approximate by design. |
| **Loudness** | Export only. |

**Parity test method** (Jest, skipped with a message when `ffmpeg` is not on the PATH):

1. Build a small document with one feature (a crop, a zoom, a sticker, a text, a speed change).
2. Generate a **self-describing source** with FFmpeg's `lavfi`: a gradient whose red channel is x and green channel is y (section 2), a bit-pattern frame counter (section 1), a texture for subpixel matching (section 3), bright discs (section 4), or a sticker with a marker (section 5). Nothing is downloaded and the sources are tiny.
3. `compileFfmpeg(buildRenderPlan(doc, ctx))` and run it for 1 to 3 seconds at 30 fps, to raw frames.
4. For each time in a short list (0, an ease start, the middle of an ease, a hold, an end, one frame past a cut), call `frameState(doc, ms)` to get the expected centre, crop, scale or box, and recover the rendered one from the frame (centroid, row matching, block code). Tolerances: crop 1 px, zoom mapping 1 px, sticker centre 1.5 px and rotation 1 degree, text box a few pixels, source frame within one, audio window level within 1 dB.
5. A failing build or version changes the numbers and fails the test, which is the point: it is what caught `in` counting from 1 and `eof_action=pass` losing a frame.
6. `clips:stills` (a script, not a test) renders the same frames to PNG so a human can look.

## 13. What The Compiler Must Do

| # | Rule | Why (section) |
|---|---|---|
| 1 | Pass the graph as `-/filter_complex <file>`; never `-filter_complex_script`, never `-vsync` | Both removed in 9.0.2 (build check) |
| 2 | Use relative file names with the job folder as the working directory | Avoids drive-letter escaping (3, 6) |
| 3 | Per segment: `trim`, crop, `setpts`, `fps`, `setsar=1`; concat; one more `fps` and `format=yuv420p`; `apad=whole_dur` and `-t` on the output | Exact length (1) |
| 4 | Chain `atempo` for speeds below 0.5 (only 0.25 today); `aresample=48000` after it | Range 0.5 to 100 (1) |
| 5 | Crop keyframes only through `sendcmd` (one linear expression per interval, a constant last line, before `setpts`); a plain `crop` for one keyframe | Expressions break near 100 keyframes; sub-segments misalign (3) |
| 6 | Evaluate crop at the shown source frame's time | 0.5x repeats frames (3) |
| 7 | Convert fractions to pixels once, to even sizes | yuv420p (2) |
| 8 | Every `overlay` has `format=yuv420` and `shortest=1`; masks are made in `yuv420p`, never `rgba` on the main picture | 2x speed; no infinite output (2, 9) |
| 9 | Zoom with `perspective ... eval=frame:enable=between(...)` after the layout, counter `(in-1)/FPS`, one filter per zoom | Exact and cheap inside the window; `scale eval=frame`, `crop` expressions and `zoompan` are rejected (4) |
| 10 | Stickers: `rotate` with `c=none` and an enlarged even `ow`/`oh`, `colorchannelmixer=aa=`, `overlay` centred with `x='C-w/2'`; animated: `setpts=PTS-STARTPTS+A/TB`, `-stream_loop -1` to loop, `enable` ending at the item's end, default `eof_action` | (5) |
| 11 | Animated inputs are APNG at a fixed frame rate with full alpha from the ingest command | GIF delays, WebP variants (5) |
| 12 | Write one ASS file with `PlayRes` equal to the canvas; event margins as the text box; `\frz-ROT`; `fs` from the font's metrics; box colour in `OutlineColour` | (6) |
| 13 | Check every font family against `fontsdir`; the folder holds TTF and OTF only | Silent fallback; WOFF2 fails (6) |
| 14 | Never set `shaping=simple`; emoji are images | Tamil and Hindi; colour emoji (6) |
| 15 | Looks and fades from the table; `fade` after `ass` when the text should fade with the picture | (7) |
| 16 | Audio: `anullsrc` base of the exact length, `amix normalize=0 duration=first dropout_transition=0`, two-pass `loudnorm` with `linear=true`, parse the JSON from stderr | (8) |
| 17 | Encode: High, `yuv420p`, `-r FPS`, `-g` and `-keyint_min` of two seconds, `-sc_threshold 0`, `+faststart`, AAC 48 kHz stereo | (9) |
| 18 | Progress from `-progress pipe:1`: use `out_time_us` as a running maximum; cancel with `kill()`; write to `.part` and rename | (11) |
| 19 | Proof Preview: same plan, scaled canvas, `ultrafast`, lower priority | (10) |
| 20 | Fail with a clear message instead of rendering when an input, sticker, sound or font is missing or a plan limit is exceeded | A render must not guess |

## 14. Risks

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| A different FFmpeg version or build behaves differently (the `in` counter, option names, filters) | Medium | Wrong or failed render | Pin 9.0.2; the doctor smoke render; parity tests in CI; this cookbook says exactly what was verified |
| `perspective` is slow if enabled outside the zoom window | Medium | Slow render | Always write `enable=between(...)` (measured 15.6 s without, 5.4 s with) |
| Overlay on `format=auto` or an `rgba` main picture | High if forgotten | Render twice as slow | Compiler rule 8 and a snapshot test of the graph text |
| ASS text with big outline and shadow, or many captions, is slow | Medium | Slow caption renders | Modest caption outline; measure in Module 05; benchmark a caption-heavy clip |
| Real speed on the production host is lower than the laptop figures suggest | Medium | Plan limits wrong | Module 05 benchmark on the host; the planning figures above are conservative |
| No hardware encoder or 4K tested | Certain | None now (4K is reserved and parked) | Not verified; a later benchmark |
| Variable-frame-rate, rotated, HDR or odd-sized sources | Medium | Wrong geometry or colour | Normalise at import (constant frame rate, rotation applied, SDR, even size); not verified here |
| Sticker with huge frame count or size | Medium | Memory or slow render | Frame and size caps at ingest (not verified) |
| The `sendcmd` file is wrong at the last keyframe | Low | Crop keeps moving | The constant last line; parity test at the end of the clip |
| Transients move by tens of milliseconds under `atempo` | Certain at 0.5x | Slightly off sound hits | Accepted; say so in the speed panel |
| Fonts on Linux differ from the Windows machine (fontconfig, Noto Tamil and Devanagari) | Medium | Wrong glyphs | Run the shaping test in the real image (not verified on Linux) |
| Hindi or Tamil with a font that lacks the glyphs | Medium | Boxes instead of letters | Font coverage check before render |
| Cancelled render leaves a partial file | Low | Junk | `.part` and rename; verified the partial has no `moov` |
