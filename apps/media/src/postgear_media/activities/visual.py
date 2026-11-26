"""`mediaPyMotion` and `mediaPyStills`: the thin Temporal faces of the picture services."""

from __future__ import annotations

from typing import Any

from temporalio import activity

from postgear_media.activities.base import answer, checkpoint, logged, parse_input
from postgear_media.contract.generated import MediaPyMotionInput, MediaPyStillsInput
from postgear_media.core.settings import get_settings
from postgear_media.core.storage import create_private_storage
from postgear_media.services.frames import open_frame_source
from postgear_media.services.motion import VisualDeps, measure_motion
from postgear_media.services.stills import cut_stills

MOTION = "mediaPyMotion"
STILLS = "mediaPyStills"


def _deps() -> VisualDeps:
    settings = get_settings()
    return VisualDeps(
        storage=create_private_storage(settings),
        scratch_root=settings.scratch_root,
        checkpoint=checkpoint,
        simulated=settings.simulation,
        open_source=open_frame_source,
    )


@activity.defn(name=MOTION)
def media_py_motion(payload: dict[str, Any]) -> dict[str, Any]:
    """Measures how much the picture moves; answers the motion file's key."""
    parsed = parse_input(MediaPyMotionInput, payload)
    return logged(MOTION, parsed.job_id, lambda: answer(measure_motion(parsed, _deps())))


@activity.defn(name=STILLS)
def media_py_stills(payload: dict[str, Any]) -> dict[str, Any]:
    """Cuts a few stills; answers their keys, never the pictures."""
    parsed = parse_input(MediaPyStillsInput, payload)
    return logged(STILLS, parsed.job_id, lambda: answer(cut_stills(parsed, _deps())))
