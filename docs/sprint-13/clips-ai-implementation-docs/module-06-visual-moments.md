# Module 06: Visual Moments

> **Sprint 13, Clips AI** | Status: Done (2026-11-26) | Size: M (one session)
> **Depends on**: [Module 05](module-05-clip-setup-and-highlights-v2.md)
> **Stories**: CA-3.3
> **Next**: [Module 07](module-07-face-detection-and-detect-camera.md)

## Goal

After this module Clip Setup has **Look For Action**. When it is on, the run also measures how much the picture moves, finds sudden bursts, and (behind a second switch) shows a few still pictures of each burst to the AI model with closed questions, to decide whether something notable happened and to describe it in a line. Moments found this way join the same list with reasons like "Sudden movement on screen". The screen says plainly that this finds sudden action and does not know the rules of any game.

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 2 (the switch and its price), 3 (the extra line on a clip).
- User stories: Journey B steps 1 and 2; CA-3.3.
- Decisions: D13-02 (AI Minutes), D13-07 (the vision check is off by default; the real test decides). Sprint 12 research [`12-plans-entitlements-and-usage.md`](../../sprint-12/research/12-plans-entitlements-and-usage.md) for the meter.
- Research: [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md), the visual moments section: cheap signals first (frame difference, scene cut density, agreement with sound), the optional check on stills with closed questions, its cost, the honest limits, and that game-specific detectors (reading a kill feed) are out of scope. [`07-cost-deploy-and-risks.md`](../research/07-cost-deploy-and-risks.md), sending pictures to a model provider.
- Code: Module 01's contract pattern; Sprint 12 Module 16's tracks, `normalise`, `findHighlights` and `tuning.ts`; Module 05's `blend.ts`, the internal pick route and the workflow; `packages/ai-engine` (a structured call with image input: check what the model client supports and add the smallest extension it needs).

## Design

### 1. The Motion Track

