"""`mediaPyHealth`: what this service is and what it can do right now."""

from __future__ import annotations

from typing import Any

from temporalio import activity

from postgear_media.activities.base import answer, logged, parse_input
from postgear_media.contract.generated import (
    Binding,
    Bindings,
    MediaPyHealthInput,
    MediaPyHealthOutput,
)
from postgear_media.core.settings import (
    MEDIA_PY_TASK_QUEUE,
    Settings,
    get_settings,
    python_version,
    service_version,
)
from postgear_media.providers.factory import BindingInfo, build_provider_table

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
        ),
        models_present=table.models_present,
    )


@activity.defn(name=NAME)
def media_py_health(payload: dict[str, Any]) -> dict[str, Any]:
    """The Temporal activity: no work, just the report."""
    parse_input(MediaPyHealthInput, payload)
    return logged(NAME, None, lambda: answer(health_report(get_settings())))
