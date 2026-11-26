from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from temporalio import activity
from temporalio.exceptions import ApplicationError, CancelledError
from temporalio.testing import ActivityEnvironment

from postgear_media.activities.base import checkpoint, parse_input
from postgear_media.activities.health import health_report, media_py_health
from postgear_media.activities.transcribe import media_py_transcribe
from postgear_media.contract.generated import (
    MediaPyHealthInput,
    MediaPyHealthOutput,
    MediaPyTranscribeOutput,
)
from postgear_media.core.settings import Settings, get_settings
from postgear_media.core.storage import create_private_storage
from postgear_media.providers.factory import get_transcriber, reset_transcribers
from tests.helpers import AUDIO_KEY, JOB, ORG, VIDEO, write_wav


def test_health_answers_the_contract_shape(
    make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = make_settings(media_simulation=True)
    monkeypatch.setattr("postgear_media.activities.health.get_settings", lambda: settings)
    result = ActivityEnvironment().run(media_py_health, {"version": 1})
    parsed = MediaPyHealthOutput.model_validate(result)
    assert parsed.simulation is True
    assert parsed.task_queue == "postgear-media-py"
    assert parsed.bindings.transcriber.state == "simulation"
    assert "contractVersion" in result


def test_health_without_simulation_reports_off_bindings(
    make_settings: Callable[..., Settings],
) -> None:
    report = health_report(make_settings(media_simulation=False, transcriber="groq"))
    # No key for the hosted lane and no model libraries in the base install.
    assert report.bindings.transcriber.state == "off"
    assert report.bindings.faces.state == "off"
    assert report.models_present is False


def test_bad_input_is_not_retryable() -> None:
    with pytest.raises(ApplicationError) as caught:
        parse_input(MediaPyHealthInput, {"version": 1, "path": "/etc/passwd"})
    assert caught.value.type == "MEDIA_BAD_INPUT"
    assert caught.value.non_retryable is True
    assert "/etc/passwd" not in str(caught.value)


def test_another_contract_version_is_refused() -> None:
    with pytest.raises(ApplicationError) as caught:
        parse_input(MediaPyHealthInput, {"version": 2})
    assert caught.value.type == "MEDIA_CONTRACT_MISMATCH"


def test_checkpoint_outside_temporal_is_a_no_op() -> None:
    checkpoint({"chunk": 1})


def test_cancel_stops_at_the_next_heartbeat() -> None:
    env = ActivityEnvironment()
    reached: list[int] = []
    started = threading.Event()

    @activity.defn(name="slowForTest")
    def slow(_: dict[str, Any]) -> None:
        for chunk in range(1000):
            reached.append(chunk)
            started.set()
            checkpoint({"chunk": chunk})
            threading.Event().wait(0.01)

    def cancel_soon() -> None:
        started.wait(2)
        env.cancel()

    threading.Thread(target=cancel_soon).start()
    with pytest.raises(CancelledError):
        env.run(slow, {})
    assert 0 < len(reached) < 1000


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()


def test_transcribe_activity_answers_the_contract_shape_under_simulation(
    make_settings: Callable[..., Settings],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = make_settings(media_simulation=True)
    monkeypatch.setattr("postgear_media.activities.transcribe.get_settings", lambda: settings)
    reset_transcribers()
    storage = create_private_storage(settings)
    storage.put_file(write_wav(tmp_path / "a.wav", 180), AUDIO_KEY, "audio/wav")
    payload = {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "videoId": VIDEO,
        "audioKey": AUDIO_KEY,
        "durationMs": 180_000,
        "ranges": [{"fromMs": 0, "toMs": 60_000}],
        "language": "auto",
        "simulation": {"sample": "talk", "force": None},
    }
    result = ActivityEnvironment().run(media_py_transcribe, payload)
    parsed = MediaPyTranscribeOutput.model_validate(result)
    assert parsed.model == "simulation"
    assert parsed.word_count > 50
    assert parsed.no_speech is False
    # Every contract key is present, nulls included, and no word rides in the payload.
    assert set(result) == {
        "heardKey",
        "language",
        "languageProbability",
        "model",
        "secondsListened",
        "wordCount",
        "noSpeech",
    }
    assert result["languageProbability"] is None
    assert storage.exists(parsed.heard_key)


def test_transcribe_activity_on_the_silent_block_is_no_speech(
    make_settings: Callable[..., Settings],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = make_settings(media_simulation=True)
    monkeypatch.setattr("postgear_media.activities.transcribe.get_settings", lambda: settings)
    reset_transcribers()
    create_private_storage(settings).put_file(
        write_wav(tmp_path / "a.wav", 180), AUDIO_KEY, "audio/wav"
    )
    result = ActivityEnvironment().run(
        media_py_transcribe,
        {
            "version": 1,
            "jobId": JOB,
            "orgId": ORG,
            "videoId": VIDEO,
            "audioKey": AUDIO_KEY,
            "durationMs": 180_000,
            "ranges": [{"fromMs": 120_000, "toMs": 150_000}],
            "language": "auto",
            "simulation": {"sample": "talk", "force": None},
        },
    )
    assert result["noSpeech"] is True
    assert result["wordCount"] == 0


def test_a_binding_that_is_off_fails_at_once(make_settings: Callable[..., Settings]) -> None:
    reset_transcribers()
    with pytest.raises(ApplicationError) as caught:
        get_transcriber(make_settings(media_simulation=False, transcriber="groq"))
    assert caught.value.type == "MEDIA_BINDING_OFF"
    assert caught.value.non_retryable is True
