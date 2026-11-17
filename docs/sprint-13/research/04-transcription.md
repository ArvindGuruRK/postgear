# Sprint 13 Research: Transcription

> **Written**: 2026-11-14. Every fact marked **verified** was read by Claude on that day from the page named beside it. Facts marked **reported** come from memory or secondary sources and were not read today; Module 02's benchmark and fixture recording confirm them before they ship. Prices are list prices in US dollars unless a line says EUR.
> **Rule carried over**: no paid API is called during the build. The API binding is built against a recorded response; the owner decides when a real key is used.

## 1. The Short Answer

- **The model**: Whisper `large-v3-turbo`, run by **faster-whisper 1.2.1** on **CTranslate2 4.9.0**. It is MIT, multilingual (Hindi and Tamil included), gives word timings with a confidence per word, and runs on a plain CPU.
- **Word timings**: taken from faster-whisper itself (`word_timestamps=True`). WhisperX alignment is parked: it has no Tamil model and drags in a pinned PyTorch.
- **Three bindings behind one interface**: `simulation` (recorded transcript), `faster-whisper` (self-hosted), `groq` (hosted Whisper, the only API today that is cheap and returns word timings from the same model family).
- **OpenAI is out as the API choice**: `whisper-1` and the whole `gpt-4o-transcribe` family shut down on 2027-02-26, and the replacement `gpt-transcribe` documents no word timings (section 3.2).
- **Speed, not price, is the real limit**: a CPU box transcribes at about real time (assumption, section 6), so a 3 hour stream takes about 3 hours. Clip-length audio is fine on CPU; whole-stream jobs need a fast lane (API or GPU).

## 2. Options Read Today

