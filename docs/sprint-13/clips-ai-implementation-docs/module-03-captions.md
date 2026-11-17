# Module 03: Captions

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session, may need a second)
> **Depends on**: [Module 02](module-02-transcription.md)
> **Stories**: CA-1.1, CA-1.2, CA-1.3, CA-1.4, CA-1.5, CA-1.6, CA-1.7 (new: Upload SRT)
> **Next**: [Module 04](module-04-transcript-editing-and-speech-cleanup.md), [Module 10](module-10-recipes-and-brand-kit.md), [Module 11](module-11-montage-and-batch-export.md)

## Goal

**Demo 1.** In the editor's new Captions tab a user presses Add Captions, picks one of six styles, and sees word-by-word captions on the clip that match the speech. They fix a word once for the whole video, change the position and size, make a style of their own, translate the captions, or upload their own SRT file instead of listening, and export: the captions in the video are drawn by the same compiler that drew the editor's Preview Export, and the editor itself matches the export closely. Trim, split, delete or speed up the clip and the captions are still in step, because they store no times of their own.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 1, 4, 11, 12, 13.
- User stories: Journey A; CA-1.x; section 5.
- Sprint doc: What The Research Settled (items 4 and 5); The Clip Document, Version 2; API Routes (captions, caption styles).
- Decisions: D13-05 (Tamil captions on, editable), D13-16 (captions through ASS), D13-02 (AI Minutes).
- Research: [`09-ass-captions-and-edit-cookbook.md`](../research/09-ass-captions-and-edit-cookbook.md) (**verified recipes**: sections 2 to 4 and 10, and 14.2 for what the writer must do) and [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md) (section 2: the pager, safe areas, Tamil and Hindi shaping and fonts, the style catalogue as data; section 3: the two-clock design and why mapping loops over segments). [`02-libraries.md`](../research/02-libraries.md). Sprint 12's [`05-editor-and-render.md`](../../sprint-12/research/05-editor-and-render.md) (the render compiler, fonts in a render, the preview).
- Code: `packages/video-engine/src/document/` (schema, `upgrade.ts`), `time/time-map.ts`, `src/render/` (`frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`); `packages/video-preview/` (`PreviewEngine`); `packages/media-tools` (the runner); Sprint 12's Text panel, handle layer, `ColorPicker`, timeline rows; `packages/design-engine/src/fonts/` (the registry, its licence rules and the font manifest); Module 02's `ensure` and transcript routes.

## Design

### 1. Document Version 2 (`packages/video-engine`)

- `CURRENT_SCHEMA_VERSION = 2`; one `upgrade()` step from 1 that adds empty `bleeps` and nothing else. Every fixture in `fixtures/v1-clips/` must parse, upgrade and give an identical `RenderPlan` and identical `frameState` at sampled times (a test).
- The captions track as in the sprint doc: `{ id, kind: 'captions', transcriptAssetId, language, styleId, position, sizePx, maxWords, edits }`. At most one captions track per clip. `edits` is keyed by word index: `{ text?, hidden? }` for changes that belong to this clip only (video-wide fixes live in the transcript, Module 02).
- The other version 2 parts (`segments[].role`, `layout.follow`, `bleeps`, `recipeId`) are added to the schema now, unused, so later modules need no further version bump.

### 2. Captions In The Engine (`captions/`, pure)

- `map.ts`: `captionWords(doc, transcript)`: for each segment in play order, take the transcript words inside that segment's video range, map each word's start and end to the clip's time (through the segment's start and speed), apply `edits`, and return words in the clip's time. Looping over segments (not words) is what makes a hook clip or a montage that plays one stretch twice show its captions twice. A word cut in half by a segment's edge is kept if more than half of it is inside.
- `pages.ts`: `captionPages(words, { maxWords, maxChars, maxGapMs })`: groups words into pages that break at the word limit, at a character limit that depends on the size and the canvas width, at a pause longer than `maxGapMs`, at sentence ends, and always at a segment boundary. It marks the last word of each page (`pageBreakAfter`) so the ASS writer knows where pages end (research 06 section 2.2 explains why paging by time alone gives ugly pages). The pager breaks lines itself before libass could wrap: a page is at most two lines.
- `width.ts`: the pure text width function (research 09 section 14.3): summed glyph advances from a metrics table generated from the shipped font files, times a script factor (Tamil about 1.3 times Latin, tuned from rendered frames), plus outline and letter spacing. It only chooses page breaks and sizes, so a few percent of error is fine; libass makes the final wrap. The first build tests it against a set of frames libass drew. Tamil and Hindi pages stay one or two words shorter than Latin pages until it is tuned.
- `styles.ts`: `CAPTION_STYLES`, six built-in styles as data: font, weight, size ratio, fill, outline, box, the way the spoken word is marked (colour, a box behind it, scale, sweep), the entrance of a page (none, pop, slide, type on), letter case, default words at once. Names and looks are our own: **Bold Pop**, **Marker**, **Karaoke**, **Clean**, **Boxed**, **Typewriter**. `resolveStyle(styleId, customStyles)`. Each style says which ASS pattern draws it (research 06 section 2.2); a field ASS cannot draw (a rounded box corner) stays out of the editor until it can.
- `script.ts`: `scriptOf(text)` (Latin, Tamil, Devanagari, other) and `fontForScript(style, script)`, so Tamil and Hindi words are drawn in a font that has them.
- `safe-area.ts`: the guide rectangles for a vertical clip (the looser everyday guide and a strict one, from research 06, marked reported there).
- `srt.ts`: `parseSubtitleFile(text)` for **Upload SRT**: reads SRT and VTT cues (index or cue id optional, `HH:MM:SS,mmm` or `HH:MM:SS.mmm`, basic tags stripped, byte order mark and Windows line ends tolerated), refuses a file that has no valid cue, and spreads each cue's time across its words by character length (as a translation does, so the page is the unit of highlight). It returns a `Transcript` with `producer: 'supplied'`.
- Tests: mapping through a trim, a split, a removed middle, a 2x part, and a repeated stretch; paging rules; every style resolves; script detection; the width function on Latin and Tamil samples; the SRT parser on good, odd and bad files.

