"""`mediaPyHealth`: what this service is and what it can do right now."""

from __future__ import annotations

from typing import Any

from temporalio import activity

from postgear_media.activities.base import answer, logged, parse_input
from postgear_media.contract.generated import (
    Binding,
    Bindings,
    HostedAboveMinutes,
    MediaPyHealthInput,
    MediaPyHealthOutput,
    VoiceInfo,
    VoiceList,
)
from postgear_media.core.settings import (
    MEDIA_PY_TASK_QUEUE,
    Settings,
    get_settings,
    python_version,
    service_version,
)
from postgear_media.providers.factory import BindingInfo, build_provider_table
from postgear_media.providers.speech.base import Voice
from postgear_media.providers.speech.kokoro import KOKORO_VOICES
from postgear_media.providers.speech.simulated import VOICES as SIMULATED_VOICES

NAME = "mediaPyHealth"


def _binding(info: BindingInfo) -> Binding:
    return Binding(state=info.state, name=info.name)


def health_report(settings: Settings) -> MediaPyHealthOutput:
    """The health answer for these settings (also served by `GET /tools`)."""
    table = build_provider_table(settings)
    return MediaPyHealthOutput(
        contract_version=1,
        service_version=service_version(),
        python_version=python_version(),
        simulation=settings.simulation,
        task_queue=MEDIA_PY_TASK_QUEUE,
        bindings=Bindings(
            transcriber=_binding(table.transcriber),
            faces=_binding(table.faces),
            motion=_binding(table.motion),
            stills=_binding(table.stills),
            speaker=_binding(table.speaker),
            hosted_transcriber=_binding(table.hosted_transcriber),
        ),
        models_present=table.models_present,
        hosted_above_minutes=(
            None
            if table.hosted_above_minutes is None
            else HostedAboveMinutes(table.hosted_above_minutes)
        ),
    )


def hosted_lane(settings: Settings) -> dict[str, Any] | None:
    """`/ready`'s `hostedLane` (Module 15): which hosted listener long speech goes to, or None.

    Read by the API for `ai.hostedLane` in `GET /clips/status`, so the privacy
    text names the provider only while sound can leave our servers. The
    provider's name and the threshold only, never the key.
    """
    table = build_provider_table(settings)
    if table.hosted_transcriber.state != "live" or table.hosted_above_minutes is None:
        return None
    return {"provider": table.hosted_transcriber.name, "aboveMinutes": table.hosted_above_minutes}


def _voice(voice: Voice) -> VoiceInfo:
    return VoiceInfo.model_validate(
        {"id": voice.id, "name": voice.name, "languages": list(voice.languages)}
    )


def voice_list(settings: Settings) -> VoiceList:
    """`GET /voices` (Module 09): the speaker this service runs and its voices.

    The API offers exactly this list, so a voice on offer is always one that
    can speak here. A speaker that is `off` has no voices.
    """
    speaker = build_provider_table(settings).speaker
    if speaker.state == "simulation":
        voices = SIMULATED_VOICES
    elif speaker.state == "live":
        voices = tuple(entry.voice for entry in KOKORO_VOICES)
    else:
        voices = ()
    return VoiceList(speaker=_binding(speaker), voices=[_voice(voice) for voice in voices])


@activity.defn(name=NAME)
def media_py_health(payload: dict[str, Any]) -> dict[str, Any]:
    """The Temporal activity: no work, just the report."""
    parse_input(MediaPyHealthInput, payload)
    return logged(NAME, None, lambda: answer(health_report(get_settings())))
