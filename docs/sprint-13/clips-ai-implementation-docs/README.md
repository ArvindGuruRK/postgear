# Sprint 13: Clips AI, Implementation Modules

This folder splits Sprint 13 (Clips AI) into **seventeen modules plus a UX blueprint** (the last module is a parked P2 list). Build them in order, **one module per Claude Code session**. Each module builds, verifies and stops so you can check it by hand before the next one starts. Captions are on by the end of Module 03; editing by transcript by Module 04; the smarter Find Clips by Module 05; Follow The Speaker by Module 08; Editor seats and the creator tools by Module 14.

**Do not start until Sprint 12 has passed its exit gate** ([`../../sprint-12/real-test-plan.md`](../../sprint-12/real-test-plan.md), section 7). These documents were written before Sprint 12 was built; Module 01's first task corrects them against what was actually built.

| Document | What it decides |
|---|---|
| [`../../sprint-documents/sprint-13-clips-ai.md`](../../sprint-documents/sprint-13-clips-ai.md) | **How** to build: document version 2, the media service and its contract, jobs, data model, API routes |
| [`../../new-modules/user-stories-clips-ai.md`](../../new-modules/user-stories-clips-ai.md) | **What the user experiences**: journeys, acceptance criteria, UX rules, edge cases, completion checklist |
| [`../research/`](../README.md) | **Why**: the features, libraries, open-source repos, transcription, the Python service, captions and vision, cost and risks, the approach, the ASS cookbook, the creator tools |
| [`00-ux-blueprint.md`](00-ux-blueprint.md) | **How it looks and feels**: Clip Setup, the Captions tab, the Transcript pane, the AI rows, bulk actions, the composer additions |
| `module-NN-*.md` (this folder) | **What to do in each session**: scope, design details, tasks, tests, done when, hand check |
| [`../real-test-plan.md`](../real-test-plan.md) | **How Arvind tests it for real** after the build |
| Sprint 12's set ([`../../sprint-12/clips-implementation-docs/README.md`](../../sprint-12/clips-implementation-docs/README.md)) | The foundations: its rules, names, entitlements and Decision Log still bind this sprint |

If two documents disagree: user stories win on behaviour, the UX blueprint wins on look and interaction, the sprint doc wins on architecture, the research wins on facts about outside tools and services, and **the Sprint 12 code wins over anything written here about Sprint 12**. Record every such call in the decision log below. Every open question of the first plan was settled on 2026-11-17; the calls are in the Decision Ledger of [`../README.md`](../README.md) as `D13-NN`.

---

## The North Star

> AI that listens and looks, shows its work, costs what it said it would, and can always be undone.

