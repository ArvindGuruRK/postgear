"""The `speech` track: how sure we are someone is talking, two values a second.

Worked out from the heard words, so every binding gives the same kind of
curve: a half-second slot's value is the share of the slot covered by words,
weighted by how sure each word was. Slots outside the listened stretches are
`None` (nothing measured them), which the scorer never scores.

Sprint 13's Remove Silences and the moment picker read this track from the
video's signals file.
"""

from __future__ import annotations

from collections.abc import Sequence

from postgear_media.providers.transcribe.base import Word

SPEECH_RATE_HZ = 2
SLOT_MS = 1000 // SPEECH_RATE_HZ


def speech_values(
    words: Sequence[Word],
    ranges: Sequence[tuple[int, int]],
    duration_ms: int,
) -> list[float | None]:
    """One value per half second from the start of the video to its end."""
    slots = max(0, -(-duration_ms // SLOT_MS))
    values: list[float | None] = [None] * slots
    for from_ms, to_ms in ranges:
        first = max(0, from_ms // SLOT_MS)
        last = min(slots, -(-to_ms // SLOT_MS))
        for slot in range(first, last):
            values[slot] = 0.0
    for word in words:
        if word.end <= word.start:
            continue
        first = max(0, word.start // SLOT_MS)
        last = min(slots - 1, (word.end - 1) // SLOT_MS)
        for slot in range(first, last + 1):
            current = values[slot]
            if current is None:
                continue
            slot_from = slot * SLOT_MS
            overlap = min(word.end, slot_from + SLOT_MS) - max(word.start, slot_from)
            if overlap > 0:
                values[slot] = min(1.0, current + (overlap / SLOT_MS) * word.sure)
    return [None if value is None else round(value, 2) for value in values]
