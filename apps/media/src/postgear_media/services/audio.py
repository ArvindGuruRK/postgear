"""The analysis sound: a 16 kHz mono 16-bit WAV, read and cut with the standard library.

The import made this file (`ANALYSIS_AUDIO`), so the service needs no FFmpeg
of its own: a chunk is a slice of frames written to a new WAV.
"""

from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path

from temporalio.exceptions import ApplicationError

ANALYSIS_RATE = 16_000


@dataclass(frozen=True, slots=True)
class AudioFacts:
    """What the WAV says about itself."""

    sample_rate: int
    channels: int
    sample_width: int
    frames: int

    @property
    def duration_ms(self) -> int:
        return round(self.frames * 1000 / self.sample_rate) if self.sample_rate else 0


def bad_audio(message: str) -> ApplicationError:
    """A non-retryable error: the same file fails the same way."""
    return ApplicationError(message, type="MEDIA_BAD_AUDIO", non_retryable=True)


def read_facts(path: Path) -> AudioFacts:
    """The WAV's header, or `MEDIA_BAD_AUDIO` when it is not one we can read."""
    try:
        with wave.open(str(path), "rb") as source:
            facts = AudioFacts(
                sample_rate=source.getframerate(),
                channels=source.getnchannels(),
                sample_width=source.getsampwidth(),
                frames=source.getnframes(),
            )
    except (wave.Error, EOFError, OSError):
        raise bad_audio("The analysis sound could not be read") from None
    if facts.sample_rate <= 0 or facts.channels < 1 or facts.sample_width != 2:
        raise bad_audio("The analysis sound is not 16-bit PCM")
    return facts


def cut_chunk(source_path: Path, target_path: Path, from_ms: int, to_ms: int) -> int:
    """Writes `[from_ms, to_ms)` of the WAV to `target_path`; answers the frames written."""
    try:
        with wave.open(str(source_path), "rb") as source:
            rate = source.getframerate()
            first = max(0, min(source.getnframes(), round(from_ms * rate / 1000)))
            last = max(first, min(source.getnframes(), round(to_ms * rate / 1000)))
            source.setpos(first)
            frames = source.readframes(last - first)
            with wave.open(str(target_path), "wb") as target:
                target.setnchannels(source.getnchannels())
                target.setsampwidth(source.getsampwidth())
                target.setframerate(rate)
                target.writeframes(frames)
            return last - first
    except (wave.Error, EOFError, OSError):
        raise bad_audio("The analysis sound could not be cut") from None
