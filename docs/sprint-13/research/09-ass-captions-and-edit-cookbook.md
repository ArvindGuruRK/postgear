# Sprint 13 Research: The ASS Captions And Edit Cookbook

> **Written**: 2026-11-17. Every recipe below was run on FFmpeg 9.0.2 (gyan.dev "full" GPL build) on a Windows 11 desktop with synthetic sources only (`lavfi`). Evidence lines say "verified on FFmpeg 9.0.2 gyan full build, 2026-11-17". Outside facts carry a link and a date, or "reported" where the page could not be read.
> **Why this exists**: the render engine is FFmpeg only (Remotion is dropped). Captions, titles, bleeps, many-segment cuts, the hook clip, montage, Follow The Speaker and the Emote Maker all become filter graphs and ASS subtitle files. This is the cookbook the compiler (`packages/video-engine/src/render`) and the ASS writer follow.
> **Sprint 12's cookbook**: `docs/sprint-12/research/09-ffmpeg-render-cookbook.md` did not exist when this was written, so the experiments here did not repeat anything from it. Where the two overlap (scaling, blurred layout, quality presets) Sprint 12's file wins.
> **Scripts**: the generators used (an ASS writer, a cut-graph writer, a crop-expression writer, tone and frame checkers) are throwaway spike code, kept in the session scratch folder, not in the repository. The recipes below are the contract; the production code is written in the modules.

## 1. The Build And The Machine

| Fact | Value |
|---|---|
| FFmpeg | 9.0.2-full_build-www.gyan.dev, built with gcc 16.2.0 |
| Subtitle renderer | libass 0.17.5 (API 0x1705000), FreeType 2.14.3, FriBidi 1.0.16, HarfBuzz 14.4.0 in COMPLEX shaping mode (the `[Parsed_ass_0]` log lines at `-loglevel verbose`) |
| Relevant configure flags | `--enable-libass --enable-libharfbuzz --enable-libfribidi --enable-libfreetype --enable-fontconfig --enable-libwebp --enable-libx264 --enable-libvpx --enable-librubberband --enable-whisper` (from `ffmpeg -buildconf`) |
| Font provider on this machine | DirectWrite with GDI (Windows). The production worker is Debian, where libass uses fontconfig. **Not run**: no Linux machine was available, so the fontconfig path is reported, not verified |
| Machine | A shared 12 logical processor Windows desktop with other jobs running. Wall times below are noisy and pessimistic; CPU seconds (`-benchmark` `utime`) are steadier |
| Sources | `testsrc2` 1080x1920 and 1920x1080 at 30 fps, 62 s, about 5 Mbps (a high-entropy picture, harder to encode than a talking head), a 300 Hz or 440 Hz sine for sound |

**A change that breaks the brief's wording.** `-filter_complex_script` no longer exists in FFmpeg 9.0.2 (`Unrecognized option 'filter_complex_script'`, verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). The replacement is the `-/` prefix, which reads any option value from a file: `-/filter_complex graph.txt`. It was used for every graph in this file and works with graphs of 31 KB. The compiler writes `graph.txt` and passes `-/filter_complex graph.txt`; it must never pin the old flag name.

**Windows and paths.** ASS and font paths inside a filter string need drive letters and colons escaped. Run FFmpeg with its working directory set to the job folder and use relative names (`ass=cap.ass:fontsdir=fonts`). That worked everywhere here and is also correct on Linux.

## 2. Experiment 1: Word By Word Captions Through ASS

### 2.1 Four Ways To Mark The Spoken Word

All four were written by a generator from the same word list (0.36 s a word, uppercase, 96 px Arial bold, 1080x1920, `\an5\pos`), paged 3 words a page, and checked by extracting frames.

| Method | Pattern | What You See | Verdict |
|---|---|---|---|
| Karaoke fill `\k` | One Dialogue per page: `{\k36}SO {\k36}TODAY {\k33}WE`. Style `PrimaryColour` is the colour after the word is spoken, `SecondaryColour` the colour before | Each word switches at its time and **stays** highlighted: "SO TODAY" yellow when TODAY is spoken | Use for the "spoken words keep the accent" style (`karaoke`) |
| Karaoke sweep `\kf` | Same, `\kf` | The fill sweeps left to right inside the word, smooth every frame (frame at 0.18 s showed "SO" half filled) | Use for a sweep style |
| Karaoke outline `\ko` | Same, `\ko` | Fill changes at the word's time, outline fades out as it is sung | Works; not needed by any preset |
| One Dialogue per word | Each event shows the whole page, the active word wrapped as `{\1c&H0000E6FF&}WORD{\r}` | Only the active word is highlighted, the rest stays white | **The default** for every "only the current word" style |
| `\t` colour transforms in one Dialogue per page | `{\r\t(a,a+1,\1c YELLOW)\t(b,b+1,\1c WHITE)}WORD ` per word, times in ms from the event start | Works, once each word block starts with `\r` | Not needed: no better than per-word events |

**The trap in the `\t` method.** Without `\r` at the start of each word block, a `\t` from an earlier block still applies to the later words, so all three words turned yellow at 0.18 s (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). Always reset with `\r` when using `\t`.

