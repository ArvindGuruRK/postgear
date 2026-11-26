"""Where faces are: the work behind `mediaPyDetectFaces` (Module 07).

1. Fetch the light copy to a scratch folder (a real run only: the simulated
   binding answers recorded boxes and never decodes).
2. Decode the asked stretches once, forward, at five pictures a second, at
   most 640 px wide, in colour (`frames.py`, the decode loop Module 06 wrote).
3. Hand each picture to the detector and keep its boxes as fractions of the
   picture: clamped inside it, the unsure ones and the tiny ones dropped
   (a face under `MIN_FACE_HEIGHT` of the picture is a poster, not a person
   in the shot), largest first, at most eight.
4. Write the face file to a key made from the job's id (a retry overwrites
   it) and answer its key and two counts.

The file holds boxes and times, nothing else: no landmarks, no picture of a
face, no likeness, never who. Heartbeats every few seconds of video.
"""

from __future__ import annotations

import gzip
import json
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from temporalio.exceptions import ApplicationError

from postgear_media.contract.generated import (
    FaceTracksFile,
    MediaPyDetectFacesInput,
    MediaPyDetectFacesOutput,
)
from postgear_media.core.keys import job_file_key
from postgear_media.core.scratch import scratch_folder
from postgear_media.core.storage import PrivateStorage, StorageNotFoundError
from postgear_media.providers.vision.simulated_faces import recorded_faces
from postgear_media.services.frames import Frame, FrameSource, sample_times
from postgear_media.services.motion import checked_ranges

RATE_HZ = 5
MAX_WIDTH = 640
#: Boxes the detector is less sure of than this are dropped.
MIN_SCORE = 0.35
#: A face shorter than this part of the picture is too far away to frame (a poster).
MIN_FACE_HEIGHT = 0.035
MAX_PER_PICTURE = 8
#: Pictures between heartbeats (five seconds of video).
HEARTBEAT_EVERY = 25
SLOW_STEP_SECONDS = 0.25
SLOW_STEPS = 40

PixelBox = tuple[float, float, float, float, float]


class FaceDetector(Protocol):
    """What the service hands pictures to."""

    name: str

    def detect(self, pixels: Any) -> list[PixelBox]:
        """`(x, y, w, h, score)` in pixels for each face in a colour picture."""

    def close(self) -> None:
        """Lets the model go."""


@dataclass(frozen=True, slots=True)
class FacesDeps:
    """What the face service needs from outside."""

    storage: PrivateStorage
    scratch_root: Path
    #: Heartbeats and raises when the caller cancelled.
    checkpoint: Callable[[dict[str, Any] | None], None]
    #: True for the simulated binding: recorded boxes, no decoder, no model.
    simulated: bool
    #: Opens the real decoder on a file (tests hand in a fake).
    open_source: Callable[[Path], FrameSource]
    #: Loads the real detector (tests hand in a fake).
    open_detector: Callable[[], FaceDetector]
    sleep: Callable[[float], None] = time.sleep


def _fraction(value: float) -> float:
    return round(min(max(value, 0.0), 1.0), 4)


def clean_boxes(found: Iterable[PixelBox], width: int, height: int) -> list[dict[str, float]]:
    """Pixel boxes as fractions of a `width` by `height` picture, the noise taken out."""
    if width <= 0 or height <= 0:
        return []
    kept: list[dict[str, float]] = []
    for x, y, w, h, score in found:
        if score < MIN_SCORE:
            continue
        left, top = max(x, 0.0), max(y, 0.0)
        right, bottom = min(x + w, float(width)), min(y + h, float(height))
        if right <= left or bottom <= top:
            continue
        box_h = (bottom - top) / height
        if box_h < MIN_FACE_HEIGHT:
            continue
        kept.append(
            {
                "x": _fraction(left / width),
                "y": _fraction(top / height),
                "w": _fraction((right - left) / width),
                "h": _fraction(box_h),
                "score": _fraction(score),
            }
        )
    kept.sort(key=lambda box: box["w"] * box["h"], reverse=True)
    return kept[:MAX_PER_PICTURE]


