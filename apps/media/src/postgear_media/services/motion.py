"""How much the picture moves: the work behind `mediaPyMotion` (Module 06).

1. Fetch the light copy to a scratch folder (a real run only: the simulated
   binding answers recorded motion and never decodes).
2. Decode the asked stretches once, forward, at two pictures a second, on a
   grey copy at most 320 px wide (`frames.py`).
3. Each sample is the mean absolute difference between it and the picture
   before it, in grey levels (0 to 255). The first picture of a stretch has
   nothing before it and takes the value of the one after it.
4. Write the motion file to a key made from the job's id (a retry overwrites
   it) and answer its key. A hard cut is a spike here too; the engine takes
   cuts out with the scene track (`motionBursts`).

Heartbeats every few seconds of video, so a cancel stops it within a moment.
"""

from __future__ import annotations

import gzip
import json
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from temporalio.exceptions import ApplicationError

from postgear_media.contract.generated import MediaPyMotionInput, MediaPyMotionOutput, MotionFile
from postgear_media.core.keys import is_video_key, job_file_key
from postgear_media.core.scratch import scratch_folder
from postgear_media.core.storage import PrivateStorage, StorageNotFoundError
from postgear_media.providers.vision.simulation import recorded_motion
from postgear_media.services.frames import MOTION_WIDTH, Frame, FrameSource

RATE_HZ = 2
#: Pictures between heartbeats (ten seconds of video).
HEARTBEAT_EVERY = 20
SLOW_STEP_SECONDS = 0.25
SLOW_STEPS = 40


@dataclass(frozen=True, slots=True)
class VisualDeps:
    """What a picture service needs from outside."""

    storage: PrivateStorage
    scratch_root: Path
    #: Heartbeats and raises when the caller cancelled.
    checkpoint: Callable[[dict[str, Any] | None], None]
    #: True for the simulated bindings: recorded answers, no decoder.
    simulated: bool
    #: Opens the real decoder on a file (tests hand in a fake).
    open_source: Callable[[Path], FrameSource]
    #: Tests shorten the slow switch.
    sleep: Callable[[float], None] = time.sleep


def bad_input(message: str) -> ApplicationError:
    return ApplicationError(message, type="MEDIA_BAD_INPUT", non_retryable=True)


def checked_ranges(ranges: Sequence[Any], duration_ms: int) -> list[tuple[int, int]]:
    """The asked stretches in order, apart, inside the video."""
    out: list[tuple[int, int]] = []
    previous_end = -1
    for item in ranges:
        if item.to_ms <= item.from_ms:
            raise bad_input("A range must end after it starts")
        if item.from_ms < previous_end:
            raise bad_input("The ranges must be in order and must not overlap")
        if item.from_ms >= duration_ms:
            raise bad_input("A range starts past the end of the video")
        previous_end = item.to_ms
        out.append((item.from_ms, min(item.to_ms, duration_ms)))
    return out


def mean_abs_difference(a: Any, b: Any) -> float:
    """The mean absolute difference of two grey pictures of one size, 0 to 255."""
    import numpy as np  # noqa: PLC0415 - a real run only; simulation never imports it

    if a.shape != b.shape:
        raise ApplicationError(
            "Two pictures of one stretch differ in size",
            type="MEDIA_BAD_VIDEO",
            non_retryable=True,
        )
    return float(np.mean(np.abs(a.astype(np.int16) - b.astype(np.int16))))