**Reference products** (ideas only, never code or art): OpusClip for the setup screen, the transcript beside the clip, captions that follow the words, a frame that follows the speaker, recipe chips and Auto-Edit; StreamLadder for bleeping, the hook title, montage, posting slots, the Emote Maker, the Schedule Maker and Editors. **Open-source projects** read for logic are listed with their licences in [`../research/03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md).

---

## Module Map

| # | Module | Size | Depends on | Stories | Status |
|---|---|---|---|---|---|
| 00 | [UX Blueprint](00-ux-blueprint.md) (read, do not build) | - | - | all UI stories | Reference |
| 01 | [Media Service Foundations](module-01-media-service-foundations.md) | L | Sprint 12 | foundations | Not started |
| 02 | [Transcription](module-02-transcription.md) | L | 01 | CA-1.1 (server side), CA-10.1 | Not started |
| 03 | [Captions](module-03-captions.md) | L | 02 | CA-1.1 to CA-1.7 | Not started |
| 04 | [Transcript Editing And Speech Cleanup](module-04-transcript-editing-and-speech-cleanup.md) | L | 03 | CA-2.1 to CA-2.3 | Not started |
| 05 | [Clip Setup And Highlights V2](module-05-clip-setup-and-highlights-v2.md) | L | 02 | CA-3.1, CA-3.2, CA-3.4 | Not started |
| 06 | [Visual Moments](module-06-visual-moments.md) | M | 05 | CA-3.3 | Not started |
| 07 | [Face Detection And Detect Camera](module-07-face-detection-and-detect-camera.md) | L | 01 | CA-4.1 | Not started |
| 08 | [Auto-Reframe](module-08-auto-reframe.md) | L | 07 | CA-4.2 | Not started |
| 09 | [AI Effects](module-09-ai-effects.md) | L | 03, 04 | CA-5.1 to CA-5.4 | Not started |
| 10 | [Recipes And Brand Kit](module-10-recipes-and-brand-kit.md) | **L (grew from M: starter recipes, Auto-Edit Video)** | 03, 05 | CA-6.1 to CA-6.4 | Not started |
| 11 | [Montage And Batch Export](module-11-montage-and-batch-export.md) | L | 03 | CA-7.1, CA-7.2 | Not started |
| 12 | [More Sources And Platforms](module-12-more-sources-and-platforms.md) | M | Sprint 12 | CA-8.1, CA-8.2 | Not started |
| 13 | [Publisher Upgrades](module-13-publisher-upgrades.md) | **L (grew from M: posting slots, windows per weekday, random time)** | Sprint 12 | CA-9.1 to CA-9.3 | Not started |
| 14 | [Creator Tools And Editor Seats](module-14-creator-tools-and-editor-seats.md) | **XL (new; may need two sessions)** | 03, Sprint 12 | CA-11.1 to CA-11.4 | Not started |
| 15 | [Scale, Cost And Deploy](module-15-scale-cost-and-deploy.md) | L | 02, 07 | CA-10.1 to CA-10.3 | Not started |
| 16 | [Hardening, E2E And Sprint Close-Out](module-16-hardening-e2e-closeout.md) | L | 01 to 15 | section 6 checklist | Not started |
| 17 | [P2 Backlog](module-17-p2-backlog.md) | S | 16 | extras | Parked |

```text
Sprint 12 -> 01 -> 02 -> 03 -> 04 -> 09
              |     |     |-> 10 (with 05)
              |     |     '-> 11
              |     '-> 05 -> 06
              '-> 07 -> 08
Sprint 12 -> 12
Sprint 12 -> 13
Sprint 12 (+ 03) -> 14        (best built right after 03, or at any point before 16; Part A, Editor Seats, first)
              02, 07 -> 15
              01 to 15 all done -> 16 -> (17)
```

After 02, the caption line (03, 04, 09), the AI line (05, 06) and the face line (07, 08) are independent of each other. Modules 12, 13 and 14 touch no AI and can run at any time, even first (14 edits every Clips controller, so the later it runs the more routes the route-matrix test covers, and nothing is missed either way). Keep the numbered order unless you are running sessions in parallel.

Size guide: M fits one session easily, L fills one, XL may need a second session ("continue Module NN"). Each module lists its tasks as checkboxes so a second session can pick up exactly where the first stopped. Module 14 is written as three parts (A Editor Seats, B Emote Maker, C Schedule Maker) so a session can stop between them.

**Demos**: Demo 1 after Module 03 (captions on a clip, exported), Demo 2 after Module 04 (cut a clip by deleting text), Demo 3 after Module 05 (Clip Setup and titled, sentence-aligned clips), Demo 4 after Module 08 (a two-person video followed in a tall frame), Demo 5 after Module 10 (one press turns a whole video into one edited clip with a starter recipe), Demo 6 after Module 14 (an emote cut from a clip, a schedule picture, and an Editor who can save a draft but not schedule).

---

## How To Run A Module

1. Docker services up (`docker compose up -d`), on branch `sprint-13-clips-ai`, working tree clean (commit the previous module first).
2. Open a fresh Claude Code session in the repo and paste the **Kickstart Prompt** below with the module number filled in.
3. When it finishes: do the module's **Hand Check**, then ask it to commit (`Module NN: <title>` as the subject line).
4. The session updates the **Progress** table and the **Decision Log** in this README before it stops.

### Kickstart Prompt (copy, set the module number, paste)

```text
We are building Sprint 13, Clips AI, module by module, on top of Sprint 12 (Clips), which is built and tested.

Read, in this order:
1. CLAUDE.md
2. docs/sprint-12/clips-implementation-docs/README.md (the rules, names and Decision Log of the foundations, including its names for entitlements and the AI Minutes meter; they still bind us)
3. docs/sprint-13/clips-ai-implementation-docs/README.md (rules, names, progress, decision log)
4. docs/sprint-13/clips-ai-implementation-docs/module-NN-*.md (this session's module, in full)
5. Whatever that module's "Read First" section lists.

We are doing Module NN only. Before writing code:
- Check both Progress tables and Decision Logs, and confirm the modules this one depends on are Done. If one is not, stop and tell me.
- Check the branch is sprint-13-clips-ai (Module 01 creates it from the branch I name) and the tree is clean.
- These documents were written before Sprint 12 was built. Where a path, name or shape here differs from the Sprint 12 code, the code wins: note the difference in the Decision Log and carry on.
- Give me a short plan (10 lines or fewer): what you will build, in what order, and anything in the module doc you think is wrong or risky. Then start building without waiting, unless something blocks you.

While building:
- Follow the module's Design and Tasks. Tick each task checkbox in the module doc as you finish it.
- Use the project skills the module names (prisma-change, new-api-module, new-page, temporal-workflow, verify-change).
- UX follows both UX blueprints (Sprint 12's for the frame, Sprint 13's for what is added). Never copy another product's code or art.
- Everything runs under CLIPS_SIMULATION=true, MEDIA_SIMULATION=true and AI_SIMULATION=true. Never download a model, call a hosted AI service, or fetch a real video unless I say so in this session. No paid call, ever.
- Every AI step is charged through Sprint 12's UsageService in AI Minutes (price from video-engine/src/pricing.ts), never through new credit types.
- Every new API route needs a decision for Editors: name Role.EDITOR in its @Roles or leave it out on purpose, and add it to the route-matrix table (Module 14).
- Do not change the meaning of anything in a version 1 clip document, the job table, the queue names or the storage keys. Add; do not rename.
- If the module doc and the code disagree, trust the code, make the smallest sensible choice, and write it in the Decision Log.

Before you stop:
- Run the verify-change skill for the touched workspaces (Python included once apps/media exists).
- Update the module's Status line, the Progress table and the Decision Log in this README.
- Tell me what to check by hand (the module's Hand Check), what is not done and why, and suggest the commit message. Do not commit or push unless I ask.
```

To continue an XL module in a second session, use the same prompt and add: `Module NN is partly done. Its unticked task boxes are what is left.`

---

## Rules For Every Module

**Project rules** and **Sprint 12's module rules** all still apply; read them in Sprint 12's README. In addition:

- **Add, never rename.** A version 1 clip document must open, play and export exactly as before. The regression set (Module 01 saves it) is re-exported in Module 16 and compared.
- **One render engine: FFmpeg.** The compiler is pure: `packages/video-engine/src/render` turns a document into a render plan and the plan into an FFmpeg graph and ASS files with plain string building, no Node built-ins, no Prisma, no Temporal. `frameState(doc, outputMs)` is the one definition of what is on screen and is used by the browser preview and by the compiler tests alike. Captions and text are ASS subtitles drawn by libass.
- **Never a shell string.** Programs run through `runTool` with an argument array. A filter graph goes in a file and is passed as `-/filter_complex graph.txt` (`-filter_complex_script` does not exist in FFmpeg 9.0.2). User text is escaped for ASS and for filters before it is written.
- **Python does sound and pictures; Node does words and order.** No language model is called from Python. No workflow is written in Python. Python activities are plain functions that take one JSON object and return one.
- **One contract.** Every shape that crosses between Node and Python is written once in `packages/media-contract` and generated for Python. The same fixture files are parsed by Jest and by pytest.
- **Storage keys cross the boundary, never paths or addresses.**
- **Captions store no times.** Words and their times live in the transcript asset, in the video's own time. Anything shown on the clip is mapped through the time map. Absolute word times are rounded into ASS centiseconds, never durations.
- **Every AI step**: shows its price in AI Minutes first, is charged through `UsageService` before it starts (key `clips.ai:<step>:<jobId>`), is reversed if it fails, reports progress in words, can be cancelled, is one undo step in the editor, and leaves a visible trace of what it changed.
- **A stretch of video is listened to once.** Never transcribe what is already covered.
- **Faces are boxes.** No embeddings, no names, no pictures of faces stored; face files are deleted with their video.
- **No speech text in logs.** Transcripts, prompts and AI answers are never written to logs or error messages. Neither are Twitch tokens or secrets.
- **Every route is an Editor decision.** `Role.EDITOR` fails closed: a route is denied to Editors until its decorator names them, and `editor-access.json` lists every route (Module 14). Editors never schedule or publish in v1.
- The UI says **captions**, **transcript**, **speaker**, **recipe**, **score**, **AI minutes**, **emote**, **editor**; never "ASR", "diarization", "inference", "model", "tokens", "keyframes", "VAD", "virality".
- Everything runs under `CLIPS_SIMULATION=true`, `MEDIA_SIMULATION=true` and `AI_SIMULATION=true` locally. A real model or hosted service is used only in Module 02's and Module 07's benchmarks and in the real-test plan, each time with Arvind's OK.
- Logic adapted from an open-source project names the project and its licence in the Decision Log.

---

## Names Everyone Uses

| Thing | Name |
|---|---|
| Branch | `sprint-13-clips-ai`, cut from `sprint-12-clips` (or the branch Sprint 12 was merged into) |
| Python service | `apps/media`; the package `postgear_media`; FastAPI on port 8100; Python 3.13; uv |
| Contract | `packages/media-contract` (`@postgear/media-contract`) |
| Python activities | `mediaPyHealth`, `mediaPyTranscribe`, `mediaPyDetectFaces`, `mediaPyMotion`, `mediaPyStills` |
| Worker activity (Node) | `emoteExport` (Module 14), on the media queue |
| Queues | `postgear-media-py` (the Python worker); `postgear-media-gpu` reserved |
| New job kinds | `TRANSCRIBE` (stage `listening`), `FACES` (`faces`), `TRANSLATE` (`translating`), `SPEECH` (`voice`), **`EMOTE`** (`fetching`, `encoding`, `finishing`); HIGHLIGHTS gains `listening`, `reading`, `watching` |
| New asset kinds | `TRANSCRIPT` (`meta`: language, covered ranges, word fixes), `FACE_TRACKS` (`meta`: range, people) |
| New signal tracks | `speech` (how sure we are someone is talking), `motion`; `faces` is a file, not a track |
| Engine folders | `packages/video-engine/src/transcript/`, `captions/` (with the SRT and VTT reader and `buildAss`), `cleanup/`, `highlights/`, `reframe/`, `recipes/` (starter recipes and the Auto-Edit planner), `emotes/` (profiles as data, the size ladder), `render/` (from Sprint 12) |
| Design Studio v3 | `DESIGN_SCHEMA_VERSION` 3; layout `schedule-week@1`; `rows` slot kind, `schedule` role and slot, `ScheduleSource`; five themes `schedule-clean-blue`, `schedule-light-blue`, `schedule-cool`, `schedule-dark`, `schedule-red`; preset category "Schedule" |
| Roles and capabilities | `Role.EDITOR`; `packages/entitlements/src/capabilities.ts`; `apps/api/src/common/guards/editor-access.json`; `assertEditorMayWrite` in `posts.service.ts`; `EditorSeatsService` |
| AI agents | `packages/ai-engine`: the moment picker, the title writer, the still-picture checker |
| Models | `ClipRecipe`, `ClipCaptionStyle`, `ClipWordList` (posting slots are a validated JSON list on `Integration`, no table); clip fields on `BrandKit`; `ClipOrigin` gains `AI_TRANSCRIPT` (Module 05), `MONTAGE` (Module 11) and `AUTO_EDIT` (Module 10); `ClipChannel` is Sprint 12's (the channel browser). No `ClipEmote` table: emotes are job outputs under the private exports prefix, and Module 14's spike did not find a reason for one |
| Web | `/[orgId]/clips/video/[videoId]/setup`, `/[orgId]/clips/kit`, `/[orgId]/clips/tools`, `/[orgId]/clips/tools/emote`, `/[orgId]/clips/tools/schedule`; `apps/web/src/components/clips/setup/`, `transcript/`, `emote/`, `panels/captions-panel.tsx` |
| Env flags | `MEDIA_SIMULATION` (refused in production; follows `CLIPS_SIMULATION` when unset), `MEDIA_URL` (default `http://localhost:8100`), `MEDIA_INTERNAL_TOKEN`, `TRANSCRIBER` (`faster-whisper` default, `groq`, `simulation`; `auto` from Module 15, with `TRANSCRIBE_HOSTED_ABOVE_MINUTES`), `WHISPER_MODEL` (default `large-v3-turbo`; `small` suggested for local real runs), `GROQ_API_KEY` (optional), `CLIPS_ACTION_VISION` (default `false`), `CLIPS_TTS` (default `false`), `GOOGLE_DRIVE_PICKER_KEY` (optional), `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (Sprint 12's pair, reused by the Schedule Maker) |
| Entitlement keys | Used: `clips.ai_minutes_per_month` (the meter), `clips.queue_priority` (low, normal, high), `clips.downloads_per_day` (emote exports), `clips.enabled`. New in this sprint: **`members.editors_max`** (FREE 0, STANDARD 1, PRO 3, TEAM 10, ULTIMATE 25). Read Sprint 12's README names for the rest |
| AI Minutes steps | `signals` (Sprint 12), `listen`, `read`, `action`, `translate`, `voice`; rates in `packages/video-engine/src/pricing.ts` (`aiMinutesCost`); ledger keys `clips.ai:<step>:<jobId>`. There are no `clip_*` credit types |
| Caption styles | Built in: `bold-pop`, `marker`, `karaoke`, `clean`, `boxed`, `typewriter` |
| Starter recipes | `clean-up-recording`, `auto-edit-talking-video`, `captions-only`, `reframe`, `social-edit` |
| Samples | Sprint 12's two, plus `two-speakers` (generated); recorded transcripts, face boxes, motion and model answers beside them; schedule fixtures `simstreamer`, `simvacation`, `simnoschedule`, `simnouser` |
| Error codes | `captions_off`, `no_speech`, `language_unsupported`, `transcribe_failed`, `no_faces`, `many_faces`, `voice_off`, `site_paused`, `drive_not_connected`, `recipe_missing_part`, `montage_shapes_differ`, `font_missing`, `clips_ai_minutes_used` (Sprint 12), `emote_too_long`, `emote_too_big`, `emote_range_invalid`, `twitch_user_not_found`, `schedule_fetch_failed`, `editor_forbidden`, `members_editor_seats_full` |

---

## Additions Beyond The Sprint Doc

Strike one out here if you do not want it.

| Addition | Module | Why |
|---|---|---|
| A refresh of these documents against the built Sprint 12, and a saved regression set of Sprint 12 clips | 01 | The documents were written before Sprint 12 existed in code; the set proves nothing old breaks |
| A speech-to-text speed benchmark on this machine | 02 | The research could not find a processor-only figure for the chosen model; limits and the fast-lane decision need one |
| A third generated sample, `two-speakers` | 01 | Faces and speakers need something to detect with no real person in the repo |
| Two added fonts (Tamil, Devanagari) and a font manifest check (`font_missing`) | 03 | None of the 52 Studio fonts covers them; a missing font must fail loudly, not fall back |
| **Captions From A File**: Upload SRT (and VTT) in place of listening, no AI Minutes | 03 | OpusClip's setup screen has it; nearly free once the transcript asset exists |
| Search and clip-from-text in the video page's transcript | 04 | Nearly free once the transcript exists, and the fastest way to make a clip from speech |
| **Genre** on Clip Setup (Auto, Podcast, Gaming, Education, Interview, Vlog) tuning the picker | 05 | OpusClip has it; it is a paragraph of the picker's prompt |
| **Five starter recipes** and **Auto-Edit Video** (a whole video to one edited clip in one press) | 10 | OpusClip's recipe chips and "Auto-edit footage" |
| **Posting slots** with a window per time, times per weekday, Shuffle Times and a **random time of day** picker | 13 | StreamLadder screens 15, 16, 23 and 24 |
| **Creator Tools And Editor Seats**: Emote Maker, Schedule Maker and the Editor role | 14 | StreamLadder screens 27, 29 and the Editors entry; Arvind asked for full screenshot coverage |
| The cost table (Editor seat, emote and schedule jobs) and the AI Minutes audit | 15 | Prices must be shown before the press and cover the bills |
| The real-test plan | after 16 | Arvind's way to test with real videos |

---

## Progress

Each session updates its row. Status: Not started, In progress, Done, Done with gaps (say which). Module 14 lists which of its parts (A, B, C) are done.

| # | Status | Date | Commit | Notes (exports, endpoints, gaps) |
|---|---|---|---|---|
| 01 | Not started | | | |
| 02 | Not started | | | |
| 03 | Not started | | | |
| 04 | Not started | | | |
| 05 | Not started | | | |
| 06 | Not started | | | |
| 07 | Not started | | | |
| 08 | Not started | | | |
| 09 | Not started | | | |
| 10 | Not started | | | |
| 11 | Not started | | | |
| 12 | Not started | | | |
| 13 | Not started | | | |
| 14 | Not started | | | Parts: A Editor Seats, B Emote Maker, C Schedule Maker |
| 15 | Not started | | | |
| 16 | Not started | | | |
| 17 | Parked | | | |

---

## Decision Log

| Date | Module | Decision | Why |
|---|---|---|---|
| 2026-11-14 | plan | Sprint 13 starts only after Sprint 12's exit gate | Arvind: test the core for real first |
| 2026-11-14 | plan | The Python service runs activities only, on its own queue; workflows stay in TypeScript | One owner of order, retries and progress; research 05 |
| 2026-11-15 | plan | Speech to text runs on our own machine by default (faster-whisper, `large-v3-turbo`), with a hosted fast lane behind `TRANSCRIBER` | Research 04: it gives word timings with no graphics card and no per-minute bill; OpenAI's models are being retired |
| 2026-11-15 | plan | WhisperX is not used | Research 04 and 06: it pulls in PyTorch and has no Tamil alignment |
| 2026-11-15 | plan | Transcripts are files with covered ranges; a stretch is listened to once, on demand | Nobody should pay to listen to six hours for a forty second clip |
| 2026-11-15 | plan | Captions store a transcript reference, a style and word fixes, never times | They then follow every edit through the time map |
| 2026-11-15 | plan | The model picks numbered transcript rows, not times; the engine snaps, trims and removes duplicates | Research 06: it removes invented timestamps |
| 2026-11-15 | plan | Following a speaker is computed in the pure engine from face boxes | It re-runs at once in the browser and is testable without a model |
| 2026-11-15 | plan | Features with no module here (AI emoji, auto zoom, auto transitions, auto sound effects, enhance sound, dubbing, B-roll, eye contact, upscale) are in Module 17 or not planned | Research 01's cut: each is a product of its own |
| 2026-11-17 | plan | **FFmpeg only for the whole product**; Remotion is dropped. Captions and text are ASS subtitles drawn by libass; the preview is a fast approximation and Preview Export shows the real result | Arvind chose FFmpeg: no render licence, no headless browser, faster renders (D13-16) |
| 2026-11-17 | plan | **AI Minutes** is the meter for all Clips AI; the `clip_*` credit types are not created. The earlier "credits or Clip Minutes" question is closed. Module 15 audits prices and queue priority only | One clean currency and an operator-editable allowance per plan (D13-02) |
| 2026-11-17 | plan | Text to speech is **open-source voice only** (Kokoro through `kokoro-onnx` if its licence chain passes, else parked); no hosted voice | Same open-source stance as the libraries; OpenAI's speech models are being retired (D13-06) |
| 2026-11-17 | plan | Sites: Vimeo, Rumble, Dailymotion, Loom, X, Facebook, LinkedIn, Reddit, Pinterest and Threads are **on**; TikTok, Instagram, Zoom and Dropbox are built but **off**; each site has its own switch | The off ones usually need a login or break often (D13-08) |
| 2026-11-17 | plan | **Editors cannot schedule or publish in v1.** They save drafts only; an approval step or a switch is Module 17 item 19 | A freelancer who can schedule can publish to the brand with no review, and there is no approval step yet (D13-15) |
| 2026-11-17 | plan | **The creator tools are built**: Emote Maker, Schedule Maker and Editor Seats are the new Module 14; the old 14, 15 and 16 become 15, 16 and 17 | They are screens in the StreamLadder captures and Arvind asked for full coverage (D13-15) |
| 2026-11-17 | plan | **Starter recipes and Auto-Edit Video are built** in Module 10 | OpusClip's recipe chips and "Auto-edit footage" (D13-17) |
| 2026-11-17 | 14 | Emotes and schedule pictures carry no watermark on any plan; the schedule PNG export is not metered; one `EMOTE` job is one `clips.downloads_per_day` unit; the capability table is one pure shared file in `packages/entitlements` rather than two copies | See Module 14's "Contradictions Found While Writing This Module" |

---

## Where Each Decision Lands

| Decision | Modules |
|---|---|
| D13-02 AI Minutes | 02, 05, 06, 09, 15 (audit), 16 (meter tests) |
| D13-03 hosted lane | 02, 15 |
| D13-06 text to speech | 09 |
| D13-08 sites | 12 |
| D13-15 creator tools and seats | 14, 16 |
| D13-16 ASS captions, FFmpeg only | 03, 04, 09, 11, 16 |
| D13-17 recipes | 10 |
