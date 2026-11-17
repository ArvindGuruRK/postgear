# Sprint 13 Research: The Approach On PostGear

> **Written**: 2026-11-15. How Clips AI sits on top of Sprint 12 as that sprint is specified in `../../sprint-12/`. The sprint doc (`../../sprint-documents/sprint-13-clips-ai.md`) is the binding version of this; this page explains the reasoning and lists what is reused. Sprint 12 was not built when this was written, so every Sprint 12 path below is from its documents, not from code: Module 01 checks them against the build.

## 1. Data Flow

```
Browser                        API (NestJS)                     Node worker (Temporal)            Python worker            Outside
-------                        ------------                     ----------------------            -------------            -------
Clip Setup, Find Clips ------> POST /clips/videos/:id/highlights
                                 price, charge credits
                                 rows: run, ClipJob(HIGHLIGHTS) -> queue postgear-media
                                                                   signals (Sprint 12, reused)
                                                                   TRANSCRIBE step ------------> mediaPyTranscribe
                                                                                                   faster-whisper on the
                                                                                                   16 kHz sound from import  (or the hosted fast lane)
                                                                                                   transcript file + speech track
                                                                   motion step (if asked) -----> mediaPyMotion
                                                                   read the transcript in rows
                                                                   ask the model (ai-engine) -----------------------------> the AI model provider
                                                                   engine: snap, trim, dedup,
                                                                   blend with signals
                                                                   Clip rows: titles, scores

Open a clip, Add Captions ---> POST /clips/:id/captions
                                 covered already? add the track.
                                 else TRANSCRIBE for the clip's range, then add it
Editor                           GET transcript for the clip's range
  the caption pager and the ASS writer draw words through the time map (no times stored in the clip)
  fix a word ----------------> PATCH .../transcript/words       (kept for the whole video)
  delete a sentence              (a pure edit: segments change; autosave as Sprint 12)

Follow The Speaker ----------> POST /clips/:id/faces  ---------> FACES job ---------------------> mediaPyDetectFaces
                                                                                                   boxes at 5 a second
                               GET faces                          engine (pure, in the browser too):
                                                                   people from boxes, pick the speaker,
                                                                   smooth, write crop keyframes

Export (Sprint 12's render) -------------------------------------> the same compiler (`compileFfmpeg`), now with an ASS caption file and the bleep audio filters
```

Python does sound and pictures. Words and judgement (reading a transcript, writing a title, judging a still picture) stay on the Node side in `packages/ai-engine`, behind the model client and `AI_SIMULATION` that already exist.

## 2. Where The Code Goes

