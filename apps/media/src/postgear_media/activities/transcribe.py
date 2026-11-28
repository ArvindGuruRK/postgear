"""`mediaPyTranscribe`: the thin Temporal face of `services/transcribe.py`."""

from __future__ import annotations

from typing import Any

from temporalio import activity

from postgear_media.activities.base import answer, checkpoint, logged, parse_input
from postgear_media.contract.generated import MediaPyTranscribeInput
from postgear_media.core.settings import get_settings
from postgear_media.core.storage import create_private_storage
from postgear_media.providers.factory import get_hosted_lane, get_transcriber
from postgear_media.services.transcribe import TranscribeDeps, transcribe

NAME = "mediaPyTranscribe"


@activity.defn(name=NAME)
def media_py_transcribe(payload: dict[str, Any]) -> dict[str, Any]:
    """Listens to the asked stretches; answers the heard file's key, never its words."""
    parsed = parse_input(MediaPyTranscribeInput, payload)
    settings = get_settings()

    def work() -> dict[str, Any]:
        deps = TranscribeDeps(
            storage=create_private_storage(settings),
            transcriber=get_transcriber(settings),
            scratch_root=settings.scratch_root,
            checkpoint=checkpoint,
            simulated=settings.simulation,
            hosted=get_hosted_lane(settings),
        )
        return answer(transcribe(parsed, deps))

    return logged(NAME, parsed.job_id, work)