### 3. The ASS Caption Writer (`packages/video-engine/src/render/`) And The Preview

Captions are drawn by FFmpeg, not by a browser. The pages from section 2 reach `buildAss`, which writes one ASS subtitle file for the whole render (titles and captions share it, one `Style` per distinct look); `compileFfmpeg` adds `ass=cap.ass:fontsdir=fonts` as the last stage of the picture chain, after crop, scale and overlays, so it draws at the output size. `PlayResX` and `PlayResY` equal the output size, so one file works at 360p (Preview Export) and 1080p. The recipes are verified on FFmpeg 9.0.2 (research 09, sections 2 to 4 and 10). The writer follows these rules:

- **Default highlight, one Dialogue per word.** Each event shows the whole page and the active word is wrapped as `{\1c&H0000E6FF&}WORD{\r}`. Only the active word changes colour. This is the default for every "only the current word" style.
- **Karaoke options.** Styles that keep spoken words in the accent colour use one Dialogue per page with `\k` (stays filled); a sweep through the word uses `\kf`. `PrimaryColour` is the colour after the word, `SecondaryColour` before. If a `\t` method is ever used, every word block starts with `\r`, or earlier transforms leak into later words.
- **Pop.** A page enters with `{\fscx60\fscy60\t(0,110,\fscx100\fscy100)}`; an active word that scales uses `\fscx118\fscy118\t(0,90,\fscx100\fscy100)`. A style that must not move uses colour only. Slide is `\move`, fade is `\fad`.
- **Box and reveal.** A box behind the active word is `BorderStyle=3` with a per-word border colour and a transparent box on the other words (square corners). Words that appear as spoken and stay use `{\alpha&HFF&}` on the unspoken words so the layout never shifts.
- **Times.** Round each word's **absolute** start and end to centiseconds, then take differences for `\k`, never the other way, so error never builds up over a page. An event is drawn when `start <= frame time < end`, to 10 ms.
- **Wrapping.** Page margins (`MarginL`, `MarginR`, `MarginV` from the safe area, bottom anchored, `WrapStyle: 0`) set the wrap width. `\q2` is **never** written (it turns wrapping off and long lines run past the frame edge); the pager breaks lines before libass would wrap.
- **Scripts.** A style change (colour, scale, alpha) may happen only at a word boundary, never inside a word: inside a Tamil or Hindi cluster it draws dotted circles. So non-Latin text is highlighted by whole word only, per-letter animation (type on by letter) is reduced to a word reveal for those scripts, and **Tamil and translated captions default to a page-level highlight** (one Dialogue per page, or a soft `\kf` over the page), because their word times are looser or synthetic. The writer sets `\fn` per script run explicitly and never relies on silent fallback.
- **Case.** ASS has no case attribute: the writer upper-cases (or sentence-cases) the text itself and skips it for scripts without case.
- **Emoji.** libass draws emoji in one colour, so a colour emoji in a caption is removed from the text and becomes a **sticker overlay** placed from the word's time and position (Sprint 12's sticker path). The writer records these as overlay items for `buildRenderPlan`.
- **Fonts.** The image's `fontsdir` holds the 52 Studio fonts, the two added here and nothing else. `compileFfmpeg` runs FFmpeg at `-loglevel info`, collects the `fontselect:` lines and compares each selected PostScript name with the font manifest (generated from the files, never by hand). An unexpected family fails the render with `font_missing` naming it, instead of delivering captions in a wrong font. The same check runs once against the folder before the job.
- Two fonts are added to the font set for Tamil and Devanagari (open-licence faces only, as the font registry's header demands; research 06 section 2.5 names candidates; record the licence files as the registry does), plus their entries in the manifest. They are used automatically by `fontForScript`, not offered in the Latin font list.
- A caption burn costs about 0.3 CPU seconds a second of video at 1080x1920 (research 09 section 2.4). The cost lines in Module 15 count it.

**In the browser.** `packages/video-preview` draws captions with a `CaptionsPreviewLayer` from the same pages and the same `frameState` (DOM text, the active word marked from the playhead). It is a fast approximation: it can differ from libass by a pixel or two of letter spacing and by the pop and box animations, so the export panel's **Preview Export** (a 360p render through the same compiler) is the truth check. The editor shows the dotted underline for unsure words and the Safe Area Guide; neither is ever drawn in an export.

`buildRenderPlan` takes the clip's words as an input (resolved by the render's prepare step, which downloads the transcript's words for the clip into the plan); nothing is fetched during the render.

### 4. Routes

- `POST /clips/:clipId/captions` `{ styleId, language? }`: calls `ensure` for the clip's video ranges (widened by Sprint 12's handles, so small trims outward need no new listening). If listening is needed it answers 202 `{ job, price }` (the price in AI minutes, charged by Module 02's `ensure`) and the track is added when the job ends; else it adds the track at once and answers `{ clip }`. No speech: 422 `no_speech`. A refusal for too few AI minutes is the 402 `clips_ai_minutes_used`.
- `POST /clips/:clipId/captions/from-file` (**Upload SRT**, CA-1.7): a multipart file, SRT or VTT, up to 1 MB. The engine's `parseSubtitleFile` turns it into a Transcript stored as a TRANSCRIPT asset with `producer: 'supplied'` (never merged into a listened transcript), and the captions track points at it. **No listening, no AI minutes**, no Python call, and it works when the AI service is off. Errors: 413 over 1 MB, 422 `subtitle_file_invalid` ("We could not read any captions in that file. Check that it is an SRT or VTT file."), and cues outside the clip's range are ignored with a note ("12 lines were outside this clip and were skipped"). The style defaults to a page-level highlight (cue times only), and the user can change it.
- `GET /clips/:clipId/words`: the transcript words for the clip's ranges (for the editor and the Transcript pane).
- `POST /clips/:clipId/captions/translate` `{ language }`: priced by `aiMinutesCost('translate', clipMs)` (0.25 per clip minute, minimum 1) and charged through `UsageService.consume` with key `clips.ai:translate:<clipId>:<revision>:<hashOfInput>` (the same input twice is one charge); a TRANSLATE job sends the clip's sentences to the model client (`ai-engine`, a structured call that returns one translated line per sentence; simulated under `AI_SIMULATION`) and stores a second TRANSCRIPT asset for that language whose words carry the original timings spread across each sentence. A failure reverses the charge. The captions track's `language` switches to it. Word-by-word marking is softer in a translation; the style falls back to marking by page.
- Caption styles: `GET /clips/caption-styles` (built-in and the workspace's), `POST`, `PATCH /:id`, `DELETE /:id` (`ClipCaptionStyle`, `prisma-change`; 30 per workspace; the style validated by the engine's schema).

### 5. The Captions Tab (`components/clips/panels/captions-panel.tsx`)

Per blueprint section 4: the four states (no captions, listening, no speech, on); **Add Captions** with its price in AI Minutes only when this stretch is not yet covered, for example **Add Captions (12 AI Minutes)** (price from `aiMinutesCost('listen', ms)` and `covered`), with the chip "38 of 300 AI minutes left" beside it, and **Upload SRT** beside it as a secondary action (a file picker; no price, "No AI minutes used"); the `CaptionStyleTile` grid previewing two real words of the clip; position, size, words at once, letter case, the marked word's colour; the **Safe Area Guide** toggle; **Create A Style** (a dialog with the style's controls and a live preview); **Translate Captions**; **Remove Captions**. Every change is one undo step.

