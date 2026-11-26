"""The decode loop: pictures of the light copy at a steady rate, in one forward pass.

Every picture service (motion here, faces in Module 07) reads frames through a
`FrameSource`. The real one is OpenCV's decoder (the `ml` group); tests hand
in a fake that draws pictures with numpy. A source never seeks per sample:
it seeks once to the start of each stretch, then grabs forward and decodes
only the pictures it keeps, which is what makes a long stretch cheap
(research 06, section 8.2: one pass, not a seek a sample).

Times are whole milliseconds of the video. A sample's time is the moment it
was asked for, not the decoder's own timestamp, so the grid never drifts.
"""

from __future__ import annotations

import math
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from temporalio.exceptions import ApplicationError

#: The grey copy the motion measure works on (research 06, section 9).
MOTION_WIDTH = 320


@dataclass(frozen=True, slots=True)
class Frame:
    """One kept picture: when, and its pixels (grey: height by width; colour: by 3)."""

    t_ms: int
    pixels: Any


class FrameSource(Protocol):
    """What a picture service reads frames through."""

    name: str

    def frames(
        self, ranges: Sequence[tuple[int, int]], fps: float, max_width: int, *, grey: bool
    ) -> Iterator[Frame]:
        """The pictures at `fps` inside each stretch, at most `max_width` wide."""

    def still(self, t_ms: int, width: int) -> bytes:
        """One JPEG of the picture at `t_ms`, `width` pixels wide."""

    def close(self) -> None:
        """Lets the file go."""


def sample_times(from_ms: int, to_ms: int, fps: float) -> list[int]:
    """The moments a stretch is sampled at: from its start, every `1000 / fps` ms."""
    if to_ms <= from_ms or fps <= 0:
        return []
    step = 1000 / fps
    first = math.ceil(from_ms / step)
    times: list[int] = []
    index = first
    while True:
        t = round(index * step)
        if t >= to_ms:
            break
        times.append(t)
        index += 1
    return times


def bad_video(message: str) -> ApplicationError:
    return ApplicationError(message, type="MEDIA_BAD_VIDEO", non_retryable=True)


def binding_off(what: str) -> ApplicationError:
    return ApplicationError(
        f"The {what} cannot run on this service", type="MEDIA_BINDING_OFF", non_retryable=True
    )


class OpenCvFrameSource:
    """OpenCV's own decoder (FFmpeg inside the wheel). Needs the `ml` group."""

    name = "opencv"

    def __init__(self, path: Path) -> None:
        try:
            import cv2  # noqa: PLC0415 - only a real run needs it
        except ImportError:
            raise binding_off("picture decoder") from None
        self._cv2 = cv2
        self._capture = cv2.VideoCapture(str(path))
        if not self._capture.isOpened():
            raise bad_video("The light copy could not be opened")

    def _scaled(self, image: Any, max_width: int, *, grey: bool) -> Any:
        cv2 = self._cv2
        height, width = image.shape[:2]
        if width > max_width:
            size = (max_width, max(1, round(height * max_width / width)))
            image = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if grey else image

    def frames(
        self, ranges: Sequence[tuple[int, int]], fps: float, max_width: int, *, grey: bool
    ) -> Iterator[Frame]:
        cv2 = self._cv2
        capture = self._capture
        for from_ms, to_ms in ranges:
            wanted = sample_times(from_ms, to_ms, fps)
            if not wanted:
                continue
            capture.set(cv2.CAP_PROP_POS_MSEC, float(from_ms))
            index = 0
            while index < len(wanted):
                if not capture.grab():
                    return
                position = capture.get(cv2.CAP_PROP_POS_MSEC)
                if position + 1 < wanted[index]:
                    continue
                ok, image = capture.retrieve()
                if not ok:
                    raise bad_video("A picture of the light copy could not be decoded")
                pixels = self._scaled(image, max_width, grey=grey)
                # A gap in the file (a dropped stretch) keeps one picture for every time it covers.
                while index < len(wanted) and wanted[index] <= position + 1:
                    yield Frame(t_ms=wanted[index], pixels=pixels)
                    index += 1

    def still(self, t_ms: int, width: int) -> bytes:
        cv2 = self._cv2
        self._capture.set(cv2.CAP_PROP_POS_MSEC, float(t_ms))
        ok, image = self._capture.read()
        if not ok:
            raise bad_video("A still could not be cut from the light copy")
        height, source_width = image.shape[:2]
        size = (width, max(1, round(height * width / source_width)))
        resized = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
        ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            raise bad_video("A still could not be written")
        return bytes(encoded.tobytes())

    def close(self) -> None:
        self._capture.release()


def open_frame_source(path: Path) -> FrameSource:
    """The real decoder for a file on disk."""
    return OpenCvFrameSource(path)
