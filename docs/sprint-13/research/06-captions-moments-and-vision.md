# Sprint 13 Research: Captions, Moments And Vision

> **Written**: 2026-11-14. Facts marked **verified** were read on that day from the page or file named beside them. Facts marked **reported** come from memory, secondary pages or a reference repository's own notes and must be confirmed by the module that uses them. Repository files are cited by their path; the full reads are in [03-open-source-reference-repos.md](03-open-source-reference-repos.md).
> **Scope**: the design research behind Modules 03 to 09 of Sprint 13. Transcription itself is in `04-transcription.md`, the Python service in `05-python-media-service.md`.
> **Rule**: the reference products (StreamLadder, OpusClip) are described from the local screenshots only. Nothing is copied from them; every preset below is our own design.

## 1. Summary

| Area | Pick | Why |
|---|---|---|
| Caption drawing, paging, fitting | FFmpeg's `ass` filter (libass with HarfBuzz) fed by an ASS file from `buildAss`; our own pure pager and text width function; `CaptionWord` as the one data shape | One text pipeline for titles and captions, no browser in the render; Tamil and Hindi shape correctly (verified 2026-11-17, see 09) |
| Where captions are stored | Source time, as a transcript asset plus a captions track | Survives trim, split, delete-middle, speed and a hook clip with no rewrite |
| Moment finding | Two passes over sentence-aligned windows, answers as word indexes, a rubric score | The pattern the two largest open clippers converged on |
| Speech cleanup | Silero VAD spans gated by loudness, cuts as segments | No new render path: a cleaned clip is just more segments |
| Faces | MediaPipe Face Detector (Tasks API, BlazeFace short-range) at 5 fps, our own track matching | Apache-2.0, CPU, Python and JavaScript |
| Who is speaking, and the camera path | Heuristics first (size, mouth movement gated by audio); then a dead zone, jump confirmation, a speed cap, a snap on scene cuts and keyframe reduction | Dedicated models need a GPU and carry dataset questions; the output is the plan's crop keyframes in source time |
| Visual moments | Frame difference, optical flow, cut density, agreement with loudness; a vision check on the top few | Cheap first, paid only where it changes the answer |
| Text to speech | A provider interface: hosted first, Kokoro (Apache-2.0) as the self-hosted binding | Piper is GPL-3.0 today |

## 2. Captions Through ASS And FFmpeg

> **Revised 2026-11-17.** The render engine is FFmpeg only. This section replaced an earlier browser rendered design. Every recipe, number and caveat is in [`09-ass-captions-and-edit-cookbook.md`](09-ass-captions-and-edit-cookbook.md) (verified on FFmpeg 9.0.2 gyan full build, 2026-11-17); this section keeps the design decisions and the style catalogue.

### 2.1 The Pipeline

Captions are drawn by FFmpeg's `ass` filter (libass 0.17.5 with HarfBuzz shaping and FriBidi) from an ASS subtitle file the render writes. Text items from Sprint 12 and captions from Sprint 13 use one writer, `buildAss`, in `packages/video-engine/src/render`. There is no browser in the render, so no web font loading, no `fitText` and no component library: the data type is our own `CaptionWord` (`{ text, startMs, endMs, confidence, pageBreakAfter? }` in output time) and the pages are built by our own pure pager.

The editor's preview draws the same pages with DOM text and the `frameState` function; the export is what libass draws. The two can differ by a pixel or two of letter spacing and by the pop and box animations, which is why the export panel offers Preview Export (Sprint 12 Module 15).

### 2.2 From Word Timings To Pages And Highlight

Our pager (pure, in `packages/video-engine`, replacing `createTikTokStyleCaptions`) does the same four things the open examples do (the docs-style recipe and the clippers, read 2026-11-14):

1. Take `CaptionWord[]` in output time.
2. Break pages by word count (`maxWords`), characters (`maxChars`), a pause longer than `maxGapMs`, a sentence end, and always at a segment boundary. The open clippers use the same limits: 3 words and a 0.6 s pause (github.com/Steezy-code/clipper/blob/main/clipper/captions.py, read 2026-11-14), 20 characters and 2,000 ms (github.com/mutonby/openshorts/blob/main/remotion/src/lib/captions.ts, read 2026-11-14).
3. Hold the active word until the next word starts inside a page, so the highlight never flickers off in a short gap.
4. Hand each page to `buildAss`, which writes it in the style's way:

| Style behaviour | ASS pattern (verified in 09, sections 2.1 and 2.5) |
|---|---|
| Active word in another colour | One Dialogue per word; the page text with `{\1c<colour>}WORD{\r}` |
| Active word scaled (pop) | The same with `\fscx118\fscy118\t(0,90,\fscx100\fscy100)` |
| Box behind the active word | Style `BorderStyle=3`; per word `{\3a&H00&\3c<box>&}WORD{\3a&HFF&}`; square corners |
| Fill that stays after the word (`karaoke`) | One Dialogue per page with `{\k<cs>}WORD`; `PrimaryColour` after, `SecondaryColour` before |
| Fill that sweeps through the word | The same with `\kf` |
| Words appear as spoken and stay (`plain-cut`) | One Dialogue per word; unspoken words wrapped in `{\alpha&HFF&}` so the layout does not shift |
| Page entrance | `{\fscx60\fscy60\t(0,110,\fscx100\fscy100)}` (pop), `\fad(in,out)` (fade), `\move(x,y+20,x,y,0,120)` (slide up) |
| No inner highlight (page style, Tamil, translations) | One Dialogue per page |

