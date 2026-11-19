# Module 16: AI Highlights (Signals)

> **Sprint 12, Clips** | Status: Done with gaps (2026-11-19; see the README Progress row) | Size: L (one full session)
> **Depends on**: [Module 04](module-04-import-pipeline.md), [Module 07](module-07-manual-clipping-and-clips-library.md)
> **Stories**: CL-4.1, CL-4.2, CL-4.3, CL-4.4
> **Next**: [Module 17](module-17-send-to-composer.md), [Module 19](module-19-retention-quotas-and-safety.md)

## Goal

**Demo 5.** On a video's page a user presses **Find Clips**, pays the AI Minutes shown on the button, watches the steps in words, and gets up to 20 scored clips with plain reasons and marks on the timeline. The moments come from signals only: how loud the sound gets, where the picture cuts, how fast Twitch chat moves, and (when YouTube gives it) which parts viewers replayed most. Nothing here reads speech; that is Sprint 13, and the scorer is built so speech, faces and motion become more tracks, not a rewrite.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names, signal tracks, job stages).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 4 (clip cards with a score), 5 (the right column, the AI note), 10 (Find Clips Again), 11.
- User stories: Journey A steps 5 and 6; CL-4.x; section 5 (no sound, chat cannot be read, out of AI minutes, a failed run).
- Sprint doc: What The Research Settled (item 6); Providers (`SignalProducer`, the scorer); Database (`ClipHighlightRun`, `Clip.origin`, `score`, `reasons`); the limits section.
- Research: [`06-highlight-signals.md`](../research/06-highlight-signals.md), all of it: the exact FFmpeg filters and their output, the chat route and why it is behind a switch, the proposed scorer with its starting weights, the track file format, the honest limits. [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), the highlight finders (a baseline from the video itself, short windows merged and padded, weights plus a bonus when signals agree; Twitch muted parts are silent and must be skipped).
- Research for the meter: [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), sections 7 (the charge, the key, the reversal) and 13 (the sentence when minutes run out).
- Code: `packages/video-engine/src/signals/types.ts` and `src/pricing.ts` (`aiMinutesCost`); Module 04's ANALYSIS_AUDIO asset and peaks; Module 02's `runTool`, `jobProgress`, `ClipJobsService`; Module 03's sample facts JSON and chat fixture; `apps/api/src/modules/entitlements/` from Module 01 (`UsageService.consume` and `reverse`, the refusal exception); `apps/api/src/modules/discover/competitor-research.service.ts` (the shape: price, charge, call, give back on failure; it uses AI credits, which Clips does not); Module 06's `AiMinutesChip`; `apps/web/src/components/seo/analyze-form.tsx` (the cannot-afford alert); Module 07's `SourceTimeline` and `VideoClipList`.

## Design

### 1. Tracks (`packages/video-engine/src/signals/`, pure)

