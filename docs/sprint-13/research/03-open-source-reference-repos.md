# Sprint 13 Research: Open-Source Reference Repositories

> **Written**: 2026-11-15, from reads made on 2026-11-14. Each repository was shallow-cloned into its own empty scratch folder outside the project (nothing was run from it) and read in this order: LICENSE, README, then the files that hold the logic. Stars were read from the repository's GitHub page; the last commit is the date and short hash of the clone's newest commit. Repositories marked **page only** were not cloned: only their GitHub page was read.
> **How to use this page**: logic is described in our own words with small pseudo-code. No code from any repository is pasted here, and none may be pasted into PostGear without the rule in section 4. Every file path below exists in the commit named.
> **Companion**: the designs built on these reads are in [06-captions-moments-and-vision.md](06-captions-moments-and-vision.md).

## 1. The Short List

| Repository | Licence | Stack | Use For | Verdict |
|---|---|---|---|---|
| `mutonby/openshorts` | MIT for the core; `cloud/` is under its own commercial licence | Python (FastAPI), React, a browser based video renderer behind a Node service (not our path), FFmpeg, MediaPipe, faster-whisper, Gemini or a local model | Two-pass moment picking, word snapping, the damped camera, mouth-movement speaker test, layout choice, hook placement | **Adapt** (core only; never `cloud/`, never its YOLO path) |
| `Anil-matcha/AI-Youtube-Shorts-Generator` | MIT | Python; a paid hosted API by default, a local mode with yt-dlp, faster-whisper, FFmpeg | Chunk sizes, asking for twice the clips, overlap dedup, retry on bad JSON | **Ideas Only** (its header says the logic was ported from another product) |
| `Steezy-code/clipper` | MIT | Python (FastAPI), faster-whisper, Ollama, OpenCV YuNet, FFmpeg, ASS captions | Silence trim from word gaps, time remap, facecam rule, zero-lag smoothing, caption paging | **Adapt** |
| `Rose91825/autoclip` | Not found | | | **Skip**: the address returns 404 and an anonymous clone is refused |
| `zhouxiaoka/autoclip` (read in its place) | MIT | Python (FastAPI), React, any OpenAI-compatible model, Whisper or SenseVoice | Row ids instead of timestamps, window sizes, timeline repair, length tiers | **Adapt** (logic; its prompts are in Chinese and stay ideas) |
| `NaufalRizqullah/opensource-clipping` | MIT | Python, faster-whisper, Gemini, MediaPipe Tasks, pyannote, FFmpeg | MediaPipe Tasks set-up, tracking parameters, the five-part score, keep-segments, micro-hooks | **Adapt** (never its YOLO path or its edge-tts voice) |
| `google/mediapipe` (AutoFlip) | Apache-2.0 | C++ calculators, Bazel | Per-scene strategy, required regions, padded fallback | **Ideas Only** (a C++ graph; its docs page is gone) |
| `m-bain/whisperX` | BSD-2-Clause | Python, faster-whisper, wav2vec2 alignment, pyannote | Forced alignment for tighter word times, where a model exists for the language | **Adapt** (as an optional dependency) |
| `SYSTRAN/faster-whisper` | MIT | Python, CTranslate2 | Transcription with word times and probabilities | **Adapt** (as a dependency) |
| `snakers4/silero-vad` | MIT (LICENSE file) | Python, PyTorch or ONNX Runtime | Speech spans for chunking and silence removal | **Adapt** (as a dependency) |
| `Breakthrough/PySceneDetect` | BSD-3-Clause | Python, OpenCV | Scene cuts for reframe resets and cut density | **Adapt** (as a dependency) |
| `Junhua-Liao/Light-ASD`, `TaoRuijie/TalkNet-ASD` (page only) | MIT, MIT | PyTorch | Dedicated active-speaker models | **Ideas Only** for now (dataset terms behind the weights) |
| `soCzech/TransNetV2` (page only) | MIT | PyTorch | A neural scene-cut detector | **Ideas Only** for now |
| `kamilstanuch/Autocrop-vertical` (page only) | No licence | Python, YOLOv8, PySceneDetect, FFmpeg | Track or letterbox per scene | **Ideas Only** |
| `WyattBlue/auto-editor` (page only) | Unlicense | Nim | Silence removal defaults | **Ideas Only** |

