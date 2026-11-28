"""Which binding does each job: simulated, live, or off.

One factory reads the settings and answers every binding at once. With
`MEDIA_SIMULATION` on, every binding is the simulated one and no model
library needs to be installed. Otherwise a binding is live only when its
library imports (the `ml` group) or, for the hosted lane, when its key is set;
anything else is `off`, so the service still starts and the page says that
step is not available instead of failing at the first job.

Later modules hang the real provider objects off this table; the states here
are what `mediaPyHealth` reports.

`TRANSCRIBER=auto` (Module 15) has two listeners: `transcriber` is reported
as `auto` with our own machine's state (the lane every short job takes), and
`hosted_transcriber` is the hosted lane, live only with its key. A job is
routed by its length in `services/transcribe.py`.
"""

from __future__ import annotations

import importlib.util
import threading
from dataclasses import dataclass
from typing import Literal

from temporalio.exceptions import ApplicationError

from postgear_media.core.settings import Settings
from postgear_media.providers.speech.base import Speaker
from postgear_media.providers.speech.kokoro import kokoro_ready
from postgear_media.providers.transcribe.base import HostedLane, Transcriber
from postgear_media.providers.vision.mediapipe_faces import face_model_path

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
    speaker: BindingInfo
    models_present: bool
    #: The hosted lane (Groq): `live` only when `TRANSCRIBER` uses it and its key is set.
    hosted_transcriber: BindingInfo
    #: Jobs asking for more minutes of sound than this go to the hosted lane
    #: (0: every job, `TRANSCRIBER=groq`); None while the lane is not live.
    hosted_above_minutes: int | None


def _installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def _models_present(settings: Settings) -> bool:
    root = settings.model_root
    return root.is_dir() and any(root.iterdir())


def _own_machine() -> BindingInfo:
    """faster-whisper on this box: live only with the `ml` group installed."""
    return BindingInfo("live" if _installed("faster_whisper") else "off", "faster-whisper")


def _groq(settings: Settings) -> BindingInfo:
    return BindingInfo("live" if settings.groq_api_key else "off", "groq")


def _transcriber(settings: Settings) -> BindingInfo:
    """The listener `TRANSCRIBER` names; under `auto`, named so, with our own machine's state."""
    choice = settings.transcriber
    if choice == "simulation":
        return BindingInfo("simulation", "simulation")
    if choice == "groq":
        return _groq(settings)
    own = _own_machine()
    if choice == "auto":
        return BindingInfo(own.state, "auto")
    return own


def _hosted_transcriber(settings: Settings) -> BindingInfo:
    """The hosted lane: on only for `auto` and `groq`, and only with the key."""
    if settings.transcriber in {"auto", "groq"}:
        return _groq(settings)
    return BindingInfo("off", "groq")


def _hosted_above_minutes(settings: Settings, hosted: BindingInfo) -> int | None:
    if hosted.state != "live":
        return None
    return 0 if settings.transcriber == "groq" else settings.transcribe_hosted_above_minutes


def _faces(settings: Settings) -> BindingInfo:
    """Live only with the library and its model file on this box (never downloaded here)."""
    model = face_model_path(settings.model_root)
    live = _installed("mediapipe") and _installed("cv2") and model.is_file()
    return BindingInfo("live" if live else "off", "mediapipe")


def _speaker(settings: Settings) -> BindingInfo:
    """Module 09. `MEDIA_SPEAKER=kokoro` speaks for real even under simulation.

    Kokoro is local, free and reaches no network, so it is the one binding a
    person may hear for real while everything else simulates. `auto` follows
    `MEDIA_SIMULATION`. Kokoro is live only when its program and both model
    files are on this box (never downloaded here).
    """
    choice = settings.media_speaker
    if choice == "simulation" or (choice == "auto" and settings.simulation):
        return BindingInfo("simulation", "simulation")
    ready = kokoro_ready(settings.voice_program, settings.model_root)
    return BindingInfo("live" if ready else "off", "kokoro")


