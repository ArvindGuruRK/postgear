"""Text to speech (Module 09): the simulated speaker, the service and the activity."""

from __future__ import annotations

import json
import wave
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from temporalio.exceptions import ApplicationError
from temporalio.testing import ActivityEnvironment

from postgear_media.activities.speech import media_py_speak
from postgear_media.contract.generated import MediaPySpeakInput, MediaPySpeakOutput
from postgear_media.core.keys import library_job_key
from postgear_media.core.settings import Settings
from postgear_media.core.storage import LocalPrivateStorage, create_private_storage
from postgear_media.providers.factory import get_speaker
from postgear_media.providers.speech.base import Spoken, Voice
from postgear_media.providers.speech.simulated import (
    CHARACTER_MS,
    SAMPLE_RATE,
    VOICES,
    SimulatedSpeaker,
)
from postgear_media.services.speech import SpeechDeps, speak
from tests.conftest import FIXTURES, read_json
from tests.helpers import JOB, ORG

TEXT_KEY = library_job_key(ORG, JOB, "json")
OUT_KEY = library_job_key(ORG, JOB, "wav")
LINE = "Wait for it. This is the best part of the stream."


def payload(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "textKey": TEXT_KEY,
        "voiceId": "sim-river",
        "outKey": OUT_KEY,
        "simulation": {"force": None},
    }
    values.update(overrides)
    return values


def store_text(storage: LocalPrivateStorage, folder: Path, text: str = LINE) -> None:
    path = folder / "text.json"
    path.write_text(json.dumps({"version": 1, "text": text}), encoding="utf-8")
    storage.put_file(path, TEXT_KEY, "application/json")


def deps(storage: LocalPrivateStorage, root: Path, **overrides: Any) -> SpeechDeps:
    values: dict[str, Any] = {
        "storage": storage,
        "scratch_root": root / "scratch",
        "checkpoint": lambda _details: None,
        "simulated": True,
        "open_speaker": SimulatedSpeaker,
        "sleep": lambda _seconds: None,
    }
    values.update(overrides)
    return SpeechDeps(**values)


# --- The simulated speaker -------------------------------------------------------


def test_the_voices_are_the_shared_fixture() -> None:
    fixture = read_json(FIXTURES / "voices" / "simulated.json")
    assert [
        {"id": voice.id, "name": voice.name, "languages": list(voice.languages)} for voice in VOICES
    ] == fixture["voices"]


def test_length_follows_the_text() -> None:
    speaker = SimulatedSpeaker()
    short = speaker.speak("Hi there", "sim-river")
    long = speaker.speak("x" * 1000, "sim-river")
    assert short.duration_ms == 8 * CHARACTER_MS
    # About a minute for a thousand characters: the pace the price assumes.
    assert long.duration_ms == 60_000
    assert short.sample_rate == SAMPLE_RATE


def test_the_same_line_and_voice_make_the_same_bytes() -> None:
    first = SimulatedSpeaker().speak(LINE, "sim-meadow")
    second = SimulatedSpeaker().speak(LINE, "sim-meadow")
    other = SimulatedSpeaker().speak(LINE, "sim-river")
    assert first.pcm == second.pcm
    assert first.pcm != other.pcm


def test_spaces_are_silent_and_letters_are_not() -> None:
    spoken = SimulatedSpeaker().speak("a b", "sim-stone")
    per_character = len(spoken.pcm) // 3
    assert any(spoken.pcm[:per_character])
    assert not any(spoken.pcm[per_character : 2 * per_character])


def test_reads_other_scripts_without_failing() -> None:
    spoken = SimulatedSpeaker().speak("नमस्ते दोस्तों", "sim-meadow")
    assert spoken.duration_ms == len("नमस्ते दोस्तों") * CHARACTER_MS


def test_an_unknown_voice_is_a_key_error() -> None:
    with pytest.raises(KeyError):
        SimulatedSpeaker().speak("Hello", "af_heart")


# --- The service -------------------------------------------------------------------


