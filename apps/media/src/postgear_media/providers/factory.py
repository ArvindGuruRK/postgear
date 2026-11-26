"""Which binding does each job: simulated, live, or off.

One factory reads the settings and answers every binding at once. With
`MEDIA_SIMULATION` on, every binding is the simulated one and no model
library needs to be installed. Otherwise a binding is live only when its
library imports (the `ml` group) or, for the hosted lane, when its key is set;
anything else is `off`, so the service still starts and the page says that
step is not available instead of failing at the first job.

Later modules hang the real provider objects off this table; the states here
are what `mediaPyHealth` reports.
"""

from __future__ import annotations

import importlib.util
import threading
from dataclasses import dataclass
from typing import Literal

from temporalio.exceptions import ApplicationError

from postgear_media.core.settings import Settings
from postgear_media.providers.transcribe.base import Transcriber

BindingState = Literal["simulation", "live", "off"]


@dataclass(frozen=True, slots=True)
class BindingInfo:
    """One binding's state and what runs it."""

    state: BindingState
    name: str


@dataclass(frozen=True, slots=True)
class ProviderTable:
    """Every binding the service has."""

    transcriber: BindingInfo
    faces: BindingInfo
    motion: BindingInfo
    stills: BindingInfo
    models_present: bool


def _installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def _models_present(settings: Settings) -> bool:
    root = settings.model_root
    return root.is_dir() and any(root.iterdir())


def _transcriber(settings: Settings) -> BindingInfo:
    choice = settings.transcriber
    if choice == "simulation":
        return BindingInfo("simulation", "simulation")
    if choice == "groq":
        return BindingInfo("live" if settings.groq_api_key else "off", "groq")
    if _installed("faster_whisper"):
        return BindingInfo("live", "faster-whisper")
    return BindingInfo("off", "faster-whisper")


def build_provider_table(settings: Settings) -> ProviderTable:
    """The bindings this process will use."""
    if settings.simulation:
        sim = BindingInfo("simulation", "simulation")
        return ProviderTable(
            transcriber=sim,
            faces=sim,
            motion=sim,
            stills=sim,
            models_present=_models_present(settings),
        )
    has_cv = _installed("cv2")
    return ProviderTable(
        transcriber=_transcriber(settings),
        faces=BindingInfo("live" if _installed("mediapipe") else "off", "mediapipe"),
        motion=BindingInfo("live" if has_cv else "off", "opencv"),
        stills=BindingInfo("live" if has_cv else "off", "opencv"),
        models_present=_models_present(settings),
    )


_transcribers: dict[tuple[str, str], Transcriber] = {}
_transcribers_lock = threading.Lock()


def get_transcriber(settings: Settings) -> Transcriber:
    """The listener this process uses: one object per binding, so a model loads once.

    Simulation wins over everything (no library is imported). Otherwise
    `TRANSCRIBER` picks: `groq` needs its key, anything else is our own machine
    and needs the `ml` group. A binding that cannot run raises a non-retryable
    `MEDIA_BINDING_OFF`, so the job fails at once with a plain reason instead
    of retrying for an hour.
    """
    info = build_provider_table(settings).transcriber
    key = (info.name, settings.whisper_model)
    with _transcribers_lock:
        found = _transcribers.get(key)
        if found is not None:
            return found
        if info.state == "off":
            raise ApplicationError(
                f"The {info.name} listener cannot run on this service",
                type="MEDIA_BINDING_OFF",
                non_retryable=True,
            )
        built: Transcriber
        if info.state == "simulation":
            from postgear_media.providers.transcribe.simulation import (  # noqa: PLC0415
                SimulatedTranscriber,
            )

            built = SimulatedTranscriber()
        elif info.name == "groq":
            from postgear_media.providers.transcribe.groq import GroqTranscriber  # noqa: PLC0415

            assert settings.groq_api_key is not None  # the table said live
            built = GroqTranscriber(settings.groq_api_key.get_secret_value())
        else:
            from postgear_media.providers.transcribe.faster_whisper import (  # noqa: PLC0415
                FasterWhisperTranscriber,
            )

            built = FasterWhisperTranscriber(
                settings.whisper_model,
                settings.model_root,
                # A production box never reaches out for a model: a missing one fails loudly.
                local_files_only=settings.node_env == "production",
            )
        _transcribers[key] = built
        return built


def reset_transcribers() -> None:
    """Forgets the built listeners (tests)."""
    with _transcribers_lock:
        _transcribers.clear()