def build_provider_table(settings: Settings) -> ProviderTable:
    """The bindings this process will use."""
    if settings.simulation:
        sim = BindingInfo("simulation", "simulation")
        return ProviderTable(
            transcriber=sim,
            faces=sim,
            motion=sim,
            stills=sim,
            speaker=_speaker(settings),
            models_present=_models_present(settings),
            hosted_transcriber=sim,
            hosted_above_minutes=None,
        )
    has_cv = _installed("cv2")
    hosted = _hosted_transcriber(settings)
    return ProviderTable(
        transcriber=_transcriber(settings),
        faces=_faces(settings),
        motion=BindingInfo("live" if has_cv else "off", "opencv"),
        stills=BindingInfo("live" if has_cv else "off", "opencv"),
        speaker=_speaker(settings),
        models_present=_models_present(settings),
        hosted_transcriber=hosted,
        hosted_above_minutes=_hosted_above_minutes(settings, hosted),
    )


_transcribers: dict[tuple[str, str], Transcriber] = {}
_transcribers_lock = threading.Lock()


def get_transcriber(settings: Settings) -> Transcriber:
    """The listener this process uses: one object per binding, so a model loads once.

    Simulation wins over everything (no library is imported). Otherwise
    `TRANSCRIBER` picks: `groq` needs its key, anything else is our own machine
    and needs the `ml` group (under `auto` too: the hosted lane is the extra,
    `get_hosted_lane`). A binding that cannot run raises a non-retryable
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
            # `auto` is off when our own machine is: name the part that is missing.
            name = "faster-whisper" if info.name == "auto" else info.name
            raise ApplicationError(
                f"The {name} listener cannot run on this service",
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


def get_hosted_lane(settings: Settings) -> HostedLane | None:
    """`TRANSCRIBER=auto`'s hosted lane, or None (simulation, another setting, no key).

    One Groq listener per process, like `get_transcriber`. Building it sends
    nothing: a request is made only when a long job is handed to it.
    """
    if settings.transcriber != "auto":
        return None
    table = build_provider_table(settings)
    if table.hosted_transcriber.state != "live" or table.hosted_above_minutes is None:
        return None
    assert settings.groq_api_key is not None  # the table said live
    key = ("groq", "hosted-lane")
    with _transcribers_lock:
        found = _transcribers.get(key)
        if found is None:
            from postgear_media.providers.transcribe.groq import GroqTranscriber  # noqa: PLC0415

            found = GroqTranscriber(settings.groq_api_key.get_secret_value())
            _transcribers[key] = found
    return HostedLane(transcriber=found, above_ms=table.hosted_above_minutes * 60_000)


def reset_transcribers() -> None:
    """Forgets the built listeners (tests)."""
    with _transcribers_lock:
        _transcribers.clear()


def get_speaker(settings: Settings) -> Speaker:
    """The speaker this process uses (Module 09): see `_speaker`.

    A Kokoro that is not ready (no voice program, or no model files) raises a
    plain, non-retryable `MEDIA_BINDING_OFF` at once instead of retrying.
    """
    info = _speaker(settings)
    if info.state == "simulation":
        from postgear_media.providers.speech.simulated import SimulatedSpeaker  # noqa: PLC0415

        return SimulatedSpeaker()
    if info.state == "off":
        raise ApplicationError(
            "The kokoro voice cannot run on this service",
            type="MEDIA_BINDING_OFF",
            non_retryable=True,
        )
    from postgear_media.providers.speech.kokoro import KokoroSpeaker  # noqa: PLC0415

    return KokoroSpeaker(settings.voice_program, settings.model_root, settings.scratch_root)


def speaker_is_simulated(settings: Settings) -> bool:
    """True when the simulated speaker answers (only it reads the forcing switch)."""
    return _speaker(settings).state == "simulation"
