# Sprint 13 Research: Libraries

> **Written**: 2026-11-14. Python versions, licences, release dates and wheel lists were read from `pypi.org/pypi/<name>/json` on that day; npm packages from `registry.npmjs.org`. Anything not read today is marked **reported**. The service runs on **Python 3.13** (see `05-python-media-service.md`, section 7); the API still compiles with `module: commonjs` on Node 20.9 or newer, and the repo has zod 3.25.76 installed.
> **Licence rule** (from the plan): only permissive licences ship inside our code. GPL and LGPL tools may run as separate programs. Model weights and word lists have their own licences and are listed too.

## 1. Python: The Service And Its Models

| Package | Version | Licence | Last release | Python | Verdict | Why |
|---|---|---|---|---|---|---|
| `fastapi` | 0.163.0 | MIT | 2026-11-14 | 3.11 or newer | **Pick** | The HTTP surface (health, info) and the app lifespan. Depends on Starlette and pydantic 2. |
| `uvicorn` | 0.54.0 | BSD-3-Clause | 2026-09-25 | 3.10 or newer | **Pick** | The server for FastAPI. Plain install, no extras needed for three routes. |
| `pydantic` | 2.14.3 | MIT | 2026-11-05 | 3.10 or newer | **Pick** | Every payload model; mirrors the Zod contract. |
| `pydantic-settings` | 2.16.3 | MIT | 2026-11-13 | 3.11 or newer | **Pick** | Typed settings read from the repo root `.env` (brings `python-dotenv`). |
| `temporalio` | 1.36.1 | MIT | 2026-11-14 | 3.11 or newer | **Pick** | The Python worker on `postgear-media-py`. One `abi3` wheel per platform, Windows included. |
| `faster-whisper` | 1.2.1 | MIT | 2025-10-31 | 3.9 or newer | **Pick** | Speech to text with word timings. Pure Python wheel. Last release is a year old, see section 6. |
| `ctranslate2` | 4.9.0 | MIT | 2026-11-10 | 3.9 or newer | **Pick** | The engine under faster-whisper. Wheels for cp39 to cp315 on Windows, Linux and macOS. GPU needs CUDA 12 and cuDNN 9. |
| `onnxruntime` | 1.32.0 | MIT | 2026-11-13 | 3.11 or newer | **Pick** (arrives with faster-whisper) | Runs the Silero VAD model that faster-whisper bundles. |
| `av` (PyAV) | 19.0.2 | BSD-3-Clause | 2026-10-21 | 3.12 or newer | **Pick** (arrives with faster-whisper) | Decodes audio in-process, so the service needs no FFmpeg program. |
| `whisperx` | 3.8.6 (3.8.7rc1 on 2026-06-26) | BSD-2-Clause | 2026-05-25 | 3.10 to 3.13 | **Later** | Tighter word timings by forced alignment, but it pins `torch~=2.8.0`, `torchaudio`, `torchvision` and `pyannote-audio>=4`, caps `huggingface-hub<1.0.0`, and has no Tamil alignment model. |
| `silero-vad` | 6.2.3 | MIT | 2026-09-23 | 3.8 or newer | **Reject** as a package | It requires `torch>=1.12.0`. We use the copy inside faster-whisper (Silero VAD V6, on `onnxruntime`). |
| `scenedetect` | 0.7.3 | BSD-3-Clause | 2026-11-08 | 3.10 or newer | **Reject** this build | It hard-requires `opencv-python` (the desktop build). Use the twin below. |
| `scenedetect-headless` | 0.7.3 | BSD-3-Clause | 2026-11-08 | 3.10 or newer | **Pick** | The same PySceneDetect, bundling the headless OpenCV. Scene cuts for moments and reframing. |
| `mediapipe` | 1.2.3 | Apache-2.0 | 2026-11-11 | classifiers 3.9 to 3.14 | **Pick** | Face detection and landmarks for facecam detect and Auto-Reframe. `py3-none` wheels for Windows x64 and ARM, Linux x64 and ARM, macOS ARM. Pulls `opencv-contrib-python`, `matplotlib` and `sounddevice`, see section 6. |
| `opencv-python-headless` | 5.0.0.93 (the 4.x line is at 4.14.0.94, 2026-07-29) | Apache-2.0 | 2026-07-02 | 3.6 or newer | **Pick**, as the single OpenCV build | Motion and frame work. One `abi3` wheel (44 MB on Windows, 61 MB on Linux). Which exact build ships is settled in section 6. |
| `numpy` | 2.5.4 | BSD-3-Clause and others | 2026-10-10 | 3.12 or newer | **Pick** | Arrays for every model. Sets the Python floor with PyAV. |
| `boto3` | 1.44.3 | Apache-2.0 | 2026-11-13 | 3.10 or newer | **Pick** | S3 and MinIO. Blocking, which suits threaded activities. |
| `httpx` | 0.28.1 | BSD-3-Clause | 2024-12-06 | 3.8 or newer | **Pick** | The client for the transcription API binding and for FastAPI's test client. Stable but quiet: no release in two years. `huggingface-hub` 2.4.0 already depends on its successor `httpx2` 2.16.0 (github.com/pydantic/httpx2), so both end up installed; revisit at the next upgrade. |
| `structlog` | 26.1.0 | MIT or Apache-2.0 | 2026-06-06 | 3.10 or newer | **Pick** | JSON logs with job ids bound to every line. |
| `demucs` | 4.1.0 | MIT | 2026-07-11 | 3.10 or newer | **Later** | Vocal separation for gaming streams. Needs PyTorch and wants a GPU. |
| `nemo-toolkit` (Parakeet, Canary) | 3.0.0 | Apache-2.0 (models CC BY 4.0) | 2026-08-07 | 3.10 or newer | **Reject** | The models cover 25 European languages: no Hindi, no Tamil. |
| `pyannote.audio` | 4.0.7 | MIT (reported) | 2026-06-30 | 3.10 or newer | **Later** | Speaker labels. Needs PyTorch and a Hugging Face token with accepted terms. |
| `torch` | 2.15.0 | a compound expression (Apache-2.0, BSD and others) | 2026-10-28 | 3.11 or newer | **Reject** for now | Not needed by anything picked. 127 MB on Windows; on Linux it pulls the CUDA 13 toolkit and cuDNN as dependencies. Keeping it out is what keeps the image small. |

