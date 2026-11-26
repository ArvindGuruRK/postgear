"""What every speaker is: a typed line and a voice in, a WAV out (Module 09).

**The real binding is parked (D13-06, the licence decision).** The candidate,
Kokoro through `kokoro-onnx`, has Apache-2.0 weights and an MIT wrapper, but
its phonemiser path (espeak-ng through phonemizer) is GPL-3.0, and
`kokoro-onnx` loads espeak-ng as a library inside the calling process. That
link fails for use inside this service. If it is ever built (Module 17, after
the owner's own licence read), it must run as **its own small program** that
this service calls with a file in and a file out, behind this same interface,
never imported here. Nothing in this package downloads a model or a voice.

The only binding today is `SimulatedSpeaker` (`simulated.py`): a deterministic
tone pattern whose length follows the text, so every step around it (the job,
the charge, the sound in the library, the editor) runs for real.
"""

from __future__ import annotations

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

    def speak(self, text: str, voice_id: str) -> Spoken:
        """The line spoken in the voice. Raises `KeyError` for a voice it does not have."""