- The tab rail gains **Captions** between Audio and Export.
- On the clip: the captions block is selectable through the handle layer (move and resize only); double-click a word to fix it in place (this clip only writes `edits`; **Replace Everywhere** writes a video-wide fix through Module 02's route). Unsure words (`sure` under a threshold) carry a dotted underline in the editor, never in the export.
- On the timeline: a read-only **Captions** row with one bar per page.
- When the AI service is off: the tab shows "Captions are not available right now. Everything else still works." Existing captions still draw and export (they need only the stored transcript), and **Upload SRT** still works (it needs no AI service).

### 6. Tests

- Engine: section 2, and the version 1 fixtures test.
- ASS writer (`buildAss`): golden files per style (the exact ASS text for a fixed page list); centisecond rounding from absolute times; no `\q2` anywhere; no style tag inside a word for a Tamil and a Hindi sample; page-level output for Tamil and for a translation; emoji stripped into overlay items; `{\r}` reset after every highlighted word.
- Compiler, with the real FFmpeg binary on tiny inputs: render one frame per style at three times (`ffmpeg -ss <t> -frames:v 1`) and compare to expected pixels at known points (the active word's colour at the word's time, the page absent outside it); a Tamil page and a Hindi page with joined letters (no dotted circle: a pixel check on the cluster); an overflow page that the pager breaks into two lines; the fixed frame renders the same twice; a missing font family fails with `font_missing`. The same ASS file rendered at 360p and 1080p puts the caption at the same relative place.
- Preview: `frameState` returns the same active word as the ASS events at sampled times; `CaptionsPreviewLayer` shows the same page text.
- API: add captions (covered and not), no speech, upload SRT (good, VTT, over 1 MB, no cues, cues outside the clip, no AI minutes charged), translate (charge, key, reversal), style routes, tenancy.
- Web: the panel's states, style switching, position by drag, in-place fix and Replace Everywhere, the underline, the guide, the Captions row, Upload SRT, the service-off state.

## Scope

**In**: document version 2, caption mapping, paging and styles, the ASS caption writer and its preview layer, the two fonts, the routes, the Captions tab, Upload SRT, translation, custom styles.
**Out**: the Transcript pane and cutting by text (04), emoji and keyword colouring by AI, dubbing (Module 17), rounded caption boxes (`\p1` drawings, parked), right-to-left scripts (reported, not yet run).

## Tasks

- [ ] Schema version 2, the upgrade step, the version 1 fixtures test.
- [ ] `captions/`: map, pages, styles, script, safe area, width function, SRT parser, with tests.
- [ ] `buildAss` caption support in `render/` and the compiler's `ass` stage; the font manifest check and `font_missing`.
- [ ] `CaptionsPreviewLayer` in `packages/video-preview`, driven by `frameState`.
- [ ] The two added fonts with their licence records and manifest entries.
- [ ] `buildRenderPlan` carries the clip's words.
- [ ] Routes: add captions, upload SRT, words, translate, caption styles (`prisma-change` for `ClipCaptionStyle`).
- [ ] The Captions tab, `CaptionStyleTile`, Create A Style, Upload SRT, the in-place fix, the Captions row.
- [ ] Single-frame checks for every style and both scripts (`ffmpeg -ss ... -frames:v 1`); title-case test green.
- [ ] Playwright once under simulation: add captions, switch style, fix a word, trim, Preview Export, export. Screenshots in `screenshots/`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js captions render document
npx jest --config packages/video-preview/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels
```

## Done When

- Add Captions puts word-by-word captions on a sample clip, matching its recorded speech, in under a minute in simulation, and its price reads in AI Minutes.
- All six styles draw in the editor and in the export; the editor matches the export closely at the checked frames, and Preview Export shows the exact result.
- After a trim, a split, a deleted middle and a 2x part, each caption is still on its word, with no call to the server.
- A fixed word shows fixed; Replace Everywhere changes it in another clip of the same video.
- Tamil and Hindi sample lines render with joined letters in the editor and in the export, and Tamil defaults to a page-level highlight.
- A translated clip shows the translation and can switch back.
- Upload SRT turns a small SRT file into captions on the clip with no AI minutes used.
- A render with a font missing from the manifest fails with `font_missing`.
- Every Sprint 12 clip in the regression set upgrades and plays unchanged.

## Hand Check

With `CLIPS_SIMULATION=true`, `MEDIA_SIMULATION=true`, `AI_SIMULATION=true` and the demo admin, in a clip from the stream sample:

1. Captions tab, Add Captions: "Listening to what is said", then captions on the clip. Play: the spoken word is marked.
2. Click through the six styles. Drag the captions up; change Words At Once to 1.
3. Double-click a word and change it. Use Replace Everywhere on another.
4. Trim five seconds off the start and set a part to 2x: captions are still in step.
5. Turn on the Safe Area Guide and drag the captions into the marked area: the guide shows.
6. Create A Style with another font and colour; apply it.
7. Translate Captions to another language; switch back.
8. Remove the captions, then Upload SRT with a small file of your own: captions appear, and the AI minutes chip did not move.
9. Press Preview Export: the 360p result shows the captions where the editor did. Export at 720p: the captions are in the video as shown.

## Handoff

Module 04 builds the Transcript pane on `GET /clips/:clipId/words` and the same `edits`. Module 09 masks bleeped words in captions and draws the hook title through the same writer. Module 10 saves the caption style in recipes. Module 11's hook clip and montage rely on mapping by segment.
