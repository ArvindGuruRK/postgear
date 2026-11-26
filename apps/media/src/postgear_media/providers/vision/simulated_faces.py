"""Simulated faces: recorded boxes for the samples, no decoder, no model.

Nothing in the samples is a real person. The boxes are written here from
`packages/media-tools/fixtures/samples/plan.json`, the way the recorded motion
is, so a test and a hand check always see the same thing:

- **two-speakers**: the plan's two face markers, left and right, both on
  screen the whole length (a box at each marker's centre and size). Each one
  drops out for under a second now and then, the way a turned head does, so
  joining boxes into people is exercised. While a marker's turn runs (the
  plan's turns), its box's height moves a little from picture to picture, the
  way a talking mouth moves the lower half of a face box: Follow The Speaker
  reads that to tell who speaks (Module 08). And the left marker is lost for
  three seconds in the middle of its turn from 55 to 69 s (`LOST_SPEAKER`),
  the stretch Fix By Hand is checked on.
- **stream**: one small face in the bottom right corner that never moves:
  a streamer's face camera. The generated picture draws no marker there
  (the stream sample is test patterns); the recorded boxes stand in for one,
  which is all Detect Camera reads (Decision Log, Module 07).
- **talk** and any other video: no face at all.

`tests/test_faces_service.py` reads the plan and fails when the two-speakers
copy drifts from it.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

#: The plan's two face markers: centre and size as fractions of the picture.
TWO_SPEAKERS_FACES: tuple[tuple[float, float, float, float], ...] = (
    (0.27, 0.47, 0.2, 0.44),
    (0.73, 0.47, 0.2, 0.44),
)
#: The plan's turns: (index into TWO_SPEAKERS_FACES, start second, end second).
TWO_SPEAKERS_TURNS: tuple[tuple[int, float, float], ...] = (
    (0, 2, 13.5),
    (1, 15, 26.5),
    (0, 28, 39),
    (1, 40.5, 49),
    (0, 55, 69),
    (1, 70.5, 84),
    (0, 85.5, 96),
    (1, 97.5, 110),
    (0, 116, 129),
    (1, 130.5, 142),
    (0, 143.5, 154),
    (1, 155.5, 168.5),
    (0, 170, 181),
    (1, 187, 199),
    (0, 200.5, 212),
    (1, 213.5, 225),
    (0, 226.5, 237),
)
#: How much a talking face box's height moves, as a part of the face's height.
MOUTH_MOVE = 0.04
#: The speaker lost for a while: (index into TWO_SPEAKERS_FACES, from ms, to ms).
LOST_SPEAKER: tuple[int, int, int] = (0, 60_000, 63_000)
#: The stream's face camera: a small box in the bottom right corner (square on 16:9).
STREAM_CAMERA: tuple[float, float, float, float] = (0.905, 0.835, 0.06, 0.106)
#: Each sample's length, seconds.
SAMPLE_SECONDS = {"stream": 600, "two-speakers": 240}
#: A face drops out for three pictures (0.6 s) every this many pictures.
DROPOUT_EVERY = {"stream": 211, "two-speakers": 157}
DROPOUT_PICTURES = 3
RATE_HZ = 5


@dataclass(frozen=True, slots=True)
class RecordedFace:
    """One box as fractions of the picture, and the detector's confidence."""

    x: float
    y: float
    w: float
    h: float
    score: float


def _wobble(name: str, index: int, salt: int) -> float:
    """A tiny steady jitter from the name and place, never random: -1 to 1."""
    digest = hashlib.sha256(f"{name}:{salt}:{index}".encode()).digest()
    return (digest[0] % 41 - 20) / 20


def _face(
    name: str,
    index: int,
    salt: int,
    box: tuple[float, float, float, float],
    talking: bool = False,
) -> RecordedFace:
    cx, cy, w, h = box
    jitter = 0.003
    x = cx - w / 2 + _wobble(name, index, salt) * jitter
    y = cy - h / 2 + _wobble(name, index, salt + 7) * jitter
    score = 0.9 + _wobble(name, index, salt + 13) * 0.05
    # A talking mouth moves the box's lower edge: the top stays, the height moves.
    tall = round(h * (1 + _wobble(name, index, salt + 29) * MOUTH_MOVE), 4) if talking else h
    return RecordedFace(
        x=round(min(max(x, 0.0), 1 - w), 4),
        y=round(min(max(y, 0.0), 1 - tall), 4),
        w=w,
        h=tall,
        score=round(score, 3),
    )


def _talking(speaker: int, t_ms: int) -> bool:
    return any(
        who == speaker and start * 1000 <= t_ms < end * 1000
        for who, start, end in TWO_SPEAKERS_TURNS
    )


def _lost(speaker: int, t_ms: int) -> bool:
    who, start, end = LOST_SPEAKER
    return who == speaker and start <= t_ms < end


def _dropped(name: str, index: int, salt: int) -> bool:
    every = DROPOUT_EVERY[name]
    return (index + salt * 61) % every < DROPOUT_PICTURES


def recorded_faces(sample: str | None, t_ms: int) -> list[RecordedFace]:
    """The faces a sample shows at `t_ms`. Past the sample's end, and in any other video, none."""
    if sample not in SAMPLE_SECONDS or t_ms >= SAMPLE_SECONDS[sample] * 1000:
        return []
    index = t_ms * RATE_HZ // 1000
    if sample == "two-speakers":
        return [
            _face(sample, index, salt, box, _talking(salt, t_ms))
            for salt, box in enumerate(TWO_SPEAKERS_FACES)
            if not _dropped(sample, index, salt) and not _lost(salt, t_ms)
        ]
    if _dropped(sample, index, 0):
        return []
    return [_face(sample, index, 0, STREAM_CAMERA)]
