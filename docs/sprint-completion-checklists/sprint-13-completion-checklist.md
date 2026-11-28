# Sprint 13: Completion Checklist & Test Guide

Companion to [sprint-13-clips-ai.md](../sprint-documents/sprint-13-clips-ai.md), the module index
[clips-ai-implementation-docs/README.md](../sprint-13/clips-ai-implementation-docs/README.md)
(Progress table and Decision Log) and the real-test plan
[real-test-plan.md](../sprint-13/real-test-plan.md).
Status as of **2026-11-28**. Branch `sprint-13-clips-ai`, cut from `sprint-12-clips` at its tip
(`3ee7c82`, the merge base). Modules 01 to 13 are on `origin/sprint-13-clips-ai` (last 9641556);
Modules 14 (99f75f6) and 15 (b638547) are local commits; Module 16 (hardening) is uncommitted work
in the tree; Module 17 (the P2 backlog) is parked. Not merged.

Sprint 13 started from Sprint 12's Clips, which could not hear or see: no speech to text, no
Python, no captions, no faces. The only trace of this sprint in the code was a reserved
`packages/video-engine/src/transcript.ts` (segments in seconds, "nothing in Sprint 12 writes or
reads one") and the queue name `postgear-media-py` in `packages/scheduling/src/clips.ts`, polled by
nobody. The clip document was version 1, Design Studio's document version 2, `Role` held
`SUPERADMIN`, `ADMIN` and `USER` only, and a channel's posting times were a flat JSON list of minutes
(`[{"time":120}, ...]`) read by about thirty files.

The **[Pre-existing]** things worth not re-testing: Sprint 12's whole Clips module (the version 1
clip document, the job table, the four Node queues, private storage and signed addresses, the
entitlement registry, `EntitlementResolver`, `UsageService` and the AI Minutes meter, the operator
screen, the worker image with FFmpeg 9.0.2, the sample videos and forcing links); the session
guards, RBAC and the org cookie (Sprint 2); the Temporal worker, retry policy and maintenance
reconcile (Sprint 5); the model client and `AI_SIMULATION` (Sprint 6); Design Studio and brand kits
(Sprint 9); `nextFreeSlot` and the internal token guard (Sprint 10); the design-system components.

**Of the 24 Definition of Done items, 11 are met, 10 are met only in simulation and 3 are met in part
(Upload SRT on the video itself; the added sites with Google's own Drive picker; and `npm run validate`,
red on seven tests that predate the last modules); none is not met.**
Everything ran under `CLIPS_SIMULATION`, `MEDIA_SIMULATION`, `AI_SIMULATION` and
`PUBLISH_SIMULATION`, with a browser pass per module and a test per rule. What has not met the real
world:

- no hosted AI service was called: no Groq (no key), no OpenAI or OpenRouter model, no vision model;
  every moment pick, title, translation and still check came from the simulated model;
- no real face detector ran: MediaPipe and OpenCV were never installed (the `ml` group stayed off),
  so every face box is a recorded one;
- no real video was fetched from any site, no real Google Drive file was read, no real Twitch
  schedule was read, and no platform post was made (the stand-in publisher only);
- no email was sent (Editor invites were printed to the API console or copied as links).

