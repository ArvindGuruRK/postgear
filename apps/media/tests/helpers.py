"""Small helpers shared by the tests: a WAV maker and ids."""

from __future__ import annotations

import wave
from pathlib import Path

ORG = "seed-demo-org"
VIDEO = "2f1c8a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b"
JOB = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
AUDIO_KEY = f"clips/{ORG}/{VIDEO}/analysis-audio-{'0123456789abcdef' * 2}.wav"


def write_wav(path: Path, seconds: float, rate: int = 16_000) -> Path:
    """A silent 16-bit mono WAV of the given length."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(b"\x00\x00" * round(seconds * rate))
    return path
