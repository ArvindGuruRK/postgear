# Module 02: Transcription

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 01](module-01-media-service-foundations.md)
> **Stories**: CA-1.1 (server side), CA-10.1; foundations for CA-1.x, CA-2.x, CA-3.x
> **Next**: [Module 03](module-03-captions.md), [Module 05](module-05-clip-setup-and-highlights-v2.md)

## Goal

After this module any stretch of a video can be turned into text with a time for every word, once. The transcript is a file with a record of which stretches it covers; asking again for a covered stretch costs nothing and starts nothing. There are three ways to listen (a recorded answer for simulation, our own machine, a hosted fast lane), listening is paid for in AI Minutes (charged through Sprint 12's usage meter, reversed on failure), and a benchmark says how fast this machine listens. Checked with `curl`; captions are Module 03.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- Sprint doc: What The Research Settled (items 3 and 4), Jobs (TRANSCRIBE), API Routes (the transcript rows), and its limits section (AI Minutes).
- Decisions: D13-02 (AI Minutes), D13-03 (hosted lane), D13-04 (listen on demand only), D13-05 (Tamil on).
- Sprint 12 research [`12-plans-entitlements-and-usage.md`](../../sprint-12/research/12-plans-entitlements-and-usage.md): `EntitlementResolver`, `UsageService.consume` and `reverse`, the 402 codes, keys like `clips.ai_minutes_per_month`.
- User stories: CA-1.1, CA-10.1; section 5 (no speech, an unsupported language, listening fails).
- Research: [`04-transcription.md`](../research/04-transcription.md), all of it: the options table, the chosen model and settings, word timings, long audio and silence, languages, the cost table, the provider interface and the `Transcript` shape. [`02-libraries.md`](../research/02-libraries.md), the faster-whisper and ctranslate2 rows. [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md), the note that the voice-activity curve should be kept as the `speech` track.
- Code: Module 01's contract pattern and `apps/media`; `packages/video-engine/src/transcript.ts` (the type Sprint 12 reserved); Sprint 12's `ClipJobsService`, `jobProgress`, the ANALYSIS_AUDIO asset, the SIGNALS file; the Sprint 12 entitlements module (`EntitlementsModule`, `UsageService`).

## Design

### 1. The Transcript In The Engine (`packages/video-engine/src/transcript/`, pure)

- `Transcript`: `{ version, language, model, covered: Range[], words: Word[] }`, where a `Word` is `{ i, start, end, text, sure }` in the video's own milliseconds, `i` a stable index, `sure` from 0 to 1. Sentences are derived, not stored: `sentences(transcript)` splits on punctuation and long gaps and returns `{ from, to, wordFrom, wordTo, text }`.
- `covered.ts`: `missingRanges(covered, wanted)`, `mergeRanges`, `isCovered`. A request is rounded outward to whole 30 second blocks so small overlaps do not cause tiny extra jobs.
- `merge.ts`: `mergeTranscript(existing, incoming)` joins a new stretch into the file, re-numbering nothing that already has an index (word fixes are keyed by index and time).
- `fixes.ts`: word fixes kept for the whole video: `{ at, text }` keyed by the word's start time, applied when a transcript is read (`applyFixes`), so re-listening keeps them. `replaceEverywhere(transcript, from, to)`.
- `window.ts`: `wordsInRange(transcript, fromMs, toMs)`.
- Tests for each, including merging overlapping stretches and fixes surviving a re-listen.

### 2. The Contract And The Python Side

- `mediaPyTranscribe`: input `{ version, audioKey, ranges, languageHint?, model }`; output `{ transcriptKey, language, speechTrackKey, secondsListened, noSpeech }`. Fixtures on both sides.
- `services/transcribe.py`: fetch the 16 kHz analysis sound to scratch, cut the asked ranges, run the bound provider on each with heartbeats per chunk (the heartbeat detail records how far it got, so a retry resumes), write words with times shifted back into the video's time, and write the voice-activity curve at 2 a second as the `speech` track.
- Providers (`providers/transcribe/`):
  - `simulation`: reads the recorded transcript beside each sample and returns the words inside the asked ranges.
  - `faster_whisper`: the model from `WHISPER_MODEL`, the compute settings research 04 gives for a machine with no graphics card, word timings on, its built-in voice detection on so silence and music are skipped. The model is downloaded once into the cache folder on first real use; a line in the log says so.
  - `groq`: sends each chunk (cut to stay under the size limit research 04 names) and asks for word timings; only bound when `TRANSCRIBER=groq` and a key is set. Errors and rate limits become retries with back-off.
- A stretch with no speech returns `noSpeech: true` for that stretch and no words; the file still records it as covered, so it is never listened to again.
- Languages: `LANGUAGES` in the contract (the list research 04 confirms), with `auto`. An unsupported hint is refused before anything is charged.

### 3. The Job And The Routes

- `ClipJobKind` gains `TRANSCRIBE`; `ClipAssetKind` gains `TRANSCRIPT` (`prisma-change`).
- `ClipTranscriptsService.ensure(orgId, videoId, range, language)`: the one door every feature uses. It reads the video's TRANSCRIPT asset (if any), works out the missing ranges, and if there are none answers at once. Otherwise it prices the missing stretch with `aiMinutesCost('listen', ms)` (pure, in `video-engine/src/pricing.ts`: 1.0 for each minute of video listened to, whole minutes rounded up, 2 at least), checks the entitlement `clips.ai_minutes_per_month`, creates the TRANSCRIBE job (its id is made before the charge), charges through `UsageService.consume(orgId, 'clips.ai_minutes_per_month', price, { idempotencyKey: 'clips.ai:listen:<jobId>', refId: jobId })` and starts it. A covered range charges nothing and a stretch is charged once per step (the unique key). Too few AI minutes left is the 402 `clips_ai_minutes_used`: "This workspace has used all its AI minutes for this month. They reset on 1 December." with **See Plans**. A video being listened to for an overlapping range is not started twice (the second caller is given the running job).
- `clipTranscribeWorkflow` (`postgear-media`): stage `listening`; calls `mediaPyTranscribe`; merges the result into the video's transcript file (`mergeTranscript`), stores it as the TRANSCRIPT asset (one per video and language, replaced in place), merges the `speech` track into the SIGNALS file; marks DONE. Failure: FAILED, the charge is reversed with `UsageService.reverse(entryId)` (key `rev:<entryId>`, so a job that fails twice cannot reverse twice), "We could not finish listening to this video. Your AI minutes were given back." No speech at all in the asked range: DONE with `output.noSpeech`, and the charge is reversed (nothing was heard).
- Routes: `POST /clips/videos/:videoId/transcript` (202 with the job and its price in AI minutes, or 200 `{ covered: true }`), `GET /clips/videos/:videoId/transcript?fromMs&toMs` (the words in range with fixes applied, and `covered`), `PATCH /clips/videos/:videoId/transcript/words` (fixes and Replace Everywhere, stored in the asset's `meta`).
- `GET /clips/status` gains `ai.captions` (true when the service is up) and `prices.listen` (in AI minutes, from `aiMinutesCost`). The "38 of 300 AI minutes left" chip reads the meter from `GET /entitlements/me`.
- Transcript text is never logged, and never placed in a notification.

### 4. The Benchmark

`npm run clips:listen-benchmark` (real mode, with Arvind's OK, since it downloads a model): listens to one minute and ten minutes of a real recording Arvind supplies with the default model and with `small`, and prints the seconds taken for each second of sound, the peak memory and the processor count. Write the table in the Progress notes. Module 15 and the plan limits read it; if the default is slower than real time on this machine, say so plainly and suggest `small` for local real runs.

### 5. Tests

- Engine: section 1.
- Python: the service with a fake provider (ranges cut and shifted correctly, heartbeat resume, no-speech stretches, the speech track's rate), the simulation provider on each sample, the Groq binding against recorded answers (chunk sizes, an error then a retry).
- Node and API: `ensure` (covered, partly covered, already running, the price, the charge, the duplicate key and the reversal), the merge into an existing file, word fixes surviving a re-listen, tenancy, no text in logs (a test that captures the logger).
- One cross-language test under simulation: a TRANSCRIBE job on the stream sample ends with a TRANSCRIPT asset whose words fall inside the asked range.

## Scope

**In**: the transcript's shape and pure helpers, the contract entry, the Python service with three providers, the job, `ensure`, the routes, the speech track, the AI Minutes charge and reversal, the benchmark.
**Out**: captions (03), any transcript UI (04), reading transcripts for moments (05), translation (03), who is speaking by voice.

## Tasks

- [ ] `transcript/`: types, covered ranges, merge, fixes, windows, sentences, with tests.
- [ ] `mediaPyTranscribe` in the contract with fixtures; the generated model.
- [ ] `services/transcribe.py` and the three providers; recorded transcripts for the three samples.
- [ ] Enum values (`prisma-change`); `ClipTranscriptsService.ensure`; `clipTranscribeWorkflow`.
- [ ] The three routes; `ai.captions` and the price in the status.
- [ ] `aiMinutesCost('listen', ms)` in `pricing.ts`; the `UsageService.consume` charge and the `reverse` paths (failure, no speech); the 402 `clips_ai_minutes_used`.
- [ ] The benchmark script; its table in the Progress notes (only with Arvind's OK).
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js transcript
npx jest --config packages/media-contract/jest.config.js
npm run test --workspace=apps/media
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/worker/jest.config.js clips
```

## Done When

- Under simulation, asking for the transcript of a two minute stretch of the stream sample returns its words, each with a start and an end inside the stretch.
- Asking again for the same stretch answers at once, starts no job and charges nothing; asking for a wider stretch listens only to the new part and charges only for it.
- A fix to one word is still there after the video is listened to again.
- A stretch with no speech is recorded as covered and its charge is reversed.
- A forced failure reverses the charge and says so.
- Listening to a ten minute stretch is priced 10 AI minutes (a 1 minute stretch, 2), and an empty allowance gives `clips_ai_minutes_used` before any job starts.
- No transcript text appears in any log line.

## Hand Check

With `CLIPS_SIMULATION=true`, `MEDIA_SIMULATION=true` and the demo admin, by `curl` or the console:

1. `POST /clips/videos/<stream sample>/transcript` `{ fromMs: 60000, toMs: 180000 }`: 202, the AI minutes meter went down; watch the job: "listening", done.
2. `GET .../transcript?fromMs=60000&toMs=180000`: words with times.
3. The same POST again: `covered: true`, AI minutes unchanged.
4. POST for 0 to 240000: only the new part is listened to.
5. `PATCH .../transcript/words` with a fix; GET shows it; POST a re-listen of a range (force it in simulation): the fix is still there.
6. On the 3 minute talk sample's silent stretch: `noSpeech`, and the AI minutes come back.

## Handoff

Module 03 calls `ensure` for a clip's range and draws the words. Module 04 edits through word indexes and reads the `speech` track for silences. Module 05 reads `sentences()`. Module 09 finds words to bleep. Module 15 reads the benchmark, audits the `listen` price and adds queue priority.