A 60 second clip is 56 events at 3 words a page, or 166 with one event per word; libass drew both at the same cost (09, section 2.4).

### 2.3 Fitting Text

There is no `fitText`. libass wraps at the frame width minus the event's `MarginL` and `MarginR` even with `\pos`, balancing the lines with `WrapStyle: 0`; `\q2` turns wrapping off and must never be emitted for a page that can be long (09, section 2.3). The writer still has to choose a page size that keeps a page to two lines, using a **pure text width function** in `packages/video-engine`: summed glyph advances from a metrics table generated from the shipped font files, times a script factor (Tamil about 1.3 times Latin at the same size, to be tuned), plus outline and letter spacing, measured against the safe width (section 2.4). It only picks sizes and page breaks, so a few percent of error is fine; libass makes the final wrap. The function and its comparison with libass output were not built in the spike (09, section 14.3), so the first module build tests it against a set of rendered frames. The active word's scale never changes the page width except during the 90 ms pop (a style that must not move uses colour only).

### 2.4 Safe Areas

The platforms publish safe zones for ads, not for organic posts. A checker page that cites each platform's ads help page lists these margins on a 1080 by 1920 frame (upload-post.com/tools/safe-zone-checker, verified 2026-11-14, its own check dated 2026-09-23; the platform pages themselves were not opened, so the numbers are **reported**):

| Platform | Top | Bottom | Left | Right |
|---|---|---|---|---|
| TikTok | 240 px | 660 px | 120 px | 120 px |
| Instagram Reels | 269 px | 672 px | 65 px | 65 px |
| YouTube Shorts | 288 px | 672 px | 48 px | 192 px |

The strict union is top 288, bottom 672, left 120, right 192: a box of 768 by 960 px from (120, 288). A second guide gives looser working margins for organic posts (top about 15 %, sides 10 to 15 %, bottom 25 to 35 %) and repeats that these are not official organic rules (reap.video/blog/short-form-video-safe-zones, verified 2026-11-14).

Design: the editor draws two guides over the canvas, **Strict** (the union above) and **Organic** (top 15 %, bottom 25 %, sides 10 %), stored as percentages so they scale to any export size. Captions default to a block whose bottom edge sits at 72 % of the height; the template's default (150 px tall, 350 px from the bottom) sits inside every platform's bottom zone in the table, so we do not copy it.

**Open question for Arvind**: which guide is on by default? Recommendation: Organic on, Strict as a toggle, and a warning on export when a caption or hook leaves the Strict box.

### 2.5 Scripts: Tamil, Hindi And Right-To-Left

libass shapes with HarfBuzz (COMPLEX mode, HarfBuzz 14.4.0, FriBidi 1.0.16 in the FFmpeg 9.0.2 gyan full build), and Tamil and Hindi sample text shaped correctly through Windows Nirmala UI, including the ஸ்ரீ, க்ஷ and क्षत्रिय conjuncts, split vowel signs and the pre-base matra (09, section 3; verified 2026-11-17). The risks are in our own writer:

- **Never change style inside a word.** HarfBuzz shapes one run of identical style at a time. A colour change in the middle of a Tamil or Hindi cluster drew dotted-circle placeholders (09, section 3). Highlighting is by whole word, so a style change happens only at a space. A per-letter animation is **not allowed** for non-Latin text; a style that needs letters degrades to a word reveal for those scripts.
- **Styling.** Upper case does nothing for Tamil, Hindi or Arabic: the writer skips the preset's `case` for scripts without case. Marks above and below the line need room: keep outline widths moderate and the line spacing at 1.2 or more of the font size where Latin capitals use 1.0.
- **Font coverage.** None of the 52 shipped Studio fonts covers Tamil (checked in `packages/design-engine/src/fonts/index.ts`, 2026-11-14). Sprint 13 adds Noto Sans Tamil and Noto Sans Devanagari plus one display face each (for example Anek Tamil, Anek Devanagari, Baloo Thambi 2; all OFL, reported, to be checked file by file under the Studio font rule). They go in `fontsdir` beside the 52 Latin fonts.
- **Silent fallback.** When a style's font lacks a script, libass falls back glyph by glyph with no warning; a family that is not installed at all falls back silently to a default (09, section 10). The writer sets `\fn` per script run (detected from the Unicode ranges: Tamil U+0B80 to U+0BFF, Devanagari U+0900 to U+097F, Arabic U+0600 to U+06FF, Hebrew U+0590 to U+05FF) and the render compares the `fontselect:` log lines with the font manifest, failing with `font_missing` on a wrong family.
- **Emoji.** libass draws emoji monochrome in the text colour; colour emoji in a caption become sticker overlays (09, section 4).
- **Right to left.** libass reorders through FriBidi, so the writer keeps the words in logical order and never reverses arrays; a sweep (`\kf`) follows the reading order. Not run in the spike (09, section 16); reported.
- **Timing quality.** WhisperX ships no default alignment model for Tamil (its table has Hindi, Telugu, Malayalam, Urdu and Arabic but not Tamil, Bengali, Kannada, Marathi or Gujarati; github.com/m-bain/whisperX/blob/main/whisperx/alignment.py, read 2026-11-14). Tamil word timings come from faster-whisper's own word timestamps and will be looser, so Tamil, and any translation, defaults to a page-level highlight (one Dialogue a page, or a soft `\kf` over the page).

