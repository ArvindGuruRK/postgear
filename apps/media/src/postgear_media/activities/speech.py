"""`mediaPySpeak`: the thin Temporal face of `services/speech.py` (Module 09)."""

from __future__ import annotations

from typing import Any

from temporalio import activity

from postgear_media.activities.base import answer, checkpoint, logged, parse_input
from postgear_media.contract.generated import MediaPySpeakInput
from postgear_media.core.settings import get_settings
from postgear_media.core.storage import create_private_storage
from postgear_media.providers.factory import get_speaker
from postgear_media.services.speech import SpeechDeps, speak

NAME = "mediaPySpeak"


@activity.defn(name=NAME)
def media_py_speak(payload: dict[str, Any]) -> dict[str, Any]:
    """Makes the job's line a voice; answers the WAV's key and length, never the line."""
    parsed = parse_input(MediaPySpeakInput, payload)
    settings = get_settings()

    def work() -> dict[str, Any]:
        deps = SpeechDeps(
            storage=create_private_storage(settings),
            scratch_root=settings.scratch_root,
            checkpoint=checkpoint,
            simulated=settings.simulation,
            open_speaker=lambda: get_speaker(settings),
        )
        return answer(speak(parsed, deps))

    return logged(NAME, parsed.job_id, work)
