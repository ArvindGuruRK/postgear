"""A typed line made into a voice: the work behind `mediaPySpeak` (Module 09).

1. Check the keys: both must be this job's own library files
   (`clips/<org>/library/<job hex>.json` and `.wav`), made the same way the
   Node side makes them, so a payload can never point the service elsewhere.
2. Read the speech text file (the line never rides in the payload).
3. Hand the line to the speaker and write a mono 16-bit WAV at the job's key
   (a retry overwrites it).
4. Answer the key, the length and the rate.

The Node side turns the WAV into the workspace's own sound (the editor's AAC
`.m4a` with its peaks, the same as an uploaded sound) and removes both files.

The line is never logged, never put in an error, never kept past the
attempt's scratch folder.
"""

from __future__ import annotations

import time
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from temporalio.exceptions import ApplicationError

from postgear_media.activities.base import bad_input
from postgear_media.contract.generated import (
    MediaPySpeakInput,
    MediaPySpeakOutput,
    SpeechTextFile,
)
from postgear_media.core.keys import library_job_key
from postgear_media.core.scratch import scratch_folder
from postgear_media.core.storage import PrivateStorage, StorageNotFoundError
from postgear_media.providers.speech.base import Speaker, Spoken

#: Only the rate the contract names is ever written.
SAMPLE_RATE = 24_000
#: The longest voice the contract lets us answer.
MAX_MS = 10 * 60 * 1000
SLOW_STEP_SECONDS = 0.25
SLOW_STEPS = 40


@dataclass(frozen=True, slots=True)
class SpeechDeps:
    """What the speech service needs from outside."""

    storage: PrivateStorage
    scratch_root: Path
    #: Heartbeats and raises when the caller cancelled.
    checkpoint: Callable[[dict[str, Any] | None], None]
    #: True for the simulated binding (only it reads the forcing switch).
    simulated: bool
    #: Builds the speaker (tests hand in a fake).
    open_speaker: Callable[[], Speaker]
    sleep: Callable[[float], None] = time.sleep


def write_wav(path: Path, spoken: Spoken) -> None:
    """The samples as a mono 16-bit WAV file."""
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(spoken.sample_rate)
        target.writeframes(spoken.pcm)


def _checked_keys(payload: MediaPySpeakInput) -> tuple[str, str]:
    text_key = library_job_key(payload.org_id, payload.job_id, "json")
    out_key = library_job_key(payload.org_id, payload.job_id, "wav")
    if payload.text_key != text_key or payload.out_key != out_key:
        raise bad_input("A speech job reads and writes only its own library files")
    return text_key, out_key


def _read_text(storage: PrivateStorage, key: str, folder: Path) -> str:
    path = folder / "speech.json"
    try:
        storage.get_to_file(key, path)
    except StorageNotFoundError:
        raise ApplicationError(
            "The speech text file is not in storage",
            type="MEDIA_KEY_NOT_FOUND",
            non_retryable=True,
        ) from None
    try:
        return SpeechTextFile.model_validate_json(path.read_bytes()).text
    except ValidationError:
        # Field names only: the line itself never reaches an error.
        raise bad_input("The speech text file does not match the contract") from None


def _simulation_force(payload: MediaPySpeakInput, deps: SpeechDeps) -> None:
    hint = payload.simulation
    force = hint.force if hint and deps.simulated else None
    if force == "fail":
        raise ApplicationError("The simulated speaker failed on purpose", type="MEDIA_TOOL_FAILED")
    if force == "slow":
        for step in range(SLOW_STEPS):
            deps.checkpoint({"step": step, "of": SLOW_STEPS})
            deps.sleep(SLOW_STEP_SECONDS)


def speak(payload: MediaPySpeakInput, deps: SpeechDeps) -> MediaPySpeakOutput:
    """Speaks the job's line in the asked voice and stores the WAV."""
    text_key, out_key = _checked_keys(payload)
    speaker = deps.open_speaker()
    voice_id = payload.voice_id
    if voice_id not in {voice.id for voice in speaker.voices()}:
        raise bad_input("This voice is not on this service")
    with scratch_folder(deps.scratch_root, payload.job_id) as folder:
        text = _read_text(deps.storage, text_key, folder)
        deps.checkpoint({"characters": len(text)})
        _simulation_force(payload, deps)
        spoken = speaker.speak(text, voice_id)
        if spoken.sample_rate != SAMPLE_RATE or not 0 < spoken.duration_ms <= MAX_MS:
            raise ApplicationError(
                "The speaker made a sound the contract does not take", type="MEDIA_TOOL_FAILED"
            )
        deps.checkpoint({"ms": spoken.duration_ms})
        path = folder / "voice.wav"
        write_wav(path, spoken)
        deps.storage.put_file(path, out_key, "audio/wav")
    return MediaPySpeakOutput.model_validate(
        {
            "soundKey": out_key,
            "durationMs": spoken.duration_ms,
            "sampleRate": SAMPLE_RATE,
            "producer": speaker.name,
        }
    )