- `SignalTrack` is `{ name, version, sampleRateHz, startSec, unit, values }`: one number per sample at a fixed rate (2 a second is enough for every track), `values` a plain number array in the engine and a compact file on disk. `TRACKS` is the registry: `loudness` (LUFS, short-term), `scene` (a cut score from 0 to 1), `chat` (messages a second), `replayed` (0 to 1, YouTube's heat map), each with a version; `speech`, `faces` and `motion` are reserved names for Sprint 13.
- `signals/file.ts`: encode and decode the stored form (one gzipped JSON holding every track of a video with their headers), small enough to load in one read for a 6 hour video (research 06 has the size estimate).
- `signals/normalise.ts`: turn a track into "how unusual is this moment for this video": a rolling median and spread over a few minutes each side, giving a robust z-score, clamped. Loudness is clamped at a floor first (silence reads as a very low number). Gaps (muted or missing stretches) are marked as "no data" and never score.

### 2. The Scorer (`signals/score.ts`, pure)

`findHighlights(tracks, options)` returns `HighlightRange[]`: `{ fromMs, toMs, score, reasons }`. The steps, each a small tested function (the starting numbers are research 06's and are constants in one file, `signals/tuning.ts`, version `signals-v1`):

1. Normalise each track that is present.
2. Shift the chat track earlier by its usual lag (viewers type after the moment; research 06 gives about 25 seconds) so it lines up with the sound.
3. Combine: a weighted sum of the present tracks, with the weights re-scaled to add to one whatever subset is present, plus a bonus when two or more tracks are high together.
4. Pick peaks at least a minimum distance apart (two minutes to start with), strongest first, up to `maxClips` (20).
5. Build a window around each peak: a lead-in before it and a tail after, then snap each end to the nearest scene cut within a few seconds, then clamp the length to 15 to 60 seconds. Merge windows that overlap.
6. Score each from 0 to 100 against this video's own range, and attach up to three reasons from the tracks that drove it: "Loud reaction", "Chat exploded", "Fast cuts", "Sudden silence then noise", "Viewers replayed this".
7. Drop anything under a floor; return nothing rather than weak picks.

Rules: it must work with any subset of tracks (loudness alone, scene alone); a chat track with too few messages (research 06's floor of about 500 an hour) is ignored; a video with no usable track returns an empty list. The function is deterministic.

Tests: synthetic tracks with planted peaks (found, in order, with the right reasons); the lag shift; missing tracks; a flat track gives nothing; windows snap and clamp; overlaps merge; the stream sample's recorded tracks give its known moments.

### 3. Producers (`packages/media-tools/src/signals/`, real and simulated)

Each implements `SignalProducer` and returns a track or null:

- **Loudness**: FFmpeg's `ebur128` over the ANALYSIS_AUDIO file, parsed from its per-100 ms metadata lines and reduced to 2 a second. Null when the video has no sound.
- **Scene**: FFmpeg's `scdet` over the proxy, decoding keyframes only (research 06 measured that this, not a lower frame rate, is what makes it fast), giving a score per sampled frame, binned to 2 a second.
- **Chat** (Twitch past streams only, only when `CLIPS_TWITCH_CHAT=true`): pages through the chat replay the way research 06 describes (a route Twitch does not document, with a query id that Twitch changes from time to time; the id is one constant, `TWITCH_CHAT_QUERY`, overridable by env so it can be fixed without a release). Messages become a rate per half second; nothing else about them is kept: no names, no text is stored. Any failure, a channel with replay off, or a refused request returns null and logs one line. It is never retried in a loop.
- **Replayed** (YouTube): built from `LinkInfo.replayed` saved at import, when present.
- Simulated bindings read the recorded tracks beside the sample videos.

### 4. The Run

- `POST /clips/videos/:videoId/highlights`: the video must be READY; 409 `highlights_running` if a run is active. The price is `aiMinutesCost('signals', durationMs)` (0.25 AI minutes per video minute, rounded up, at least 1: a 60 minute video costs 15). The `ClipJob` id is made first, then `UsageService.consume('clips.ai_minutes_per_month', price, { idempotencyKey: 'clips.ai:signals:<runId>', refId })` (402 `clips_ai_minutes_used` when short, with the sentence "This needs {need} AI minutes and you have {n} left. They come back on {date}, or you can upgrade the plan."). The run id is part of the key, so a double click or a replayed request charges once. Creates `ClipHighlightRun` (`engineVersion`, `params`, `aiMinutesCharged`) and a HIGHLIGHTS job, and answers 202 with the run, the job and the new meter state (`used`, `remaining`).
- `clipHighlightsWorkflow` (`postgear-media`): stages `loudness`, `scenes`, `chat`, `scoring`, each reporting progress. Tracks already stored for this video at the current versions are reused, not recomputed. The new tracks are written into the video's SIGNALS asset. Then `findHighlights`, then one transaction: delete this video's clips that are `origin: AI_SIGNALS`, status NEW and never opened (older runs' leftovers), insert the new ones (status NEW, `score`, `reasons`, `highlightRunId`, a document from `createClipDocument` at 9:16, titled "{video title} 1", "2" and so on), update the run (`found`, `tracks`, `finishedAt`).
- Failure at any stage: the run and job FAILED, the charge is given back in full with `UsageService.reverse` (a reversal entry, key `rev:<entryId>`, called through the internal route so the worker never holds the ledger), and the sentence is "We could not finish looking for clips. Your AI minutes were given back." A cancelled run is reversed in full too. A run that finds nothing is a success and is not reversed; the price was for looking. Say this in the confirm line (section 5). In Sprint 13 a run that also listens includes this `signals` charge for free; here it is charged on its own.
- AI clips do not fetch the sharp range when they are made. It is fetched the first time one is opened in the editor (`GET /clips/:clipId` starts the SEGMENT job when the clip has none), which is also when NEW becomes DRAFT.
- `GET /clips/videos/:videoId/highlights`: the latest run with its state and the tracks it used.

### 5. The Video Page

- **Find Clips** (`Button variant="highlight"`) now works, with the price in the label ("Find Clips (15 AI Minutes)") and the `AiMinutesChip` ("38 of 300 AI minutes left") under it. Too few AI minutes: the button is disabled and an `Alert variant="warning"` gives the sentence from the stories ("This workspace has used all its AI minutes for this month. They reset on 1 December." when none are left, the "needs {need} and you have {n}" sentence when some are) with **See Plans**.
- A second run asks first (`AlertDialog`): "Find clips again? New clips you have not opened will be replaced. This costs 15 AI minutes."
- While it runs the button becomes a `Progress` with the step in words ("Listening for loud moments", "Looking for scene changes", "Reading the chat", "Picking the best moments") and **Cancel** (a cancelled run gives the minutes back).
- When done: the list shows AI clips best first, each with a score chip, up to three reasons, **Play**, **Edit**, **Hide** and the menu; hand-made clips follow under a `GroupLabel`. `SourceTimeline` draws a small flag at each AI clip's start; clicking it plays the clip.
- Notes, in `type-muted`: always "AI in this version listens and watches for action. It does not understand speech yet."; when the video had no sound, "This video has no sound, so we looked at the picture only."; when nothing was found, "We did not find any stand-out moments. You can still mark clips by hand."
- A small "How this was found" line under the list names the tracks used ("Sound and picture", or "Sound, picture and chat").

### 6. Tests

- Engine: everything in sections 1 and 2.
- Tools: the FFmpeg argument builders and the parsers against captured output (research 06 has real samples), the chat pager against recorded pages (ends, an error mid-way returns null, replay off returns null), the rate builder keeps no text.
- Engine: `aiMinutesCost('signals', ...)` for a 3, 10, 60 and 360 minute video and a 20 second one (the minimum of 1).
- API: the price, the charge (once for two identical requests; refused past the allowance with the typed 402 and the right numbers), the reversal paths (failure, cancel, not on an empty result), the running refusal, the replace-only-unopened rule, tenancy.
- Worker: the workflow with fake producers (reuse of stored tracks, a failed producer does not fail the run, a failed scorer gives the minutes back).
- Web: the button states, the confirm, progress labels, the list order and reasons, flags on the timeline, each note.

## Scope

**In**: tracks, the file format, normalising, the scorer and its tuning file, the four producers, the run with its AI Minutes charge, the Find Clips flow, marks and reasons.
**Out**: speech, titles written by AI, a prompt for what to look for, clip length choices, action detection (all Sprint 13); chat for Kick and YouTube; tuning beyond one round.

## Tasks

- [x] `SignalTrack`, the registry, the file format, `normalise`.
- [x] `findHighlights` and `tuning.ts`, with the synthetic and sample tests.
- [x] Producers: loudness, scene, chat (behind its switch), replayed; simulated bindings.
- [x] The route, the run, the AI minutes charge and its reversal, `clipHighlightsWorkflow`, the replace rule, the give-back on failure and cancel.
- [x] The sharp range fetched on first open of an AI clip.
- [x] The video page: button with its AI Minutes price, confirm, progress, list, flags, notes.
- [x] Measure a run on the 10 minute sample and note the time for each stage in the Progress notes.
- [x] Title-case test green.
- [x] `verify-change`; update the Progress table and the Decision Log.

**Gaps at close (2026-11-19)**: The sharp range fetched on the first open of an AI clip is covered by tests only: on the stream sample the sharp video was already there, so the fetch had nothing to do live. The AI minutes chip under the button appears a moment after the page loads (it waits for `GET /entitlements/me`). A flat video's "We did not find any stand-out moments." was checked in the scorer and page tests, not live (the talk sample still finds 3 clips from its sound). Everything ran under `CLIPS_SIMULATION`: loudness and scene changes were measured for real with FFmpeg on the sample files, but chat came only from the recorded fixture, and no real YouTube, Twitch or Kick video or chat was ever read. Kick and YouTube chat stay out (as the Scope says). The light and Lilac themes are left to the hand check.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js signals
npx jest --config packages/media-tools/jest.config.js signals
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/worker/jest.config.js clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/video
```

## Done When

- On the stream sample, Find Clips returns clips on the sample's known moments, best first, each with a score and reasons, and the same ones every run.
- The AI minutes shown on the button are charged once (the meter in `GET /entitlements/me` rises by that number); a forced failure gives them back, shows a reversal entry in the ledger, and says so.
- With chat switched off or failing, the run still succeeds from sound and picture, and "How this was found" says which were used.
- A video with no sound gets its note; a flat video gets "We did not find any stand-out moments."
- Running again replaces only AI clips nobody opened; opened and edited ones stay.
- No chat text or name is stored anywhere.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin, on the 10 minute stream sample:

1. Find Clips shows its price; the chip shows what is left. Press it: four steps in words, then clips.
2. The top clip has a score and reasons; Play plays it; its flag is on the timeline.
3. Hide one. Open another in the editor: it becomes a draft, and the sharp video is fetched.
4. Press Find Clips again: the confirm sentence. Confirm: the hidden and opened ones are still there, the unopened ones are replaced.
5. Use up the AI minutes (set the workspace's `clips.ai_minutes_per_month` override to a small number in psql, or run a few runs) and reload: the button is disabled with the sentence and **See Plans**.
6. On the 3 minute talk sample: few or no clips, with the right note.

## Handoff

Sprint 13 adds `speech`, `faces` and `motion` producers on the Python queue, a transcript-aware picker beside this scorer, and the Clip Setup screen in front of the button; `findHighlights` and the SIGNALS file stay as they are. The real-test plan's R-22 to R-26 judge the picks on real videos, and one tuning round of `tuning.ts` follows from Arvind's marks.