| Option | Kind | Version read | Licence | Word timings | Hindi / Tamil | Cost or speed | Verdict |
|---|---|---|---|---|---|---|---|
| faster-whisper | self-hosted library | 1.2.1, released 2025-10-31 | MIT | Yes, cross-attention plus dynamic time warping, with a probability per word | Both (Whisper's 99 languages) | Section 2.1 benchmarks | **Pick** (default) |
| WhisperX | self-hosted, on top of faster-whisper | 3.8.6, released 2026-05-25 | BSD-2-Clause | Yes, wav2vec2 forced alignment | Hindi yes, Tamil no alignment model | Claims about 70x real time on GPU with large-v2 | **Later** |
| whisper.cpp | self-hosted C++ program | repository read, release tag not shown | MIT | `-ml 1`, marked experimental | Both | On par with faster-whisper in its README tables | **Reject** for now (a second runtime for no gain) |
| NVIDIA Parakeet TDT 0.6b v3 | self-hosted, NeMo | model card dated 2025-08-14 | CC BY 4.0 | Yes, native | **Neither** (25 European languages) | RTFx 3,332 on the Open ASR board | **Reject** (languages) |
| NVIDIA Canary 1b v2 | self-hosted, NeMo | model card | CC BY 4.0 | Yes for transcription | **Neither** (25 European languages) | RTFx 749 | **Reject** (languages) |
| Groq, `whisper-large-v3-turbo` | hosted API | docs page | service terms | Yes (`verbose_json`, `timestamp_granularities` word and segment) | Both (multilingual) | **$0.04 per audio hour**, speed factor 216 | **Pick, optional** (the fast lane) |
| Groq, `whisper-large-v3` | hosted API | docs page | service terms | Yes | Both | $0.111 per audio hour, speed factor 189 | **Pick, optional** (accuracy switch) |
| Deepgram Nova-3 | hosted API | pricing page | service terms | Yes, always (`words[]` with start, end, confidence) | Both listed for Nova-3 | $0.0043 a minute ($0.258 an hour); multilingual $0.0052 a minute | **Later** (swap-in) |
| AssemblyAI Universal-2 | hosted API | pricing page | service terms | Yes (`words[]` in milliseconds) | Hindi "Good", Tamil "Moderate" | $0.15 an hour | **Later** (swap-in) |
| AssemblyAI Universal-3.5 Pro | hosted API | pricing page | service terms | Yes | 18 languages, list not shown | $0.21 an hour | **Later** |
| OpenAI `gpt-transcribe` | hosted API | model page | service terms | **Not documented** | "Multilingual audio, and code-switching", no list | $0.0045 a minute ($0.27 an hour) | **Reject** (no word timings) |
| OpenAI `whisper-1` | hosted API | guide and deprecations page | service terms | Yes | 98 languages | $0.006 a minute ($0.36 an hour) | **Reject** (shut down 2027-02-26) |

Sources for the table: pypi.org/pypi/faster-whisper/json, pypi.org/pypi/whisperx/json, github.com/SYSTRAN/faster-whisper, github.com/m-bain/whisperX, github.com/ggml-org/whisper.cpp, huggingface.co/nvidia/parakeet-tdt-0.6b-v3, huggingface.co/nvidia/canary-1b-v2, console.groq.com/docs/speech-to-text, deepgram.com/pricing, developers.deepgram.com/docs/pre-recorded-audio, developers.deepgram.com/docs/models-languages-overview, assemblyai.com/pricing, assemblyai.com/docs/pre-recorded-audio/supported-languages, developers.openai.com/api/docs/guides/speech-to-text, developers.openai.com/api/docs/pricing, developers.openai.com/api/docs/deprecations, developers.openai.com/api/docs/models/gpt-transcribe (all verified 2026-11-14).

### 2.1 faster-whisper In Detail

**What it is**: a reimplementation of Whisper on CTranslate2 (github.com/SYSTRAN/faster-whisper, verified 2026-11-14). The wheel is pure Python (`py3-none-any`, 1.1 MB) and depends on `ctranslate2>=4.0,<5`, `huggingface-hub`, `tokenizers`, `onnxruntime`, `av>=11` and `tqdm` (pypi.org/pypi/faster-whisper/json, verified 2026-11-14). Audio is decoded by PyAV, so the service needs no FFmpeg of its own for transcription (reported).

**Maintenance**: releases 1.1.0 (2024-11-21, batched inference and `large-v3-turbo`), 1.2.0 (2025-08-06, `distil-large-v3.5`), 1.2.1 (2025-10-31, Silero VAD V6) (github.com/SYSTRAN/faster-whisper/releases and PyPI, verified 2026-11-14). Nothing since: the last release is over a year old. The engine under it is active (CTranslate2 4.9.0, 2026-11-10). The stack resolved with binary wheels only for Python 3.13 and 3.14 on Windows and Linux in a dry run on 2026-11-14 (`uv pip compile`, see `05-python-media-service.md`, section 7).

**Models**:

| Model | Size | Languages | Use |
|---|---|---|---|
| `large-v3` | 1,550 M parameters | Multilingual | Best accuracy, slowest. The accuracy switch for Tamil and noisy audio. |
| `large-v3-turbo` (alias `turbo`) | 809 M, decoder cut from 32 layers to 4 | Multilingual, 99 languages | **Default.** "Way faster, at the expense of a minor quality degradation." Not trained for translation. |
| `distil-large-v3.5` | 756 M | **English only** | About 1.5 times faster than turbo on short audio, but worse on long audio (10.04 against 8.82 average WER). Not for us: the owner's users speak Hindi and Tamil. |
| `small` | 244 M | Multilingual | Local development and tests: fast on a laptop CPU, weaker text. |

(github.com/openai/whisper, huggingface.co/openai/whisper-large-v3-turbo, huggingface.co/distil-whisper/distil-large-v3.5, verified 2026-11-14.)

**Compute types** (opennmt.net/CTranslate2/quantization.html, verified 2026-11-14): `int8`, `int8_float32`, `int8_float16`, `int8_bfloat16`, `int16`, `float16`, `bfloat16`, `float32`, plus `default` and `auto`. On an x86-64 CPU use `int8`; `float16` on a CPU silently becomes `float32`. On an NVIDIA GPU use `float16`, or `int8_float16` when memory is tight.

**GPU needs**: "The latest versions of `ctranslate2` only support CUDA 12 and cuDNN 9" (faster-whisper README, verified 2026-11-14). The CTranslate2 4.7 to 4.9 release notes do not mention CUDA 13 (github.com/OpenNMT/CTranslate2/releases, verified 2026-11-14), so the GPU image stays on CUDA 12 until that is proven.

**Benchmarks from its README** (13 minutes of audio, beam size 5; real-time factor worked out here as 780 seconds divided by the time):

| Hardware | Model | Setting | Time | Times real time | Memory |
|---|---|---|---|---|---|
| NVIDIA RTX 3070 Ti 8 GB | large-v2 | fp16 | 1 m 03 s | 12 | 4,525 MB VRAM |
| NVIDIA RTX 3070 Ti 8 GB | large-v2 | fp16, `batch_size=8` | 17 s | 46 | 6,090 MB VRAM |
| NVIDIA RTX 3070 Ti 8 GB | large-v2 | int8, `batch_size=8` | 16 s | 49 | 4,500 MB VRAM |
| Intel Core i7-12700K, 8 threads | small | int8 | 1 m 42 s | 7.6 | 1,477 MB RAM |
| Intel Core i7-12700K, 8 threads | small | int8, `batch_size=8` | 51 s | 15 | 3,608 MB RAM |
| Intel Core i7-12700K, 8 threads | small | fp32 | 2 m 37 s | 5 | 2,257 MB RAM |

(github.com/SYSTRAN/faster-whisper, verified 2026-11-14.) The same tables put whisper.cpp at 1 m 05 s on the GPU and 2 m 05 s on the CPU, and `openai/whisper` at 2 m 23 s and 6 m 58 s. **The README has no CPU figure for `large-v3` or `turbo`.** Module 02 measures both on the owner's machine and on the production box before any limit is set.

### 2.2 Why Not The Others

- **WhisperX** adds VAD batching, wav2vec2 alignment and speaker labels (github.com/m-bain/whisperX, verified 2026-11-14). Its package pins `torch~=2.8.0`, `torchaudio~=2.8.0`, `pyannote-audio>=4.0.0` and `huggingface-hub<1.0.0`, and supports Python `>=3.10,<3.14` (pypi.org/pypi/whisperx/json, verified 2026-11-14). Its own limits: words with characters outside the alignment dictionary (digits, symbols) get no timing, overlapping speech is handled badly, and each language needs its own model. The default list has `hi` (theainerd/Wav2Vec2-large-xlsr-hindi) but **no `ta`**, `kn`, `bn` or `mr` (whisperx/alignment.py, verified 2026-11-14). The README asks for help "to keep this project going"; 179 issues are open.
- **whisper.cpp** is MIT, has CUDA, Vulkan and OpenVINO builds and its own Silero VAD flag. It is a compiled program with separate model files; faster-whisper gives the same speed inside the Python service we are building anyway.
- **Parakeet and Canary** are the fastest open models and have native word timings, but both model cards list 25 European languages with no Hindi and no Tamil.

## 3. Word-Level Timestamps

### 3.1 Why Captions Need Them

- **Word-by-word captions**: our own pure pager in `packages/video-engine` takes `CaptionWord[]` (`text`, `startMs`, `endMs`, `confidence`, `pageBreakAfter`) and returns pages; the ASS writer turns each page into Dialogue lines with the spoken word marked (research 06 section 2 and research 09). Words carry no leading space; the writer joins them with a space (revised 2026-11-17, replacing a third party captions package).
- **Transcript editing** (Module 04): deleting words cuts the video, so every word needs a start and an end in source time.
- **Word censoring** (Module 09): the mute or bleep covers exactly one word's span.
- **Surviving trims**: the plan keeps captions in source time, so one transcript serves every clip cut from that source.

### 3.2 How Each Option Produces Them

| Option | Method | What to expect |
|---|---|---|
| faster-whisper | `word_timestamps=True`: "Compute word-level timestamps via cross-attention and dynamic time warping". Each `Word` has `start`, `end`, `word`, `probability` (faster_whisper/transcribe.py, verified 2026-11-14) | Good enough for captions on clear speech; drifts by a few tenths of a second over music and at segment edges (reported). Slower than plain transcription. |
| WhisperX | A second pass: a wav2vec2 phoneme model aligns the text to the audio | Tighter timings on supported languages (reported); no timing for digits and symbols; no Tamil. |
| whisper.cpp | `-ml 1` (max segment length of one), marked experimental | Token-level, rougher. |
| Parakeet, Canary | Native to the model | Precise, but wrong languages. |
| Groq | `response_format=verbose_json` with `timestamp_granularities` `word`, `segment` or both. The word option returns only word, start and end. The page contradicts itself once (a code comment says `json`) | Same model family as ours, so the same quality (reported). No per-word confidence when only `word` is asked. |
| Deepgram | Every response has `words[]` with `word`, `start`, `end` (seconds) and `confidence` | Native, with confidence. |
| AssemblyAI | `words[]` with `text`, `start`, `end` (milliseconds), `confidence`, `speaker` | Native, with confidence. |
| OpenAI | `timestamp_granularities[]` "is supported only for `whisper-1`" (guide). The `gpt-transcribe` model page lists text output and no timestamps | Not usable after 2027-02-26. |

**Guard rails we add**: clamp each word inside its segment, force words to be in order and non-overlapping, give a zero-length word a 40 ms floor, and mark words with `prob` under 0.5 so the editor can underline them. A fixture test holds the rules.

## 4. Language Coverage

- **Whisper** covers 99 languages (huggingface.co/openai/whisper-large-v3-turbo, verified 2026-11-14); Hindi (`hi`) and Tamil (`ta`) are in its list (reported, from `tokenizer.py`). Its README says "performance varies widely depending on the language" and gives no numbers in text.
- **A fair proxy for quality**: AssemblyAI ranks Hindi as "Good" (over 10% up to 25% WER) and Tamil as "Moderate" (over 25% up to 50% WER) for its Universal-2 model (assemblyai.com/docs/pre-recorded-audio/supported-languages, verified 2026-11-14). Expect the same order from Whisper: Hindi captions need light fixing, Tamil captions need real editing (reported).
- **Deepgram** lists both `hi` and `ta` for Nova-3; its code-switching option `multi` is not listed for general Nova-3 (developers.deepgram.com/docs/models-languages-overview, verified 2026-11-14).
- **Language detection**: faster-whisper detects on the first window (`language_detection_segments=1`, threshold 0.5) and returns `language` and `language_probability`. Setting `multilingual=True` runs detection on every segment (transcribe.py, verified 2026-11-14).

**Code-switching (Tanglish, Hinglish)**: Whisper decodes one language per 30 second window. With the language fixed to Tamil, English words come out in Tamil script or get dropped; with it fixed to English, Tamil is translated or garbled (reported). `multilingual=True` helps when the switch is between sentences, not inside one. No option read today promises Romanised Tamil or Hindi. What we do: a language picker in Clip Setup (Auto, plus the workspace's languages), the detected language and its confidence shown on the transcript, a one-click re-run in another language, and editable captions.

**Translation**: turbo is not trained for it, and OpenAI's translation endpoint is also being shut down. Caption translation (Module 03) goes through the text model in `ai-engine`, segment by segment, keeping the timings.

## 5. Long Audio

### 5.1 Chunking With Voice Activity Detection

- **Silero VAD**: MIT, `silero-vad` 6.2.3 on PyPI (2026-09-23). "One audio chunk (30+ ms) takes less than 1ms to be processed on a single CPU thread", a model of about 2 MB, 8 kHz and 16 kHz input, "no telemetry, no keys, no registration" (github.com/snakers4/silero-vad, verified 2026-11-14). **The PyPI package requires `torch>=1.12.0`** (pypi.org/pypi/silero-vad/json, verified 2026-11-14). faster-whisper ships its own copy (Silero VAD V6 since 1.2.1) and runs it on `onnxruntime`, so we use that copy and install no PyTorch.
- **Inside faster-whisper**: `vad_filter=True` drops non-speech before decoding. By default it only removes silence longer than 2 seconds; `vad_parameters` tunes it (for example `min_silence_duration_ms=500`). `BatchedInferencePipeline` cuts on VAD and decodes chunks in parallel, with VAD on by default (README, verified 2026-11-14).
- **Our own chunker** (needed for the API binding, for progress and for resume): run VAD once over the 16 kHz mono analysis audio; pack speech regions into chunks of at most 10 minutes; cut only in a silence of 0.5 seconds or more; where there is none, cut with a 3 second overlap.
- **Stitching**: add the chunk offset to every time; in an overlap keep the words whose midpoint falls before the middle of the overlap from the left chunk and after it from the right; drop an exact duplicate at the seam.
- **Progress and resume**: each finished chunk is written to scratch and reported in the activity heartbeat, so a retry starts at the first unfinished chunk (Temporal keeps heartbeat details across attempts; docs.temporal.io/develop/python/activities/timeouts, verified 2026-11-14).
- **API limits to fit**: Groq takes 25 MB a file on the free tier and 100 MB on the paid one, bills a minimum of 10 seconds a request, and resamples to 16 kHz mono itself; Deepgram takes 2 GB but fails a request that runs over 10 minutes; OpenAI takes 25 MB (vendor pages, verified 2026-11-14). A 10 minute chunk of 16 kHz mono FLAC stays under 25 MB (reported, about 1 MB a minute).

### 5.2 Hallucination On Silence And Music

Whisper invents text when there is no speech: sign-off phrases, a line repeated for minutes, made-up subtitle credits (reported, widely seen). The knobs, all in `WhisperModel.transcribe` with these defaults (transcribe.py, verified 2026-11-14):

| Setting | Default | What we set |
|---|---|---|
| `vad_filter` | `False` | `True`, always |
| `condition_on_previous_text` | `True` | `False` for streams, so one bad window cannot poison the next |
| `no_speech_threshold` | 0.6 | keep |
| `log_prob_threshold` | -1.0 | keep |
| `compression_ratio_threshold` | 2.4 | keep (catches loops) |
| `hallucination_silence_threshold` | `None` | 2 seconds (needs `word_timestamps`) |
| `temperature` | 0.0 to 1.0 in six steps | keep the fallback |
| `hotwords`, `initial_prompt` | `None` | game and channel names from the source title, capped |

After decoding we also drop a segment whose `no_speech_prob` is high while `avg_logprob` is low, and collapse a phrase repeated more than three times in a row.

### 5.3 The Gaming-Stream Problem

A stream is one mixed track: the streamer's voice under game music, gunfire, and game characters who also speak. VAD counts game dialogue and sung lyrics as speech, and Whisper transcribes them.

| What helps | Cost | When |
|---|---|---|
| The **16 kHz mono analysis audio** made at import (already a `ClipAsset` kind in the plan): one decode, small file, the exact input every model expects | none, exists | Sprint 13, always |
| Stricter VAD (`threshold` up from 0.5, longer minimum speech) for sources tagged as gameplay | none | Sprint 13 |
| A language hint, so loud English game dialogue does not flip a Tamil stream to English | none | Sprint 13 |
| Low-confidence words underlined in the editor, with one-click delete | small | Sprint 13 (Module 03) |
| An FFmpeg voice-band filter before analysis (high-pass, low-pass, light denoise) | cheap, must be tested: it can also hurt | Try in Module 02's benchmark |
| **Vocal separation** (Demucs 4.1.0, MIT, 2026-07-11; needs PyTorch, wants a GPU) (pypi.org/pypi/demucs/json, verified 2026-11-14) | heavy | **Later**, behind the same interface as a pre-step |
| Speaker labels (who is the streamer) | heavy (pyannote) | **Later** |

## 6. Cost Model

**Prices read today**: Groq turbo $0.04 an audio hour; AssemblyAI Universal-2 $0.15; Deepgram Nova-3 $0.258; OpenAI `gpt-transcribe` $0.27. A dedicated 8 vCPU, 32 GB box (Hetzner CCX33) is EUR 0.1891 an hour or EUR 117.99 a month, excluding VAT. A 24 GB GPU is $0.44 an hour (RunPod L4, community) to $0.69 (RunPod L4 secure; Lambda Quadro RTX 6000), or EUR 214 a month plus EUR 209 setup for a dedicated one (Hetzner GEX45). Serverless GPU: Modal L4 $0.000222 a second ($0.80 an hour), billed by the second, with $30 of free credit a month (sources in `05-python-media-service.md`, section 11; all verified 2026-11-14).

**Speed assumptions** (not read anywhere, to be replaced by Module 02's benchmark): turbo `int8` on 8 cloud vCPUs runs at **1 times real time**; turbo `float16` batched on a 24 GB GPU runs at **30 times real time** (the README shows 46 for large-v2 on an RTX 3070 Ti); a serverless call adds about one minute of start-up.

**Per Source Hour**:

| Option | Cost per source hour | Wait for a 3 hour stream |
|---|---|---|
| Groq turbo API | $0.04 | a few minutes (speed factor 216, plus upload) |
| Serverless GPU (Modal L4) | about $0.05 (3 billed minutes plus CPU and memory) | about 10 minutes |
| Always-on GPU, busy | $0.015 to $0.023 (2 minutes of $0.44 to $0.69) | about 6 minutes |
| CPU box, billed hourly | EUR 0.19 | about 3 hours |
| CPU box that is already running for the service | nothing extra until it is full (about 730 source hours a month) | about 3 hours |
| Deepgram Nova-3 | $0.258 | minutes |
| OpenAI `gpt-transcribe` | $0.27, and no word timings | minutes |

**Per Month At Three Usage Levels**:

| Option | 50 source hours | 500 source hours | 5,000 source hours |
|---|---|---|---|
| Groq turbo API | $2 | $20 | $200 |
| Serverless GPU (Modal L4) | about $3 (inside the free credit) | about $28 (inside the free credit) | about $275 |
| AssemblyAI Universal-2 | $7.50 | $75 | $750 |
| Deepgram Nova-3 | $12.90 | $129 | $1,290 |
| CPU boxes, always on | EUR 118 (1 box) | EUR 118 (1 box, about 70% busy) | EUR 826 (7 boxes) |
| GPU, always on (RunPod L4) | $321 to $504 | $321 to $504 | $321 to $504 |
| GPU, dedicated (Hetzner GEX45) | EUR 214 | EUR 214 | EUR 214 |

**Break-Even Points** (always-on GPU at $321 a month): against Groq turbo at about **8,000 source hours a month**; against serverless GPU at about 5,800; against Deepgram at about 1,250. A CPU box bought only for transcription never beats Groq turbo on price (it is full at 730 hours, and break-even would be 2,950), and it is the slowest by far. Its case is different: it is already there, it costs nothing extra, and no audio leaves our servers.

## 7. The Provider Interface

One interface in the contract package, three bindings in `apps/media`, picked in one factory (the `createDiscoverEngine` pattern):

```ts
interface Transcriber {
  transcribe(input: {
    audioKey: string;        // storage key of the 16 kHz mono analysis audio, never a path
    languageHint?: string;   // ISO 639-1, absent means detect
    range?: { startSec: number; endSec: number }; // absent means the whole file
    vocabulary?: string[];   // names to bias towards, capped
  }): Promise<Transcript>;
}
```

```ts
type Transcript = {
  schemaVersion: 1;
  language: string;                  // ISO 639-1, detected or hinted
  languageProbability: number | null;
  durationSec: number;               // audio analysed
  provider: 'faster-whisper' | 'groq' | 'simulation';
  model: string;                     // for example "large-v3-turbo"
  version: string;                   // library, engine and compute type, for example "faster-whisper 1.2.1, ctranslate2 4.9.0, int8"
  createdAt: string;                 // ISO 8601
  segments: Array<{
    start: number;                   // seconds of SOURCE time, 3 decimals
    end: number;
    text: string;
    words: Array<{ start: number; end: number; word: string; prob: number | null }>;
  }>;
};
```

Rules:

- **Stored as a file asset**, never a row and never a workflow payload: `ClipAsset` kind transcript, a JSON file in the private clip key space. An hour of speech is about 9,000 words and half a megabyte (reported). The activity returns `{ transcriptKey, language, durationSec, wordCount }`.
- **Source time, seconds**: the same timebase as crops in the project file. the caption pager wants output-time milliseconds; a pure mapper in `packages/video-engine` does `Transcript -> CaptionWord[]` through the time map, so captions survive trims, splits and speed changes.
- **`prob` may be null**: Groq's word-only response has no confidence.
- **`model` and `version` are part of the cache key**: a transcript is reused for a source only when the provider, model, language hint and range match.
- **The `Transcript` type lives in `packages/video-engine`** (already reserved by the plan); the Python side mirrors it (see `05-python-media-service.md`, section 8).

## 8. Recommendation

| Where | Provider | In plain words |
|---|---|---|
| **Simulation** (`MEDIA_SIMULATION=true`, the local default and CI) | `simulation` | A recorded transcript of the bundled sample video comes back after a short fake delay. No model, no download, no key. |
| **Local development, real pass** | `faster-whisper`, model `small`, `int8`, CPU | Free, offline after one download of about 0.5 GB (reported), 5 to 15 times real time on a desktop CPU in the README's table. Switch to `large-v3-turbo` to judge caption quality. |
| **Production, clip-length audio** (captions for one clip, up to a few minutes) | `faster-whisper`, `large-v3-turbo`, `int8`, on the media box's CPU | The box is already running, the wait is about the clip's length, nothing leaves our servers, no per-minute bill. |
| **Production, long audio** (AI Highlights V2 over a whole stream) | the fast lane: `groq` at launch, a GPU worker later | A CPU would take as long as the stream. Groq costs $0.04 an hour and needs nothing deployed; a serverless GPU costs about the same and keeps audio in our own account. |

The switch is two settings: `TRANSCRIBE_PROVIDER` (default `faster-whisper`) and `TRANSCRIBE_LONG_PROVIDER` with `TRANSCRIBE_LONG_AFTER_MINUTES` (default 10). With no Groq key set, long jobs stay on the self-hosted model and the Clip Setup screen shows the expected wait.

## 9. Open Questions

- **Open question for Arvind**: may user audio go to a third party (Groq) for long jobs? It is the cheapest and fastest path, and it needs a line in the privacy policy. Recommendation: yes for launch, behind the switch above, with a serverless GPU as the planned replacement once Module 14 is built.
- **Open question for Arvind**: transcribe the whole stream at import, or only on demand? Recommendation: on demand. Captions transcribe just the clip; AI Highlights V2 transcribes the range picked in Clip Setup and charges credits for it.
- **Open question for Arvind**: is Tamil a launch language for captions, given "Moderate" accuracy? Recommendation: ship it with the editable transcript and a visible "check these words" marker, and use `large-v3` (not turbo) when the language is Tamil.
- **Settled 2026-11-17 (D13-02): listening is 1.0 AI minute per source minute (minimum 2), set in the entitlements registry.** Earlier question: credits per transcribed minute. Recommendation: a placeholder like the other prices, set after the Module 02 benchmark gives the real speed.
- **To confirm in Module 02**: CPU and GPU speed of turbo; whether CTranslate2 4.9.0 runs on CUDA 13; word-timing drift on a gaming clip; the voice-band filter; Groq's word response shape against a recorded sample.