A library we install is marked **Adapt**: the licence rule in section 4 applies to it the same way.

## 2. Repositories

### 2.1 `mutonby/openshorts`

- **URL**: github.com/mutonby/openshorts. **Licence**: MIT (`LICENSE`), with an exception stated in `NOTICE`: everything under `cloud/` is under `cloud/LICENSE`, "The OpenShorts Commercial License", which forbids offering it as a hosted service. **Stars**: 8.2k. **Last commit**: 2026-11-12 (`8af4a48`).
- **Stack**: `app.py` (FastAPI), a React dashboard, a browser based renderer with its own caption folder (`remotion/src/`, cited below for its caption logic only) run by a Node service (`render-service/`), which we do not use because our render is FFmpeg only, FFmpeg, MediaPipe, PySceneDetect and TransNetV2, faster-whisper or Parakeet, Gemini or an OpenAI-compatible local model.
- **Licence trap**: `main.py` imports `ultralytics` for a person-detection fallback. That package is AGPL-3.0 (reported). We take nothing from that path.

Logic worth taking:

| File | What It Does | Module |
|---|---|---|
| `clip_selection.py` | Sentence-aligned scoring windows of about 90 s with 30 s overlap (a window may run to 1.25 times its target to close on a sentence); near-equal scoring batches; a shortlist that grows with length (`duration / 90 + 2`, between 3 and 10); a floor and a ceiling on the clip count; trimming by score and not by position; dedup at 25 % of the shorter clip; snapping a proposed cut to the nearest word edge within 1.5 s and leading into the silence (up to 0.35 s before, 0.45 s after) | 05 |
| `main.py` (`get_viral_clips`) | The two passes: score every window, shortlist globally, detail the shortlist, ask the unused windows again when the count falls short, snap, dedup. Sparse speech (under 8 words or 5 words a minute) goes to a vision path instead | 05, 06 |
| `gemini_worker.py` | The response models (a scored window; a clip with seconds, score, hook, titles, a one-line why) used as a structured-output schema, and the prompts' rules (score every window, use the whole range, the two-second test, stand alone, no two clips on the same point, the hook names this moment) | 05, 09 |
| `main.py` (`SmoothedCameraman`, `SpeakerTracker`) | The "heavy tripod": hold while the target is inside a safe zone of a quarter of the crop width; move at a slow fixed speed, faster when far; a large jump must repeat on three detections; reset and cut at a scene change. The tracker matches faces by centre distance, scores by size with decay, multiplies the current speaker's score, and enforces a cooldown before switching | 07, 08 |
| `main.py` (`analyze_scenes_strategy`) | Five sampled frames a scene; near-black frames skipped; an average of about one face means follow, none or several means the blurred layout; a short scene between two agreeing neighbours is flipped to match | 08 |
| `active_speaker.py` | Who is talking between two known faces: frame difference in a mouth region, 0.4 s windows, counted only when the audio is above 18 % of the scene's peak, each face normalised to its own 20th to 80th percentile, a 15 % margin to decide, and three windows to take over | 07, 08 |
| `frame_sampler.py`, `reframe_v2.py` | Read sampled frames in one forward pass (89 CPU-seconds with seeks against 6 without, on a 20 s clip); analyse at 640 px or less, render separately | 07 |
| `scene_detection.py` | TransNetV2 first, PySceneDetect `ContentDetector` as the fallback; scenes under 0.4 s merged into a neighbour | 08 |
| `camera_inset.py`, `split_layout.py`, `screencast_layout.py`, `layout_picker.py` | Finding a webcam inset from a corner; stacking two speakers; screen above speaker; asking a vision model one closed question on twelve stills at 1,024 px (92 % against hand labels, where sending the whole video scored 92 to 96 %; 640 px was worse, more frames did not help) | 07, 08, 06 |
| `hook_placement.py`, `hook_grounding.py` | Place the hook in the band that covers faces least and never on the caption band; rewrite a hook from three frames when the meaning is on the screen | 09 |
| `twitch_signals.py` | Viewer-made clips as evidence on a window, and a guaranteed shortlist place for the hottest windows | 05 |
| `transcribe_backends.py` | A written transcript contract (text, language, segments, words with a leading space, absolute times) and a fallback chain between engines | 02 |
| `remotion/src/lib/captions.ts`, `types.ts` | Caption blocks by 20 characters or 2,000 ms; a style shape (font, colours, border, background, animation) | 03 |
| `recut.py` | A clip as a list of source segments, with a fast path when every segment lies inside what was already cut | 04, 11 |
| `burned_subtitles.py` | Detecting subtitles already burned into the source so ours do not stack on them | 03 |