**Pop entrance.** Page: `{\fscx60\fscy60\t(0,110,\fscx100\fscy100)}` at the start of the text, pops from 60 percent to full size in 110 ms about the centre. Active word: `{\1c&H0000E6FF&\fscx118\fscy118\t(0,90,\fscx100\fscy100)}WORD{\r}`. Both render. Scaling a word changes the line width for the 90 ms of the pop (the line re-centres); acceptable for a pop, so a style that must not move uses colour only.

**Box behind the active word.** Style `BorderStyle=3` (opaque box, padding equals `Outline`), then per word `{\3a&H00&\3c&H00D2A04F&\1c&H00FFFFFF&}WORD{\3a&HFF&}` and a `{\3a&HFF&}` at the start so the other words have a fully transparent box. The box sits behind only the active word and moves word to word (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). Caveat: the box has square corners and no radius. A rounded box needs a `\p1` vector drawing sized from a measured word width (section 14.3).

**Reveal (words appear as spoken and stay).** One Dialogue per word whose text is the page with the not-yet-spoken words made invisible: `SO{\alpha&HFF&} TODAY WE`. `\alpha&HFF&` hides fill and outline, so the line keeps its final layout and nothing shifts (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). Do not use a `\k` with a transparent `SecondaryColour` for this: the outline of unspoken words would still draw.

**Slide up.** `{\an2\move(540,1400,540,1382,0,200)}` moved the text into place (frame at the start sat lower than the others). Works; not measured further.

**Letter case.** ASS has no case attribute. The writer upper-cases (or sentence-cases) the text itself and skips the transform for scripts without case.

### 2.2 Timing

| Fact | Evidence |
|---|---|
| An event is drawn on a frame when `start <= frame time < end`, in centiseconds | Events 1.00 to 1.10, 1.50 to 1.52 and 2.01 to 2.04 on a 30 fps full-frame white block: bright frames were 30, 31, 32 (t 1.000 to 1.067), 45 (1.500) and 61 (2.033) and no others (`signalstats` per frame, verified on FFmpeg 9.0.2 gyan full build, 2026-11-17) |
| Time resolution is 10 ms | ASS stores `H:MM:SS.cc`; at 30 fps (33.3 ms a frame) a boundary can land one frame early or late at worst |
| `\k` durations are whole centiseconds | Round each word's **absolute** start to the centisecond, then take differences, so the error never accumulates over a page |

### 2.3 Layout, Safe Area And Wrapping

- Position: `Alignment 2` (bottom centre, grows upward), `MarginV` = 1920 minus the caption block's bottom edge. Design default bottom edge at 72 percent of the height: y 1382, `MarginV 538`. Per-page `MarginL` and `MarginR` set the wrap width.
- libass wraps at the frame width minus the margins even with `\pos` (a 90 px line wrapped at 1080 minus 120 px; with event margins 200 and 200 it wrapped at 680 px). `WrapStyle: 0` balances the lines (smart wrapping); `{\q2}` or `WrapStyle: 2` turns wrapping **off** and long Tamil and English lines ran past the frame edge (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). Never emit `\q2` for a page that can be long.
- The writer must still choose the page size so a page is at most two lines: it estimates width with a pure width function (section 14.3), not by asking FFmpeg.

### 2.4 Cost: Events And Speed

| Case (60 s, 1080x1920, flat background, `-f null`) | CPU seconds (`utime`) | Wall seconds (shared machine) |
|---|---|---|
| Empty ASS file | 2.8 | 3.9 |
| 3 pages only | 3.8 | 4.7 |
| `\k`, 56 pages of 3 words | 17.9 to 18.6 | 26 to 31 |
| `\kf`, 56 pages | 17.9 | 30 |
| One Dialogue per word, 166 events (3 word pages) | 18.7 to 18.8 | 26 to 28 |
| One word per page, 166 events | 8.7 to 9.3 | 15 to 17 |
| `\k` 56 pages at 540x960 | 5.9 | 7.5 |
| `\k` with and without the pop | 18.3 versus 18.5 | the same |

Reading: libass keeps up with 166 events a minute (and 600 would be the same order); the cost follows the pixels drawn and the glyphs on screen, not the event count, and the pop makes no difference. A caption burn at 1080x1920 costs about 0.3 CPU seconds for each second of video and runs on one thread of the filter graph, so it adds roughly 12 s of wall time to a 60 s export on this machine (flat source, veryfast: 24.9 s without, 37.3 s with, both shared-machine times). A 540x960 draw is about a third of that. All verified on FFmpeg 9.0.2 gyan full build, 2026-11-17.

### 2.5 Recipe: The Caption File And The Filter

```
[Script Info]
ScriptType: v4.00+
PlayResX: 1080          <- the OUTPUT size of this render, so one file works at 360p and 1080p
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,<family>,<size px>,<fill>,<fill>,<outline colour>,<shadow colour>,<bold -1|0>,<italic>,0,0,100,100,<spacing>,0,<1 or 3>,<outline px>,<shadow px>,2,<marginL>,<marginR>,<marginV>,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:01.36,Cap,,0,0,0,,{\1c&H0000E6FF&}SO{\r} TODAY WE      <- one event per word
```