- Contract: `mediaPyMotion` in `{ version, proxyKey, ranges, sampleFps }` out `{ trackKey }`. `mediaPyStills` in `{ version, key, momentsMs, width }` out `{ keys }` (small JPEG stills in the private space under the video's prefix, removed after the run).
- Python `services/motion.py`: decode the light copy at a low rate (2 a second, small size), compute the mean absolute difference between successive pictures (OpenCV), and write it as the `motion` track at 2 a second. A scene cut produces a spike in this measure too, so the engine subtracts cuts using the `scene` track (a spike that coincides with a cut is a cut, not action).
- Simulated provider: a recorded track for each sample (the stream sample's facts JSON already names its "bursts").
- `packages/video-engine/src/signals/`: `motion` joins the registry with its version; `motionBursts(motion, scene)` returns the bursts after removing cuts; `tuning.ts` gains a weight for motion and the rule that motion counts for more when the sound rises with it or just after it.

### 2. The Check On Stills (Behind `CLIPS_ACTION_VISION`)

- For each of the best motion bursts not already explained by a transcript pick (at most 12 a run), `mediaPyStills` cuts four stills across the burst (just before, at the peak, just after, two seconds after) at about 768 px wide.
- `packages/ai-engine` agent `still-checker.ts`: one structured call per burst with the four stills and closed questions: is there a clear sudden event (yes or no), which kind (a crash or fall, a win or score, a surprise, a visual gag, nothing notable), how sure (0 to 1), and one plain sentence of at most 15 words saying what is seen. The system text says not to guess game rules, names or outcomes that are not visible, and not to describe people beyond what they are doing.
- A burst the model calls "nothing notable" or is unsure of is dropped. Others become candidates with the reason "Something unexpected happens" (or "Sudden movement on screen" when the check is off) and the model's sentence as the clip's extra line.
- With `CLIPS_ACTION_VISION=false` (the default) bursts are used on their own, with a lower weight and no sentence. The price is the same either way; the setup's help line says which is on: "We also look at a few still pictures of each burst." appears only when it is.
- Simulated answers for the samples through `AI_SIMULATION`.
- Stills are deleted when the run ends, whatever its outcome.

### 3. The Run

- The setup schema's `action` switch is live; `setupPrice` adds the `action` line, `aiMinutesCost('action', rangeMs)` (0.5 per minute of the range, whole minutes rounded up, minimum 1), charged through `UsageService.consume` with the key `clips.ai:action:<jobId>` (one charge per step per job) as part of Module 05's run; a failed run reverses it with `UsageService.reverse`. The price is the same with the vision check on or off.
- `clipHighlightsWorkflow` gains the `watching` stage after `reading`: `mediaPyMotion` (skipped when the track exists at this version for the range), bursts in the engine, then, when the switch allows, stills and the internal route `POST /internal/clips/highlights/check-stills`.
- `blend.ts` takes the action candidates as a third input: an action burst inside a transcript pick adds its reason and sentence to that clip; alone, it becomes its own clip with a window built as Sprint 12 builds signal windows (a lead-in so the build-up is included), origin `AI_SIGNALS`.
- `Clip` rows gain the sentence in `reasons` metadata: store it as the clip's `meta.seen` (a small optional JSON on `Clip`, `prisma-change`), not in `reasons`, which stay short.

### 4. The UI

- Clip Setup: **Look For Action** (`Toggle`) with "+N AI Minutes" (for example **Look For Action (+8 AI Minutes)**; the form's chip "38 of 300 AI minutes left" and the disabled-button rule are Module 05's) and the help "Finds sudden action in the picture. It does not know the rules of your game."
- Results: clips found this way show the extra line in `type-muted` under the reasons; the list's note reads "AI listened to what was said and watched for action."
- `GET /clips/status` `ai.action` and `ai.actionVision` drive what is shown.

### 5. Tests

- Engine: `motionBursts` (a cut is not a burst; a burst with rising sound scores higher), the three-way blend.
- Python: the motion measure on tiny synthetic clips (a still picture gives a flat track; a sudden change gives one spike), the stills cutter (count, size, cleanup).
- `ai-engine`: the still checker's schema and prompt snapshot; "nothing notable" drops the burst.
- API and worker: the price, the `watching` stage with fakes, stills deleted on success and on failure, the switch off path.
- Web: the switch, its price and help, the extra line.

## Scope

**In**: the motion track, bursts, the optional check on stills, the `watching` stage, the blend, the switch and the extra line.
**Out**: reading on-screen text or kill feeds, game-specific detectors, object tracking, laughter detection (Module 17), any training of our own.

## Tasks

- [x] `mediaPyMotion` and `mediaPyStills` in the contract with fixtures; the Python services; simulated tracks.
- [x] `motion` in the registry; `motionBursts`; tuning.
- [x] The still checker agent, its simulated answers, the internal route.
- [x] The `watching` stage; the three-way blend; `Clip.meta.seen`.
- [x] The setup switch, price, help; the results' extra line.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js signals highlights
npm run test --workspace=apps/media
npx jest --config packages/ai-engine/jest.config.js still-checker
npx jest --config apps/worker/jest.config.js clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/setup
```

## Done When

- With Look For Action on, the stream sample's known bursts come back as clips with "Sudden movement on screen", and with the vision switch on they carry a sentence about what is seen.
- A hard cut alone does not produce an action clip.
- The price shows in AI Minutes before the run and is charged once (a second press with the same job key charges nothing), and a failed run gives it back.
- With the vision switch off, no picture leaves the system.
- Stills are gone from storage after every run.

## Hand Check

With the three simulation flags on and the demo admin, on the stream sample:

1. Clip Setup: turn on Look For Action. The price in AI Minutes rises; the help line is there.
2. Find Clips: the steps include "Watching for action". Some clips now carry "Sudden movement on screen".
3. Set `CLIPS_ACTION_VISION="true"`, restart, run again: those clips have a sentence, and the reason reads "Something unexpected happens".
4. In the private bucket there are no still pictures left under the video's folder.

## Handoff

Module 07 reuses the Python decode loop for faces. The real-test plan judges action picks on a real gameplay stream, and Arvind decides there whether the vision switch goes on.
