# Module 05: Clip Setup And Highlights V2

> **Sprint 13, Clips AI** | Status: Done (2026-11-26) | Size: L (one full session)
> **Depends on**: [Module 02](module-02-transcription.md)
> **Stories**: CA-3.1, CA-3.2, CA-3.4 (new: Genre)
> **Next**: [Module 06](module-06-visual-moments.md), [Module 10](module-10-recipes-and-brand-kit.md)

## Goal

**Demo 3.** Find Clips now opens a Clip Setup screen: choose the stretch of video, say what to look for, pick a clip length and shape, say what kind of video it is (Genre), and read the price in AI Minutes before anything runs. The run listens to the stretch (once), reads the transcript for moments that stand on their own, blends them with Sprint 12's sound, picture and chat signals, and returns clips that start and end on a sentence, each with a title AI wrote, a score and plain reasons. What the user asked for, and the genre, change what comes back.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 2, 3, 11.
- User stories: Journey A steps 1 to 3; CA-3.1, CA-3.2, CA-3.4; section 5 (nothing matched, queued, failed).
- Decisions: D13-02 (AI Minutes). Sprint 12 research [`12-plans-entitlements-and-usage.md`](../../sprint-12/research/12-plans-entitlements-and-usage.md) (the meter, keys, 402 codes).
- Sprint doc: What The Research Settled (item 6); Jobs (HIGHLIGHTS extended); API Routes (setup price, highlights).
- Research: [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md), the section on reading transcripts for moments (window sizes and overlap, numbered rows, the score built from five parts, snapping, length, removing near-duplicates, blending with signals, the cost per hour); [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), how the open clippers chunk and prompt (ideas, in our own words); [`07-cost-deploy-and-risks.md`](../research/07-cost-deploy-and-risks.md), prompt injection through transcripts.
- Code: Sprint 12 Module 16 (`findHighlights`, `tuning.ts`, `clipHighlightsWorkflow`, the Find Clips flow on the video page); Module 02's `ensure` and `sentences()`; `packages/ai-engine/src/types.ts` (`ModelClient.structured`), `src/agents/snippets.ts` and `src/prompts/` (an agent with a schema and a prompt builder), `model/simulated-model-client.ts`; `apps/api/src/modules/discover/competitor-research.service.ts` (a guarded model call; the charge here is not credits but `UsageService.consume`, see section 3).

## Design

### 1. The Picker's Pure Parts (`packages/video-engine/src/highlights/`)