Filter (last stage of the picture chain, after crop, scale and overlays so it draws at the output size): `...,ass=cap.ass:fontsdir=fonts,format=yuv420p`. The `ass` filter is the same renderer as `subtitles`; `ass` takes an ASS file directly. Colours are `&HAABBGGRR&` (blue, green, red order, alpha first); alpha `00` is opaque.

**Evidence**: verified on FFmpeg 9.0.2 gyan full build, 2026-11-17: karaoke, per-word, box, pop and reveal frames extracted and checked; 56 and 166 event files rendered over 60 s without error.

## 3. Experiment 2: Tamil And Hindi Captions

Fonts: Windows Nirmala UI (`Nirmala.ttc`, which holds Regular, Bold and Semilight, Tamil and Devanagari together) copied into `fontsdir`. Style `Nirmala UI` 100 px bold.

| Test | Result |
|---|---|
| Tamil conjuncts and signs: நன்றி, வணக்கம், ஸ்ரீ, க்ஷ, பிரச்சினை, கொடுக்கும், கௌரவம், கிராமம், தமிழ்நாடு | All shaped correctly (pulli forms, split vowel signs ொ and ௌ, the ஸ்ரீ and க்ஷ conjuncts) |
| Hindi: श्रीमान्, क्षत्रिय, द्वारा, हिन्दी, विद्यार्थी, ज्ञान, कर्म, प्रेम | All shaped correctly (reph, pre-base matra ि, conjuncts) |
| `\k` karaoke over three Tamil words | Words switch colour at word boundaries and each word stays whole |
| Colour change **inside** a Tamil word at a vowel sign: `க{\1c red}ொ{\1c yellow}டுக்கும்` | **Broken**: the sign ொ is drawn as a dotted circle placeholder, not attached to க |
| Colour change inside a Tamil word at a cluster edge: `நன்{red}றி`, `ஸ்{red}ரீ` | Drawn fine, the cluster `ன்` was complete on its side |
| Colour change inside Hindi at complete cluster edges: `क्ष{red}त्रि{yellow}य`, `वि{red}द्या{yellow}र्थी` | Drawn fine |
| Colour change that splits a Hindi cluster: `क{red}्{yellow}ष`, `प्र{red}े{yellow}म`, `हि{red}न्{yellow}दी` | **Broken**: dotted circles appear |

Verified on FFmpeg 9.0.2 gyan full build, 2026-11-17 (libass 0.17.5, HarfBuzz 14.4.0 COMPLEX).

**What it means.** HarfBuzz shapes one run of identical style at a time. Any override that changes the style inside a word (colour, scale, alpha) ends the run, so a cluster split by it loses its shaping. The rule for the writer: **a style change may happen only at a word boundary (a space), never inside a word.** Highlighting is by whole word, so this holds for every preset in the catalogue. Per-letter animation (type-on by letter) is **not allowed** for Tamil, Hindi and every script that is not Latin; if a style needs letters, it is reduced to a word reveal for those scripts.

**Page-level fallback.** Tamil word times are looser (research 06 section 2.5, WhisperX has no Tamil alignment model). For a transcript whose script is Tamil, or a translation (synthetic times), the writer emits one Dialogue per **page** with no inner highlight (or `\kf` over the whole page), so a few hundredths of a second of drift cannot be seen. The same fallback applies if a word contains a combining mark that the font lacks.

**Text width.** Tamil lines are wide: at 90 px the sample `நன்றி வணக்கம் தமிழ்நாடு பிரச்சினை கொடுக்கும் கௌரவம்` wrapped onto three lines inside 960 px (WrapStyle 0, 60 px margins). The width function (section 14.3) must carry a script factor (about 1.0 for Latin capitals in a bold sans, 1.3 or more for Tamil at the same size, measured in this run by eye, to be tuned from real shaping widths).

**Linux fonts.** The image ships Noto Sans Tamil and Noto Sans Devanagari (OFL) and the writer names them in `\fn`. Not run here; reported.

## 4. Experiment 3: Mixed Scripts And An Emoji

| Line | Result |
|---|---|
| `Hello தமிழ் हिंदी abc 😀 ok` in style `Nirmala UI` | One line, all three scripts correct; Latin drawn in Nirmala's own Latin glyphs |
| Same text in style `Arial` | Arial for Latin; the Tamil and Hindi glyphs came from a **silent fallback** (`fontselect: (Arial, 700, 0) -> NirmalaUI-Bold`), correct shapes |
| `{\fnSegoe UI Emoji}😀🎉` inside a Nirmala line | The emoji draws, but **monochrome**: a flat glyph in the text colour with the outline, not the colour emoji |
| Style `Arial`, Tamil text | Shapes correct because of the fallback; not guaranteed on Linux, where the fallback font is whatever fontconfig finds |

Verified on FFmpeg 9.0.2 gyan full build, 2026-11-17.

Decisions: (1) the writer sets `\fn` per script run explicitly (Latin run in the style font, Tamil in the Tamil font, Devanagari in the Devanagari font), never relying on fallback; this adds style changes only at word boundaries, so shaping is safe. (2) libass does not paint colour emoji. A colour emoji in a caption is a PNG sticker overlay placed from the word's time and position (Sprint 12's sticker path), not text. The writer strips emoji from the caption text and records them as overlay items. P1.