def motion_values(
    frames: Iterable[Frame],
    ranges: Sequence[tuple[int, int]],
    duration_ms: int,
    on_frame: Callable[[int], None] | None = None,
) -> tuple[list[float | None], int]:
    """The motion grid of a video `duration_ms` long, and how many pictures were read.

    Samples outside every stretch are None (no data). A picture counts
    against the one before it only within one stretch.
    """
    count = -(-duration_ms * RATE_HZ // 1000)
    values: list[float | None] = [None] * count
    starts = {from_ms for from_ms, _ in ranges}
    previous: Frame | None = None
    waiting_first: int | None = None
    seen = 0
    for frame in frames:
        seen += 1
        if on_frame is not None:
            on_frame(seen)
        index = frame.t_ms * RATE_HZ // 1000
        if index >= count:
            continue
        starts_stretch = previous is None or any(
            previous.t_ms < start <= frame.t_ms for start in starts
        )
        if starts_stretch:
            waiting_first = index
        else:
            assert previous is not None
            value = round(mean_abs_difference(previous.pixels, frame.pixels), 2)
            values[index] = value
            if waiting_first is not None:
                values[waiting_first] = value
                waiting_first = None
        previous = frame
    if waiting_first is not None:
        # A stretch of one picture: nothing moved that could be seen.
        values[waiting_first] = 0.0
    return values, seen


def _simulated(
    payload: MediaPyMotionInput, ranges: list[tuple[int, int]], deps: VisualDeps
) -> tuple[list[float | None], int]:
    hint = payload.simulation
    sample = str(hint.sample.root) if hint and hint.sample else None
    force = hint.force if hint else None
    if force == "fail":
        raise ApplicationError(
            "The simulated picture measure failed on purpose", type="MEDIA_TOOL_FAILED"
        )
    if force == "slow":
        for step in range(SLOW_STEPS):
            deps.checkpoint({"step": step, "of": SLOW_STEPS})
            deps.sleep(SLOW_STEP_SECONDS)
    full = recorded_motion(sample, payload.duration_ms)
    values: list[float | None] = [None] * len(full)
    sampled = 0
    for from_ms, to_ms in ranges:
        for index in range(from_ms * RATE_HZ // 1000, -(-to_ms * RATE_HZ // 1000)):
            if index < len(full):
                values[index] = round(full[index], 2)
                sampled += 1
    return values, sampled


def measure_motion(payload: MediaPyMotionInput, deps: VisualDeps) -> MediaPyMotionOutput:
    """Measures the asked stretches and stores the motion file."""
    ranges = checked_ranges(payload.ranges, payload.duration_ms)
    proxy_key = payload.proxy_key
    if not is_video_key(proxy_key, payload.org_id, payload.video_id):
        raise bad_input("A job reads only the files of its own video")
    with scratch_folder(deps.scratch_root, payload.job_id) as folder:
        if deps.simulated:
            if not deps.storage.exists(proxy_key):
                raise ApplicationError(
                    "The light copy is not in storage",
                    type="MEDIA_KEY_NOT_FOUND",
                    non_retryable=True,
                )
            values, sampled = _simulated(payload, ranges, deps)
            producer = "simulation"
        else:
            proxy = folder / "proxy.mp4"
            try:
                deps.storage.get_to_file(proxy_key, proxy)
            except StorageNotFoundError:
                raise ApplicationError(
                    "The light copy is not in storage",
                    type="MEDIA_KEY_NOT_FOUND",
                    non_retryable=True,
                ) from None
            source = deps.open_source(proxy)
            try:
                frames = source.frames(ranges, RATE_HZ, MOTION_WIDTH, grey=True)

                def beat(seen: int) -> None:
                    if seen % HEARTBEAT_EVERY == 0:
                        deps.checkpoint({"pictures": seen})

                values, sampled = motion_values(frames, ranges, payload.duration_ms, beat)
                producer = source.name
            finally:
                source.close()
        deps.checkpoint({"pictures": sampled})

        motion = MotionFile.model_validate(
            {
                "version": 1,
                "producer": producer,
                "ranges": [{"fromMs": a, "toMs": b} for a, b in ranges],
                "sampleRateHz": RATE_HZ,
                "values": values,
            },
        )
        out = folder / "motion.json.gz"
        with gzip.open(out, "wt", encoding="utf-8") as handle:
            json.dump(motion.model_dump(by_alias=True, mode="json"), handle)
        key = job_file_key(payload.org_id, payload.video_id, "motion", payload.job_id)
        deps.storage.put_file(out, key, "application/gzip")

    return MediaPyMotionOutput.model_validate(
        {"trackKey": key, "sampled": sampled, "producer": producer},
    )