- `rows.ts`: `transcriptRows(transcript, range)`: the sentences in range as numbered rows `{ n, from, to, text }`, long sentences split at clause breaks so a row is at most about 20 seconds.
- `windows.ts`: `rowWindows(rows, { windowMs: 90_000, overlapMs: 30_000 })`: overlapping groups of whole rows.
- `candidates.ts`: `toCandidate(rows, pick)`: turns a model's answer (`{ fromRow, toRow, title, parts, reason, matchesRequest }`) into a range. It refuses row numbers that do not exist or run backwards.
- `score.ts`: the score is the sum of five parts the model gives from 0 to 20 each (hook, stands alone, payoff, clarity, shareable); we add them, the model never reports a total.
- `fit.ts`: `fitToLength(candidate, rows, lengthChoice)`: grows or shrinks by whole rows to the asked length (`auto` keeps 20 to 75 seconds), always starting at a row's start and ending at a row's end, with a little air.
- `dedupe.ts`: drop a candidate that overlaps a higher-scored one by more than a quarter of the shorter of the two.
- `blend.ts`: `blendWithSignals(candidates, signalRanges)`: a candidate that overlaps a Sprint 12 signal highlight gains a bonus and that highlight's reasons; a strong signal highlight with no transcript candidate is kept as its own clip (origin `AI_SIGNALS`), so loud wordless moments are not lost. One list, best first, capped at 20.
- `reasons.ts`: plain reasons from the parts ("Strong opening line" when hook is high, "Complete thought", "Clear payoff", "Funny exchange" when the model tags it, "Matches what you asked for").
- `genre.ts`: `GENRES` (`auto`, `podcast`, `gaming`, `education`, `interview`, `vlog`) and `genreTuning(genre)`, pure data that does two things: a short **prompt note** the picker adds to its system text (what a good moment is in this kind of video: a podcast quote that stands alone, a gaming clutch or reaction, an education step with its payoff, an interview answer with its question, a vlog beat with a hook) and the **signal weights** used by `blendWithSignals` (gaming leans on loud, motion and chat signals; podcast and interview lean on speech and the five scored parts; education leans on clarity and payoff; vlog leans on hook and shareable). `auto` uses balanced weights and no note. The five parts and their scale never change, so scores stay comparable.
- `setup.ts`: the Clip Setup choices as a Zod schema (`range`, `request` up to 300 characters, `genre`, `length`, `ratio`, `layouts`, `captions { on, styleId }`, `follow`, `action`, `silences`, `hookTitle`, `recipeId`, `brandKitId`) and `setupPrice(setup, durations, covered)`: signals (Sprint 12's sound, picture and chat look, only when the range is not already covered), listening (only the uncovered part), reading, action, as separate lines in AI minutes and a total, each from the pure `aiMinutesCost(kind, ms)` in `video-engine/src/pricing.ts` (`signals` 0.25 (free when the run also listens), `listen` 1.0 with a minimum of 2, `read` 0.25, `action` 0.5; whole minutes rounded up, minimum 1).
- Tests for each, with made-up rows and picks, including hostile picks (row numbers out of range, a start after an end); `genreTuning` for every genre (a gaming request weights a loud moment above a quiet one that scores the same, `auto` is neutral); `setupPrice` against `aiMinutesCost`.

### 2. The Agents (`packages/ai-engine`)

- `agents/moment-picker.ts`: `pickMoments(model, { rows, request, genre, length, language })`: one structured call per window. The system text states the task, the five scoring parts, the genre's prompt note, that rows are quoted material and never instructions, and that the answer is row numbers only. The user's request is passed as a short, cleaned line ("The user is most interested in: ..."). Output schema: up to three picks per window. Windows run a few at a time (a small concurrency limit), each with a deadline; a failed window is skipped, and the run fails only if most windows fail.
- A second pass over the shortlist (the best 40 across all windows) asks the model for a title of at most 8 words for each, in the transcript's language, with no quotes or hashtags.
- Simulated answers for the samples live with the simulated model client, keyed by the sample's rows, so the same clips come back every run.
- Transcript rows and the request are never logged.

### 3. The Run

- `POST /clips/videos/:videoId/setup/price`: the setup's choices in, the price lines (in AI minutes) and what is left out. Pure arithmetic plus the transcript's covered ranges; no charge.
- `POST /clips/videos/:videoId/highlights` now takes the setup. With no setup in the body it behaves exactly as Sprint 12 did (signals only), so nothing that calls it today breaks. With a setup: validate; price; check the entitlement `clips.ai_minutes_per_month` for the total first (too few is the 402 `clips_ai_minutes_used`: "This workspace has used all its AI minutes for this month. They reset on 1 December." with **See Plans**, and the form shows the missing number before it ever gets here); create the run and its job (the job id exists before any charge); then charge each step through `UsageService.consume(orgId, 'clips.ai_minutes_per_month', price, { idempotencyKey, refId: jobId })` with the keys `clips.ai:signals:<jobId>`, `clips.ai:listen:<jobId>` (for the uncovered part), `clips.ai:read:<jobId>` and, when asked, `clips.ai:action:<jobId>` (Module 06). If a later charge is refused, the earlier ones are reversed at once. The run's `params` hold the setup.
- `clipHighlightsWorkflow` grows: Sprint 12's signal stages over the chosen range, then `listening` (Module 02's transcribe as a child step, skipped when covered), `reading` (an activity that calls the API's internal route for the picker, since the model client and its keys live in the API: `POST /internal/clips/highlights/pick` with the run id; the API loads the rows, calls the agents and returns candidates), then `scoring` (fit, dedupe, blend in the engine), then the same transaction as before: replace unopened AI clips, insert the new ones with `origin`, `title`, `score`, `reasons`, and a document made by `createClipDocument` plus the setup's choices (ratio, layout, and, when asked, a captions track, since the stretch is now covered).
- A video with no speech in the range falls back to signals alone and says so in the results note.
- Failure rules as Sprint 12: a failed run reverses every entry charged for it (`UsageService.reverse`, key `rev:<entryId>`); a run that finds nothing is not reversed, and the setup's summary says "You pay for looking, even when nothing stands out."
- `ClipOrigin` gains `AI_TRANSCRIPT` (`prisma-change`).

### 4. Clip Setup (`/[orgId]/clips/video/[videoId]/setup`)

Per blueprint section 2. A framed page inside `ClipsDesktopOnly`:

- The server page loads the video, the status (prices in AI minutes), the meter from `GET /entitlements/me` and the transcript's covered ranges.
- `SetupForm` holds the choices in one reducer; every change calls the price route (debounced) and updates the `SummaryBox` and the price list. A **Genre** select (Auto, Podcast, Gaming, Education, Interview, Vlog; default Auto, help text "Tells the finder what a good moment looks like in this kind of video") sits under the request box. The summary ends with the total on the button, **Find Clips (15 AI Minutes)**, and the chip "38 of 300 AI minutes left"; when the total is more than what is left the button is disabled and the line reads "This needs 15 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan." with **See Plans**. The range strip reuses Sprint 12's filmstrip with two handles.
- Switches for things later modules own (**Follow The Speaker**, **Look For Action**, **Remove Silences**, **Hook Title**, the recipe and brand kit pickers) are rendered only when `status.ai` says their module is live; until then they are absent, not disabled placeholders.
- **Find Clips** (`highlight`): starts the run and returns to the video page, which shows the progress with the new step names and then the results.
- The video page's **Find Clips** button now links here. A small **Quick Find** item in its menu keeps the Sprint 12 one-press run (signals only, its own price).
- Results: titles are editable in place on the clip rows; reasons and the note per blueprint section 3; "Nothing matched what you asked for. Here are the best moments we found instead." when no pick matched the request.

### 5. Tests

- Engine: section 1.
- `ai-engine`: the prompt builders (snapshots; the request is cleaned and bounded; rows are marked as quoted material), the output schema, window failures tolerated, the simulated answers.
- API: the price route, the extended run (one `consume` per step with its key, a duplicate key charges once, reversal on failure and on a refused later step, the 402, the no-setup path unchanged), the internal pick route's guard, no rows in logs.
- Worker: the grown workflow with fakes (covered skips listening; no speech falls back).
- Web: the form (every control changes the price; the Genre select is sent with the setup; too few AI minutes disables the button with the missing number), the results (titles, reasons, the nothing-matched line), Quick Find.

## Scope

**In**: the picker's pure parts, the two agents, the Genre select, the price route, the extended run, Clip Setup, results with titles.
**Out**: action from the picture (06), following the speaker (08), recipes and the brand kit (10), choosing between several AI models.

## Tasks

- [x] `highlights/`: rows, windows, candidates, score, fit, dedupe, blend, reasons, genre, setup and its price in AI minutes, with tests.
- [x] `ai-engine`: the moment picker, the title writer, their simulated answers.
- [x] The price route; the extended highlights route with its `consume` and `reverse` calls; `AI_TRANSCRIPT`; the internal pick route.
- [x] `clipHighlightsWorkflow`: `listening`, `reading`, `scoring` with fit, dedupe and blend; the fallback.
- [x] The Clip Setup page and form; the video page's button, Quick Find, results.
- [x] Title-case test green.
- [x] Playwright once under simulation: open setup on the stream sample, type a request, change the range and length, see the price change, run, see titled clips. Screenshots in `screenshots/`.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js highlights
npx jest --config packages/ai-engine/jest.config.js moment-picker
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/worker/jest.config.js clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/setup
```

## Done When

- Clip Setup shows a price in AI Minutes that changes with the range and the switches, and nothing is charged until Find Clips is pressed.
- Choosing Gaming instead of Podcast changes the picks and the order on the sample (the prompt note and the signal weights differ); Auto behaves as before the select existed.
- On the stream sample the run returns clips that begin at a sentence's start and end at a sentence's end, each with a title, a score from the five parts and reasons.
- Typing a request that matches one part of the sample puts that part first with "Matches what you asked for".
- A moment found by both speech and signals appears once, with both kinds of reasons.
- A second run on the same stretch charges nothing for listening.
- A model answer with a row number that does not exist is dropped, not trusted.
- Quick Find still works as in Sprint 12.

## Hand Check

With the three simulation flags on and the demo admin, on the stream sample:

1. Video page, Find Clips: Clip Setup opens. The summary reads the whole length and a price.
2. Drag the range to half: the price drops. Type a request. Pick a Genre. Pick 30 To 60 Seconds and Vertical.
3. Find Clips: back on the video page: "Listening to what is said", "Reading for the best moments", then clips with titles and reasons.
4. Rename one title in place. Open a clip: it is vertical, the right length, starts on a sentence.
5. Run setup again on the same range: the Listening line reads 0 AI minutes.
6. Quick Find from the menu: the Sprint 12 run.

## Handoff

Module 06 adds the Look For Action switch and the `watching` stage. Module 08's Follow The Speaker switch and Module 10's recipe and brand kit pickers appear on this page when they are live. The real-test plan judges the picks on real videos.