def test_writes_a_wav_at_the_job_key(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    store_text(storage, tmp_path)
    result = speak(MediaPySpeakInput.model_validate(payload()), deps(storage, tmp_path))
    assert result.sound_key == OUT_KEY
    assert result.duration_ms == len(LINE) * CHARACTER_MS
    assert result.sample_rate == 24_000
    assert result.producer == "simulation"
    copy = tmp_path / "copy.wav"
    storage.get_to_file(OUT_KEY, copy)
    with wave.open(str(copy), "rb") as made:
        assert made.getnchannels() == 1
        assert made.getsampwidth() == 2
        assert made.getframerate() == 24_000
        assert round(made.getnframes() * 1000 / made.getframerate()) == result.duration_ms
    # Nothing is left in the scratch folder.
    assert list((tmp_path / "scratch").iterdir()) == []


def test_refuses_keys_that_are_not_the_jobs_own(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    store_text(storage, tmp_path)
    other = library_job_key(ORG, "11111111-2222-4333-8444-555555555555", "wav")
    with pytest.raises(ApplicationError) as caught:
        speak(MediaPySpeakInput.model_validate(payload(outKey=other)), deps(storage, tmp_path))
    assert caught.value.type == "MEDIA_BAD_INPUT"
    assert caught.value.non_retryable is True


def test_a_missing_text_file_is_final(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    with pytest.raises(ApplicationError) as caught:
        speak(MediaPySpeakInput.model_validate(payload()), deps(storage, tmp_path))
    assert caught.value.type == "MEDIA_KEY_NOT_FOUND"


def test_a_bad_text_file_never_shows_its_text(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    path = tmp_path / "text.json"
    secret = "x" * 600
    path.write_text(json.dumps({"version": 1, "text": secret}), encoding="utf-8")
    storage.put_file(path, TEXT_KEY, "application/json")
    with pytest.raises(ApplicationError) as caught:
        speak(MediaPySpeakInput.model_validate(payload()), deps(storage, tmp_path))
    assert caught.value.type == "MEDIA_BAD_INPUT"
    assert secret not in str(caught.value)


def test_an_unknown_voice_is_bad_input(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    store_text(storage, tmp_path)
    with pytest.raises(ApplicationError) as caught:
        speak(
            MediaPySpeakInput.model_validate(payload(voiceId="sim-nobody")), deps(storage, tmp_path)
        )
    assert caught.value.type == "MEDIA_BAD_INPUT"


def test_the_forced_failure_is_retryable(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    store_text(storage, tmp_path)
    with pytest.raises(ApplicationError) as caught:
        speak(
            MediaPySpeakInput.model_validate(payload(simulation={"force": "fail"})),
            deps(storage, tmp_path),
        )
    assert caught.value.type == "MEDIA_TOOL_FAILED"
    assert caught.value.non_retryable is False
    assert not storage.exists(OUT_KEY)


def test_slow_heartbeats_while_it_waits(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    store_text(storage, tmp_path)
    beats: list[dict[str, Any] | None] = []
    speak(
        MediaPySpeakInput.model_validate(payload(simulation={"force": "slow"})),
        deps(storage, tmp_path, checkpoint=beats.append),
    )
    assert len(beats) > 40


def test_a_force_is_ignored_outside_simulation(tmp_path: Path) -> None:
    class Fake:
        name = "fake"

        def voices(self) -> tuple[Voice, ...]:
            return (Voice(id="sim-river", name="River", languages=("en",)),)

        def speak(self, text: str, voice_id: str) -> Spoken:  # noqa: ARG002
            return Spoken(pcm=b"\x00\x00" * 24_000, sample_rate=24_000)

    storage = LocalPrivateStorage(tmp_path / "private")
    store_text(storage, tmp_path)
    result = speak(
        MediaPySpeakInput.model_validate(payload(simulation={"force": "fail"})),
        deps(storage, tmp_path, simulated=False, open_speaker=Fake),
    )
    assert result.duration_ms == 1000
    assert result.producer == "fake"


# --- The binding and the activity ----------------------------------------------------


def test_outside_simulation_the_speaker_is_off(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ApplicationError) as caught:
        get_speaker(make_settings(media_simulation=False))
    assert caught.value.type == "MEDIA_BINDING_OFF"
    assert caught.value.non_retryable is True


def test_the_activity_answers_the_contract_shape(
    make_settings: Callable[..., Settings],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = make_settings(media_simulation=True)
    monkeypatch.setattr("postgear_media.activities.speech.get_settings", lambda: settings)
    storage = create_private_storage(settings)
    assert isinstance(storage, LocalPrivateStorage)
    store_text(storage, tmp_path)
    result = ActivityEnvironment().run(media_py_speak, payload())
    parsed = MediaPySpeakOutput.model_validate(result)
    assert set(result) == {"soundKey", "durationMs", "sampleRate", "producer"}
    assert parsed.sound_key == OUT_KEY
    assert storage.exists(OUT_KEY)


def test_the_activity_refuses_a_payload_with_the_text_in_it(
    make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = make_settings(media_simulation=True)
    monkeypatch.setattr("postgear_media.activities.speech.get_settings", lambda: settings)
    with pytest.raises(ApplicationError) as caught:
        ActivityEnvironment().run(media_py_speak, payload(text=LINE))
    assert caught.value.type == "MEDIA_BAD_INPUT"
    assert LINE not in str(caught.value)


def test_library_job_keys_follow_the_node_rule() -> None:
    expected = f"clips/{ORG}/library/{JOB.replace('-', '')}.json"
    assert expected == TEXT_KEY
    assert OUT_KEY.endswith(".wav")