Two local models did run, each once and with the owner's OK, both fetched by hand and never by the
app: faster-whisper `small` for the Module 02 speed benchmark (in a Linux container, on the 60
second Verideck narration, which also became that sample's recorded transcript), and Kokoro v1.0 for
Text To Speech (Module 09: two real voices made, a cancel stopping the program). The default
`large-v3-turbo` was never downloaded or measured. The real-test plan
([§13](#13-what-remains-for-you)) is where real speech, faces, models, sites and platforms are
tried.

---

## Prerequisites

```bash
docker compose up -d                 # Postgres 15, Redis, MinIO, Temporal (:7233), Temporal UI (:8233)
npm install                          # adds @postgear/media-contract and the @postgear/media workspace
cd apps/media && uv sync && cd ../.. # uv installs Python 3.13; base and dev packages, no model library
npm run db:generate
npm run migrate:deploy --workspace=packages/db
#   13 migrations, 20261126120000_sprint13_clips_ai_enums to 20261128160000_sprint13_clip_job_cost
#   (Role.EDITOR alone in 20261128140000_sprint13_role_editor; the members.editors_max plan rows in
#   20261128140100_sprint13_editor_seats_seed)
npm run db:seed
npm run clips:doctor
npm run clips:samples                # adds the generated two-speakers sample, and your own verideck file if present
npm run generate:keys                # one value for MEDIA_INTERNAL_TOKEN
RESEND_API_KEY= npm run dev:api      # blank key: an Editor invite is printed to the console, never sent
WORKER_ROLES=publishing,media,render PUBLISH_SIMULATION=true CLIPS_SIMULATION=true MEDIA_SIMULATION=true AI_SIMULATION=true npm run dev:worker
npm run dev:media                    # FastAPI on :8100 and its Temporal worker on postgear-media-py
npm run dev --workspace=@postgear/web
```

`npm run dev` starts the Python service too, and without uv prints one line and steps aside (every
AI button then shows as off). The local `.env` keeps `PUBLISH_SIMULATION="false"` for real LinkedIn
posts and holds a real Resend key, and dotenv never overrides a variable the shell already set, so
export both as shown.

| Variable | Default | Meaning |
|---|---|---|
| `MEDIA_SIMULATION` | empty (follows `CLIPS_SIMULATION`) | Every Python activity answers from recorded files, no model; refused in production by every process that reads it. **Set `true` locally** |
| `MEDIA_URL` | `http://localhost:8100` | Where the API reads `/ready` for `ai.service` in `GET /clips/status` |
| `MEDIA_INTERNAL_TOKEN` | empty | Sent as `X-PostGear-Internal` to every route but `/health`; required in production |
| `MEDIA_SCRATCH_DIR`, `MEDIA_MODEL_DIR` | system temp, `.cache/media-models` | The service's work folder and model files (never fetched by the app) |
| `MEDIA_MAX_ACTIVITIES`, `MEDIA_RUN_WORKER` | `1`, empty | Python activity slots; `false` runs only the HTTP side |
| `TRANSCRIBER` | `faster-whisper` | Also `auto` (Groq above `TRANSCRIBE_HOSTED_ABOVE_MINUTES`, 55, with a key), `groq`, `simulation` |
| `WHISPER_MODEL` | `large-v3-turbo` | Or `small`; never measured at the default |
| `GROQ_API_KEY` | empty | The hosted lane. **Empty locally: never called** |
| `CLIPS_ACTION_VISION` | `false` | Look For Action also shows stills to the model |
| `CLIPS_TTS` | `false` | The Text To Speech row and `POST /clips/:clipId/voice` |
| `MEDIA_SPEAKER`, `MEDIA_VOICE_PROGRAM` | `auto`, empty | `kokoro` speaks for real even under simulation (local, offline); the program's path |
| `CLIPS_PLATFORMS` | 12 sites (YouTube to Pinterest) | Threads is allowed only with `CLIPS_SIMULATION=true`; TikTok, Instagram, Zoom, Dropbox built and off |
| `GOOGLE_DRIVE_PICKER_KEY`, `GOOGLE_DRIVE_APP_ID` | unset | Pick From Google Drive; under simulation a stand-in picker with made-up files |
| `CLIPS_RENDER_SLOTS`, `CLIPS_MEDIA_SLOTS`, `CLIPS_MEDIA_PY_SLOTS` | `2`, `4`, `2` | The scheduler's slots across every workspace |
| `WORKER_MEDIA_CONCURRENCY` | `6` (was `2`) | At least the media and Python slots together; the worker warns at boot when it is not |
| `OPENROUTER_API_KEY`, `AI_PROVIDER`, `OPENROUTER_APP_URL`, `OPENROUTER_APP_NAME` | empty | A third live AI mode (Module 01). **Unused locally (`AI_SIMULATION=true`)** |
| `CLIPS_AI_LEDGER_DB_TEST`, `EDITOR_SEATS_DB_TEST` | unset | Test only: the meter's and the seats' race tests against the real Postgres |

---

## 1. The media service and its contract: `apps/media`, `packages/media-contract`

| # | Item | Status |
|---|---|---|
| 1.1 | `apps/media` (`postgear_media`): FastAPI `/health`, `/ready`, `/tools`; a Temporal worker on `postgear-media-py`, supervised inside the app's lifespan (Temporal down: HTTP still answers, `/ready` 503); settings from the root `.env`, logging, storage, scratch, the provider factory; Ruff, strict mypy, pytest | ✅ [New] |
| 1.2 | Six activities: `mediaPyHealth`, `mediaPyTranscribe`, `mediaPyDetectFaces`, `mediaPyMotion`, `mediaPyStills`, `mediaPySpeak`; real and simulated bindings per provider; heartbeats and cancel; `plain_failure()` keeps library text out of Temporal's history (Module 16) | ✅ [New]; real faces, motion and stills **never run** (no `ml` group) |
| 1.3 | `packages/media-contract`: shapes written once in Zod (`src/shapes`), `schema/contract.json` exported by `npm run contract:export`, the Pydantic models generated from it (`npm run contract:python`), shared fixtures parsed by Jest and pytest, a freshness test on both sides; no optional keys (nullable and required), unknown fields refused; `./names` for workflow code | ✅ [New] |
| 1.4 | The typed stub `apps/worker/src/clips/media-py.ts`; `clipRuntimeCheckWorkflow` asks `mediaPyHealth`; the API's `MediaServiceProbe` reads `/ready` (2.5 s at most, kept 10 s) for `ai.service`; proven live on the local Temporal (`media-py.live.test.ts`) | ✅ [New] |
| 1.5 | Turborepo runs it through `apps/media/package.json` (`dev` with `--optional`, `lint`, `typecheck`, `test` through `uv run`); CI installs uv (`astral-sh/setup-uv@v6`, `uv sync --locked`) | ✅ [New] |
| 1.6 | `infra/docker/Dockerfile.media`: `slim` (352 MB) and `full` (1.47 GB, the `ml` group), non-root uid 10002, a Python health check, `/licenses`, no model inside; `--build-arg VOICE=kokoro` adds the voice program; compose profile `media-image` forces the simulation flags | ✅ [New]; a listen ran inside the slim image under simulation (Module 15) |
| 1.7 | Samples: the generated `two-speakers` (two shapes taking turns, tones for speech), the owner's own `verideck` (never committed), recorded transcripts, face boxes, motion levels and stills beside them | ✅ [New] |

### 1.8: why Python answers and Node decides

Python does sound and pictures and nothing else: it reads no plan, no ledger and no row, and calls
no language model. The Node worker owns every workflow, the order, the retries and the charges, and
calls each Python activity by name with one JSON object carrying storage keys (never paths or
addresses). One owner of order means a failed or cancelled step is given back in one place, and the
contract test on both sides means the two languages cannot drift apart silently.

```bash
npm run test --workspace=@postgear/media
npx jest --config packages/media-contract/jest.config.js
```

Expect at Module 15 **251 passed, 1 skipped** in Python (the skip is the real OpenCV run) with Ruff
and mypy green; the contract had 59 at Module 06, before Module 16 added `contract.security.test.ts`.

## 2. Listening and the transcript: `packages/video-engine/src/transcript`, `clips/transcripts`

| # | Item | Status |
|---|---|---|
| 2.1 | The engine: words in whole ms with stable indexes, covered ranges, `mergeTranscript`, word fixes, sentences, the asset meta, `speechValues` and `silencesIn` (the speech curve worked out on read), 12 languages whose captions can be drawn | ✅ [New] |
| 2.2 | `TRANSCRIBE` jobs (`clipTranscribeWorkflow`: prepare, Python, finish); one heard file per job (`heard-<job>.json.gz`) merged on the Node side; requests rounded outward to 30 s blocks, at most 64 stretches; a stretch another open job covers joins it (price 0) | ✅ [New]; **in simulation** |
| 2.3 | Routes: `POST /clips/videos/:videoId/transcript`, `/transcript/quote`, `GET /transcript`, `PATCH /transcript/words`; the charge `clips.ai:listen:<jobId>` with its give-back on failure, cancel and no speech | ✅ [New]; **in simulation** |
| 2.4 | Three listeners: recorded answers, faster-whisper (fed plain samples, PyAV never used), Groq; chunks, seams and resume; a retryable failure keeps finished chunks, a cancel or the last attempt removes them (Module 16) | ✅ [New]; faster-whisper run **once** (the benchmark); **Groq never called** |
| 2.5 | Forcing links 900000012 (fails), 900000013 (slow), 900000014 (no speech, Module 16) | ✅ [New] |

### 2.6: the benchmark (Module 02)

Intel i7-8750H, 4 processors given to a Linux container (`onnxruntime` has no Intel Mac build),
faster-whisper `small`, int8, the 60 s Verideck narration: 10.2 s of listening, 0.17 s per second of
sound (5.9 times real time), 4.7 s to load, 997 MB at peak. `TRANSCRIBE_HOSTED_ABOVE_MINUTES` (55)
comes from this figure. `large-v3-turbo` was not measured (only `small` was approved for download),
and only one 60 second recording was used, not one and ten minutes.

Live under simulation on the 10 minute stream: two minutes cost 2 AI minutes and held 188 words; the
same request answered `covered` with no job and no charge; 0 to 240 s listened only to the two new
minutes; the talk sample's silent block ended `noSpeech` with its 2 minutes back. Expect at Module
02: engine transcript 42, contract 44, Python 120, worker transcribe 14, API transcripts 25.

## 3. Captions: `packages/video-engine/src/captions`, `render/caption-ass.ts`, the Captions tab

| # | Item | Status |
|---|---|---|
| 3.1 | Clip document **version 2** (`bleeps`, one captions track, segment roles); `upgrade()` from version 1 changes nothing a Sprint 12 clip relies on | ✅ [New] |
| 3.2 | The captions engine: the word map through the parts, pages, six built-in styles (`bold-pop`, `marker`, `karaoke`, `clean`, `boxed`, `typewriter`), scripts, the safe area, the width estimate, `captionLayout` (one definition the export and the preview both read), the SRT and VTT reader, `translationLines` | ✅ [New] |
| 3.3 | The ASS writer (21 golden tests); Tamil, Hindi and Marathi marked by whole word or page; Noto Sans Tamil and Devanagari in the render font manifest; `font_missing` read from FFmpeg's `fontselect:` lines; a page too wide for its box is drawn smaller (`pageScale`, Module 16) in the export and the preview | ✅ [New] |
| 3.4 | `ClipCaptionStyle` and its routes; `POST /clips/:clipId/captions`, `/captions/from-file`, `/captions/translate`, `GET /clips/:clipId/words`; captions routes answer the track and never write the document (the editor saves it as one undo step) | ✅ [New] |
| 3.5 | Translate runs inside the request (no `TRANSLATE` job), charged with a fresh key per attempt and given back on failure; the stored translation answers a repeat for free | ✅ [New]; **simulated model only** |
| 3.6 | The Captions tab: style tiles, look and place, Safe Area Guide, the word list with the fix, Hide Word and Replace Everywhere, unsure words with a dotted underline, Create A Style, Translate, Remove Captions; the read-only Captions row on the timeline | ✅ [New]; **in simulation** |
| 3.7 | Upload A Captions File (SRT or VTT, up to 2 MB, free, works with the AI service off) on a clip | ✅ [New]; **on a clip only**: no video route, nothing in Clip Setup (§[Known gaps](#known-gaps)) |

### 3.8: why captions store no times

A captions track holds a transcript reference, a style and the person's word fixes. Words and their
times stay in the transcript asset, in the video's own time, and every page on the clip is worked out
through the time map. A trim, a split, a deleted part, a speed change, a hook clip and a montage
therefore keep the words in step without anything to update, and the export and the preview read the
same `captionLayout`. The preview is an approximation; **Preview Export** shows the real file.

```bash
npx jest --config packages/video-engine/jest.config.js captions
npx jest --config packages/media-tools/jest.config.js caption-parity caption-box   # real FFmpeg
npm run clips:captions:stills -- --out caption-stills                              # one still per style, English, Tamil, Hindi
```

Expect at Module 03: engine 1014, AI engine 185, worker 816, preview 82, API Clips 716 (3 old
failures), web Clips 878 (1 old failure), caption parity **8** on the real FFmpeg. Live under
simulation: Translate To Tamil cost 1 AI minute and the repeat was free; a Preview Export with Tamil
captions ended DONE; a file with one line outside the clip said so.

## 4. Transcript editing and speech cleanup: `packages/video-engine/src/cleanup`, `components/clips/transcript`

| # | Item | Status |
|---|---|---|
| 4.1 | The cleanup engine: `removeSourceRanges`, `cutForWords`, `findSilences`, `findFillers`, `removedWords`; cut points on the canvas's frames, a kept piece under 250 ms goes with the cut | ✅ [New] |
| 4.2 | A 15 ms `afade` each side of every real cut, in the export and the loudness pass (version 1 clips too); `MAX_SEGMENTS` 50 to 150 | ✅ [New] |
| 4.3 | The Transcript pane (T): the spoken word followed, click to jump, double-click to fix, Delete cuts as one undo step with a toast, Restore on hover, Listen To This Clip with its price; `TranscriptText` in `packages/ui` | ✅ [New]; **in simulation** |
| 4.4 | Remove Silences (count and length shown first, the slider) and Remove Filler Words (a tick each) | ✅ [New]; the generated samples have **no real pause** (steady tone), so the silence cut was seen in tests only |
| 4.5 | The video page's Transcript sheet: find with Ctrl+F, Create Clip from selected words, gaps with their own Listen | ✅ [New]; **in simulation** |

Expect at Module 04: engine 1043 (cleanup 26), UI 136, preview 84, web Clips 832, API Clips 717,
worker Clips 338, real FFmpeg `cuts-parity` 3 (twenty cuts frame-exact, no click at any cut), and
`npm run clips:regression` green. No cut was checked by ear.

## 5. Smarter Find Clips: Clip Setup, highlights V2, Look For Action

| # | Item | Status |
|---|---|---|
| 5.1 | The picker's pure parts (`packages/video-engine/src/highlights`): numbered `transcriptRows`, `rowWindows`, `momentScore` from five parts, reasons, `fitToLength` on whole sentences, `dedupeByOverlap`, `blendWithSignals`, `genreTuning` for six genres, `setupPrice` | ✅ [New] |
| 5.2 | The AI engine's `pickMoments` (windows three at a time, rows that do not exist dropped) and `writeTitles`; transcript rows quoted with `quotedLine()` and titles cleaned with `stripMarkup()` (Module 16) | ✅ [New]; **simulated model only** |
| 5.3 | `POST /clips/videos/:videoId/setup/price`; `POST .../highlights` with `{ setup }` (no body stays Quick Find); `clips.ai:read:<jobId>`; the run's steps Listening, Reading, Scoring, Watching | ✅ [New]; **in simulation** |
| 5.4 | Clip Setup at `/[orgId]/clips/video/[videoId]/setup`: range, Genre, What Should We Look For?, length, shape, recipe and brand kit, the switches, the Summary with the price and minutes left, the privacy hint (Module 15) | ✅ [New]; the range is a two-handle slider, **not drawn over the filmstrip** |
| 5.5 | Look For Action: `mediaPyMotion` and `mediaPyStills`, `motionBursts`, the still checker (closed questions, one sentence), `clips.ai:action:<jobId>`, stills deleted after every run; `CLIPS_ACTION_VISION` off by default | ✅ [New]; **recorded motion and simulated answers**; OpenCV never ran |

Expect at Module 05: engine highlights 18 (engine 1061), AI engine moments 12 (197), API highlights 20,
moments 6, routes 24, worker highlights 25, web setup 7 and Find Clips 21; at Module 06: contract 59,
Python 152 (1 skipped), engine 1072, AI engine 205 (still checker 7), API highlights and stills 30,
worker watch 7 and Clips workflows 27, web 33. Live under simulation: "the tunnel jump", Gaming, 30
To 60 Seconds and Vertical charged 4 and made titled vertical clips of 33 to 36 s; vision on, 28
stills cut in 44 ms, 4 bursts with a sentence, 3 dropped, no still left in the video's folder.

## 6. Faces, Detect Camera and Follow The Speaker: `packages/video-engine/src/reframe`

| # | Item | Status |
|---|---|---|
| 6.1 | `mediaPyDetectFaces` and the `FaceTracksFile` shape (boxes and times only; a test fails if the file gains a key); 5 pictures a second, at most 8 faces | ✅ [New]; **recorded boxes only** |
| 6.2 | The MediaPipe binding (BlazeFace short range, never downloads, off without the model file) | ✅ [New]; **never run** |
| 6.3 | The engine: `linkPeople`, `smoothBoxes`, `findFaceCamera`, `chooseSubjects` (speech, mouth-like box change, size), `followPath` and `followBoth` (head room, dead zone, cuts at speaker changes, lost stretches held and reported, hand fixes), every threshold in `tuning.ts` | ✅ [New] |
| 6.4 | `POST` and `GET /clips/:clipId/faces` (free, a covering file reused); `FACES` jobs; face files deleted with a failed job and with the video | ✅ [New] |
| 6.5 | The export writes the moving crop with `sendcmd` command files (`render/crop-path.ts`); still crops byte-identical | ✅ [New] |
| 6.6 | The editor: Detect Camera, the Follow The Speaker switch, Show Both, the many-faces picker, `SpeakerStrip`, Fix By Hand, follow on first open, unfollow before any layout change in the same step | ✅ [New]; **in simulation** |

Expect at Module 07: Python 13, engine 15, API 9, worker 12, web 7; at Module 08: engine 1137 (the
two-speakers check: all 16 turns within 500 ms, the lost stretch found), render 231 with every
snapshot unchanged, real FFmpeg `reframe-parity` 4, UI 140, web layouts 88, worker highlights 39,
Python 180 (1 skipped). Live under simulation: the frame cut at 70.7 s for the 70.5 s turn, "We lost
the speaker for 3 seconds here." on the 60 to 63 s stretch, a 720p export drew the moving crop.

## 7. AI effects, recipes, brand kit, montage (Modules 09 to 11)

| # | Item | Status |
|---|---|---|
| 7.1 | Bleep Bad Words: `findBleepWords`, PostGear's own lists (English, Hindi; Tamil empty), My Words (`ClipWordList`, `GET`/`PUT /clips/word-list`), caption stars; the export's balanced `aeval` gate with 5 ms ramps and one 1 kHz tone | ✅ [New]; **in simulation** (recorded words) |
| 7.2 | Add Hook Title (`POST /clips/:clipId/hook-titles`, free, 10 a minute, Try Again; three looks) and Add Hook Clip (a `hook` segment played first, suggested from the loudest moment) | ✅ [New]; titles from the **simulated model** |
| 7.3 | Text To Speech: `mediaPySpeak`, `clipSpeechWorkflow`, `POST /clips/:clipId/voice` (1 AI minute per 1,000 characters, reversed on failure and cancel), `GET /clips/voices`, `usesAiVoice`; Kokoro v1.0 as its own GPL program (`apps/media/voice-program`), ten voices with samples; `CLIPS_TTS` off by default | ✅ [New]; **Kokoro ran for real on this laptop** (about 9 to 12 s a line); beeps under simulation |
| 7.4 | Recipes: `recipeSettingsSchema`, `applyRecipe` with `skipped`, `ClipRecipe` (workspace rows), `GET/POST/PATCH/DELETE /clips/recipes`, Duplicate, `POST /clips/:clipId/apply-recipe`, `ClipRecipeApplierService` for setup runs; five starters with fixed ids and a Built In badge | ✅ [New] |
| 7.5 | Auto-Edit Video: `AUTO_EDIT` jobs (`clipAutoEditWorkflow`), price first, listening only what is not covered; a missing part is named (the Follow skip is a toast on first open, Module 16) | ✅ [New]; **in simulation** |
| 7.6 | Brand kit: six clip fields on `BrandKit`, `GET`/`PATCH /clips/brand-kits`, `/use`, the logo on its own track, intro and outro (`ClipVideo` ids), the 2 s closing card | ✅ [New]; a kit logo seen **only in tests** (`brand-parity`), the seeded kit has none |
| 7.7 | Export All: `POST /clips/exports` (30 at most), the fair render queue, one batch notice, the Exporting chip | ✅ [New] |
| 7.8 | Create Montage: `POST /clips/montages` (origin `MONTAGE`, Cut or Fade, up to 20 sources, a shape when shapes differ), bulk `PATCH`/`DELETE /clips/bulk`, `xfade` and `acrossfade` joins | ✅ [New] |

### 7.9: why Kokoro runs as its own program

`kokoro-onnx` loads espeak-ng, which is GPL-3.0, into whatever process imports it, so the licence
chain fails for in-process use (decision D13-06). The voice runs like FFmpeg: a separate program
with its own uv environment and licence, started per line with the text in a scratch file, a clean
environment (no token or key) and raw audio out. The media service never imports it (a test fails if
it does). The model files were fetched by hand once with the owner's OK; no code downloads them.

Expect at Module 09: engine 1206, real FFmpeg `bleep-parity` 4, preview 102, AI engine 220, worker
891; at Module 10: engine 1311, preview 118, `brand-parity`, API Clips and Studio 1295 (3 old
failures), worker Clips 336; at Module 11: engine 1368, preview 124, render montage 24, real FFmpeg
`montage-parity` 3, API Clips and notifications 1051 of 1054 (the 3 old), worker 904, web Clips and
lib 1094 of 1096. Live: the 720p export had the tone on both words and the hook first; Auto-Edit made
one 5:32 clip of 95 parts from the stream; "3 clips are ready." rang once; a Fade montage exported
at 45.553 s with both pictures mixed at the join.

## 8. More sources and the publisher (Modules 12 and 13)

| # | Item | Status |
|---|---|---|
| 8.1 | `links/sites.ts`: one table of 17 sites (12 on by default: YouTube, Twitch, Kick, Vimeo, Rumble, Dailymotion, Loom, X, Facebook, LinkedIn, Reddit, Pinterest); TikTok, Instagram, Zoom and Dropbox built and off; Riverside and StreamYard upload only; `ClipPlatform` widened by 14 values | ✅ [New]; **fixtures only** |
| 8.2 | Threads: built, refused before any tool, and allowed in `CLIPS_PLATFORMS` only under simulation (the pinned yt-dlp has no Threads reader) | **Partly**: cannot be switched on for real |
| 8.3 | The yt-dlp binding from the table (own extractors only, no login or user cookies for new sites), the playlist rule (`link_many_videos`), site-named refusals; a retried import probes its link again (Module 16) | ✅ [New]; **in simulation** |
| 8.4 | Google Drive: `POST /clips/videos/drive` (facts first, stored as an upload, token sealed with `encrypt` and wiped at once and on failure or cancel), Google's picker with the keys, a stand-in picker under simulation | ✅ [New]; **stand-in picker only** |
| 8.5 | Posting slots in the same JSON list (`{ time, windowMinutes, days }`, windows 0, 5, 15, 30); the migration gives every old time window 0 and seven days; `jitteredTime`, `findFreeSlot`, `suggestSlots`, `randomTimeOfDay` (pure, `packages/automation`); saved through `PATCH /channels/:id` | ✅ [New] |
| 8.6 | `GET /channels/next-slot` (the browser's zone, a fresh seed per press, asked again on save); Add To Queue jittered and seeded by run and step; a post placed by hand is never moved | ✅ [New] |
| 8.7 | Made With AI: `Post.madeWithAi`, `aiLabel` per provider (YouTube `status.containsSyntheticMedia`, both Instagram providers `is_ai_generated`; the rest `'none'`), Send To Composer marks a clip with a made-up voice, the stand-in link ends `?ai=label` | ✅ [New]; **in simulation**; YouTube by tests only |
| 8.8 | The web: Manage Posting Time Slots (weekday chips, windows), Shuffle Times, Next Available, the `DateTimePicker`'s Pick A Random Time tab, the Made With AI control | ✅ [New] |

Expect at Module 12: engine sites 92, media-tools sites 73 and Drive 9, API links 55; at Module 13:
automation 29 new (purity 14), API next-slot 5, social-core `ai-label` 4, web slots 7 and composer
10. Live: Vimeo, Rumble and Reddit cards; Threads and TikTok paused; a Drive stand-in file came in as
an upload with the token null in the job row; Next Available gave two posts different minutes; an
Instagram post stored `madeWithAi` with the stand-in link ending `?ai=label`.

## 9. Creator Tools and Editor seats (Module 14)

| # | Item | Status |
|---|---|---|
| 9.1 | `Role.EDITOR` in its own migration; `members.editors_max` (FREE 0, STANDARD 1, PRO 3, TEAM 10, ULTIMATE 25); `capabilities.ts` shared by the API and the web, checked against Prisma's `Role` at compile time (`role-parity.ts`) | ✅ [New] |
| 9.2 | The route matrix `apps/api/src/common/guards/editor-access.json`: **381 routes** (allow 156, deny 118, draft-only 3, open 51, public 53), with a decorator spec and a real-`RolesGuard` spec that fail on a route without an entry | ✅ [New] |
| 9.3 | `assertEditorMayWrite` (drafts only) in posts and every draft writer; `PUT /posts/:group/schedule` and publish-now refuse an Editor; `Post.createdById`; channel connect closed to Editors | ✅ [New] |
| 9.4 | `EditorSeatsService`: soft check at invite, hard check at accept under `pg_advisory_xact_lock`, role change re-checked, a disabled Editor not counted, a downgrade disables nobody; `GET /orgs/:id/seats`; Editor invites bound to an address | ✅ [New]; **no real email sent** |
| 9.5 | Every refusal of an Editor reads "Editors cannot do this. Ask an admin." (`editor_forbidden`, from `RolesGuard`, Module 16); `rbac.denied` and four member events in the security log, ids only | ✅ [New] |
| 9.6 | The web: `RoleGate` in ten section layouts, `role-checks.test.tsx` (no role compared by name anywhere), the reduced rail, the composer's Save As Draft only, calendar and queue read only, the invite dialog's Editor tile and seat line | ✅ [New] |
| 9.7 | Emote Maker: `emotes/` profiles, ladder and plan; `EMOTE` jobs (`clipEmoteWorkflow`, 30 min); GIF, WebP and APNG with header-read facts, a zip; `POST /clips/emotes/export`, `GET /clips/emotes/:jobId` (one download each); the chat preview; Make An Emote in a clip's menu | ✅ [New]; real FFmpeg on **local samples**; no platform page read |
| 9.8 | Schedule Maker: design schema version 3 (`rows` slot, `schedule` role), `schedule-week@1`, five themes, the pure time module (zones, clock change, midnight); `POST /studio/schedules/fetch` (shared app token, cached 10 minutes, 10 a minute); the wizard and the editor's Schedule panel | ✅ [New]; **recorded Twitch weeks only** |

```bash
npx jest --config apps/api/jest.config.js apps/api/src/common/guards
EDITOR_SEATS_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js editor-seats.race
```

The second is the race against the real Postgres: five accepts for the last seat admit one. No test
count was recorded at Module 14; its hand check passed as admin and as an Editor (screenshots
`s13-m14-*`). Module 16's `editor-seats.security.spec.ts` adds 79 tests.

## 10. Queue, cost and deploy (Module 15)

| # | Item | Status |
|---|---|---|
| 10.1 | `ClipSchedulerService`: one scheduler for every Clips start, three classes (`render`, `media-py`, `media`), a serializable claim, priority from `clips.queue_priority` aged one step every 10 minutes, served-longest-ago turns; paid AI jobs start only while their charge stands | ✅ [New] |
| 10.2 | "Waiting for our turn", "about N minutes" (an EWMA pace in Redis), "Plans with a higher priority go first." | ✅ [New] |
| 10.3 | `ClipJob.costCents` and `cost`, `ClipCostService` from `clip-prices.ts`, `GET /operator/clips/costs` and the operator Costs tab | ✅ [New]; model tokens and pictures **estimated** |
| 10.4 | The AI Minutes audit: `clips-ai-charges.ts`, one test per AI route, the no-free-route and charge-site audits; four uncharged paths closed | ✅ [New] |
| 10.5 | `TRANSCRIBER=auto` with a fallback to our own machine; `hostedLane` in `/ready` and the status | ✅ [New]; **no Groq call** |
| 10.6 | Deletion: five leaks closed (emote exports, preview exports, unused voices and stickers, a removed montage's preview, the sweep's removed rows); removing a video deletes its private folder | ✅ [New] |

Expect at Module 15 lint and typecheck **57 of 57**, Python 251 passed and 1 skipped. Live: one slot
held three Find Clips runs with "about 2 minutes"; a High run started before an earlier Low one; a
failed listen charged 10 and gave 10 back.

## 11. Hardening (Module 16, uncommitted)

| # | Item | Status |
|---|---|---|
| 11.1 | The AI-side sweep, a test per line: `apps/media/tests/test_service_security.py`, `test_speech_text_security.py`, `contract.security.test.ts`, `clips-prompts.security.test.ts`, the worker's `speech-text.security.test.ts` and `env.security.test.ts`, the API's `audit/*.security.spec.ts`, `clip-moments.security.spec.ts`, `media-service.security.spec.ts`, `env.security.spec.ts`; seven bugs fixed (§[Review findings](#review-findings-fixed-before-closing-2026-11-28)) | ✅ [New] |
| 11.2 | The creator-side sweep: `editor-seats.security.spec.ts` (79), `clip-emotes`, `schedules`, `studio-tenancy` (document version 3), `clip-drive`, `links/sites`, `publisher-tenancy`, video-engine `captions` and `document-v2`, media-tools `sites` and `caption-box` (real FFmpeg); four bugs fixed | ✅ [New] |
| 11.3 | Edge cases: all 35 rows of the stories' section 5 have a test (`clips-ai.edge-cases` in the API, worker, web and video-engine, `moments.edge-cases`, `simulation.edge-cases`, `random-time.edge-cases`, `test_edge_cases.py`); four bugs fixed | ✅ [New] |
| 11.4 | Two new forcing switches: link 900000014 (nobody speaks) and `[simulate:model-bad-rows]`; the busy queue is `CLIPS_MEDIA_SLOTS=1` with the slow sample (testing guide §5q, "Every forcing switch in one place") | ✅ [New] |
| 11.5 | The Sprint 12 regression set (2026-11-28, the worker image's FFmpeg): `npm run clips:regression` **5 of 5** version 1 clips exported as recorded (fullscreen-text, blurred-zoom, split-speeds, gameplay-stickers, square-sound); the video-engine v1 fixtures test **16 of 16**; the design-engine upgrade tests **60 of 60** (version 1 and 2 designs move to version 3) | ✅ [New] |
| 11.6 | `e2e/clips-ai.spec.ts` (19 tests) and `e2e/clips.spec.ts` unchanged | ✅ [New]: `e2e/clips-ai.spec.ts` 19 of 19 in 6.4 minutes, and 19 of 19 again after the look pass in 11.5 minutes on a busier machine (Export All's three real exports took 2.4 minutes of it); `e2e/clips.spec.ts` brought up to date with the UI, 18 of 18 in 6.7 minutes |
| 11.7 | The `security-review` skill on the branch diff | Not recorded in the Decision Log yet |
| 11.8 | Performance checks (forty cuts with captions, a thousand-word pane, Python timings), the accessibility review and the look pass with its checklist | ✅ [New]: `docs/design-patterns/sprint-13-clips-ai-look-pass.md` (40 items, light, dark and Lilac at 1366 and 1920), the transcript playback fix (30.6 to 50.8 fps), forty cuts with captions at 50.9 fps; Python timings need a real run; **no real screen reader or 200 percent zoom check** |
| 11.9 | Docs: testing guide §5q, `.env.example`, `CLAUDE.md`, `SCHEMA_NOTES.md`, both Deviations sections, the index rows | In the tree, uncommitted |

## 12. The whole gate: `npm run validate`

**Run 2026-11-28 (Module 16), one workspace at a time:** lint and typecheck 57 of 57 tasks green;
tests 15,914 passed with only the seven old failures below (the final rerun after the look pass: ui
151, web 3,262 with `video-card` failing, video-engine 75 files, api 4,522 with the three Clips specs
failing); Python 291 passed (ruff, mypy and pytest).

Through Module 15 the touched-workspace runs were green on lint and typecheck and red only on the same
old tests, each logged when first seen: three Clips API specs (`clip-sticker-uploads` and
`clip-sound-uploads` read the real clock against a fixed row date, `clip-files.controller` a socket
reset; all three fail on the Sprint 12 tree too), web `video-card.test.tsx` (date-based),
media-tools `runner.test`, discover-engine `ics.test` (fixtures stored without the CRLF it expects)
and the speed-dependent Discover reader spec. Every other red file passed alone (timeouts under the
parallel load on a 16 GB machine). Module 15's run was split into pieces (turbo concurrency 2, Jest
two workers) after a full run was stopped for low memory.

---

## Definition of Done: evidence

| # | DoD item | Evidence |
|---|---|---|
| 1 | `apps/media` starts with `npm run dev`, is in `npm run validate`, answers a health activity from a TypeScript workflow on `postgear-media-py` | §1.4 and §1.5: `media-py.live.test.ts` on the local Temporal (Module 01); Python lint, types and tests in every module's run (251 passed at Module 15) |
| 2 | Contract written once; Python generated; one set of fixtures in Jest and pytest | §1.3: freshness tests both sides, shared fixtures; `contract.security.test.ts` (Module 16) |
| 3 | A stretch is listened to once; a time per word; only what was asked; a second request free | **In simulation.** §2.6: the 188-word stretch, `covered` with no job, only new minutes charged; the one real listen was the `small` benchmark |
| 4 | Add Captions in six styles; a fix once for the whole video; unsure words underlined; in step after trim, split, deleted part, speed change, hook clip; Preview Export matches | **In simulation.** §3.2, §3.6, §3.8: Module 03 browser pass (49 words, 15 bars, a fix, Replace Everywhere, Undo); the map tests through trim, split, a removed middle and 2x; the hook export with captions (Module 09) |
| 5 | Tamil and Hindi shaped right in the export, whole words only, `font_missing` instead of a silent change | §3.3: caption parity 8 and `caption-box.security.test.ts` on the real FFmpeg (long Tamil and Hindi words stay in their box); Preview Export with Tamil captions DONE (Module 03); the words were recorded or stand-in translations |
| 6 | Upload SRT on the video and on a clip, free; an unreadable file says why and changes nothing | **Partly.** §3.7: on a clip only (Captions tab, 422 `subtitle_file_invalid` with its sentence, no AI minutes). No `POST /clips/videos/:videoId/transcript/from-file` and no Upload SRT in Clip Setup (Module 03 decision: a supplied file belongs to one clip) |
| 7 | Deleting words cuts between words in one undo step; Remove Silences and Remove Filler Words show what they remove first | **In simulation.** §4: Module 04 browser pass (six words cut 4.2 s, one Undo); `cuts-parity` 3; the silence cut seen in tests only (§4.4) |
| 8 | Clip Setup price first; clips on sentences with title, score, reasons; request and Genre change the result; one list without duplicates | **In simulation.** §5: Module 05 browser pass (priced 8, half 4; the tunnel jump picks with reasons); the simulated model's answers depend on the request and genre; `dedupeByOverlap` and `blendWithSignals` tests |
| 9 | Look For Action adds moments from the picture, says what it saw and what it cannot know | **In simulation.** §5.5: recorded motion, simulated still answers; Module 06 browser pass with vision off and on |
| 10 | Detect Camera or its sentence; Follow The Speaker smooth, cuts at speaker changes, marks lost stretches, Fix By Hand, restores the user's boxes | **In simulation.** §6: recorded boxes only; Module 07 and 08 browser passes; the real wide-shot and podcast checks are open |
| 11 | Bleep Bad Words, Add Hook Title, Add Hook Clip, one undo step each; Text To Speech behind its switch or parked | **In simulation.** §7.1 to §7.3: Module 09 browser pass and export; Text To Speech built behind `CLIPS_TTS` with Kokoro, which **ran for real on this laptop** (two voices, a cancel) |
| 12 | A recipe carries settings to another clip and another member; the brand kit adds a logo, a caption style, an intro and an outro | §7.4 and §7.6: Module 10 browser pass (Save As Recipe, Apply in one step); recipes are workspace rows, so every member reads them (not tried with a second account); the logo by `brand-parity` only |
| 13 | Five starters read-only and copyable; Auto-Edit in one press; a missing part named | **In simulation.** §7.4 and §7.5: Built In and Duplicate; Auto-Edit on the stream, on the 3 s intro and on Listening Fails; the Follow skip toast (Module 16) |
| 14 | Export All with one notice; Create Montage from one or more videos, exported | §7.7 and §7.8: Module 11 browser pass on the local samples with the real FFmpeg (one bell for three clips, a 45.553 s Fade montage) |
| 15 | The added sites (Reddit, Pinterest, Threads) each behind its switch, TikTok and Instagram off; a Google Drive file through Google's picker | **Partly. In simulation.** §8.1 to §8.4: fixtures only; Threads cannot be switched on outside simulation; Drive only through the stand-in picker, Google's own picker never opened with real keys |
| 16 | Posting slots per weekday with windows; random time picker; Shuffle; Next Available; old times migrate; a hand-placed post exact; Made With AI reaches platforms with a field | **In simulation.** §8.5 to §8.8: Module 13 browser pass under `PUBLISH_SIMULATION` (Instagram `?ai=label`); YouTube by tests; TikTok and Pinterest left `'none'` until confirmed |
| 17 | Emote Maker: at most 3 s to Twitch, 7TV and BTTV files; the ladder; "too big" in words; the chat preview at real sizes | §9.7: the real FFmpeg on local samples (every first-step 112 px GIF under 512 KB at 60 frames); `[simulate:emote-too-big]`; no platform has accepted a file yet (real-test A-80 to A-82) |
| 18 | Schedule Maker: a Twitch week in the user's zone (clock change, midnight, cancelled, vacation); no schedule or unknown name with a sentence; five themes, two shapes, PNG; every word editable | **In simulation.** §9.8: recorded weeks `simstreamer`, `simvacation`, `simnoschedule`, `simnouser`; the time module's tests; no real Twitch read |
| 19 | Editor seat: makes clips, designs, drafts; every denial a 403 with the sentence and a log line; the matrix lists every route; the web hides it; seats counted under a lock | §9.1 to §9.6: the matrix spec, `editor-seats.security.spec.ts` (79), the real-Postgres race (one of five), the Module 14 hand check as an Editor; e2e test 18 green; the Module 16 hand check (six admin routes refused with 403 `editor_forbidden` and the sentence); no email sent |
| 20 | AI Minutes: price first, charged once by step and job, reversed on failure and no speech, never twice, short allowance refused; operator changes with no deploy; priority first; queued says waiting | §10 and the meter's sweep: `ai-minutes.security.spec.ts` with its race lines behind `CLIPS_AI_LEDGER_DB_TEST=1`; `clips-ai-charges.ts` audit; Module 15 browser pass (quoted 3, charged 3; 10 back on failure; overrides on `/operator`); the waiting line reads "Plans with a higher priority go first." |
| 21 | Transcripts and face positions deleted with their video; no face identified; no speech text leaves except to named providers | §6.1, §10.6, §11.1: the face file schema test; Module 15's removal of the private folder; `test_speech_text_security.py` and `speech-text.security.test.ts`; Clip Setup's privacy hint names Groq only while it is on |
| 22 | Every Sprint 12 clip in the regression set opens, plays and exports the same | §11.5: 5 of 5, 16 of 16, 60 of 60 on 2026-11-28; three version 1 clips opened in the editor and exported to DONE in the Module 16 hand check |
| 23 | Simulation runs every screen with no network and no model; `e2e/clips-ai.spec.ts` and `e2e/clips.spec.ts` pass; `npm run validate` green | **Partly. In simulation.** Both e2e suites pass (§11.6) and every module's browser pass ran with no model and no network; `npm run validate` is green on lint and typecheck and red only on the seven old tests in §12 |
| 24 | Light, dark and Lilac at 1366 and 1920; the title-case test green; no em dash or middle dot | The Module 16 look pass (§11.8); the title-case test green in the web run; a scan of the changed files found neither character |

---

## Deviations from the sprint document, and why

The full list, with a reason for each, is in the sprint document's
[Deviations](../sprint-documents/sprint-13-clips-ai.md#deviations) section and the Decision Log. In
short:

| The document said | What shipped | Why |
|---|---|---|
| A transcript key and a speech track key from Python | One heard file per job, merged on the Node side | One writer of the transcript, one file written or none |
| Any language | Twelve languages whose captions can be drawn | A language the fonts cannot shape is not offered |
| Captions routes add the track and answer the clip | They answer the track; the editor saves it | One writer of the document, so Undo and autosave stay as they are |
| A `TRANSLATE` job | Translate inside the request | One short model call; the stored translation is the idempotency |
| Upload SRT on the video and in Clip Setup | On a clip only | A supplied file belongs to one clip's stretch (Module 03); **not yet in the sprint doc's Deviations** |
| Crop keyframes with `ease`; a moving crop already handled | Two keys 1 ms apart for a cut; `sendcmd` files | Sprint 12 refused any moving crop |
| A flat bleep sum; a hook through `split` | A balanced `if` tree; the hook keeps its own input | Long clips stay inside FFmpeg's expression limits |
| Text To Speech through `kokoro-onnx` in process, or parked | Kokoro as its own GPL program | espeak-ng is GPL |
| Brand kit asset ids; Starter and Copy To My Recipes | `ClipVideo` ids; Built In and Duplicate | The code's shapes and the design system's words |
| `ClipPlatform` as a free string; Threads on | An enum widened by 14; Threads built and off | Type safety; the pinned yt-dlp cannot read Threads |
| Posting slot, Shuffle and random time routes | Saved through `PATCH /channels/:id`; Shuffle and random time pure in `packages/automation`; only `GET /channels/next-slot` is new | The existing list and its readers; **not in the sprint doc's Deviations** |
| AI label on Facebook, TikTok, Pinterest | YouTube and Instagram only | Facebook posts through `/videos`; the other two are unconfirmed |
| `GET /orgs/:id/editor-seats`, `POST /clips/emotes`, `GET /clips/emote-profiles`, `POST /clips/voice` | `GET /orgs/:id/seats`, `POST /clips/emotes/export`, profiles as engine data, `POST /clips/:clipId/voice` | The module docs' shapes; the sprint doc's route table was written first |
| "Paid plans go first."; a low job ranks with high after 30 minutes | "Plans with a higher priority go first."; 20 minutes | Priority is a plan value, not only paid or free |
| An Editor sees the sentence on the posts wall only | Every role refusal of an Editor reads it | The stories' sentence everywhere (Module 16) |
| Every check in CI | The parity tests, the two race tests and the e2e suites run locally only | CI has no pinned FFmpeg, no Postgres service, no running app |

## Review findings fixed before closing (2026-11-28)

| Finding | Fix |
|---|---|
| Python activities passed library error text (which can repeat speech, paths or addresses) into Temporal's history and the SDK log | `plain_failure()`: our own errors pass, the rest become `MEDIA_TOOL_FAILED` with the type name only |
| A listen's heard words stayed on disk after a cancel or the last attempt | Removed on a cancel, a non-retryable failure and the last attempt; a retry keeps finished chunks |
| Python read any valid key | `is_video_key()` per job |
| A prompt field let a newline or `>>>` close the quoted block | `quotedLine()` (three or more angle brackets become two) |
| Model titles kept HTML, ASS override blocks and Markdown | `stripMarkup()` |
| The worker's `clipFailure` logged `error.message` in the eight speech steps | The kind only |
| `MEDIA_INTERNAL_TOKEN` was missing from the worker's log secret names | Added |
| Captions could draw past their box (one very long word, no spaces, a long Tamil or Hindi word, the 116 percent pop) | `pageScale` draws that page smaller, the ASS names `\fs` in every reset, the preview does the same |
| A caption word kept typed line breaks and tabs | Removed |
| Retrying a failed link import skipped the link checks (site switch, breaker, rights removal, length) | The link is probed again before any limit, charge or job |
| A refused document key was echoed in the issue path | Any part that is not a plain name reads `?` |
| The API's security log did not redact `x-postgear-internal` | Redacted |
| The API's own `cancelOpen` and `failOpen` kept a Drive import's sealed token | Wiped, as the worker's paths already did |
| A library error could repeat a `Bearer` token | `scrubSecrets` hides it (defence in depth, no leak found) |
| The random time picker said a part of the day had passed when it was only full | "That part of the day is full. Try another." |
| Four AI internal routes said "This job was not found." | The shared sentence |
| Every role-gated route refused an Editor with "You do not have permission to do that" | `RolesGuard` gives a refused Editor "Editors cannot do this. Ask an admin." (`editor_forbidden`); a non-member's answer is unchanged |
| Detect Automatically could store a transcript in a language we cannot draw | `finishTranscribe` refuses it as `language_unsupported`, keeps no file and gives the minutes back |
| Auto-Edit's "Follow The Speaker was skipped" sentence was never shown | A toast on the clip's first open when nobody is in it |

## Known gaps

1. **No real AI service, face detector, site or platform has been used.** Groq, OpenAI, OpenRouter
   and a vision model were never called; MediaPipe and OpenCV never ran; no site, Drive file or
   Twitch schedule was read for real; nothing was posted. Closed by the real-test plan's Pass 2, with
   your OK and a capped key.
2. **The default speech model was never measured.** Only faster-whisper `small` ran, once, on one
   60 second file; `large-v3-turbo` and the ten minute run are open, and the 55 minute hosted
   threshold rests on `small` (real-test A-01, A-06; `npm run clips:listen-benchmark`).
3. **Upload SRT is on a clip only** (DoD 6). A video route and a Clip Setup control would close it,
   or the sprint doc should record it as a deviation.
4. **Threads cannot be switched on** outside simulation (no yt-dlp reader in the pinned build);
   TikTok, Instagram, Zoom and Dropbox stay off until the real test (A-60).
5. **Made With AI**: TikTok's and Pinterest's fields unconfirmed (A-64); YouTube checked by tests
   only (the demo workspace has no YouTube channel).
6. **Captions, Module 03's gaps**: the block is placed with the panel's controls, not dragged on the
   clip; a word is fixed in the panel's list, not by double-click on the clip; emoji in caption words
   are dropped, not made sticker overlays; right-to-left scripts are not drawn.
7. **Faces**: the real wide-shot check (Module 07) and a real podcast for Follow The Speaker (Module
   08) need the `ml` group, the BlazeFace file and your video; `reframe/tuning.ts` is tuned on recorded
   boxes only.
8. **Effects and kit**: the LDNOOBW word lists need a fetch you allow, and Tamil has no bleep list; no
   bleep or cut was checked by ear; a kit logo was never seen in an app export; the editor preview
   does not draw the closing card (Preview Export does).
9. **Montage limits**: two clips of one video share a source, so a zoom may fire in both; the Fade mix
   shows only while playing, at half size; the captions routes refuse a montage; bulk Delete was
   confirmed by tests, not pressed live.
10. **Creator tools**: the Emote spike's real clips and the platforms' upload pages were not read;
    schedule pictures are not metered (Module 17 item 25); the AI credits ledger has no user column,
    so Copilot and Studio AI spending cannot be split by person.
11. **Costs** use estimated model tokens and pictures; real speeds and bills wait for the real test
    (A-71, A-75). The rented graphics card lane is documented only.
12. **Module 16 still open**: both e2e suites, `npm run validate`, the look and accessibility pass with
    its checklist in `docs/design-patterns/`, the performance checks, the `security-review` skill on
    the diff (not recorded), the hand check, and the commit.
13. **Old red tests** (listed in §12) were still red at Module 15; whether Module 16's validate clears
    them is in its Progress row.
14. **CI runs none of** the real-FFmpeg parity tests, the two race tests or any e2e suite (as in
    Sprint 12).
15. **`classifyError`** in `packages/ai-engine/src/model/resilience.ts` still carries the provider's
    message for Sprint 6 paths; every Clips caller logs the kind only (tested).

## 13. What remains for you

1. Fill the final numbers from the Module 16 Progress row into §12 and DoD 23, the e2e result into
   §11.6, and tick the sprint doc's DoD boxes from the evidence table.
2. Walk the hand checks in the testing guide §5q one module at a time as `demo@postgear.local`, then
   "Try an Editor" in a private window, then Module 16's hand check (search the API, worker and
   Python logs of the session for a word from a sample's transcript and for the Twitch secret).
3. Commit Module 16, write `b638547` into Module 15's Progress row, and push Modules 14 to 16 (the
   remote has up to Module 13).
4. Run the real-test plan ([real-test-plan.md](../sprint-13/real-test-plan.md)): Pass 1 in
   simulation, then Pass 2 with your OKs for `uv sync --group ml`, the `large-v3-turbo` and BlazeFace
   files in `MEDIA_MODEL_DIR`, a capped AI key, optionally `GROQ_API_KEY`, the Twitch pair, a second
   email address, and `PUBLISH_SIMULATION="false"` only for A-62.
5. Make the calls in its §7: the listening lane and model, Tamil at launch, the vision check, Text To
   Speech, which sites stay on, Follow The Speaker's default, the AI Minutes prices and allowances,
   Editor seat numbers, the emote caps, and whether Editors may one day schedule.
6. Decide the LDNOOBW lists and any Module 17 items.
7. Before production: `MEDIA_INTERNAL_TOKEN`, the media service kept off the internet, the
   `media_models` volume filled by the documented operator step, both images in a private registry
   (GPL FFmpeg, and the GPL voice program when built with `VOICE=kokoro`).

---

## Files changed in this sprint

Since `3ee7c82`: 1,216 files in the 16 commits (734 added, 481 modified, 1 deleted), plus Module 16's
51 modified and 37 new files in the tree.

**Added: the media service and contract**
- `apps/media/` (`src/postgear_media/{main,worker}.py`, `activities/`, `contract/{generate,generated}.py`, `core/`, `providers/{speech,transcribe,vision}/`, `services/`, `simulation/`, `tests/`, `voice-program/`, `pyproject.toml`, `uv.lock`)
- `packages/media-contract/{src/shapes,src/{index,names,registry}.ts,schema/contract.json,scripts/export.ts,fixtures}`
- `infra/docker/Dockerfile.media`, `infra/docker/media/licenses/*`, `infra/docker/worker/bin/{ffmpeg,ffprobe,host-tool.sh}` (the image's FFmpeg on a machine without one)

**Added: engine and packages**
- `packages/video-engine/src/{transcript,captions,cleanup,highlights,reframe,effects,brand,recipes,montage,emotes,links}/*`, `render/{caption-ass,caption-plan,bleep-plan,card-plan,card-style,crop-path}.ts` (+ tests and golden files)
- `packages/video-preview/src/{captions-node,bleep-schedule}.ts`; `packages/ui/src/components/{transcript-text,speaker-strip}.tsx`
- `packages/ai-engine/src/{agents,prompts}/*` (moments, titles, still checker, translation); `packages/automation/src/queue/*` (slots, jitter, suggest, random time)
- `packages/design-engine/src/schedule/*`, the `schedule-week@1` layout, five themes and presets; `packages/media-tools/src/drive/*`; `packages/entitlements/src/capabilities.ts`
- 13 migrations, `20261126120000_sprint13_clips_ai_enums` to `20261128160000_sprint13_clip_job_cost`

**Added: API, worker, web**
- `apps/api/src/modules/clips/{transcripts,captions,faces,hook-titles,word-list,voice,recipes,brand-kits,auto-edit,montages,exports,emotes,costs,audit}/*`, `modules/studio/schedules/*`, `modules/admin/costs/*`, `modules/org/editor-seats.service.ts`, `common/guards/{editor-access.json,role-parity.ts}` (+ specs)
- `apps/worker/src/clips/{media-py,transcribe,captions,faces,speech,auto-edit,emote,highlights/watch}*` (+ tests, and `workflows/clips/media-py.live.test.ts`)
- `apps/web/src/app/(dashboard)/[orgId]/clips/{video/[videoId]/setup,kit,tools,tools/emote,tools/schedule}/page.tsx`, `components/clips/{setup,transcript,emote,kit,schedule}/*`, `panels/captions-panel.tsx`, `components/access/*`, `public/clips/voice-samples/*`
- Module 16 (uncommitted): the `*.security.spec.ts`, `*.security.test.ts`, `*.edge-cases.*` and `apps/media/tests/test_{service_security,speech_text_security,edge_cases}.py` files listed in §11, `e2e/clips-ai.spec.ts`, `e2e/helpers/clips-ai.ts`

**Modified**
- `apps/api`: clips (videos, highlights, jobs, internal, status, links, retention, limits), channels, posts, org, studio, roles guard, security logger, env
- `apps/worker`: `workflows/clips/job.workflows.ts` (the transcribe, faces, speech, Auto-Edit and emote workflows), `runtime-check.workflow.ts` (asks `mediaPyHealth`), highlights, import, render, failures, log redaction, maintenance, boot
- `apps/web`: the Clips page, video page and editor (Layouts, Effects, timeline, top bar), composer, calendar, queue, channels, Team page and invite dialog, rail, Home, search, operator
- `packages`: video-engine (document v2, time map, render plan and compiler, pricing, jobs, errors), media-tools (downloader, sites, render), social-core (`aiLabel`), scheduling, entitlements, db schema and `SCHEMA_NOTES.md`
- `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `CLAUDE.md`, the testing guide, the Sprint 12 and 13 docs
