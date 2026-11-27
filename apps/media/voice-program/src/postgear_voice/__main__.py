"""PostGear's voice program: one line in, one voice's samples out (Sprint 13, Module 09).

The media service runs this as its own program, never imports it:

    postgear-voice --model-dir DIR --voice af_heart --lang en-us \
        --text line.txt --out voice.pcm

- `--text` is a UTF-8 file holding the line (the line never rides on the
  command line, where `ps` would show it).
- `--out` gets mono 16-bit little-endian PCM samples.
- On success the last line on stdout is JSON: `{"sampleRate": 24000, "samples": N}`.
- On failure the exit code is 3 and the last line on stderr is one short code
  (`model_missing`, `voice_unknown`, `text_empty`, `speak_failed`). Nothing
  this program prints ever holds the line, its sounds or a path.

It reads only the two Kokoro files in `--model-dir/kokoro` and reaches no
network. Kokoro's weights are Apache-2.0; `kokoro-onnx` loads espeak-ng
(GPL-3.0) inside this process, which is why this is its own program, under
GPL-3.0-or-later (see README.md).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"
FAILED = 3


class VoiceError(Exception):
    """A failure this program answers with one short code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _arguments(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="postgear-voice", add_help=True)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--lang", required=True)
    parser.add_argument("--text", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--speed", type=float, default=1.0)
    return parser.parse_args(argv)


def _speak(arguments: argparse.Namespace) -> tuple[int, int]:
    folder = arguments.model_dir / "kokoro"
    model, voices = folder / MODEL_FILE, folder / VOICES_FILE
    if not model.is_file() or not voices.is_file():
        raise VoiceError("model_missing")
    text = arguments.text.read_text(encoding="utf-8").strip()
    if not text:
        raise VoiceError("text_empty")

    import numpy as np  # noqa: PLC0415 - only after the cheap checks
    from kokoro_onnx import Kokoro  # noqa: PLC0415

    kokoro = Kokoro(str(model), str(voices))
    if arguments.voice not in kokoro.get_voices():
        raise VoiceError("voice_unknown")
    try:
        samples, rate = kokoro.create(
            text, voice=arguments.voice, speed=arguments.speed, lang=arguments.lang
        )
    except Exception as error:  # any library failure is one code
        raise VoiceError("speak_failed") from error
    pcm = (np.clip(samples, -1.0, 1.0) * 32_767).astype("<i2")
    if pcm.size == 0:
        raise VoiceError("speak_failed")
    arguments.out.write_bytes(pcm.tobytes())
    return int(rate), int(pcm.size)


def main(argv: list[str] | None = None) -> int:
    """Runs once and exits: 0 with the JSON line, or 3 with a code."""
    # The libraries log phonemes and words at debug and warning levels: silence them.
    logging.disable(logging.CRITICAL)
    arguments = _arguments(argv)
    try:
        rate, samples = _speak(arguments)
    except VoiceError as failure:
        print(failure.code, file=sys.stderr)  # noqa: T201 - the program's answer
        return FAILED
    except Exception:  # noqa: BLE001 - never a trace that could hold the line
        print("speak_failed", file=sys.stderr)  # noqa: T201
        return FAILED
    print(json.dumps({"sampleRate": rate, "samples": samples}))  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main())