(All rows: pypi.org/pypi/<name>/json, verified 2026-11-14.)

## 2. Python: Tooling

| Tool | Version | Licence | Last release | Verdict | Maps to |
|---|---|---|---|---|---|
| `uv` | 0.13.8 | MIT or Apache-2.0 | 2026-11-12 | **Pick** | Python install, `.venv`, `uv.lock`, `uv sync --locked`, `uv run`. Not a project dependency: installed on the machine and copied into the image. |
| `ruff` | 0.17.5 | MIT | 2026-11-12 | **Pick** | `lint` and `lint:fix` (`ruff check`, `ruff format`). One binary, no plugins. |
| `mypy` | 2.4.1 | MIT | 2026-10-28 | **Pick** | `typecheck`, strict mode. |
| `pyright` | 1.1.414 | MIT | 2026-09-10 | **Reject** (alternative) | Good checker, but the PyPI package fetches its own Node through `nodeenv`. One checker is enough. |
| `ty` | 0.0.104 | MIT | 2026-11-13 | **Later** | Astral's type checker, still on 0.0.x. |
| `pytest` | 9.2.0 | MIT | 2026-10-27 | **Pick** | `test`. |
| `pytest-asyncio` | 1.5.0 | Apache-2.0 | 2026-11-12 | **Pick, optional** | Only if an async route or the worker start-up needs a test. |
| `datamodel-code-generator` | 0.96.0 | MIT | 2026-11-13 | **Pick** (dev only) | Generates the pydantic models from the contract's JSON Schema. |
| `moto` | 5.2.5 | Apache-2.0 | 2026-10-27 | **Pick, optional** | Fakes S3 in storage tests; the local-directory mode covers most of them. |

(pypi.org/pypi/<name>/json, verified 2026-11-14.)