def detect_in_frames(
    frames: Iterable[Frame],
    detector: FaceDetector,
    on_frame: Callable[[int], None] | None = None,
) -> list[dict[str, Any]]:
    """One entry a picture: its time and the boxes found in it."""
    pictures: list[dict[str, Any]] = []
    for frame in frames:
        height, width = frame.pixels.shape[:2]
        boxes = clean_boxes(detector.detect(frame.pixels), width, height)
        pictures.append({"t": frame.t_ms, "boxes": boxes})
        if on_frame is not None:
            on_frame(len(pictures))
    return pictures


def _simulated(
    payload: MediaPyDetectFacesInput, ranges: Sequence[tuple[int, int]], deps: FacesDeps
) -> list[dict[str, Any]]:
    hint = payload.simulation
    sample = str(hint.sample.root) if hint and hint.sample else None
    force = hint.force if hint else None
    if force == "fail":
        raise ApplicationError(
            "The simulated face detector failed on purpose", type="MEDIA_TOOL_FAILED"
        )
    if force == "slow":
        for step in range(SLOW_STEPS):
            deps.checkpoint({"step": step, "of": SLOW_STEPS})
            deps.sleep(SLOW_STEP_SECONDS)
    pictures: list[dict[str, Any]] = []
    for from_ms, to_ms in ranges:
        for t in sample_times(from_ms, to_ms, RATE_HZ):
            boxes = [
                {"x": f.x, "y": f.y, "w": f.w, "h": f.h, "score": f.score}
                for f in recorded_faces(sample, t)
            ]
            pictures.append({"t": t, "boxes": boxes})
    return pictures


def _key_missing() -> ApplicationError:
    return ApplicationError(
        "The light copy is not in storage", type="MEDIA_KEY_NOT_FOUND", non_retryable=True
    )


def detect_faces(payload: MediaPyDetectFacesInput, deps: FacesDeps) -> MediaPyDetectFacesOutput:
    """Looks for faces in the asked stretches and stores the face file."""
    ranges = checked_ranges(payload.ranges, payload.duration_ms)
    with scratch_folder(deps.scratch_root, payload.job_id) as folder:
        if deps.simulated:
            if not deps.storage.exists(payload.proxy_key):
                raise _key_missing()
            pictures = _simulated(payload, ranges, deps)
            producer = "simulation"
        else:
            proxy = folder / "proxy.mp4"
            try:
                deps.storage.get_to_file(payload.proxy_key, proxy)
            except StorageNotFoundError:
                raise _key_missing() from None
            detector = deps.open_detector()
            try:
                source = deps.open_source(proxy)
                try:

                    def beat(seen: int) -> None:
                        if seen % HEARTBEAT_EVERY == 0:
                            deps.checkpoint({"pictures": seen})

                    frames = source.frames(ranges, RATE_HZ, MAX_WIDTH, grey=False)
                    pictures = detect_in_frames(frames, detector, beat)
                finally:
                    source.close()
                producer = detector.name
            finally:
                detector.close()
        deps.checkpoint({"pictures": len(pictures)})

        faces = FaceTracksFile.model_validate(
            {"version": 1, "sampleFps": RATE_HZ, "frames": pictures},
        )
        out = folder / "faces.json.gz"
        with gzip.open(out, "wt", encoding="utf-8") as handle:
            json.dump(faces.model_dump(by_alias=True, mode="json"), handle)
        key = job_file_key(payload.org_id, payload.video_id, "faces", payload.job_id)
        deps.storage.put_file(out, key, "application/gzip")

    found = sum(len(picture["boxes"]) for picture in pictures)
    return MediaPyDetectFacesOutput.model_validate(
        {"facesKey": key, "sampled": len(pictures), "found": found, "producer": producer},
    )
