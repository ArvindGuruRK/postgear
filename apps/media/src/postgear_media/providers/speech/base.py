"""What every speaker is: a typed line and a voice in, a WAV out (Module 09).

Two bindings:

- `SimulatedSpeaker` (`simulated.py`): a deterministic tone pattern whose
  length follows the text, so every step around it (the job, the charge, the
  sound in the library, the editor) runs with no model.
- `KokoroSpeaker` (`kokoro.py`): Kokoro v1.0 through `kokoro-onnx`. Its
  phonemiser, espeak-ng, is GPL-3.0 and `kokoro-onnx` loads it inside the
  calling process, so Kokoro runs as **its own program**
  (`apps/media/voice-program`, GPL-3.0-or-later) that this service calls with
  a file in and a file out, never imported here. Nothing in this package
  downloads a model or a voice.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Voice:
    """One voice on offer: its id, a name a person reads, and the languages it reads."""

    id: str
    name: str
    languages: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Spoken:
    """A made voice: mono 16-bit PCM samples (little-endian) at `sample_rate`."""

    pcm: bytes
    sample_rate: int

    @property
    def duration_ms(self) -> int:
        """The voice's length in whole milliseconds."""
        return round(len(self.pcm) / 2 * 1000 / self.sample_rate)


class Speaker(Protocol):
    """What the speech service hands a line to."""

    #: What speaks, such as `simulation`. Never a path.
    name: str

    def voices(self) -> tuple[Voice, ...]:
        """The voices this binding offers."""

    def speak(self, text: str, voice_id: str, tick: Callable[[], None] | None = None) -> Spoken:
        """The line spoken in the voice. Raises `KeyError` for a voice it does not have.

        A slow binding calls `tick` while it works (the heartbeat, which raises
        when the job is cancelled).
        """