## 3. npm

| Package | Version | Licence | Last release | Verdict | Why |
|---|---|---|---|---|---|
| `openapi-typescript` | 7.13.0 | MIT | 2026-02-11 | **Pick, optional** | Types for the service's three HTTP routes from its OpenAPI file; no runtime code. Peer `typescript ^5`. Its docs want `module` ESNext or NodeNext, so check it under the API's CommonJS build. |
| `openapi-fetch` | 0.17.0 | MIT | 2026-02-11 | **Reject** | A typed fetch client. `fetch` plus the generated types is enough for three calls. |
| Zod's own JSON Schema export (`z.toJSONSchema` from `zod/v4`) | in zod 3.25.76 (installed); zod latest is 4.6.7, 2026-10-12 | MIT | | **Pick** | Tested locally on 2026-11-14: emits draft 2020-12 with `additionalProperties: false` for strict objects. It accepts only schemas written with the version 4 API; a Zod 3 schema throws. |
| `zod-to-json-schema` | 3.25.2 | ISC | 2026-03-27 | **Reject** | Its README says "As of November 2025, this project will no longer be actively maintained" and points to Zod 4; the repository was archived on 2026-06-30 (github.com/StefanTerdell/zod-to-json-schema, verified 2026-11-14). |
| `obscenity` | 0.4.6 | MIT | 2026-01-18 | **Pick, optional** | English profanity matcher that sees through spacing and letter swaps (reported). Node 18 or newer. See section 5. |

(registry.npmjs.org, verified 2026-11-14. The browser renderer caption packages that an earlier draft listed here are dropped: the render engine is FFmpeg only, see section 3.1.)

### 3.1 Libass And FFmpeg 9.0.2 (Replaces The Earlier Caption Packages)

Captions and titles are drawn by libass inside FFmpeg, so no npm caption or layout package is needed. What the build in use provides (`ffmpeg -buildconf` and `-loglevel verbose`, verified on FFmpeg 9.0.2 gyan full build, 2026-11-17):

| Part | Version | Use |
|---|---|---|
| FFmpeg | 9.0.2, GPL build, run as a separate program | The renderer; `ass` filter, `aeval`, `xfade`, `libwebp_anim`, APNG and GIF writers |
| libass | 0.17.5 | ASS drawing: outline, box (`BorderStyle=3`), karaoke `\k` `\kf` `\ko`, `\t`, `\move`, `\alpha`, smart wrapping |
| HarfBuzz | 14.4.0 (COMPLEX shaper) | Tamil and Devanagari shaping (verified on sample text through Nirmala UI) |
| FriBidi | 1.0.16 | Right to left reordering (not run) |
| FreeType | 2.14.3 | Rasteriser; colour emoji are not drawn in colour |
| Font provider | DirectWrite on Windows; fontconfig on Debian (reported, not run) | `fontsdir` adds our fonts; a missing family falls back silently, caught from the `fontselect:` log lines |

Two FFmpeg 9 facts that older notes get wrong: `-filter_complex_script` is gone (use `-/filter_complex file`), and `volume=...:eval=frame` snaps edits to the audio frame (use `aeval`). Details in [`09-ass-captions-and-edit-cookbook.md`](09-ass-captions-and-edit-cookbook.md).

## 4. Text To Speech (The "Text To Speech" Effect)

| Option | Version | Licence | Languages | Runs on | Verdict |
|---|---|---|---|---|---|
| **Kokoro-82M** (weights), through `kokoro-onnx` | model v1.0 (2025-01-27); `kokoro-onnx` 0.6.1 (2026-08-19), Python 3.10 to 3.13 | Weights Apache-2.0; package licence not in the registry record (MIT reported) | 8 languages, 54 voices; the list is in the model's `VOICES.md` (not read; Hindi reported, Tamil not) | CPU through `onnxruntime`, which we already ship; 24 kHz output | **Pick, optional** |
| `kokoro` (the official PyTorch package) | 0.9.4 (2025-04-05) | Apache-2.0 | same | PyTorch, and Python **below 3.13** | **Reject** (wrong Python, needs PyTorch) |
| **Piper** (`piper-tts`) | 1.8.0 (2026-09-04) | **GPL-3.0-or-later** | Many voices, each with its own licence (`docs/VOICES.md`, not read) | CPU, embeds espeak-ng | **Later**, and only as a separate program |
| **OpenAI speech API** (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) | deprecated 2026-10-01 | service terms | Follows Whisper's list, Hindi included; voices tuned for English | API; $15 and $30 per million characters for the first two | **Reject** |