### 2.6 Caption Style Catalogue

What the reference products show (local screenshots `docs/screenshots/streamladder/10-...` and `docs/screenshots/opusclip/07-...`; stills only, so motion is **reported**). StreamLadder: "The Hook" is heavy italic capitals in white with a thick dark drop shadow; "Words You Sing Back" is tall condensed capitals with the last word green; "Hits" is a single heavy italic word. OpusClip: "Word Cut" is bold sentence case on two centred lines with no colour; "Marker Sweep" is condensed capitals with the active word on a lilac block; "Negative Keywords" is wide heavy capitals with some words white and others a muted tan; "Karaoke" is bold white capitals with a dark outline.

Our presets, as data, in the same order (our names, our fonts from the shipped set, our colours from the brand kit):

| Preset Id | Font | Case | Stroke And Shadow | Active Word | Keyword Rule | Enter | Words Per Page |
|---|---|---|---|---|---|---|---|
| `punch` | Archivo Black italic | Upper | No stroke; hard shadow 6 px down and right, black | Scale 1.08, same colour | None | Pop, 5 frames | 3, one line |
| `sing-along` | Bebas Neue | Upper | 4 px black stroke under fill | Accent colour (default green) | None | Fade, 3 frames | 4, one line |
| `one-word` | Anton italic | Upper | Hard shadow 8 px | The word is the page | None | Pop, 4 frames | 1 |
| `plain-cut` | Sora 700 | Sentence | Soft shadow, 30 % black | None; words appear as spoken and stay | None | None | Up to 7, two lines |
| `marker` | Oswald 700 | Upper | None | Box behind the word in accent colour, text turns dark; box slides from the previous word in 3 frames | None | Fade | 4, one line |
| `muted-keys` | Montserrat 900 | Upper | 3 px black stroke | None | Stop words drawn at 55 % tint, content words full white | Slide up 20 px | 3, two lines |
| `karaoke` | Poppins 800 | Upper | 5 px black stroke | Fill sweeps left to right across the word over its duration; spoken words keep the accent | None | None | 5, two lines |

**How the catalogue maps to ASS** (09, section 2): the `marker` box is `BorderStyle=3` with a per word border colour, so it **jumps** from word to word with square corners (a slide and a corner radius need a measured `p1` drawing, not built); strokes are libass outlines, always under the fill, so the seam problem of CSS strokes does not exist; `karaoke` is `kf`; `plain-cut` is the `alpha&HFF&` reveal; `muted-keys` tints stop words per run; the pop and slide are `	` transforms and `move`. The `box.radiusPx` field in the schema below is therefore `0` for now, and a field that ASS cannot draw stays out of the editor until it can.

Preset schema (Zod, in `video-engine`): `{ id, name, fontFamily, fontWeight, italic, case: 'upper' | 'sentence', maxFontPx, fill, stroke: { color, widthPx } | null, shadow: { x, y, blur, color } | null, box: { color, radiusPx, padPx } | null, active: { mode: 'none' | 'colour' | 'scale' | 'box' | 'sweep', color?, scale? }, keyword: { mode: 'none' | 'tint' | 'colour', color? }, enter: { kind: 'none' | 'pop' | 'fade' | 'slide-up', frames }, paging: { maxWords, maxChars, maxLines, maxGapMs }, position: { anchor: 'top' | 'middle' | 'bottom', yPct } }`. A custom style is a copy of a preset with fields changed, saved per workspace; a brand kit names a default preset.

## 3. Captions On The Two Timebases

### 3.1 What Is Stored

- **Transcript asset** (immutable, a `ClipAsset`): `{ id, sourceRef, language, producer, version, words: [{ i, text, startMs, endMs, confidence, speaker? }], sentences: [{ firstWord, lastWord }] }`. All times are **source** time.
- **Captions track** (in the clip document): `{ kind: 'captions', transcriptId, presetId, styleOverrides, position, edits: { [wordIndex]: { text?, hidden?, emphasis?, breakAfter?, censor? } } }`. No times at all: only word indexes.

A caption fix (a typo, a hidden word) is an entry in `edits` and never cuts video. Deleting words in the transcript pane (Module 04) is a different action that cuts segments.

### 3.2 Mapping To Output Time

Captions reach the ASS writer as `CaptionWord[]` in output time, built on every document change by a pure function:

```
out = []
outStart = 0
for seg in document.segments:                      # output order
    for w in transcript.words overlapping [seg.sourceIn, seg.sourceOut) on seg.sourceRef:
        e = track.edits[w.i]
        if e.hidden: continue
        s = max(w.startMs, seg.sourceIn); t = min(w.endMs, seg.sourceOut)
        if (t - s) < 0.5 * (w.endMs - w.startMs): continue      # mostly cut away
        out.push({ text: (e.text or w.text),
                   startMs: outStart + (s - seg.sourceIn) / seg.speed,
                   endMs:   outStart + (t - seg.sourceIn) / seg.speed,
                   pageBreakAfter: e.breakAfter or w is the last kept word of seg })
    outStart += (seg.sourceOut - seg.sourceIn) / seg.speed
```

