# Module 04: Transcript Editing And Speech Cleanup

> **Sprint 13, Clips AI** | Status: Done (2026-11-26) | Size: L (one full session)
> **Depends on**: [Module 03](module-03-captions.md)
> **Stories**: CA-2.1, CA-2.2, CA-2.3
> **Next**: [Module 09](module-09-ai-effects.md) (AI Effects)

## Goal

**Demo 2.** The editor gets a Transcript pane: the clip's words beside the clip, the spoken word marked as it plays. Click a word to jump there, select a sentence and press Delete and the video cuts with it, one button removes pauses and another removes filler words, each showing what it will remove first. On the video page the transcript can be searched, and a selected stretch of text becomes a clip. Everything here is the segment list from Sprint 12 doing more work; there is no new structure in the document.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 3 (the transcript sheet on the video page), 5 (the pane), 13 (the open question on columns).
- User stories: Journey A steps 5 to 7; CA-2.x; section 5 (a delete that leaves under 3 seconds).
- Sprint doc: What The Research Settled (item 8).
- Research: [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md), the speech cleanup section (cuts between words, tiny fades, a shortest cut, why the transcriber's own silence settings are wrong for this and the `speech` track is used instead, filler words from word timings). [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), `auto-editor` and the clippers' silence logic (ideas only where the licence says so).
- Code: `packages/video-engine/src/time/edits.ts` (`splitAt`, `removeSegment`, `replaceItems`), `transcript/`, `captions/map.ts`; Sprint 12's editor store (`apply`, undo), `PlaybackStore`, the timeline; Module 03's words route and in-place fix; Sprint 12's video page.

## Design

### 1. Cutting By Words In The Engine (`cleanup/`, pure)

- `cut-range.ts`: `removeSourceRange(doc, sourceId, fromMs, toMs)`: removes a stretch of the video from the clip wherever it is played: every segment that overlaps it is split and the middle dropped. It refuses when the result would be shorter than `CLIP_MIN_MS` ("A clip needs at least 3 seconds.") or would leave no segment. `restoreSourceRange` is not needed: undo covers it, and Restore (below) re-inserts a stretch by merging neighbouring segments back (`healSegments(doc, sourceId, fromMs, toMs)`, which only succeeds when the two neighbours are otherwise untouched).
- `word-cuts.ts`: `cutForWords(transcript, wordFrom, wordTo)`: the stretch to remove for a selection of words: from the midpoint of the gap before the first word to the midpoint of the gap after the last, never inside a word, and at least 80 ms. Adjacent cuts merge.
- `silences.ts`: `findSilences(speechTrack, transcript, { minMs })`: stretches where the `speech` track is low and no word is spoken, at least `minMs` long (0.5 to 2 seconds, default 0.8), each shortened to leave 150 ms of air at both ends so speech does not sound clipped. Returns ranges and their total.
- `fillers.ts`: `findFillers(transcript, language)`: words matching a small per-language list (English: "um", "uh", "erm", "you know", "like" only when it stands alone between pauses; Hindi and Tamil lists start empty with a note), each with its cut from `cutForWords`. Returns them grouped by word with counts.
- `removedWords(doc, transcript)`: the words of the clip's wider range that are not played, so the pane can show them struck through.
- A tiny fade at every cut is the render compiler's job (section 2), not the document's.
- Tests: cuts land between words; merging; the minimum length refusal; silences keep air; fillers only when alone; `removedWords` after several cuts.

### 2. The Render Compiler

`compileFfmpeg` (in `packages/video-engine/src/render/`) gives every audio segment a 15 ms `afade` in and out at every boundary between two segments that are not continuous (a cut of the same source, or a join of different sources), so cuts never click: an unfaded join stepped 25 times the tone's own largest step, a faded one did not (research 09 sections 6 and 11, verified on FFmpeg 9.0.2). The clip's start and end get no fade of their own, and a kept piece too short to hold two 15 ms fades has its fade clamped to a third of the piece. Picture cuts stay hard: a plain `concat` of per-segment `trim` chains with `setpts=PTS-STARTPTS`, no filter on the picture at the join. `buildRenderPlan` aligns every segment boundary to a whole frame (it rounds once per segment), so a clip with thirty or more parts stays exact, and the compiler asserts the output duration against the plan. Segments of one source are grouped into runs, each opened with its own `-ss` input, so a clip from hour two of a stream does not decode the first hour (research 09 section 6). The browser preview (`PreviewEngine`) plays the same segments and fades the sound with Web Audio gain ramps from the same `frameState`; **Preview Export** shows the exact join.

### 3. The Transcript Pane (`components/clips/transcript/`)

- `TranscriptText` (a new design-system piece, on `/dev/components` first): renders words as inline spans with states: normal, spoken (marked), selected, removed (struck through and dimmed), unsure (dotted underline), outside (dimmed context). Keyboard: arrows move a caret by word, Shift extends the selection, Enter jumps the playhead, Delete cuts. It is a read-and-select surface, not a text field; fixing a word opens a small field in place.
- `TranscriptPane`: opened by **Transcript** in the top bar (a ghost button with a `TooltipHint` and the shortcut **T**). Per the blueprint's open question, opening it collapses the panel to its rail so there are at most three columns; the rail still switches tabs and re-opens the panel (which closes the pane). Whether it was open is remembered per user.
- It loads `GET /clips/:clipId/words` once and derives everything else from the document: the spoken word from `PlaybackStore` (mapped through the time map), removed words from `removedWords`.
- Click a word: seek to it. Double-click: fix it (Module 03's edit; **Replace Everywhere** offered when the word occurs again).
- Select and **Delete** (or Backspace): `apply(removeSourceRange(...cutForWords...))`, one undo step. The cut text stays, struck through; hovering it shows **Restore**, which heals it when it can, and otherwise says "Use Undo to bring this back."
- Paragraphs break at long pauses; each shows its time in the margin.
- A note at the top when many words are unsure: "Some words were hard to hear. Check the underlined ones."
- If the clip's video has no transcript for its range yet, the pane shows **Listen To This Clip** (`highlight`, with the price), which calls Module 02's `ensure` (the button reads for example **Listen To This Clip (12 AI Minutes)**, with the "38 of 300 AI minutes left" chip; the 402 `clips_ai_minutes_used` shows its sentence and **See Plans**).

### 4. Remove Silences And Remove Filler Words

At the foot of the pane, two secondary buttons, each opening a popover first:

- **Remove Silences**: "7 pauses, 4.2 seconds", a `Slider` for the shortest pause to remove (0.5 to 2 seconds; the count updates as it moves), and **Remove**. Applies every cut in one `apply`, one undo step. Nothing found: "No pauses longer than 0.8 seconds."
- **Remove Filler Words**: the words found, each with its count and a tick (all ticked), and **Remove**. Nothing found: "No filler words found."
- After either, a toast reads the result ("Removed 7 pauses. The clip is 4.2 seconds shorter.") with **Undo**.
- Captions, zooms, crops and items on a moment all follow by themselves (Sprint 12's rules).

### 5. The Video Page's Transcript

- A **Transcript** button in the video page's `PageActions` (shown when the video has any transcript; otherwise it offers **Listen To This Video** with its price in AI Minutes for the whole length).
- It opens a right-hand `Sheet` with `TranscriptText` for the covered parts of the video (uncovered parts show as "Not listened to yet" gaps with a small **Listen** link). A find field inside the sheet (Ctrl+F while the sheet is open; a field inside a sheet for finding within its own text, like a browser's find, not a second page search) highlights matches and steps through them.
- Clicking a word seeks the source player. Selecting a stretch and pressing **Create Clip** (enabled between `CLIP_MIN_MS` and `CLIP_MAX_MS`) makes a clip from the first word's start to the last word's end, with a little air.

### 6. Tests

- Engine: section 1.
- Web: `TranscriptText` (states, caret and selection by keyboard, Delete emits the word range), the pane (the spoken word follows playback, delete cuts and strikes through, Restore heals or explains, the minimum length refusal, panel collapse), both popovers (counts change with the slider, one undo step, nothing-found lines), the video page sheet (find, seek, Create Clip from a selection).
- A compiler test with the real FFmpeg binary: a clip with twenty cuts exports to the frame count and duration the plan predicts (frame-exact), a 300 Hz tone cut and joined has no step at the joins, and a graph of 150 segments (about 31 KB) renders through `-/filter_complex`.
- By ear in the Hand Check: no click at cuts.

## Scope

**In**: cutting by words, silences and fillers in the engine, the fade at cuts, the Transcript pane, both cleanup tools, the video page's transcript sheet with find and clip-from-text.
**Out**: removing "bad takes", rewriting speech, typing new words to make the voice say them, exporting the transcript as a file (Module 17).

## Tasks

- [x] `cleanup/`: `removeSourceRange`, `healSegments`, `cutForWords`, `findSilences`, `findFillers`, `removedWords`, with tests.
- [x] The 15 ms `afade` at cuts and the per-run `-ss` inputs in `compileFfmpeg`; the matching gain ramps in `PreviewEngine`; frame alignment check for many parts.
- [x] `TranscriptText` with a playground demo.
- [x] `TranscriptPane`: load, follow, seek, fix, delete, Restore, panel collapse, Listen To This Clip.
- [x] Remove Silences and Remove Filler Words with their popovers and toasts.
- [x] The video page's sheet: find, seek, Create Clip from text, Listen.
- [x] Title-case test green.
- [x] Playwright once under simulation: open the pane, delete a sentence, remove silences, undo, export. Screenshots in `screenshots/`.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js cleanup render
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/transcript apps/web/src/components/clips/video
npx jest --config packages/ui/jest.config.js transcript-text
```

## Done When

- The pane shows the clip's words and marks the spoken one as it plays.
- Deleting a selected sentence removes it from the video between words, strikes it through in the pane, and one Ctrl+Z brings back the words, the video and the captions together.
- Remove Silences and Remove Filler Words each say what they found first and each undo in one step.
- A delete that would leave under 3 seconds is refused with its sentence.
- Cuts do not click in the export, and Preview Export has the same joins.
- On the video page, finding a word jumps to it, and a selected stretch becomes a clip.

## Hand Check

With the three simulation flags on and the demo admin, in a captioned clip from the stream sample:

1. Press T: the pane opens, the panel folds to its rail. Play: the marked word moves.
2. Click a word far down: the playhead jumps.
3. Select a sentence and press Delete: it is struck through, the clip is shorter, the captions closed up. Hover it: Restore. Undo instead.
4. Remove Silences: read the count, move the slider, Remove. Listen: no clicks.
5. Remove Filler Words: untick one, Remove.
6. Video page, Transcript: find a word, click it, select two sentences, Create Clip.

## Handoff

Module 09's bleep and hook title read the same words. Module 05 reuses `TranscriptText` nowhere but reads `sentences()`. Module 10 stores "remove silences" and its slider value in recipes and applies them through `findSilences`.