## 5. Experiment 4: Bleeps And Mutes

Source: a 300 Hz tone (AAC) with three ranges: 1.000 to 1.500, 2.2503 to 2.6007 and 4.000 to 4.050. Tones were found by a Goertzel probe in 5 ms windows (the alignment figures are good to about 5 ms).

| Approach | Mute edges | Verdict |
|---|---|---|
| `volume='if(GATE,0,1)':eval=frame` on the decoded frames | Mute ended at 1.515 to 1.520 instead of 1.500: the edge snaps to the audio frame (1024 samples, about 21 ms) | Late by one frame. **Do not use alone** |
| Same with `asetnsamples=n=48:p=0` first (1 ms frames) | Edges at 1.500, 2.250, 4.000 within the probe's resolution | Works |
| `aeval='val(0)*(1-(GATE))':c=same` | Edges at 1.500, 2.250 to 2.260, 4.000 to 4.050, tone gate matching | **Pick**: sample accurate, 2.8 CPU seconds for a 60 s track |
| Tone: one `aevalsrc='0.5*sin(2*PI*1000*t)*(GATE)':s=48000:d=DUR` | 1 kHz present exactly in the three ranges | **Pick**: one source for any number of ranges |
| Tone: `sine` + `adelay` per range + `amix` | 1 kHz at 1.000 to 1.500, 2.250 to 2.600, 4.000 to 4.050 | Works, needs one source per range |
| Several ranges in one graph | `GATE = between(t,1,1.5)+between(t,2.2503,2.6007)+between(t,4,4.05)` | Works; the expression grows by about 20 characters a range |

Click check: a hard mute of a 300 Hz tone gave a sample step of 0.097, about 25 times the tone's own largest step (0.0039). A 5 ms ramp at each edge gave 0.0039, the same as the unmuted tone (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). So **ramp every mute edge by 5 ms**: gain `1-clip((t-a)/0.005,0,1)*clip((b+0.005-t)/0.005,0,1)` per range.

Recipe (applied on the OUTPUT timeline after the audio is joined, so `t` is output time):

```
[mix]aeval='val(0)*(1-(R1+R2+R3))':c=same[muted];
aevalsrc='0.35*sin(2*PI*1000*t)*(G1+G2+G3)':s=48000:d=<clip seconds>[tone];
[muted][tone]amix=inputs=2:normalize=0:duration=first[withbleeps]
```

where `Gn = between(t,a,b)` and `Rn = clip((t-a)/0.005,0,1)*clip((b+0.005-t)/0.005,0,1)`. For `mode: 'mute'` omit the tone. With stereo audio keep `c=same` so both channels get the gain.

Evidence: verified on FFmpeg 9.0.2 gyan full build, 2026-11-17.

**Caveat on `t`.** In `aeval` and `aevalsrc` `t` is the sample time of that stream. If the gate is applied before the segments are joined, `t` restarts per segment after `asetpts=PTS-STARTPTS`. The compiler maps bleeps to output time and applies the gate **after** `concat` and after any speed change.

## 6. Experiment 5: Many Cuts

Forty segments of 1.0 s taken from a 62 s file with 0.5 s gaps (the shape of speech cleanup), output 40.000 s.

| Approach | Graph size | Duration out | Frames | CPU s / wall s (shared) |
|---|---|---|---|---|
| One input, `split`/`asplit`, per-segment `trim` and `atrim`, `concat` | 7.3 KB | 40.000 s video and audio | 1200 | 220 / 44 |
| 40 inputs each `-ss a -t d -i`, `setpts`, `concat` | 5.0 KB | 40.000 s | 1200 | 239 / 55 |
| `select`/`aselect` with one `between()` sum | 1.7 KB | **41.17 s** video, 40.02 s audio | **1235** | 238 / 49 |
| 40 intermediate files (`-ss -t`, re-encode) then `concat` demuxer `-c copy` | 40 encodes | 40.02 s (audio gains one AAC priming frame) | 1200 | 64 s of encoding plus 2 s of copying |
| 150 segments of 0.3 s, one input, `trim` graph | 31.4 KB | 45.000 s | n/a | 120 / 13.4 (ultrafast) |

Verified on FFmpeg 9.0.2 gyan full build, 2026-11-17.

