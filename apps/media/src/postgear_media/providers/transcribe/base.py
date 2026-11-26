"""What every listener is: a function from a stretch of sound to words with times.

A listener is handed a 16 kHz mono WAV file holding exactly one chunk of the
video's sound and the chunk's place in the video. It answers words with times
**relative to the chunk's start**, in milliseconds; the service shifts them
into the video's time, so no binding ever needs to know where its chunk sits.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Word:
    """One heard word. Times are whole milliseconds."""

    start: int
    end: int
    text: str
    sure: float


@dataclass(frozen=True, slots=True)
class Chunk:
    """A piece of the video's sound, cut into its own WAV file."""

    path: Path
    #: Where the chunk starts and ends in the video, whole milliseconds.
    from_ms: int
    to_ms: int

    @property
    def length_ms(self) -> int:
        return self.to_ms - self.from_ms


@dataclass(frozen=True, slots=True)
class Heard:
    """What a listener heard in one chunk. Word times are relative to the chunk."""

    words: list[Word] = field(default_factory=list)
    #: ISO 639-1, as detected or as asked; None when the binding cannot say.
    language: str | None = None
    language_probability: float | None = None


@dataclass(frozen=True, slots=True)
class ListenRequest:
    """What a listener is asked for one chunk."""

    chunk: Chunk
    #: ISO 639-1, or None to detect.
    language: str | None
    #: Simulation only: the sample whose recorded transcript answers.
    sample: str | None = None
    #: Simulation only: a forced state (`fail`, `no-speech`, `slow`).
    force: str | None = None
    #: Called between pieces of work; raises when the caller cancelled.
    checkpoint: Callable[[], None] = lambda: None


class Transcriber(Protocol):
    """A speech to text binding."""

    #: What goes in the transcript's `model`, such as `faster-whisper:small`.
    name: str
    #: The longest chunk this binding takes, in milliseconds.
    max_chunk_ms: int

    def listen(self, request: ListenRequest) -> Heard:
        """The words of one chunk."""
        ...


class TranscriberOffError(RuntimeError):
    """The binding cannot run on this box (no library, no key)."""
