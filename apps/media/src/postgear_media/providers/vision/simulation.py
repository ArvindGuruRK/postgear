"""Simulated pictures: recorded motion and placeholder stills, no decoder, no model.

The samples are generated from `packages/media-tools/fixtures/samples/plan.json`
(nothing in them is a real person). Their motion is written here from that
plan, the way the transcripts of the generated samples are written from
scripts: every number comes from a planned moment, never from chance, so a
test and a hand check always see the same track. `tests/test_vision_simulation.py`
reads the plan and fails when these copies drift from it.

The stream sample's motion (grey levels, two a second):

- each scene holds a steady level by what it shows (moving patterns move,
  colour bars do not, the "life" scenes busy throughout);
- a hard cut is one sharp spike, the picture changing all at once;
- its seven loud moments are also **action**: a burst of movement from just
  after the cut to the end of the moment, so sound and picture agree;
- three **quiet bursts** move with no sound at all, so a burst without a
  rise in sound can be told from one with it.

The other samples barely move. A video with no recorded motion (any upload)
answers a calm, steady stand-in: no action is ever found in it.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

#: Scene starts (seconds) and what each shows, as in the plan.
STREAM_SCENES: tuple[tuple[int, str], ...] = (
    (0, "testsrc2"),
    (40, "smptehdbars"),
    (62, "life"),
    (100, "rgbtestsrc"),
    (148, "testsrc2"),
    (190, "smptehdbars"),
    (237, "life"),
    (270, "rgbtestsrc"),
    (305, "testsrc2"),
    (350, "smptehdbars"),
    (391, "life"),
    (430, "rgbtestsrc"),
    (478, "testsrc2"),
    (520, "smptehdbars"),
    (552, "life"),
    (580, "rgbtestsrc"),
)
#: The plan's loud moments (start, end seconds): action with sound.
STREAM_LOUD: tuple[tuple[float, float], ...] = (
    (62, 66),
    (148, 152),
    (237, 241),
    (305, 309),
    (391, 395),
    (478, 482),
    (552, 556),
)
#: Movement with no sound, inside still scenes, away from every cut.
STREAM_QUIET_ACTION: tuple[tuple[float, float], ...] = ((120, 123), (205, 208), (455, 458))

#: Each sample's length, seconds.
SAMPLE_SECONDS = {"stream": 600, "talk": 180, "two-speakers": 240}

#: How much each kind of scene moves, in grey levels.
SCENE_LEVEL = {"testsrc2": 4.0, "smptehdbars": 0.4, "life": 9.0, "rgbtestsrc": 0.4}
CUT_SPIKE = 72.0
ACTION_LEVEL = 36.0
QUIET_ACTION_LEVEL = 30.0
#: The calm samples (a test pattern with a counter; two markers taking turns).
CALM_LEVEL = {"talk": 3.0, "two-speakers": 1.2}
STAND_IN_LEVEL = 2.0

RATE_HZ = 2
STILL = Path(__file__).resolve().parents[2] / "simulation" / "stills" / "placeholder.jpg"


def _ripple(sample: str, index: int) -> float:
    """A small steady wobble from the sample's name and the place, never random."""
    digest = hashlib.sha256(f"{sample}:{index}".encode()).digest()
    return (digest[0] % 21 - 10) / 40


def _scene_at(sec: float) -> str:
    current = STREAM_SCENES[0][1]
    for start, source in STREAM_SCENES:
        if start <= sec:
            current = source
    return current


def _inside(sec: float, spans: tuple[tuple[float, float], ...]) -> bool:
    return any(start < sec < end for start, end in spans)


def _stream_value(index: int) -> float:
    sec = index / RATE_HZ
    cuts = {start for start, _ in STREAM_SCENES if start > 0}
    if sec in cuts:
        return CUT_SPIKE
    if _inside(sec, STREAM_LOUD):
        return ACTION_LEVEL + _ripple("stream", index) * 4
    if _inside(sec, STREAM_QUIET_ACTION):
        return QUIET_ACTION_LEVEL + _ripple("stream", index) * 4
    return max(0.0, SCENE_LEVEL[_scene_at(sec)] + _ripple("stream", index))


def recorded_motion(sample: str | None, duration_ms: int) -> list[float]:
    """The motion a sample shows on the grid of a video `duration_ms` long.

    Past the sample's own end the picture holds still. Any other video gets
    the calm stand-in.
    """
    count = -(-duration_ms * RATE_HZ // 1000)
    if sample == "stream":
        limit = SAMPLE_SECONDS["stream"] * RATE_HZ
        return [_stream_value(i) if i < limit else 0.0 for i in range(count)]
    level = CALM_LEVEL.get(sample or "", STAND_IN_LEVEL)
    name = sample or "stand-in"
    return [max(0.0, level + _ripple(name, i)) for i in range(count)]


def placeholder_still() -> bytes:
    """The one picture every simulated still is: a test pattern, never a real frame."""
    return STILL.read_bytes()