Findings:
- **Use the `trim` plus `concat` graph.** It is frame exact; `select` keeps the boundary frame of each range (`between` is inclusive on both ends) and so adds 35 frames and 1.2 s; it cannot be made exact without more work. Graph size is about 190 to 210 bytes a segment: 150 segments fit in 31 KB, far beyond a command line but fine in a file.
- **Where it decodes from.** `trim` does not seek: it reads the file from the start of the input. A single second at 55 s of a 62 s file cost 49 CPU seconds (6.2 s wall) through `trim` and 1.2 CPU seconds (0.4 s wall) through `-ss 55 -t 1 -i` input seeking. The compiler therefore groups segments of one source into **runs** (segments closer than about 20 s apart), opens each run as its own input with `-ss <run start minus 2 s> -t <run length>`, and writes the `trim` times relative to that input. A clip drawn from the first minute of a three hour stream decodes a minute; one drawn from hour two does not decode the first hour.
- **Intermediate files cost more** (64 s against 44 s here, one more generation of loss, and each AAC file adds a priming frame). Not used.
- **Memory**: the 40 segment graph peaked well below the 820 MB seen for the 1080x1920 caption render (`maxrss`); not tracked separately.
- **Click-free joins.** A 300 Hz tone cut and joined: without fades the largest sample step at a join was 0.099 (25 times normal). With `afade=t=in:d=0.015` and `afade=t=out:st=<d-0.015>:d=0.015` per segment it was 0.0039 (the tone's own); 5 ms and 30 ms fades gave the same (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). Use **15 ms** (research 06 asked for 10 to 30 ms).

Recipe (per segment `i` of run `r`, times relative to the run input):

```
[r:v]trim=start=A:end=B,setpts=PTS-STARTPTS[v_i];
[r:a]atrim=start=A:end=B,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=<B-A-0.015>:d=0.015[a_i];
... [v_0][a_0][v_1][a_1]...concat=n=N:v=1:a=1[outv][outa]
```

When a run has several segments, put `split=K` and `asplit=K` on that input's `[r:v]` and `[r:a]` first. Picture cuts stay hard.

## 7. Experiment 6: The Hook Clip

The same source range used twice: `split` and `asplit` once, hook range 10.0 to 13.0 first, then the main part 5.0 to 20.0, which contains the hook range again.

```
[0:v]split=2[hv][mv];[0:a]asplit=2[ha][ma];
[hv]trim=start=10:end=13,setpts=PTS-STARTPTS[v0];
[ha]atrim=start=10:end=13,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=2.985:d=0.015[a0];
[mv]trim=start=5:end=20,setpts=PTS-STARTPTS[v1];
[ma]atrim=start=5:end=20,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=14.985:d=0.015[a1];
[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]
```

Output 18.000 s. Frames checked against a burned-in source time: output 1.0 s showed source 11.0 (hook), 3.5 s showed 5.5 (start of the main part), 8.0 s showed 10.0 (the hook range again), 13.0 s showed 15.0 (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17; the stamp was offset by 1 s in that run and corrected for in the reading). CPU cost 16.6 s for 18 s of 540x960. The word mapping in research 06 section 3.2 already loops over segments, so captions appear twice. The compiler needs nothing special: a hook is a segment with `role: 'hook'`. If the same source is read by many reused ranges, put them all in one run.

## 8. Experiment 7: Montage

Two different sources (540x960 and 960x540), a title card, per-segment layouts, output 1080x1920 at 30 fps.

- **Per-segment chains then `concat`**: each segment ends in the same size, SAR 1, 30 fps, yuv420p, and audio `aformat=sample_rates=48000:channel_layouts=stereo`. Segment 1: fill (`scale=1080:1920`). Segment 2 (the landscape one): the blurred fit (`split`, background `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=30`, foreground `scale=1080:-2`, `overlay=(W-w)/2:(H-h)/2`). Title card: `color=c=0x101820:s=1080x1920:r=30:d=2,ass=title.ass:fontsdir=fonts` with `anullsrc=r=48000:cl=stereo,atrim=duration=2` for sound. Output 8.000 s (2+3+3). Frames checked: title at 1.0 s, A 3.0 at 3.0 s, B 5.5 at 6.5 s.
- **Fade join**: `xfade=transition=fade:duration=0.3:offset=<sum of earlier durations minus earlier fades>` chained, with `acrossfade=d=0.3:c1=tri:c2=tri` chained in the same order. Output 7.400 s for video and audio (8.0 minus 2 times 0.3). Frames at 1.85 s and 4.55 s showed the two pictures mixed (title over A, A over B).
- **Rules learned**: both `xfade` inputs must have the same size, frame rate, pixel format and SAR (the `fps=30`, `setsar=1` and `format=yuv420p` at the end of every chain do it); the offset is in the output of the previous join, so it must be computed, not written by hand; audio formats must match for `acrossfade`.
- **Cost**: 31.8 CPU seconds for the hard-cut montage and 49.4 for the xfade version (8 s of 1080x1920 output).
- A fade join shortens the clip by 0.3 s, which shifts every later caption, bleep and sticker by 0.3 s per earlier join: `frameState`'s output-time map must include the fade overlap (a montage with fades has `sum(durations) - 0.3 x joins` seconds).

Verified on FFmpeg 9.0.2 gyan full build, 2026-11-17.

## 9. Experiment 8: Follow The Speaker Crop

Test source: a 1920x1080 horizontal grey ramp, 60 s, so that the mean brightness of a 608x1080 crop gives its x position (the error of that estimate is about 5 px, shown as a constant 4.7 px in every row below). Crop 608x1080 (9:16 of 1080).

| Method | 60 keyframes | 120 keyframes | 480 keyframes | Notes |
|---|---|---|---|---|
| `crop=x='<sum of clipped ramps>'`, a flat chain of `+dx*clip((t-t0)/dt,0,1)` (pans) | Works (1.7 KB) | **Fails**: `Failed to configure input pad`, `Invalid argument` | n/a | The expression parser rejects a chain of about 95 or more nested terms (80 and 90 terms passed, 98 and above failed) |
| Nested `if(lt(t,t1),a,if(...))` (pans) | Works (2.6 KB) | **Fails** (5.2 KB) | n/a | Same depth limit |
| Flat sum of `dx*gte(t,ti)` (jump cuts) | Works | **Fails** | n/a | Same |
| **Balanced** `if(lt(t,tm),<left>,<right>)` binary search (pans) | Works | Works (5.4 KB) | Works (21.8 KB) | Depth is log2 of the keys |
| **Balanced** sum of clipped ramps (pans) | Works | Works (4.1 KB) | Works (16.6 KB) | |
| **Balanced** sum of steps (jump cuts) | Works | Works (2.6 KB) | Works (10.3 KB) | |
| `sendcmd=f=cmds.txt` with constant `T crop x N;` lines (jump cuts only) | Works | Works (2.3 KB file) | Works | Constant commands only; with a linear expression per interval it pans (Sprint 12 cookbook section 5) |

Position error against the intended path was 4.6 to 4.8 px mean, 5.3 to 5.9 px maximum for every working method, which is the luma estimate's own bias, so every method puts the crop where it should within a pixel or two (frames compared per frame, 1800 frames each; verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). Fractional `x` is truncated to whole pixels: a pan moves in one pixel steps, which is invisible at 1080 px.

Speed: 70 to 78 CPU seconds for 60 s of 1080p decode plus the crop and `signalstats`; a plain fixed crop of the same file was 14 to 15, so the signal analysis and not the expression dominated (the expression is evaluated once a frame; 480 keys cost about the same as 60). Wall time 20 to 24 s on the shared machine.

**Which is used (reconciled 2026-11-17).** Sprint 12's cookbook ([research 09](../../sprint-12/research/09-ffmpeg-render-cookbook.md) section 5) verified `sendcmd` with one linear expression per interval (exact to half a pixel at 600 keyframes, and it pans), and the compiler is shared, so **`sendcmd` is the one method**. The row above that says `sendcmd` "cannot pan" tested only constant commands per key; a linear expression per interval does pan. The balanced `if` (pans) and balanced step expression (jumps) in this table are the documented **fallback**: no extra filter, work with `-/filter_complex`, survive 480 keys. A flat chain must never be emitted (fails at about 95 terms). Sub-segment cropping (short pieces, each with a constant `crop`) misaligns at the joins and is not used.

**The time variable.** The crop sits after `trim` and before `setpts`, so `t` is the source time and the keys are written as they are in the document. (Only the fallback, which would sit after `setpts=PTS-STARTPTS`, needs the segment-relative conversion `(t_key - segment start) / speed`.) Output size is a fixed `w`, `h`; only `x` and `y` move.

**Pans or cuts.** The keyframe list carries `ease: 'linear' | 'hold'`. `hold` between two keys is a constant interval, `linear` is a ramp interval; one command file per area handles mixed lists.

## 10. Experiment 9: Fonts Of A Generated ASS

| Fact | Evidence |
|---|---|
| `fontsdir=fonts` loads every file in the folder, including a `.ttc` (`Loading font file '../fonts\Nirmala.ttc'`) | `-loglevel verbose` log |
| A font that is not found falls back **silently**: style `Totally Missing Font` rendered in Arial and style `Anton` (not installed) in Arial | The frame shows Arial; the only trace is the log line `fontselect: (Totally Missing Font, 400, 0) -> ArialMT, 0, ArialMT` |
| The `fontselect:` lines are printed at `-loglevel info` (the default) and at verbose, not at `warning` | 4 lines at info |
| A font that is found: `fontselect: (Impact, 400, 0) -> Impact, 0, Impact`; bold Arial: `(Arial, 700, 100) -> Arial-BoldMT` | log |
| A glyph missing from the chosen font prints **nothing**; only a second `fontselect` line for the same family appears (`(Arial, 700, 0) -> NirmalaUI-Bold` for Tamil text) | log |

Verified on FFmpeg 9.0.2 gyan full build, 2026-11-17.

How to detect a silent fallback: the worker runs FFmpeg at `-loglevel info` (it already needs it for `-progress`), keeps the `fontselect:` lines, and the compiler compares each `(requested family, weight, italic) -> selected PostScript name` with an expected PostScript name taken from the Studio font manifest (family to PostScript names, written when the font files were added). A selected name that is not in the expected set means the family was not found, and the render **fails with `font_missing`** naming the family, instead of delivering captions in the wrong font. The extra selection for a script run is allowed only if its PostScript name is in the manifest's fallback list for that script. Do the same check once before the job: list the manifest against the files in `fontsdir`.

Also: ASS family names must equal the font's family name table entry, not the file name; keep the manifest generated from the files, not by hand. In the Debian image, fontconfig sees only the system folders plus `fontsdir`; keep the image's own fonts limited to ours so a fallback can only land on a known file. Reported, not run.

## 11. Experiment 10: Speech Cleanup Fades

Covered by sections 6 and 5: the picture stays a hard cut (a plain `concat` of `trim` segments, no filter on the picture at the join), the audio gets 15 ms `afade` in and out at every join of two segments **of the same source that were adjacent in time** and at every join of different sources. Do not fade at a join the user did not create (the start of the clip and the end get no fade unless the clip fades itself). Unfaded joins clicked (step 25 times normal); faded joins did not (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17). Frame counts were exact (1200 for 40 segments of 30 frames each).

A kept piece shorter than 30 ms cannot hold two 15 ms fades: the compiler clamps the fade to a third of the piece (research 06 keeps no piece under 0.25 s).

## 12. Experiment 11: Emote Maker

Source: a 3 s 1080x1920 clip. Crop a 700x700 square, `fps` to 20 or 10, scale with `flags=lanczos`.

```
crop=700:700:X:Y,fps=20,scale=112:112:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle   (GIF, -loop 0)
crop=...,fps=20,scale=112:112:flags=lanczos  -c:v libwebp_anim -lossless 0 -quality 80 -loop 0                                    (animated WebP)
crop=...,fps=20,scale=112:112:flags=lanczos  -plays 0 -f apng                                                                       (APNG)
```

| Size | Frames | GIF | Animated WebP | APNG |
|---|---|---|---|---|
| 112 px, 20 fps, 3 s | 60 | 76 KB | 56 KB | 217 KB |
| 112 px, 10 fps | 30 | 42 KB | 28 KB | 109 KB |
| 56 px, 20 fps | 60 | 28 KB | 30 KB | 84 KB |
| 28 px, 20 fps | 60 | 12 KB | 12 KB | 34 KB |

All three formats were written and read back with 60 frames at 20 fps (`ffprobe -count_frames`). A round emote with transparent corners (`format=rgba,geq=...a='if(lte(hypot(X-56,Y-56),56),255,0)'`) worked in all three: GIF with `palettegen=reserve_transparent=1` and `paletteuse=alpha_threshold=128` (148 KB with dither), animated WebP (58 KB), APNG (268 KB, corner alpha 0). Verified on FFmpeg 9.0.2 gyan full build, 2026-11-17. The source is a high-contrast test pattern, so real footage will be larger: the Emote Maker must measure each file and lower the frame rate, colours or dither until it fits.

**Platform limits.** The pages for the numbers were read on 2026-11-17 as far as they could be:

| Platform | Sizes and formats | File and frame limits | Status |
|---|---|---|---|
| Twitch | 28x28, 56x56 and 112x112; static PNG or animated GIF; animated emotes square | 1 MB a file and 60 frames at most. Third-party guides disagree on the size: Elgato's page says 512 KB a size, an older guide 25 KB | **Reported.** Twitch's own help page could not be opened (the addresses tried returned 404). Figures are from search results of 2026-11-17 (Elgato's emote guide, makeemoji.com and others). The module must read the live Twitch page before it hard-codes a limit; until then it caps each file at 512 KB and warns above 25 KB |
| 7TV | PNG, APNG, WEBP, WEBM or GIF; up to 1000x1000 px (resized automatically) | 7 MB a file; animated up to 1,000 frames, as GIF or WEBM | **Verified** on help.7tv.app/en/articles/11069712-how-to-upload-an-emote-to-7tv, read 2026-11-17. The page does not name animated WebP among animated formats (another source says it is used); export GIF and treat WebP as an extra |
| BetterTTV | not stated on any readable page | one third-party guide recommends under 1 MB for animated emotes | **Reported.** betterttv.com's upload and FAQ pages return only a script shell with no readable text on 2026-11-17 |

The 60 frame Twitch cap means a 3 s emote must be at most 20 fps (60 frames) and a 30 fps emote at most 2 s. The module caps `frames = fps x seconds` at 60 whatever the platform and warns above it. Exports: GIF for all three platforms (the one format all accept), plus PNG for a still, plus WebP and APNG as extras, all from one crop.

## 13. Render Speed Observations

Sprint 12's cookbook was not available, so these are this run's numbers (shared 12 logical processor desktop; synthetic noisy source; `libx264 -preset veryfast -crf 23`, AAC 128 kbps):

| Job | CPU s / wall s |
|---|---|
| 60 s landscape to 1080x1920: balanced crop expression (120 keys), bicubic scale, 166 word captions, `aresample` | 481 / 57 (1.05 times real time), peak memory 820 MB |
| Same with single pass `loudnorm=I=-14:TP=-1.5:LRA=11` on the audio | wall 112 s on the first run (machine busy); the audio filter alone costs 5.4 CPU s per 60 s |
| Same at 360x640, `ultrafast -crf 28`, with captions (the Preview Export shape) | 102 / 26 (2.3 times real time) |
| 40 segment cleanup, 40 s output, 1080x1920 | 220 / 44 |

These are worst case figures: `testsrc2` is a high-entropy picture that x264 finds hard, and the machine was shared. A talking head at 1080p is typically several times cheaper to encode, but no figure from real footage was measured. The benchmark in Sprint 12 Module 05 remains the authority for cost lines. For planning, eight CPU seconds for each output second at 1080x1920 veryfast is the measured ceiling here; captions add about 0.3 CPU seconds a second (section 2.4).

## 14. What The Compiler And The Caption Writer Must Do

### 14.1 The Compiler (`compileFfmpeg`)

1. Write the filter graph to `graph.txt` and pass `-/filter_complex graph.txt`. Never use `-filter_complex_script` (removed in 9.0.2). Run with the job folder as the working directory and relative file names.
2. Group each source's segments into runs and open each run with `-ss <start-2> -t <length> -i`. Write `trim` and `atrim` times relative to the run input. Use `split`/`asplit` only to feed several segments from one run input.
3. Per segment: `trim`, `setpts=PTS-STARTPTS`, the layout chain, then normalise to one size, SAR 1, fps, yuv420p; audio: `atrim`, `asetpts`, `aformat=sample_rates=48000:channel_layouts=stereo`, 15 ms fades at joins, `atempo` chain for speed. Join with `concat`, or `xfade`/`acrossfade` for Fade joins with computed offsets.
4. Apply `ass=<file>:fontsdir=fonts` last in the picture chain; put title, text and caption events for the whole output in one ASS file (`buildAss`), one `Style` per distinct look.
5. Bleeps and mutes: `aeval` gate with 5 ms ramps and an `aevalsrc` tone, on the output timeline after concat and speed.
6. Follow The Speaker: the same `sendcmd` command file as every crop (one linear expression per interval, key times in source time, a constant last line); never a flat chain.
7. Run at `-loglevel info`, collect the `fontselect:` lines, fail with `font_missing` on an unexpected family; surface `-progress pipe:1` as progress.
8. Compute the output duration from the plan (segments, speeds, fade overlaps) and fail the job when the file's duration differs by more than one frame.

### 14.2 The Caption Writer (`buildAss`)

1. One ASS file per render, `PlayRes` equal to the output size. Page text is built from the words in output time (research 06 section 3.2).
2. Highlight styles: one Dialogue per word for an active word, colour, scale or box; `\k` or `\kf` per page for fill and sweep; reveal with `\alpha&HFF&`; no inner highlight for page-level styles. Round absolute times to centiseconds, never durations.
3. **Style changes only at word boundaries**; no per-letter animation for non-Latin text; per-script `\fn` runs; strip emoji into sticker overlays.
4. `\q0`, margins from the safe area, bottom anchored; page size from the width function; never `\q2` on long pages.
5. Entrances: `\fscx/\fscy` with `\t`, `\fad`, `\move`, as the style says. Upper case done by the writer.
6. Tamil and translated captions default to page-level highlight.

### 14.3 The Text Width Function

A pure function in `packages/video-engine` replaces `@remotion/layout-utils`: sum of glyph advances from a font metrics table (generated at build time from the shipped font files, one table per font), times a script factor, plus `letterSpacing` and the outline. It is used only to choose page breaks and sizes, so it may be a few percent off; libass does the final wrap. **Not run**: the metrics generator and a comparison of its widths against libass output were not built in this spike; the Latin result is expected to be close, the Tamil and Devanagari figures will need tuning because advances do not capture shaping. Until that exists the writer may keep Tamil and Hindi pages one or two words shorter than Latin pages. Rounded boxes behind words (`\p1` drawings) also need this function.

## 15. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Font family not found or fallback to a wrong font | Captions in an unexpected typeface or missing glyphs | Compare the `fontselect:` log with the font manifest, fail with `font_missing`; ship only our fonts in the image |
| A style change inside a Tamil or Hindi word | Broken glyphs (dotted circles) | The writer changes style only at spaces; a test renders every style on a Tamil and a Hindi sample |
| `-filter_complex_script` used from old notes | Every render fails on 9.0.2 | `-/filter_complex`; a compiler test runs the real binary on a tiny graph |
| A flat chain of more than about 90 terms in an expression | `Invalid argument` at filter start | Generate `sendcmd` intervals (fallback: the balanced form); a test with 480 keys |
| `trim` reading a long source from its start | A clip from hour two of a stream decodes an hour | Per-run `-ss` inputs |
| Mute edges and tones off by one audio frame | Bleep late by about 20 ms | `aeval` per sample, not `volume eval=frame` alone |
| Caption burn adds about 12 s of wall time to a 60 s export | Slower exports on small boxes | Counted in cost lines; draws at output size; Preview Export is 360p where it costs a third |
| libass fontconfig path on Debian untested | Different fallback behaviour | Module 02 of Sprint 12 runs the caption fixture inside the real image and compares frames |
| Colour emoji drawn monochrome | Wrong look | Emoji become sticker overlays |
| Twitch and BetterTTV emote limits only reported | Rejected uploads | Read the live pages in the module; cap at the strictest figure; show the file size before download |
| Crop expression truncates to whole pixels | None visible at 1080 px | Accepted |
| Intermediate-file or `select` cut methods used by mistake | Extra frames, drift, clicks | Recipe fixed in the compiler; frame-count assertion on every render |

## 16. What Was Not Run

- The fontconfig path (Linux) and any Linux font fallback.
- Right-to-left text (Arabic, Hebrew) through FriBidi; research 06 keeps its rule (logical order, no array reversal) as reported.
- Rounded caption boxes with `\p1`, and the text width function.
- `\fad` on captions beyond the title card (the title card showed at full opacity at 1.0 s; the fade itself was not measured).
- Transparent overlays of APNG stickers (Sprint 12's cookbook).
- Real talking-head footage speed and a Debian render benchmark.
- Twitch's own help page and BetterTTV's pages (unreadable on 2026-11-17).