Notes:

- **Kokoro**: an 82 million parameter model with "Apache-licensed weights", about 1,000 characters to a minute of audio, and espeak-ng for phonemes (huggingface.co/hexgrad/Kokoro-82M, verified 2026-11-14). `kokoro-onnx` depends on `espeakng-loader`, `phonemizer`, `numpy` and `onnxruntime` (pypi.org/pypi/kokoro-onnx/json, verified). espeak-ng and `phonemizer` are GPL-3.0 (reported); `kokoro-onnx` calls espeak-ng as a loaded library, so **the licence chain must be read before this ships**. If it does not pass, run it as its own small program behind the same interface.
- **Piper**: the maintained repository is `OHF-Voice/piper1-gpl`, GPL-3.0 (verified 2026-11-14); the page says the Open Home Foundation "is looking for Piper maintainers". Under our licence rule it can only run as a separate program.
- **OpenAI**: all three speech models "will shut down on January 6, 2027"; the named replacement is `gpt-realtime-2.1-mini` on the Realtime API, which is "not supported on `/v1/audio/speech`". Its policy also requires telling end users the voice is AI-generated (developers.openai.com/api/docs/guides/text-to-speech and /deprecations, verified 2026-11-14). Building on an endpoint with seven weeks to live is not sensible. `06-captions-moments-and-vision.md`, section 10, proposes OpenAI speech as the first real binding; this deprecation speaks against that, and the two files must be reconciled in the sprint document.
- **Kokoro's languages**: `06-captions-moments-and-vision.md` read the list on the project's GitHub page (American and British English, Spanish, French, Hindi, Italian, Japanese, Brazilian Portuguese, Mandarin; no Tamil).
- **Open question for Arvind**: is text to speech needed in Sprint 13 at all, and in which languages? Recommendation: English only, Kokoro, behind a `SpeechSynthesizer` interface with a simulation binding (a recorded clip), built last in Module 09 and dropped to the P2 list if the licence check fails. Every generated voice gets the AI disclosure toggle from Module 13.

## 5. Profanity Word Lists (The "Word Censoring" Effect)

Censoring is a match over transcript words, then a mute or a bleep over each word's time span and a mask over its caption. The match is pure text work, so it lives in TypeScript (`packages/video-engine`), where the editor can preview it; no Python is involved.

| Source | Version | Licence | Languages | Verdict |
|---|---|---|---|---|
| **LDNOOBW** word lists (github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) | repository, copyright Shutterstock 2012 to 2020 | **CC BY 4.0** | 28 lists, **Hindi included**, no Tamil | **Pick** as data: copy the `en` and `hi` lists into the engine with the attribution line in the notices file |
| `naughty-words` (npm) | 1.2.0, 2020-07-13 | CC BY 4.0 | the same lists as JSON | **Reject** (stale wrapper; copy the data instead) |
| `obscenity` (npm) | 0.4.6, 2026-01-18 | MIT | English | **Pick, optional**: catches spaced-out letters and letter swaps that a plain list misses (reported) |
| `cuss` (npm) | 2.2.0, 2023-04-29 | MIT | English, each word rated for how sure it is | **Later**: useful for a "mild or strict" setting |
| `bad-words` (npm) | 4.1.5, 2026-07-19 | MIT | English | **Reject** (plain list match, nothing the others lack) |
| `@2toad/profanity`, `leo-profanity` (npm) | 3.3.0; 1.9.0 | MIT | several; the second is "based on Shutterstock dictionary" | **Reject** (same data, one more dependency) |
| `better-profanity` (PyPI) | 0.7.0, **2020-11-02** | MIT | English | **Reject** (Python, and unmaintained) |

