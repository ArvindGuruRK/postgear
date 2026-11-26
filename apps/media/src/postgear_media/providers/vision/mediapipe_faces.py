"""The real face detector: MediaPipe's Tasks API with the short-range BlazeFace model.

Research 06 (the face section) picked it: small, fast on a processor, and the
one a reference project found reliable through the Tasks API (the long-range
model was reported failing there). The confidence floor is lowered from the
default 0.5 so a partly turned face is kept; `services/faces.py` drops boxes
too small to be anyone in the shot (a poster on the wall).

The model file is **never downloaded** by this code. It is read from
`MEDIA_MODEL_DIR` (a volume filled at deploy, Module 15). With the `ml` group
missing, or the file not there, the binding is off and the job fails at once
with a plain reason. Detection only: it says where a face is, never whose.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from temporalio.exceptions import ApplicationError

#: The model's file name inside `MEDIA_MODEL_DIR`.
FACE_MODEL_FILE = "blaze_face_short_range.tflite"
#: The detector's own floor: lower than its default, so a turned face is kept.
DETECTOR_MIN_CONFIDENCE = 0.35
PRODUCER = "mediapipe:blaze_face_short_range"


def face_model_path(model_root: Path) -> Path:
    return model_root / FACE_MODEL_FILE


def _off(message: str) -> ApplicationError:
    return ApplicationError(message, type="MEDIA_BINDING_OFF", non_retryable=True)


class MediaPipeFaceDetector:
    """Boxes in pixels of the picture it was handed; `services/faces.py` makes them fractions."""

    name = PRODUCER

    def __init__(self, model_root: Path) -> None:
        model = face_model_path(model_root)
        if not model.is_file():
            raise _off("The face model is not on this service")
        try:
            import mediapipe as mp  # noqa: PLC0415 - only a real run needs it
        except ImportError:
            raise _off("The face detector cannot run on this service") from None
        self._mp = mp
        vision = mp.tasks.vision
        options = vision.FaceDetectorOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.IMAGE,
            min_detection_confidence=DETECTOR_MIN_CONFIDENCE,
        )
        self._detector = vision.FaceDetector.create_from_options(options)

    def detect(self, pixels: Any) -> list[tuple[float, float, float, float, float]]:
        """`(x, y, w, h, score)` in pixels for each face in a BGR picture."""
        import numpy as np  # noqa: PLC0415

        rgb = np.ascontiguousarray(pixels[:, :, ::-1])
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        result = self._detector.detect(image)
        found: list[tuple[float, float, float, float, float]] = []
        for detection in result.detections:
            box = detection.bounding_box
            score = detection.categories[0].score if detection.categories else 0.0
            found.append(
                (
                    float(box.origin_x),
                    float(box.origin_y),
                    float(box.width),
                    float(box.height),
                    float(score),
                )
            )
        return found

    def close(self) -> None:
        self._detector.close()