The two pieces we will lean on most, in our own words:

```
snapToWords(start, end, words):
    start -> the nearest word start within 1.5 s, minus min(0.35 s, half the silence before it)
    end   -> the nearest word end within 1.5 s, plus min(0.45 s, half the silence after it)
    too short: move the end to the first word end past the minimum (keep the proposal if that breaks the maximum)
    too long:  pull the end back to the last word end inside the maximum

camera(target):
    a target further than the dead zone from the believed one is only counted; believe it after 3 matching detections
    while the believed target is outside the dead zone: step toward it slowly (faster when over half a crop away)
    at a scene cut: forget everything and jump to the first accepted target
```

### 2.2 `Anil-matcha/AI-Youtube-Shorts-Generator`

- **URL**: github.com/Anil-matcha/AI-Youtube-Shorts-Generator (its README's clone command names `SamurAIGPT/AI-Youtube-Shorts-Generator`). **Licence**: MIT. **Stars**: 6.1k. **Last commit**: 2026-11-12 (`1142a74`).
- **Stack**: Python. The default mode sends download, transcription, ranking and cropping to a paid hosted API; `--mode local` uses yt-dlp, faster-whisper and FFmpeg with one remote model call.
- **Why ideas only**: the docstring of `shorts_generator/highlights.py` says its logic was "ported from" another product's highlight generator. The MIT file is clean on its face, but the origin is not ours to judge, and the logic is short enough to write ourselves.
- **Logic** (`shorts_generator/highlights.py`, Module 05): one small call classifies the content type and density from the first 25 segments; videos over 30 minutes are cut into 20-minute chunks with 60 s overlap, shorter ones go in one call; the transcript is sent as lines of `[start] text`; the prompt asks for at least twice the wanted clips so dedup has room; output is clamped and cleaned; a clip overlapping a better one by more than half its own length is dropped; bad JSON gets up to three attempts with a stricter reminder.

### 2.3 `Steezy-code/clipper`

- **URL**: github.com/Steezy-code/clipper. **Licence**: MIT. **Stars**: 5. **Last commit**: 2026-10-19 (`518afe7`).
- **Stack**: FastAPI, faster-whisper, Qwen3 through Ollama, OpenCV (YuNet with a Haar fallback), FFmpeg, ASS captions, one static HTML page. Small, but the clearest code of the set; its low star count means nobody else has vetted it, so we rely on the read, not on reputation.

| File | What It Does | Module |
|---|---|---|
| `clipper/trim.py` | Silence trimming from word times alone: keep spans are runs of words whose gaps are under 0.5 s, padded by 0.15 s and merged; a second function moves word times onto the tightened timeline so captions still line up | 04, 03 |
| `clipper/crop.py` | Facecam rule: sample about 24 frames, take the largest face in each, need three or more, reject when the median face is over half the frame or the centres do not cluster, pad the box by half a face each side. Camera path: detect every 6th frame at 640 px, forward-fill gaps, then one exponential average run forward and one backward, averaged (no lag). A punch-in zoom as a rise, hold and fall, with a minimum gap between punches | 07, 08 |
| `clipper/captions.py` | Lines of up to 3 words, broken on a 0.6 s pause, written as ASS (the closest of the set to our writer); each word's highlight lasts until the next word starts; up to two content words a line stay tinted; the first tinted word's time doubles as a zoom trigger | 03 |
| `clipper/score.py` | A compact transcript (12 words a line, a start time first); strict JSON; clamp to the length band; note that a reasoning model with a JSON grammar must have thinking off or it returns an empty object | 05 |

```
keepSpans(words, start, end, maxGap = 0.5, pad = 0.15):
    open a span at the first word (minus pad)
    for each next word: if gap to previous word > maxGap, close the span (plus pad) and open a new one
    merge spans that touch after padding
```

In PostGear the spans become segments and the caption mapping in research file 06 replaces the remap step.

### 2.4 `Rose91825/autoclip` And `zhouxiaoka/autoclip`

- `Rose91825/autoclip` could not be read: github.com/Rose91825/autoclip returned 404 and an anonymous clone was refused (2026-11-14). It is private, renamed or removed.
- The widely used project of that name was read in its place. **URL**: github.com/zhouxiaoka/autoclip. **Licence**: MIT. **Stars**: 10.5k. **Last commit**: 2026-11-03 (`cd8e6be`).
- **Stack**: a FastAPI backend with a task queue (`backend/celery_app.py`), a React frontend, any OpenAI-compatible model (its own measurements name qwen-plus), creator subtitles or local Whisper or SenseVoice.

| File | What It Does | Module |
|---|---|---|
| `backend/pipeline/clip_finder.py` | The current one-pass finder. Rows go to the model as an id, a clock time and the text on one line (about 40 % fewer tokens than subtitle timestamps, by its own note) and clips come back as a **start row and an end row**, never as times. Windows are about 60 minutes with 4 minutes of overlap and a 70,000 character cap; local models get 20 minutes and 12,000 characters. Picks sharing more than half of the shorter one are the same moment | 05 |
| `backend/pipeline/quality.py` | "Take back from the model what a program can compute": length tiers by video length (short: 20 s minimum, 30 to 90 s target; medium: 45 s, 60 to 180 s; long: 90 s, 120 to 360 s), snapping to the nearest subtitle cue within 3 s, extending to the minimum, trimming to the maximum, merging near neighbours, and a selection floor so a strict threshold never returns zero clips | 05 |
| `backend/pipeline/step1_outline.py` to `step5_clustering.py` | The older path: outline, timeline, score, title, then clustering clips into themed collections. Its own docstring calls it built for small context windows (5,000-character chunks, four calls a chunk) | 05, 11 (collections as a montage seed) |
| `backend/prompt/<category>/` | One prompt set per content category (business, entertainment, experience and others) | 05 (genre) |
| `backend/core/weak_local_timeline.py` | A plain statement that 7B to 8B local models cannot return usable time ranges | 14 (model choice) |

```
row sent:   17 | 12:04 | so the first thing we tried was
answer:     { start_row: 17, end_row: 31, title, reason, score }
times:      rows[17].start to rows[31].end, then snapped and length-checked in code
```

This is the shape Module 05 uses, with word indexes in place of row ids.

### 2.5 `NaufalRizqullah/opensource-clipping`

- **URL**: github.com/NaufalRizqullah/opensource-clipping. **Licence**: MIT. **Stars**: 265. **Last commit**: 2026-11-14 (`ac29455`).
- **Stack**: faster-whisper (large-v3), Gemini or an NVIDIA endpoint, MediaPipe Tasks, an optional YOLO face model through `ultralytics` (AGPL-3.0, reported), pyannote diarization, FFmpeg, ASS captions, a FastAPI and React studio.

| File | What It Does | Module |
|---|---|---|
| `clipping/studio/face_detection.py` | The MediaPipe **Tasks** `FaceDetector` created once, in IMAGE mode at 0.5 confidence, and proven with one inference on a blank image before it is cached (a wrong model only fails on first use). Speaker count estimated from 20 spread samples | 07 |
| `clipping/studio/render_hybrid.py` | Two phases: detect the largest face every 0.25 s, then smooth: start from the median of the first five samples; snap when the face jumps past a threshold; otherwise move 30 % of the way only once the face leaves a dead zone of 15 % of the crop width | 08 |
| `wiki/4-Face-Tracking-and-Auto-Framing.md` | The five tuning values (step, dead zone, smoothing, jitter in pixels, snap) with settings for a solo speaker, an interview and fast movement; and the note that the full-range model fails under the Tasks detector in MediaPipe 0.10.21 | 07, 08 |
| `clipping/engine.py` (`get_analysis_prompt`) | One call over the whole transcript; a 1 to 100 score built from five 20-point parts (hook strength, emotion, share and comment potential, stand-alone clarity, payoff); optional keep-segments inside a clip; optional micro-hooks of 0.5 to 2 s for an intro | 05, 04, 09 |
| `clipping/diarization.py` | pyannote `speaker-diarization-3.1` to drive a split screen | 07 (later) |

Its prompt is in Indonesian; we take the rubric idea and write our own. Its voice-over uses an unofficial browser speech endpoint: not for a commercial service.

### 2.6 `google/mediapipe`: AutoFlip

- **URL**: github.com/google/mediapipe. **Licence**: Apache-2.0. **Stars**: 37.7k. **Last commit**: not shown on the page and not read (the repository was not cloned).
- **Status**: `docs/solutions/autoflip.md` returned 404 on the main branch on 2026-11-14, while the example code is still there. The design is described in Google's post of 2020-02-13 (research.google/blog/autoflip-an-open-source-framework-for-intelligent-video-reframing, verified 2026-11-14).
- **Logic** (`mediapipe/examples/desktop/autoflip/autoflip_messages.proto`, `mediapipe/examples/desktop/autoflip/calculators/scene_cropping_calculator.proto`, Module 08): decisions are made per scene, with a forced flush after 600 frames; every detection is a salient region with a signal type (face, human, pet, text, logo, motion, user hint and others), a score and an `is_required` flag; a user hint overrides every other signal for its scene; the strategy per scene is stationary, panning or tracking; when required regions cannot fit, the frame is padded with a blurred copy under a 0.6 dark overlay, or with a solid colour when more than 60 % of the shot's frames have a solid background.
- **What we keep**: the vocabulary (required regions, a user hint that always wins, one strategy per scene). The code is a C++ graph and is not ported.

### 2.7 `m-bain/whisperX`

- **URL**: github.com/m-bain/whisperX. **Licence**: BSD-2-Clause. **Stars**: 25.3k. **Last commit**: 2026-11-12 (`b904f02`). **Version** in `pyproject.toml`: 3.8.7rc1; Python 3.10 to 3.13; depends on `faster-whisper>=1.2.0`, `ctranslate2>=4.5.0`, `pyannote-audio>=4.0.0`, `torch~=2.8.0`.
- **Logic** (`whisperx/alignment.py`, Module 02): after transcription, each segment's text is force-aligned to the audio with a wav2vec2 model for that language, which gives tighter word times than Whisper's own; words that cannot be aligned (numbers, symbols) get times interpolated from their neighbours (`interpolate_method`, default "nearest"). `whisperx/diarize.py` assigns speakers; `whisperx/vads/` holds the Silero and pyannote VAD wrappers.
- **Language gap**: the default alignment table has about 40 languages, among them Hindi, Telugu, Malayalam, Urdu and Arabic. **Tamil is not in it**, nor are Bengali, Kannada, Marathi or Gujarati. For those, alignment needs a model we name ourselves, or we fall back to faster-whisper's word times.
- **Weight**: it pulls in PyTorch and pyannote, which is most of the image size of the media service. Its README also notes that batched transcription runs without timestamps and can differ from plain Whisper.

### 2.8 `SYSTRAN/faster-whisper`

- **URL**: github.com/SYSTRAN/faster-whisper. **Licence**: MIT. **Stars**: 26.7k. **Last commit**: 2026-11-12 (`6cb639e`). **Version**: 1.2.1 (`faster_whisper/version.py`).
- **Logic** (`faster_whisper/transcribe.py`, Module 02): a `Word` is `start`, `end`, `word`, `probability`; a `Segment` carries its words when `word_timestamps` is on (taken from the model's cross-attention, so it works for every language Whisper speaks). `BatchedInferencePipeline.transcribe` defaults to a VAD filter and a batch size of 8, and accepts hotwords.
- **A default to know** (`faster_whisper/vad.py`): its VAD options are tuned for cutting audio into chunks for transcription (speech threshold 0.5, 2,000 ms of silence to split, 400 ms of padding). They are wrong for silence removal; Module 04 runs the VAD with its own values.

### 2.9 `snakers4/silero-vad`

- **URL**: github.com/snakers4/silero-vad. **Licence**: MIT in the `LICENSE` file, and the README says "Published under permissive license (MIT)". One README badge reads "CC BY-NC 4.0"; the file is what governs, and Module 01 confirms it once more when the package is pinned. **Stars**: 10.7k. **Last commit**: 2026-10-22 (`066409f`). **Version**: 6.2.3.
- **Logic** (`src/silero_vad/utils_vad.py`, Modules 02, 04, 06): `get_speech_timestamps` turns audio into speech spans (threshold 0.5, at least 250 ms of speech, 100 ms of silence to split, 30 ms of padding, 512-sample windows at 16 kHz). `get_speech_timestamps_from_probs` does the same from a stored list of probabilities, so we can keep the probability curve as the `speech` track and cut spans twice (loosely for transcription, tightly for silence removal) without running the model again.
- **Runtime**: an ONNX path that needs no PyTorch (`silero-vad[onnx-cpu]`); under 1 ms for a 30 ms chunk on one CPU thread, by its README.

### 2.10 `Breakthrough/PySceneDetect`

- **URL**: github.com/Breakthrough/PySceneDetect. **Licence**: BSD-3-Clause. **Stars**: 5.5k. **Last commit**: 2026-11-13 (`7899283`). The main branch is `0.8-dev0`; the README names v0.7.3 as the latest release.
- **Logic** (Modules 06, 08): `scenedetect/detectors/content_detector.py` scores the change between frames and cuts above a threshold (default 27.0, a minimum scene length of 15, with a filter against flashes); `scenedetect/detectors/adaptive_detector.py` compares each score with a rolling average of its neighbours (ratio 3.0, window 2, minimum content value 15.0), which holds up better under fast camera motion. Hash, histogram and threshold detectors are documented under `docs/api/detector_options/`.
- **Note**: OpenShorts moved its primary engine to TransNetV2 and kept PySceneDetect as the fallback. Sprint 12 already writes a scene track with FFmpeg; Module 08 starts from that track and reaches for PySceneDetect's adaptive detector only if cuts are missed on gameplay.

### 2.11 A Browser Template For Captions (Dropped)

An earlier draft read a public TikTok captions template built for a browser based renderer (no licence file, `UNLICENSED` in its `package.json`, 308 stars, last commit 2026-11-09). It is dropped on 2026-11-17: the render engine is FFmpeg only, and captions are drawn by libass from an ASS file (research 06 section 2, research 09). Nothing from it is carried over. The paging ideas it showed (a page is a short run of words, the active word holds until the next word starts) are already in the clippers below, in code that targets ASS, which is closer to our design.

### 2.12 Others Found (Page Only)

| Repository | Licence | Stars | Note | Module |
|---|---|---|---|---|
| `Junhua-Liao/Light-ASD` | MIT | 196 | Active-speaker model, AVA validation mAP 94.06 % | 07 (later) |
| `TaoRuijie/TalkNet-ASD` | MIT | 520 | Active-speaker model, AVA validation mAP 92.3; its extra training set is built from VoxCeleb2 and LRS3 | 07 (later) |
| `soCzech/TransNetV2` | MIT | 1.1k | Neural shot-boundary detector with a PyTorch inference folder | 08 (later) |
| `kamilstanuch/Autocrop-vertical` | None shown | 456 | A tight crop or a letterbox per scene, decided from a person detector on the scene's middle frame; depends on YOLOv8 | 08 |
| `WyattBlue/auto-editor` | Unlicense | 5.9k | Cuts silence by audio loudness; default threshold 0.04 and margin 0.2 s | 04 |

For both active-speaker models the code is MIT, but the trained weights come from research datasets whose terms for commercial use are not settled (reported). They stay out until those terms are read.

## 3. What We Take, By Module

| Module | From | What |
|---|---|---|
| 01 Media Service Foundations | OpenShorts, autoclip | Pure, standard-library helpers kept apart from heavy imports so they are unit-tested without the models |
| 02 Transcription | faster-whisper, WhisperX, Silero VAD, OpenShorts | Word times with probabilities; optional alignment per language; a written transcript contract with a leading space on each word; a fallback chain between engines |
| 03 Captions Track And Styles | clipper (its ASS caption writer), OpenShorts | Pages and tokens; paging by words, characters and pauses; highlight held to the next word; a style shape as data |
| 04 Transcript Editing And Speech Cleanup | clipper, opensource-clipping, auto-editor, OpenShorts | Keep spans from gaps with padding; keep-segments inside a clip; a clip as a list of source segments |
| 05 Clip Setup And AI Highlights V2 | OpenShorts, autoclip, opensource-clipping, AI-Youtube-Shorts-Generator | Two passes over sentence-aligned windows; answers as row or word indexes; a five-part score; snapping and length repair in code; dedup; evidence from signals with a guaranteed shortlist place |
| 06 Visual Moments | OpenShorts | A closed question on a few stills at 1,024 px; the sparse-speech test; frames, not video |
| 07 Face Detection And Facecam Detect | opensource-clipping, clipper, OpenShorts | MediaPipe Tasks with a first-inference check; one forward decode at 640 px; the facecam cluster rule; the corner-grown inset |
| 08 Auto-Reframe | OpenShorts, opensource-clipping, clipper, AutoFlip | A mode per scene; dead zone, jump confirmation, speed cap, snap on cuts; zero-lag smoothing; padded fallback; a user hint that always wins |
| 09 AI Effects | OpenShorts, opensource-clipping | Hook text about this moment; hook placed off faces and captions; micro-hooks as an idea |
| 11 Montage And Batch Export | autoclip, OpenShorts | Themed collections as a montage seed; the segment list as the edit |
| 14 Scale, Cost And Deploy | autoclip, OpenShorts | Smaller windows for small models; a per-job cost record summed across calls |

## 4. The Licence Rule

- **MIT, BSD, Apache**: code may be adapted. The notice is kept, and the module doc that uses it names the repository, the file and the commit.
- **GPL, AGPL, no licence, "UNLICENSED"**: ideas only. No code is read side by side while writing ours, and none is pasted.
- **Nothing** is copied from StreamLadder, OpusClip or Postiz.
- **Only permissive licences ship.** LGPL and GPL tools run as separate programs.

What this read adds to the rule:

- A repository's licence does not cover its dependencies. OpenShorts and opensource-clipping are MIT but can load `ultralytics` (AGPL-3.0, reported). We never follow those paths.
- A repository can carry two licences. OpenShorts' `cloud/` folder is not MIT.
- A licence on code does not settle the licence on model weights or on fonts (the active-speaker models, the template's font).
- A file that says it was ported from another product is treated as ideas only, whatever its own header says.
- **Open question for Arvind**: `Rose91825/autoclip` could not be found. Recommendation: accept `zhouxiaoka/autoclip` (MIT, read in full for this page) as the reference, unless you have a different address in mind.

## 5. Patterns That Repeated Across Projects

1. **The model proposes, code decides.** Every project cleans the model's answer in code: clamp, snap, repair length, dedup. The two largest moved further: one snaps every cut to word edges, the other stopped asking for times at all and asks for row ids.
2. **Windows aligned to sentences, with overlap.** 90 s with 30 s (OpenShorts scoring), 20 minutes with 60 s, 60 minutes with 4 minutes. A moment cut by a window edge is lost without the overlap.
3. **Score everything, select globally.** Selecting inside each batch caps the shortlist and lets filler through.
4. **Ask for more than you need, then dedup by overlap.** Thresholds of 25 to 50 % of the shorter clip.
5. **A floor on the clip count.** One project measured that users who got one to three clips rarely returned; it added a floor and a second call on unused windows.
6. **Closed questions for vision models.** A choice between named options is stable; a measured number is not.
7. **Detect small, sparse and forward.** 640 px or less, 4 to 7 frames a second, one decode pass with no seeks.
8. **A camera that prefers to hold.** A dead zone, damped moves, big jumps confirmed before they are believed, and a hard cut at a scene change.
9. **A mode per scene, never per frame**, with short odd scenes flipped to match their neighbours.
10. **Silence trimming from word gaps of about half a second**, with 0.15 to 0.2 s kept on each side.
11. **Captions page by words, characters and pauses**, and never across a cut.
12. **Every new signal ships behind a switch, with a fallback to the old behaviour**, and the pure maths is kept in files that tests can load without the models.