(GitHub page, registry.npmjs.org and pypi.org, verified 2026-11-14.)

Rules we add: match whole words on normalised text (lower case, punctuation stripped), never substrings, to avoid false hits inside clean words; keep the list as a versioned data file, not code; let each workspace add and remove words (stored with the brand kit, Module 10), which is also how Tamil and Hinglish slang are covered since no list read today has them; the editor shows every hit and the user can un-censor one.

## 6. Findings That Change The Build

### 6.1 Three OpenCV Builds Would Be Installed

The dry run for the picked stack resolved `opencv-python`, `opencv-contrib-python` **and** `opencv-python-headless`, all at 5.0.0.93, in one environment: `scenedetect` requires the first, `mediapipe` the second, and our own code the third (pypi.org requires_dist and `uv pip compile`, verified 2026-11-14). All three install the same `cv2` module and overwrite each other; the desktop builds also need system graphics libraries in a slim image (reported).

The fix, checked in Module 01:

- depend on `scenedetect-headless` instead of `scenedetect`;
- keep **one** build in the lockfile and exclude the rest with uv's `exclude-dependencies` setting ("Prevents a package from being selected during resolution, even when transitive dependencies request it", docs.astral.sh/uv/reference/settings, verified 2026-11-14);
- the one build is `opencv-contrib-python-headless` 5.0.0.93 if MediaPipe turns out to need contrib modules, otherwise `opencv-python-headless`. An import-and-detect test on the sample video decides.

### 6.2 OpenCV 5 Is What The Resolver Picks

`opencv-python-headless` latest is 5.0.0.93 (2026-07-02), a new major line; 4.14.0.94 came out after it (2026-07-29), so the 4.x line is still maintained (verified 2026-11-14). Whether PySceneDetect 0.7.3 and MediaPipe 1.2.3 are tested on OpenCV 5 was not read. Module 01 runs the fixture tests on 5; if anything fails, pin `<5`.

### 6.3 MediaPipe Brings Passengers

`mediapipe` 1.2.3 requires `matplotlib` and `sounddevice` (verified). Neither is used by face detection. `sounddevice` wants the PortAudio system library when imported (reported). Module 07 checks that MediaPipe's face modules import in the slim image without it, or adds the one system package.

### 6.4 No PyTorch, On Purpose

Nothing picked needs PyTorch: faster-whisper runs on CTranslate2 and `onnxruntime`. `silero-vad`, `whisperx`, `demucs`, `pyannote.audio` and the official `kokoro` all do. That is the main reason each is **Later** or **Reject**: adding the first one costs gigabytes in the image and a second CUDA stack to keep in step.

### 6.5 faster-whisper Is Quiet

Its last release is 2025-10-31 and its classifiers stop at Python 3.11, yet it resolves and its engine, CTranslate2, shipped 4.9.0 four days ago (verified). The risk is a future CTranslate2 5 (the wheel requires `ctranslate2<5`). Mitigation: the `Transcriber` interface, the lockfile, and a recorded-audio regression test that runs whenever the lock changes.

### 6.6 The Contract Package Uses `zod/v4`

`z.toJSONSchema()` only accepts version 4 schemas and the rest of the repo writes Zod 3 (`import { z } from 'zod'`). The contract package imports from `zod/v4` and stays self-contained. Upgrading the whole repo to zod 4.6.7 is out of scope.

## 7. Model Weights

Weights are files, not packages, and carry their own licences. None is committed to the repo; `python -m media.fetch_models` downloads them by pinned revision (see `05-python-media-service.md`, section 9).

