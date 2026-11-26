"""The simulated listener: recorded words for the sample videos, no model.

Each sample has a recorded transcript in `simulation/transcripts/<sample>.json`
(written by hand for the generated samples, recorded once from a real listen
for a developer's own sample). The listener answers the recorded words whose
middle falls inside the asked chunk.

Any other video (an upload under simulation) gets **stand-in speech**: the
same few plain sentences spoken at a steady pace with pauses, so captions, the
transcript pane and cleanup can all be tried on any file. It is not what the
video says, and its model name says so (`simulation:stand-in`).

Forcing switches, for states a hand check could not reach otherwise:
`fail` raises a retryable failure, `no-speech` hears nothing, `slow` waits
between checkpoints so a cancel can be tried.
"""

from __future__ import annotations

import json
import time
from functools import lru_cache
from pathlib import Path

from temporalio.exceptions import ApplicationError

from postgear_media.providers.transcribe.base import Heard, ListenRequest, Word

TRANSCRIPTS = Path(__file__).resolve().parents[2] / "simulation" / "transcripts"

#: What the stand-in speech says, over and over. Plain words, a few fillers and
#: one mild bad word, so cleanup and bleeping have something to find.
STAND_IN_SENTENCES = (
    "Okay, so this is a simulated transcript for testing.",
    "It is not what this video really says.",
    "Um, every word here has a start and an end.",
    "You know, captions follow these words exactly.",
    "Fix a word once and it is fixed everywhere.",
    "Delete a sentence and the video cuts with it.",
    "Damn, that was easy.",
    "Like, try Remove Silences next.",
)
STAND_IN = [word for sentence in STAND_IN_SENTENCES for word in sentence.split()]

#: The stand-in's pace: one word slot, the share of it spoken, and a pause after each sentence.
STAND_IN_SLOT_MS = 380
STAND_IN_SPOKEN = 0.82
STAND_IN_PAUSE_MS = 900
SLOW_STEP_SECONDS = 0.25


class RecordedTranscript:
    """One sample's recorded words, in the video's own milliseconds."""

    def __init__(self, language: str, words: list[Word]) -> None:
        self.language = language
        self.words = words

    def between(self, from_ms: int, to_ms: int) -> list[Word]:
        """The words whose middle falls in `[from_ms, to_ms)`."""
        return [word for word in self.words if from_ms <= (word.start + word.end) / 2 < to_ms]


@lru_cache(maxsize=16)
def recorded(sample: str) -> RecordedTranscript | None:
    """The recorded transcript of a sample, or None when it has none."""
    safe = "".join(char for char in sample if char.isalnum() or char == "-")
    path = TRANSCRIPTS / f"{safe}.json"
    if not safe or not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    words = [
        Word(start=int(w["start"]), end=int(w["end"]), text=str(w["text"]), sure=float(w["sure"]))
        for w in data["words"]
    ]
    return RecordedTranscript(language=str(data["language"]), words=words)


def stand_in_words(from_ms: int, to_ms: int) -> list[Word]:
    """The stand-in speech between two moments of a video, in the video's time.

    Laid out from the video's start, so the same moment always holds the same
    word however the stretch was asked for (a stretch listened to in two parts
    reads the same as in one).
    """
    words: list[Word] = []
    cursor = 400
    index = 0
    while cursor < to_ms:
        text = STAND_IN[index % len(STAND_IN)]
        start = cursor
        end = start + round(STAND_IN_SLOT_MS * STAND_IN_SPOKEN)
        if from_ms <= (start + end) / 2 < to_ms:
            # Every eleventh word is one the listener was unsure of.
            words.append(
                Word(start=start, end=end, text=text, sure=0.45 if index % 11 == 7 else 0.93)
            )
        cursor += STAND_IN_SLOT_MS
        if text.endswith((".", "!", "?")):
            cursor += STAND_IN_PAUSE_MS
        index += 1
    return words


class SimulatedTranscriber:
    """Answers from recorded files. Never loads a model, never leaves the machine."""

    name = "simulation"
    max_chunk_ms = 10 * 60_000

    def listen(self, request: ListenRequest) -> Heard:
        chunk = request.chunk
        if request.force == "fail":
            raise ApplicationError(
                "The simulated listener was told to fail", type="MEDIA_TOOL_FAILED"
            )
        if request.force == "slow":
            for _ in range(40):
                request.checkpoint()
                time.sleep(SLOW_STEP_SECONDS)
        request.checkpoint()
        if request.force == "no-speech":
            return Heard(words=[], language=request.language or "en")

        record = recorded(request.sample) if request.sample else None
        if record is not None:
            absolute = record.between(chunk.from_ms, chunk.to_ms)
            language = request.language or record.language
        else:
            absolute = stand_in_words(chunk.from_ms, chunk.to_ms)
            language = request.language or "en"
        relative = [
            Word(start=w.start - chunk.from_ms, end=w.end - chunk.from_ms, text=w.text, sure=w.sure)
            for w in absolute
        ]
        return Heard(words=relative, language=language, language_probability=None)