The loop runs over **segments**, not over words. A hook clip or a montage can play the same source range twice, so one source word can have two output times; a single "source to output" function would lose one of them.

### 3.3 What Each Edit Does

| Edit | Effect On Captions |
|---|---|
| Trim an edge | Words outside the new range drop out; a word cut through the middle stays only if at least half of it remains |
| Split | Nothing changes on screen; a page break is forced at the cut so no page spans it |
| Delete middle | The words of the removed range disappear; the pages on both sides close up |
| Speed change | Word durations divide by the speed. When the median word falls under 120 ms (four frames at 30 fps) the active-word highlight is switched off for that segment and the page shows whole |
| Reorder, hook clip, montage | Words follow their segment; repeated ranges repeat their captions |
| Re-transcribe | A new transcript id. Edits are re-based by time overlap and text match; the ones that cannot be matched are listed for the user, never applied blindly |

### 3.4 Translation As A Second Transcript

A translation is another transcript asset: `{ language, translatedFrom: transcriptId }`. It is translated sentence by sentence, because word order changes between languages. Its word times are synthetic: each translated sentence takes the source sentence's time span, shared out across its words by character length. So a translated track defaults to a preset without a per-word highlight. The captions track simply points at the other transcript; nothing else changes. (The open clippers do not offer this: OpenShorts' translation is audio dubbing through a hosted API, github.com/mutonby/openshorts/blob/main/translate.py, read 2026-11-14.)

## 4. Transcript Plus LLM Highlight Scoring

### 4.1 How The Open Clippers Do It

| Project | Chunking | What The Model Returns | After The Model |
|---|---|---|---|
| OpenShorts (`clip_selection.py`, `main.py`, `gemini_worker.py`) | Sentence-aligned windows of about 90 s (or 1.5 times the longest clip), 30 s overlap; scored in near-equal batches of 8 (3 for a local model) | Pass 1: a 0 to 100 score and a short reason for **every** window. Pass 2: clips with seconds, a score, hook, titles and a one-line why, from the top windows | Snap to word edges (search 1.5 s, lead up to 0.35 s, tail up to 0.45 s), repair length, drop clips sharing 25 % of the shorter one |
| AI-Youtube-Shorts-Generator (`shorts_generator/highlights.py`) | Only above 30 min: 20 min chunks, 60 s overlap; one call below that | Seconds, a 0 to 100 score, a hook sentence, a reason; asks for twice the wanted count | Clamp, drop a clip overlapping a better one by more than half its length; three attempts on bad JSON |
| clipper (`clipper/score.py`) | None: one call, lines of 12 words each prefixed by a start time | Seconds, title, hook of 8 words or fewer, reason, score | Clamp to the length band, drop overlaps, top N |
| autoclip (`backend/pipeline/clip_finder.py`) | 60 min windows with 4 min overlap and a 70,000 character cap (20 min and 12,000 characters for local models) | **Row ids**: each row goes in as an id, a clock time and its text, and clips come back as a start row and an end row | Snap to subtitle cues within 3 s, length band by video tier, merge at 50 % overlap |
| opensource-clipping (`clipping/engine.py`) | None: the whole transcript in one call | Seconds, a 1 to 100 score from five 20-point parts, optional keep-segments and micro-hooks | Retry with a fallback model |

Three lessons recorded in those files: a single call over a long transcript clusters its picks near the start; letting each batch select its own winners caps the shortlist and admits filler, so score everything and rank globally; models are poor at time arithmetic, so the word list is the ground truth for cut points. OpenShorts measured its raw boundary error at about 0.4 to 0.5 s at the 90th percentile before snapping.

### 4.2 Our Pipeline

1. **Rows.** Split the transcript into rows of at most 12 words, broken at sentence ends and at pauses over 0.4 s. Each row is printed as `[firstWord-lastWord] mm:ss text`. The time is for the model's sense of length only.
2. **Windows.** Sentence-aligned windows of `max(90 s, 1.5 x longest clip)` with 30 s overlap. A source under 10 minutes is one window and one call.
3. **Pass 1, score.** Batches of 8 windows, near-equal in size. The model scores every window 0 to 100 with a short reason. Sprint 12 evidence rides along as fields on the window (`loudnessPeak`, `chatSpike`, `sceneCuts`), the way OpenShorts passes viewer clips.
4. **Shortlist.** Global top N by score, N growing with length and with the number of clips asked for. Windows holding a strong Sprint 12 candidate are guaranteed a place.
5. **Pass 2, detail.** The shortlist goes back with the rules and the user's steering. The model returns clips as **word indexes**.
6. **Code, not the model, does the rest**: validate, map to time, snap, enforce length, score, dedup, blend.