| Weights | Licence | Size | Used by |
|---|---|---|---|
| Whisper `small`, `large-v3-turbo`, `large-v3` (CTranslate2 conversions on the Hugging Face Hub) | MIT: "Whisper's code and model weights are released under the MIT License" (github.com/openai/whisper, verified 2026-11-14) | about 0.5, 1.6 and 3 GB (reported) | Module 02 |
| Silero VAD V6 | MIT (github.com/snakers4/silero-vad, verified 2026-11-14) | about 2 MB, inside the faster-whisper wheel | Modules 02 and 04 |
| MediaPipe face detector and face landmarker | Apache-2.0 (reported; read the model cards in Module 07) | a few MB each (reported) | Modules 07 and 08 |
| Kokoro-82M | Apache-2.0 (huggingface.co/hexgrad/Kokoro-82M, verified 2026-11-14) | 82 million parameters | Module 09, optional |

## 8. Which Module Installs What

| Module | Adds |
|---|---|
| 01 Media Service Foundations | `fastapi`, `uvicorn`, `pydantic`, `pydantic-settings`, `temporalio`, `boto3`, `structlog`; the `dev` group (`ruff`, `mypy`, `pytest`, `datamodel-code-generator`); the contract package on `zod/v4`; `openapi-typescript` if it passes the CommonJS check |
| 02 Transcription | `faster-whisper`, `ctranslate2` (with `onnxruntime`, `av`, `tokenizers`, `huggingface-hub`), `httpx` for the API binding |
| 03 Captions Track And Styles | nothing from npm (the pager and the width function are ours; libass is in FFmpeg); the Noto Tamil and Devanagari font files |
| 04 Transcript Editing And Speech Cleanup | nothing new (the VAD inside faster-whisper finds the silences) |
| 05 Clip Setup And AI Highlights V2 | nothing new (the text model already in `ai-engine`) |
| 06 Visual Moments | one OpenCV build, `scenedetect-headless`, `numpy` |
| 07 Face Detection, 08 Auto-Reframe | `mediapipe` |
| 09 AI Effects | the word lists as data, `obscenity` (optional), `kokoro-onnx` (optional, after the licence check) |
| 14 Scale, Cost And Deploy | the `gpu` group (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) |

Modules 10 to 13 and 15 add no library from this file.

## 9. Pins For `apps/media/pyproject.toml`

Exact versions live in `uv.lock`; `pyproject.toml` carries compatible ranges with a ceiling on anything that sets a file format or a wire protocol.

| Group | Dependencies |
|---|---|
| base | `fastapi>=0.163,<0.164`, `uvicorn>=0.54,<0.55`, `pydantic>=2.14,<3`, `pydantic-settings>=2.16,<3`, `temporalio>=1.36,<2`, `boto3>=1.44,<2`, `httpx>=0.28,<0.29`, `structlog>=26.1` |
| `ml` | `faster-whisper==1.2.1`, `ctranslate2>=4.9,<5`, `scenedetect-headless>=0.7.3,<0.8`, `mediapipe>=1.2.3,<1.3`, one OpenCV build (section 6.1), `numpy>=2.5,<3` |
| `gpu` | `nvidia-cublas-cu12` (12.9.3.13 today), `nvidia-cudnn-cu12` (9.28.1.4 today) |
| `tts` (optional) | `kokoro-onnx>=0.6.1,<0.7` |
| `dev` | `ruff>=0.17.5`, `mypy>=2.4,<3`, `pytest>=9.2,<10`, `datamodel-code-generator>=0.96`, `moto>=5.2` |

`requires-python = ">=3.13,<3.14"`. npm side: no caption package; `openapi-typescript` as a dev dependency of the contract package if it passes the CommonJS check.

## 10. Open Questions

- **Open question for Arvind**: WhisperX is in the plan's library table "for alignment". Recommendation: leave it out of Sprint 13. faster-whisper's own word timings are enough for captions, WhisperX has no Tamil model, and it would bring PyTorch. Revisit only if the Module 02 benchmark shows caption drift a viewer can see.
- **Open question for Arvind**: text to speech, see section 4. Recommendation: English, Kokoro, last, and only if its licence chain is clean.
- **Open question for Arvind**: which word lists ship by default? Recommendation: English and Hindi from LDNOOBW with attribution, plus a per-workspace custom list.
- **To confirm in Module 01**: one OpenCV build; OpenCV 5 against the fixtures; MediaPipe in the slim image; `openapi-typescript` output under CommonJS.
