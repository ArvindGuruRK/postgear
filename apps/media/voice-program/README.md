# PostGear Voice Program

One typed line in, one spoken voice out, through [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) v1.0 and `kokoro-onnx`. Sprint 13, Module 09 (Text To Speech).

## Why It Is Its Own Program

`kokoro-onnx` turns text into sounds with espeak-ng (through `phonemizer` and `espeakng-loader`), which is **GPL-3.0**, and it loads espeak-ng inside whatever process imports it. So:

- This program is **GPL-3.0-or-later** (the licence text is in [`COPYING`](COPYING)), with its own environment (`.venv` here).
- The media service (`apps/media/src/postgear_media`) never imports it. It runs it as a separate program, a file in and a file out, the way it runs FFmpeg (`providers/speech/kokoro.py`). A test fails if the service ever imports `kokoro_onnx`, `phonemizer` or `espeakng_loader`.
- It runs with a clean environment (only `PATH`, `HOME` and the locale), so it never sees the service's tokens or keys.
- Kokoro's weights are Apache-2.0. A made voice is ours to use.

## Set Up

```bash
npm run clips:voice:setup          # uv sync --frozen in this folder
```

The two model files are never downloaded by code. Put them in `MEDIA_MODEL_DIR/kokoro` (default `.cache/media-models/kokoro`), from the `model-files-v1.0` release of `thewh1teagle/kokoro-onnx`:

| File | Size | SHA-256 |
|---|---|---|
| `kokoro-v1.0.onnx` | 325,532,387 bytes | `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5` |
| `voices-v1.0.bin` | 28,214,398 bytes | `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d` |

Then set `MEDIA_SPEAKER="kokoro"` (or leave `auto` with `MEDIA_SIMULATION` off) and restart the media service. `GET /tools` shows `speaker: kokoro, live`.

onnxruntime 1.24 and later ship no Intel Mac build, so on an Intel Mac `pyproject.toml` holds it at 1.23.2.

## How It Is Called

```bash
postgear-voice --model-dir DIR --voice af_heart --lang en-us --text line.txt --out voice.pcm
```

- `--text`: a UTF-8 file with the line (never the command line, where `ps` would show it).
- `--out`: mono 16-bit little-endian samples at 24 kHz.
- Success: exit 0, the last stdout line is `{"sampleRate": 24000, "samples": N}`.
- Failure: exit 3, the last stderr line is one code: `model_missing`, `voice_unknown`, `text_empty` or `speak_failed`. Nothing it prints holds the line.

## Voice Samples

`npm run voice:samples --workspace=@postgear/media` makes the short sample each voice plays in the editor (`apps/web/public/clips/voice-samples`). Run it again after the voice list changes.