| Layer | Path | Notes |
|---|---|---|
| Python service | `apps/media` | FastAPI and a Temporal worker in one process; activities only. Its own lockfile, linted, typed and tested through Turborepo scripts |
| Contract | `packages/media-contract` | Activity names and shapes in Zod, exported to JSON Schema; Python models generated; shared fixtures |
| Engine | `packages/video-engine` | Document version 2; `transcript/` (the file's shape, covered ranges, word edits), `captions/` (the pager, styles, mapping words through the time map), `highlights/` (rows for the model, snapping, dedup, blending), `reframe/` (people from boxes, speaker choice, smoothing to crop keyframes), `recipes/`, `cleanup/` (silences and filler words as segment edits) |
| Render | `packages/video-engine/src/render` (`frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`); `packages/video-preview` (web) | Captions as an ASS file drawn by libass, bleeps as `aeval` audio filters, many segment cuts and montage as filter graph recipes (research 09); the two added fonts in `fontsdir` |
| AI | `packages/ai-engine` | New agents: the moment picker, the title writer, the still-picture checker; each a structured call with a simulated answer |
| API | `apps/api/src/modules/clips` (and `posts`, `channels`, `studio` for small additions) | Transcript, captions, faces, setup, recipes, montage, batch export routes |
| Node worker | `apps/worker/src/clips/` | Workflows that call the Python activities and the model; the HIGHLIGHTS workflow grows |
| Web | `apps/web/src/components/clips/` | `setup/`, `panels/captions-panel.tsx`, `transcript/`, additions to Layouts, Effects, the Clips tab and the composer |
| DB | `packages/db/prisma/schema.prisma` | `ClipRecipe`, `ClipCaptionStyle`, `ClipWordList`, enum values, fields on `BrandKit` and `Integration` |

## 3. Why These Shapes

- **Activities in Python, workflows in TypeScript.** One language owns the order of steps, retries and progress (the one that already does for Sprint 12). Python is called for the work only it does well. No Python workflows means no second sandbox to understand.
- **A contract package with generated models.** The two sides share shapes written once. The alternative, hand-mirrored models, drifts the first time someone is in a hurry.
- **Transcripts are files with covered ranges.** A six hour stream is not listened to because someone wants captions on forty seconds. The file records which stretches it covers; a new request fills only the gaps; the price is for new stretches only.
- **Captions hold no times.** If captions stored their own times they would need repair after every trim, cut, speed change and hook clip. Stored as "this transcript, this style, these word fixes", they are always right, because the time map is.
- **The model answers in row numbers.** Shown numbered rows of sentences, it picks rows. Times come from the transcript. This removes the most common failure of AI clippers: a start time that does not exist.
- **Following a face is computed in the engine.** Python returns boxes. Turning boxes into a calm moving frame is pure maths, so it runs in the browser, re-runs at once when the user picks Show Both or fixes a stretch by hand, and is tested without a model.
- **Recipes are data.** A recipe is a validated set of the same settings the editor already writes, applied by the same pure edits. It needs no feature of its own beyond storage and a picker.
- **Nothing new in the queue design.** Sprint 12 reserved `postgear-media-py`. Jobs, progress, cancel, reconcile and notifications are Sprint 12's.

## 4. What We Reuse (With Paths)

Sprint 12 paths are as its documents name them.

| Need | Reuse | Path |
|---|---|---|
| The sound to listen to | The 16 kHz analysis sound made at import | `ClipAsset` kind `ANALYSIS_AUDIO` (Sprint 12 Module 04) |
| Jobs, progress, cancel, reconcile | `ClipJob`, the events stream, `jobProgress`, the maintenance sweep | `apps/api/src/modules/clips/`, `apps/worker/src/clips/job-progress.ts` (Sprint 12 Module 02) |
| Storage and deletion | `PrivateStorage`, `ClipAsset`, `removeVideo` | `packages/storage`, Sprint 12 Modules 02 and 19 |
| The time map and edits | `toOutput`, `toSource`, `splitAt`, `removeSegment`, `replaceItems`, `frameState`, `buildRenderPlan` | `packages/video-engine/src/time/` |
| Crops over time | `areaCropAt` (already interpolates between keyframes) | `packages/video-engine/src/layout/` (Sprint 12 Module 10) |
| Signals and the scorer | `SignalTrack`, the SIGNALS file, `findHighlights`, `tuning.ts` | `packages/video-engine/src/signals/` (Sprint 12 Module 16) |
| Text on the clip | `TextItem`, the handle layer, the colour picker, `FontSelect` | Sprint 12 Module 11 |
| Sounds on the clip | `AudioItem`, the sound library, the loudness pass | Sprint 12 Module 14 |
| The render | `clipRenderWorkflow`, `compileFfmpeg`, `buildAss`, `runTool` (argument array, `-progress` parsed), Preview Export | Sprint 12 Modules 05 and 15 (revised 2026-11-17: FFmpeg only, no browser in the render) |
| The link engine | `recogniseLink`, the `Downloader`, `CLIPS_PLATFORMS` | Sprint 12 Module 03 |
| Structured model calls | `ModelClient.structured`, the simulated client, credits around the call | `packages/ai-engine/src/types.ts`, `model/openai-model-client.ts`, `apps/api/src/modules/discover/competitor-research.service.ts` |
| Credits | `CreditsService`, `AI_LEDGER_TYPES` | `apps/api/src/modules/ai/credits/` |
| Brand kits | The `BrandKit` model, its routes and picker | `packages/db/prisma/schema.prisma`, `apps/api/src/modules/studio/`, `apps/web/src/components/studio/` |
| Posting times | `Integration.postingTimes`, `nextFreeSlot()` | `packages/automation/src/queue/next-free-slot.ts`, `apps/api/src/modules/channels/` |
| Per-channel post settings | The provider settings pattern (YouTube's "made for kids") | `packages/social-core/src/providers/youtube/` |
| Simulation wiring | Flags refused in production, a factory behind a DI symbol, fixtures in the package | `apps/api/src/config/env.ts`, `apps/api/src/modules/discover/discover.engine.ts` |
| Bulk actions in a list | `BulkActionBar` | `packages/ui` |

## 5. What Does Not Exist Yet

| Missing | Where it is built |
|---|---|
| Any Python in the repo, a second lockfile, Python in CI | Module 01 |
| A way for TypeScript and Python to share shapes | Module 01 |
| Speech to text of any kind (`ai-engine` has no audio code) | Module 02 |
| Fonts that cover Tamil and Devanagari | Module 03 |
| A transcript view or any text-driven editing | Module 04 |
| An AI label setting on any provider in `social-core` | Module 13 |
| A window on posting times, and Next Available in the composer (the function exists, the button does not) | Module 13 |
| Job priority by plan | Module 14 |

## 6. Page Layout

```
Clip Setup (/clips/video/<id>/setup), a framed page:
+-------------------------------------------------------------+----------------------------+
| [poster]  Spoken Language [ Detect Automatically v ]        | Summary                    |
| Range     [====|=======================|=====]  0:00  58:10 |  58 min                    |
|           Use less of the video to spend fewer credits      |  Listening         6       |
| Recipe [ None v ]              Brand Kit [ None v ]         |  Finding clips     6       |
| What Should We Look For?                                    |  Total            12       |
| [ Enter your idea                                         ] |  44 credits left           |
| Clip Length  Auto | Under 30 Seconds | 30 To 60 | 60 To 90  |                            |
| Shape        Vertical | Horizontal | Square                 | [ Find Clips ]             |
| Layouts AI May Use   [x] Fullscreen [x] Blurred [x] Split   |                            |
| [on ] Captions        style: Bold Pop                       |                            |
| [on ] Follow The Speaker                                    |                            |
| [off] Look For Action                          +6 credits   |                            |
| [off] Remove Silences                                       |                            |
| [on ] Hook Title                                            |                            |
+-------------------------------------------------------------+----------------------------+

Editor with the Transcript pane open:
+--+------------+----------------------+------------------------------------------+
|  | panel      | Transcript           |  top bar                                 |
|T | (Captions) |  ...so I told them I |                                          |
|a |            |  was [quitting] and  |          the clip, captions on it        |
|b |            |  ~~um, you know~~    |                                          |
|s |            |  they laughed...     |  transport                               |
|  |            | [Remove Silences]    +------------------------------------------+
|  |            | [Remove Filler Words]|  timeline: Video, Captions, Overlay, ... |
+--+------------+----------------------+------------------------------------------+
```

See `../clips-ai-implementation-docs/00-ux-blueprint.md`.