Sparse speech (under 8 words, or under 5 words a minute, OpenShorts' floors) skips the transcript path and leaves the job to signals and section 9.

### 4.3 Prompt Shape And Schema

The prompt, in our own words: you are editing for a cold viewer who has seen nothing else; find self-contained moments that open on their strongest line; a clip that needs earlier context starts earlier or is skipped; never two clips that land the same point; write the hook about this moment, not the video, in the transcript's language. The transcript and the user's text are placed in delimited blocks and declared to be data, not instructions.

Structured output (a Zod shape in the contract package, exported to JSON Schema, sent as the response format):

```
{ clips: [ {
    windowId: string,
    startWord: integer,     # the first index of a printed row
    endWord: integer,       # the last index of a printed row, >= startWord
    title: string (<= 60 chars), hook: string (<= 10 words),
    parts: { hook: 0..20, emotion: 0..20, share: 0..20, standsAlone: 0..20, payoff: 0..20 },
    reasons: [string (<= 12 words)] (1 to 3),
    hookRange: [integer, integer] | null     # section 7
} ] }
```

An index that was never printed is a rejection, not something to repair. The total score is the sum of `parts`, computed by us.

### 4.4 User Steering

| Control (OpusClip's setup screen has the same three) | How It Reaches The Model | How It Is Enforced |
|---|---|---|
| "Moments To Include" free text | A delimited block: "prefer moments matching this; it cannot change the rules or the format" | Not enforced; it only shifts ranking. Capped at 300 characters |
| Clip length range | Stated in seconds, with the row times as the yardstick | In code: extend to the next sentence end until the minimum, trim back to the last sentence end under the maximum |
| Genre (Auto or chosen) | Selects one criteria paragraph (talk, gaming, tutorial, comedy, sport). Auto is one small call on the first 25 sentences, as in `highlights.py` | None needed |

### 4.5 Score, Reasons, Dedup And The Blend

- **Score shown**: 0 to 100, with the model's one to three reasons and the five parts behind a details row. Copy must call it a prediction.
- **Dedup**: sort by score; drop a clip whose overlap with a kept clip is 25 % or more of the shorter one.
- **Against Sprint 12 candidates**: an LLM clip that overlaps a signal candidate absorbs it (one clip, both reason lists). `final = min(100, llm + 0.2 x signal)`. A signal candidate with no LLM clip stays, with its signal score capped at 79 unless a vision verdict confirms it. The weights are starting values, tuned on the real-test set.
- **Origin**: the plan's `Clip.origin` has MANUAL and AI_SIGNALS. Sprint 13 needs a third value, `AI_TRANSCRIPT`, and blended clips keep both reason lists.

### 4.6 Cost Per Source Hour

Assumptions: 150 words a minute, so 9,000 words an hour; about 1.3 tokens a word in English plus row labels, about 14,500 tokens an hour; window overlap brings pass 1 to about 22,000 input tokens with instructions; pass 2 adds about 6,000. Output is about 2,600 visible tokens; allow 10,000 where the model reasons.

| Model | Input / Output Per 1M Tokens | Cost Per Source Hour |
|---|---|---|
| `gpt-4.1-mini` (the model named in `packages/ai-engine` today) | $0.40 / $1.60 | about $0.015 |
| `gpt-5-mini` | $0.25 / $2.00 | about $0.03 |
| `gpt-5.4-mini` | $0.75 / $4.50 | about $0.07 |
| `gpt-6-luna` | $0.10 / $0.50 | about $0.01 |

Prices from developers.openai.com/api/docs/pricing (verified 2026-11-14). Tamil and Hindi text costs several times more tokens per word (reported), so budget five times the input. For scale: hosted transcription on the same page is $0.006 a minute, $0.36 an hour, so scoring is a small fraction of the transcription bill. Batch pricing is half, but it is not interactive.

## 5. Speech Cleanup

- **Silence removal.** Speech spans come from Silero VAD (the `speech` track). A gap is removable only when VAD says no speech **and** the Sprint 12 loudness track is quiet there; that keeps laughter, game sound and music stings. Defaults: remove gaps longer than 0.5 s, keep 0.15 s on each side (the clipper repo's `SILENCE_MAX` and `SILENCE_KEEP`; auto-editor's default margin is 0.2 s, github.com/WyattBlue/auto-editor, verified 2026-11-14).
- **Filler words.** A list per language of unambiguous fillers ("um", "uh", "erm"); words like "like" are never removed by default. Honest limit: Whisper-family models often leave fillers out of the transcript, and a filler that was not transcribed cannot be removed by its word timing (reported).
- **Transcript editing.** Selecting words and pressing delete removes their source range from the segments. Cut points sit in the middle of the silence beside the removed words, at most 150 ms away from the neighbouring word.
- **Result.** All three produce the same thing: a longer list of segments. No new render path, and captions follow by section 3. Video cuts hard; audio gets a 10 to 30 ms fade out and in at every cut, written by the render compiler as `afade` in and out of 15 ms on every join (verified 2026-11-17, see 09 section 6: the largest sample step at a join fell from 25 times normal to normal), and by the preview as a short gain ramp.
- **Minimums.** No kept piece under 0.25 s (it merges into a neighbour); no removal under 0.3 s; every cut point is rounded to an output frame so thirty cuts do not drift.
- **Scale check for Sprint 12's design.** A cleaned 60 s clip can hold 30 or more segments. The compiler opens one input for each run of segments of a source (`-ss` at the run start, `-t` the run length) and writes every `trim` relative to it; one file per segment would not scale (64 s against 44 s for 40 segments, and a second encode) and `trim` alone would decode a long source from its start (09, section 6). 40 segments need a 7 KB graph, 150 about 31 KB, written to a file read with `-/filter_complex`.

**Open question for Arvind**: is silence removal applied automatically to AI clips, or only on a button? Recommendation: a button and a recipe switch, off by default, with a preview of the seconds saved.

## 6. Word Censoring

- **Detect** from the transcript: normalise (lower case, strip punctuation, Unicode NFKC), match against a word list per language, including native script and common Latin spellings for Tamil and Hindi. A workspace can add and remove words. Open lists exist (reported); each list's licence is read before it ships.
- **Store and apply.** The flag lives on the captions track as `edits[wordIndex].censor = 'bleep' | 'mute'`; it is keyed by word, so it survives every trim. At render the range is the word's time widened by 40 ms each side, never under 250 ms. Mute is a gain dip on the output timeline with 5 ms ramps; a bleep adds a generated 1 kHz sine over the muted range. Both are one `aeval` and one `aevalsrc` per clip, sample accurate (a plain `volume` expression snapped to a 21 ms audio frame and was late; 09, section 5).
- **Caption masking** is optional and uses the same flag: first letter plus asterisks, or the word hidden.
- **Limits**: the transcriber can mishear or soften a word; sung lyrics and overlapping speech are missed; word timings can be off by a tenth of a second, which is why the range is padded.

## 7. Hook Title And Hook Clip

- **Hook title.** The `hook` field from pass 2: ten words or fewer, in the transcript's language, naming what happens in this clip. It is a text element in output time, on screen for the first 3 s by default, with a "Rewrite" action that returns three more. Placement uses the face track: of the bands that clear the caption block and the safe guides, take the one that covers faces least over those seconds (the idea in github.com/mutonby/openshorts/blob/main/hook_placement.py, read 2026-11-14).
- **Hook clip.** StreamLadder calls it "Pick the moment that plays first". In the segment model it is a short later range played first: `segments = [ { sourceIn: h1, sourceOut: h2 }, { sourceIn: a, sourceOut: b } ]` on the same `sourceRef`, a montage of two segments. The model may propose it as `hookRange` (2 to 5 s, the single most arresting sentence inside the clip); the user can pick another on the timeline. A 2 to 4 frame flash between the two is an output-time element. opensource-clipping goes further with three or four micro-hooks of 0.5 to 2 s each (`clipping/engine.py`); that is P2. The consequences are already handled: the words repeat (section 3.2), crops are in source time so the reframe applies to both plays, and the length rule counts the hook's seconds.

## 8. Face Detection And Auto-Reframe

### 8.1 MediaPipe

| Task | Models | Output | Options |
|---|---|---|---|
| Face Detector | BlazeFace short-range, BlazeFace full-range, BlazeFace Sparse full-range; all 128 by 128, float 16 | Boxes, a score, six keypoints (both eyes, nose tip, mouth centre, both ear tragions) | `running_mode` (IMAGE, VIDEO, LIVE_STREAM), `min_detection_confidence` 0.5, `min_suppression_threshold` 0.3 |
| Face Landmarker | One bundle: BlazeFace short-range detection, FaceLandmarker-V2 mesh, a blendshape model | 478 landmarks and 52 blendshape scores a face (for example `jawOpen`) | `num_faces` (default 1), three confidence thresholds at 0.5, `output_face_blendshapes` |

Both run in Python (`pip install mediapipe`) and in the browser (`@mediapipe/tasks-vision`); the short-range detector averages 2.94 ms on a Pixel 6 CPU (developers.google.com/edge/mediapipe/solutions/vision/face_detector and `.../face_landmarker`, verified 2026-11-14; the `ai.google.dev/edge/...` addresses redirect there). The repository is Apache-2.0 (github.com/google/mediapipe, verified 2026-11-14); the model cards' own licence was not opened (reported Apache-2.0).

Two cautions from the open clippers. OpenShorts still uses the legacy `mp.solutions.face_detection` API; build on Tasks. And opensource-clipping's notes say the full-range model initialises under the Tasks detector in MediaPipe 0.10.21 and then fails on its first image, so they use short-range (github.com/NaufalRizqullah/opensource-clipping/blob/main/wiki/4-Face-Tracking-and-Auto-Framing.md, read 2026-11-14). Short-range is weaker on small, distant faces. Module 07 tests this on a wide two-person shot before it commits.

### 8.2 Sampling And Tracks

- **Rate**: 5 frames a second on the proxy, scaled to 640 px wide, in one forward decode. The open clippers sit in the same band: every 4th frame (OpenShorts), every 0.25 s (opensource-clipping), every 6th frame (clipper), all at 640 px or less. One forward pass matters: OpenShorts measured 89 CPU-seconds with a seek per sample against 6 for a single pass over a 20 s clip (`frame_sampler.py`).
- **When**: on demand for a clip's range plus handles, cached as a `faces` track asset. A coarse 1 frame a second pass over the whole source feeds facecam detection.
- **Association**: MediaPipe detects; it does not track. Match each detection to the nearest live track by centre distance (within 15 % of the frame width), drop a track unseen for 1 s, start a new id otherwise, and reset everything at a scene cut.

### 8.3 Who Is Speaking

| Method | How | Cost | Verdict |
|---|---|---|---|
| Largest face | Size score with decay; the current speaker's score is multiplied so it sticks; a cooldown before any switch | None | **Pick**, the default |
| Mouth movement gated by audio | Frame difference inside each face's mouth region, in 0.4 s windows; a window counts only when the audio is above a floor; each face is normalised to its own 20th to 80th percentile; a new speaker must hold three windows | One small decode per scene | **Pick**, for two-person shots (`active_speaker.py` in OpenShorts) |
| Landmarker `jawOpen` | The blendshape's variance per face | Heavier model | **Later**, if the pixel method is noisy |
| Light-ASD | Audio-visual model, AVA mAP 94.06 % | GPU helps; 25 fps face crops | **Later**: MIT, 196 stars (github.com/Junhua-Liao/Light-ASD, verified 2026-11-14) |
| TalkNet-ASD | Audio-visual model, AVA mAP 92.3 | GPU helps | **Later**: MIT, 520 stars (github.com/TaoRuijie/TalkNet-ASD, verified 2026-11-14) |

For both dedicated models the code is MIT, but the weights were trained on AVA-ActiveSpeaker and, for TalkNet's TalkSet, on VoxCeleb2 and LRS3. Those datasets' terms are not settled for commercial use (reported), so they stay behind a `SpeakerDetector` interface until that is checked.

### 8.4 Smoothing To Crop Keyframes

Per scene (cuts from the scene track):

1. **Choose a mode**: one clear subject -> follow; two speakers -> stack; no face or a group -> fit with a blurred background. OpenShorts samples five frames a scene and flips a short scene back when both neighbours disagree with it.
2. **Target**: the active face's centre per sample.
3. **Confirm jumps**: a move larger than the dead zone must repeat on three detections before it is believed. On real footage this cut direction reversals from 0.41 to 0.13 a second (OpenShorts, `main.py`).
4. **Dead zone**: the camera holds while the target stays within 15 to 25 % of the crop width of its centre (0.15 in opensource-clipping, 0.25 in OpenShorts).
5. **Speed cap**: about 5 % of the source width a second for a normal move and 25 % for a catch-up (OpenShorts' 3 and 15 px a frame at 30 fps on a 1920 px source).
6. **Smooth**: the pass is offline, so use a zero-lag filter: the same exponential average run forward and backward and averaged (the clipper repo, alpha 0.12). A one-euro filter (reported) is the choice only if the path is ever computed live.
7. **Scene cut**: reset the tracker and cut, never pan, to the first accepted face of the new shot.
8. **Reduce**: keep only the points where the path bends. Output `cropKeyframes: [{ t (source seconds), x, y, w, h (0 to 1), ease: 'linear' | 'hold' }]`, which is the keyframe array the plan reserved.

A keyframe the user moves is pinned and survives a re-run; "Reset To Auto" clears the pins.

### 8.5 Facecam Detection

A streamer's webcam is a small face that stays in one place. From the coarse pass: take the largest face per sampled frame; require at least 60 % of frames to have one; require the median face width under a quarter of the frame and the centres to cluster (the clipper repo requires three boxes, a median width under half the frame, and a median deviation under 0.6 of the face size, then pads the box by half a face on each side; `clipper/crop.py`). Then grow the box toward the nearest corner (OpenShorts' `camera_inset.py`, which notes that insets are often circles, have no reliable border, and that pixel-variance tricks fail over moving gameplay). The result is a **suggested** crop box for the Split layout that the user adjusts, never a silent decision.

### 8.6 How AutoFlip And The Open Clippers Do It

AutoFlip (Google, 2020-02-13) works per scene: scene cuts from colour histogram changes; face and object detectors mark salient regions, each with a signal type, a weight and an `is_required` flag; a strategy per scene (stationary, panning at constant speed, or tracking); a smooth low-degree polynomial path fitted to the boxes; and when the required regions cannot fit, a letterbox with a blurred or solid background (research.google/blog/autoflip-an-open-source-framework-for-intelligent-video-reframing, verified 2026-11-14; `mediapipe/examples/desktop/autoflip/autoflip_messages.proto` and `calculators/scene_cropping_calculator.proto`, read 2026-11-14). Its documentation page no longer resolves on the main branch. It is a C++ graph; we take the ideas.

The open clippers all share that skeleton: scenes first, a mode per scene, a damped camera, a blurred fallback. OpenShorts adds stacked speakers, a screen-over-speaker layout, and a layout picker that asks a vision model one categorical question on twelve stills.

## 9. Visual Moments

**Cheap signals first**, at 4 frames a second on a 320 px grey copy, written as the `motion` track:

| Signal | How | Reads As |
|---|---|---|
| Frame difference energy | Mean absolute difference between neighbouring samples, as a z-score over a rolling minute | Something changed a lot |
| Optical flow | OpenCV dense flow (Farneback); mean and 95th percentile magnitude, minus the median flow to remove camera pans | Objects moved fast, not just the camera |
| Scene cut density | Cuts per 10 s from the scene track | Rapid action or an edit burst |
| Audio-visual agreement | A motion peak within 1.5 s of a loudness peak multiplies the score | A crash with a scream; either alone is weak |
| Spike then stillness | A high peak followed by 2 s of near-zero motion | A death screen, a freeze, a stunned pause |

A candidate is a combined peak above two standard deviations, at least 20 s from the next, cut from 8 s before to 6 s after and snapped to scene cuts and sentence ends.

**Then an optional vision check** on the top candidates only: five frames around the peak (3 s and 1 s before, the peak, 1 s and 3 s after) at about 768 px, with the transcript lines and the signal facts, asking for a verdict: `{ isMoment: boolean, kind: 'fail' | 'win' | 'funny' | 'reaction' | 'big-motion' | 'none', confidence: 0..1, line: string (<= 12 words) }`. OpenShorts' measurements guide the shape: a closed choice is stable where a measured number was not (the same video scored 1 % and 97 % on consecutive runs), and resolution mattered more than frame count (`layout_picker.py`).

**Cost and when it is worth it.** Twenty candidates of five frames is 100 images. Image tokens are not listed for text models on the pricing page; at a reported few hundred to a thousand tokens an image this is $0.01 to $0.08 a run on a mini model. It is worth it for sources with sparse speech (gameplay, sport, silent footage) and when the transcript path returned too few clips; it is skipped otherwise, and it is a credit-charged step.

**Honest limits.** Frames miss what happens between them. Motion is not meaning: cutscenes, menu changes, loading flashes and camera shake all score high. A "fail" needs understanding the model may not have for a given game. Small on-screen events are invisible at this size. Nothing here ranks humour. **Game-specific detectors (kill feed OCR, HUD parsing, kill-cam templates) are out of scope for Sprint 13.**

## 10. Text To Speech

| Option | Licence | Languages | Verdict |
|---|---|---|---|
| Piper | GPL-3.0 at its current home (github.com/OHF-Voice/piper1-gpl, verified 2026-11-14, 6.3k stars); embeds espeak-ng; voices carry their own licences | Many | **Skip** for now: GPL means a separate program only, and every voice needs its own check |
| Kokoro | Apache-2.0 code and weights, 82 million parameters (github.com/hexgrad/kokoro, verified 2026-11-14, 10.1k stars) | American and British English, Spanish, French, Hindi, Italian, Japanese, Brazilian Portuguese, Mandarin. No Tamil | **Pick** as the self-hosted binding |
| OpenAI speech | Hosted: `tts-1` $15 and `tts-1-hd` $30 per 1M characters (developers.openai.com/api/docs/pricing, verified 2026-11-14) | Many (reported) | **Pick** as the first real binding: a 200 character line costs $0.003 |
| edge-tts | An unofficial client for a browser's speech service (used by opensource-clipping) | Many | **Reject**: no terms for a commercial service |

Design: a `SpeechSynthesizer` provider with a simulation binding (a bundled clip). The result is an audio asset on the audio track in output time, like a sound effect, storing the text, voice and language so it can be re-made. A synthetic voice should set the AI disclosure toggle of Module 13.

**Open question for Arvind**: hosted first, or Kokoro first? Recommendation: hosted first (no model to host, Tamil covered), Kokoro once the media service has spare capacity.

## 11. Signal Tracks Added In Sprint 13

Sprint 12 already writes `loudness`, `scene` and `chat`. Each track is a file in private storage with a `ClipAsset` row and a header `{ name, version, producer, producerVersion, sourceRef, rangeStart, rangeEnd, rate }`. A version bump recomputes lazily.

| Name | Version | Producer | Rate | Used By |
|---|---|---|---|---|
| `speech` | 1 | Silero VAD 6.x (512-sample windows at 16 kHz) | A probability every 32 ms, kept so spans can be re-cut with other thresholds without running the model again | 02 (chunking audio), 04 (silence removal), 05 (sparse-speech test), 06 (agreement) |
| `speakers` | 1 | Mouth-activity attribution (section 8.3); diarization can replace it later | Turns, 0.4 s windows | 03 (speaker colours), 05 (prompt context), 08 (who to frame) |
| `faces` | 1 | MediaPipe Face Detector, BlazeFace short-range, plus our track matching | 5 a second for a clip range, 1 a second for the whole source | 07 (facecam), 08 (reframe), 09 (hook placement), 03 (caption placement) |
| `motion` | 1 | OpenCV frame difference and Farneback flow | 4 a second | 06 (candidates), 05 (blend) |
| `vision` | 1 | Vision model verdicts on candidates | One row a candidate | 06 (confirm), 05 (reasons, score cap) |

The transcript is not a signal track: it is its own asset kind with its own type in `video-engine`.

## 12. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Word timings are loose (Tamil, noisy audio, music) | Highlight off the beat, cuts mid-word | Soft styles by default for weak languages; pad cuts; show confidence in the transcript pane |
| The model returns bad indexes or too few clips | Empty or broken results | Schema-enforced output, reject and retry once, a floor on clip count with one more call on unused windows, then fall back to signal candidates |
| Prompt injection through the transcript or the steering text | Odd output | Delimited data blocks, a fixed schema, no tool use, length caps |
| Short-range face model misses small faces | Reframe falls back to centre on wide shots | Test in Module 07; fit-with-blur fallback; manual keyframes |
| Reframe swings or lags | Unwatchable clips | Jump confirmation, dead zone, speed cap, snap on cuts; a regression set of real clips with measured reversals a second |
| Silence removal eats a laugh, or leaves thirty tiny segments | Clips feel wrong, slow render, audio clicks | Loudness gate, off by default, one-click undo; one HD range per clip, frame-aligned cuts, short audio fades |
| Indic fonts missing or mis-measured | Boxes of fallback glyphs, clipped text | Script detection before measuring, Noto faces added, `fontselect:` log checked against the font manifest, a render test per script |
| A highlight changes colour inside a Tamil or Hindi word | Dotted-circle glyphs | Style changes only at spaces (09, section 3) |
| Vision check cost grows with long gameplay | Bill surprises | Hard cap on candidates per source, credits charged, off by default |
