"""Security sweep, Speech text and Secrets on the Python side (Sprint 13, Module 16).

A known sentence is heard, or spoken, through the real activity wrappers, and
everything the process could keep is searched for it: the structured log
events (before any field is hidden), the standard library's log records
(Temporal's SDK logs a failed activity with its traceback), what reaches
stderr, the activity's answer, and the failure Temporal would store (its
message and its whole cause chain). The same is done for the hosted
listener's key and the internal token.

Existing proof this builds on: `test_speech_service.py` (a bad text file never
shows its text; the payload never carries the line) and the contract tests
(no activity answer carries words or boxes).
"""

from __future__ import annotations

import json
import logging
import traceback
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import structlog
from structlog.testing import capture_logs
from temporalio.api.failure.v1 import Failure
from temporalio.converter import DataConverter
from temporalio.exceptions import ApplicationError
from temporalio.testing import ActivityEnvironment

from postgear_media.activities.base import logged, plain_failure
from postgear_media.activities.speech import media_py_speak
from postgear_media.activities.transcribe import media_py_transcribe
from postgear_media.core.keys import InvalidKeyError
from postgear_media.core.logging import FORBIDDEN_FIELDS, _drop_forbidden
from postgear_media.core.settings import Settings
from postgear_media.core.storage import LocalPrivateStorage, create_private_storage
from postgear_media.providers.speech.base import Spoken, Voice
from postgear_media.providers.transcribe.base import Chunk, Heard, ListenRequest, Word
from postgear_media.providers.transcribe.groq import GroqTranscriber
from tests import test_speech_service as speech_tests
from tests.helpers import AUDIO_KEY, JOB, ORG, VIDEO, write_wav

SENTENCE = "Purple elephants dance at midnight beside the river"
GROQ_KEY = "gsk_live_secret_key_0f1e2d3c4b5a69788796a5b4"
TOKEN = "media-internal-token-" + "9" * 43


@pytest.fixture
def seen(
    caplog: pytest.LogCaptureFixture, capsys: pytest.CaptureFixture[str]
) -> Iterator[Callable[[], str]]:
    """Everything logged or printed while the test runs, as one text to search."""
    caplog.set_level(logging.DEBUG)
    with capture_logs() as events:

        def text() -> str:
            out, err = capsys.readouterr()
            records = [
                f"{record.getMessage()} {record.exc_text or ''} {record.exc_info!r}"
                for record in caplog.records
            ]
            return "\n".join([json.dumps(events, default=str), *records, out, err])

        yield text


def chain(error: BaseException) -> str:
    """What leaves the process for `error`: Temporal's stored failure and the printed traceback.

    Both follow the cause, and the context unless it was suppressed (`from None`),
    so this reads exactly what they read.
    """
    failure = Failure()
    DataConverter.default.failure_converter.to_failure(
        error, DataConverter.default.payload_converter, failure
    )
    printed = "".join(traceback.format_exception(error))
    return f"{failure}\n{printed}"


class SentenceListener:
    """Hears the known sentence in every chunk, or fails with it in its message."""

    name = "fake"
    max_chunk_ms = 60_000

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def listen(self, request: ListenRequest) -> Heard:  # noqa: ARG002 - the protocol's shape
        if self.fail:
            raise RuntimeError(f"decoder choked on: {SENTENCE}")
        words = [
            Word(start=index * 500, end=index * 500 + 400, text=word, sure=0.9)
            for index, word in enumerate(SENTENCE.split())
        ]
        return Heard(words=words, language="en", language_probability=0.9)


def listen_payload() -> dict[str, Any]:
    return {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "videoId": VIDEO,
        "audioKey": AUDIO_KEY,
        "durationMs": 60_000,
        "ranges": [{"fromMs": 0, "toMs": 30_000}],
        "language": "auto",
        "simulation": None,
    }


@pytest.fixture
def listening(
    make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Callable[[SentenceListener], Settings]:
    def arrange(listener: SentenceListener) -> Settings:
        settings = make_settings(media_simulation=False, media_internal_token=TOKEN)
        monkeypatch.setattr("postgear_media.activities.transcribe.get_settings", lambda: settings)
        monkeypatch.setattr(
            "postgear_media.activities.transcribe.get_transcriber", lambda _s: listener
        )
        monkeypatch.setattr("postgear_media.activities.transcribe.get_hosted_lane", lambda _s: None)
        create_private_storage(settings).put_file(
            write_wav(tmp_path / "a.wav", 60), AUDIO_KEY, "audio/wav"
        )
        return settings

    return arrange


# --- Speech text --------------------------------------------------------------------------


def test_a_listen_logs_and_answers_counts_never_a_word(
    listening: Callable[[SentenceListener], Settings], seen: Callable[[], str]
) -> None:
    listening(SentenceListener())
    result = ActivityEnvironment().run(media_py_transcribe, listen_payload())
    assert result["wordCount"] == len(SENTENCE.split())
    printed = seen()
    assert "activity.end" in printed
    for word in ("Purple", "elephants", "midnight", SENTENCE):
        assert word not in printed
        assert word not in json.dumps(result)


def test_a_library_failure_that_repeats_the_speech_never_reaches_temporal_or_a_log(
    listening: Callable[[SentenceListener], Settings], seen: Callable[[], str]
) -> None:
    listening(SentenceListener(fail=True))
    with pytest.raises(ApplicationError) as caught:
        ActivityEnvironment().run(media_py_transcribe, listen_payload())
    assert caught.value.type == "MEDIA_TOOL_FAILED"
    assert caught.value.non_retryable is False
    # No cause chain: Temporal encodes and stores the causes as well.
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__ is True
    assert SENTENCE not in chain(caught.value)
    assert "RuntimeError" in str(caught.value)
    assert SENTENCE not in seen()


def test_a_failed_voice_never_shows_its_line(
    make_settings: Callable[..., Settings],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    seen: Callable[[], str],
) -> None:
    settings = make_settings(media_simulation=True, media_internal_token=TOKEN)
    monkeypatch.setattr("postgear_media.activities.speech.get_settings", lambda: settings)

    class Choking:
        name = "choking"

        def voices(self) -> tuple[Voice, ...]:
            return (Voice(id="sim-river", name="River", languages=("en",)),)

        def speak(
            self,
            text: str,
            voice_id: str,
            tick: Callable[[], None] | None = None,  # noqa: ARG002 - the protocol's shape
        ) -> Spoken:
            raise ValueError(f"could not say {text!r} in {voice_id}")

    monkeypatch.setattr("postgear_media.activities.speech.get_speaker", lambda _s: Choking())
    storage = create_private_storage(settings)
    assert isinstance(storage, LocalPrivateStorage)
    speech_tests.store_text(storage, tmp_path, SENTENCE)
    with pytest.raises(ApplicationError) as caught:
        ActivityEnvironment().run(media_py_speak, speech_tests.payload())
    assert SENTENCE not in chain(caught.value)
    assert SENTENCE not in seen()
    # The attempt's scratch folder went with it.
    assert list(settings.scratch_root.iterdir()) == []


def test_our_own_failures_keep_their_sentence_and_type() -> None:
    def refuse() -> None:
        raise ApplicationError("The analysis sound is not in storage", type="MEDIA_KEY_NOT_FOUND")

    with pytest.raises(ApplicationError) as caught:
        logged("mediaPyTranscribe", JOB, refuse)
    assert caught.value.type == "MEDIA_KEY_NOT_FOUND"
    assert caught.value.message == "The analysis sound is not in storage"


def test_a_key_that_is_not_ours_is_a_bad_input_and_never_retried() -> None:
    failure = plain_failure("mediaPyStills", InvalidKeyError(f"clips/{SENTENCE}"))
    assert failure.type == "MEDIA_BAD_INPUT"
    assert failure.non_retryable is True
    assert SENTENCE not in str(failure)


def test_the_log_processor_hides_every_field_that_could_hold_speech_or_a_secret() -> None:
    event: dict[str, Any] = {name: SENTENCE for name in FORBIDDEN_FIELDS}
    event.update({"Text": SENTENCE, "API_KEY": GROQ_KEY, "job_id": JOB})
    cleaned = _drop_forbidden(None, "info", event)
    assert SENTENCE not in json.dumps(dict(cleaned))
    assert GROQ_KEY not in json.dumps(dict(cleaned))
    assert cleaned["job_id"] == JOB
    for name in ("text", "transcript", "words", "token", "api_key", "url"):
        assert name in FORBIDDEN_FIELDS


def test_a_logger_handed_the_words_by_mistake_prints_them_hidden(
    capsys: pytest.CaptureFixture[str],
) -> None:
    from postgear_media.core.logging import configure_logging, get_logger  # noqa: PLC0415

    structlog.reset_defaults()
    configure_logging(production=True)
    try:
        get_logger("test").info("oops", text=SENTENCE, words=SENTENCE.split(), api_key=GROQ_KEY)
        printed = capsys.readouterr().err
    finally:
        structlog.reset_defaults()
    assert "oops" in printed
    assert SENTENCE not in printed
    assert "Purple" not in printed
    assert GROQ_KEY not in printed


# --- Secrets: the hosted listener's key and the internal token ------------------------------


def groq_with(status: int, tmp_path: Path) -> tuple[GroqTranscriber, ListenRequest]:
    def answer(request: httpx.Request) -> httpx.Response:
        # A service that repeats what it was sent, the key and the words.
        echoed = {"error": f"bad key {request.headers.get('authorization')} for {SENTENCE}"}
        return httpx.Response(status, json=echoed, headers={"retry-after": "0"})

    client = httpx.Client(transport=httpx.MockTransport(answer))
    listener = GroqTranscriber(GROQ_KEY, client=client, sleep=lambda _s: None)
    chunk = Chunk(path=write_wav(tmp_path / "chunk.wav", 1), from_ms=0, to_ms=1_000)
    request = ListenRequest(
        chunk=chunk, language=None, sample=None, force=None, checkpoint=lambda: None
    )
    return listener, request


@pytest.mark.parametrize("status", [401, 403, 429, 500, 400])
def test_the_hosted_listener_never_repeats_its_key_or_what_the_service_said(
    tmp_path: Path, status: int, seen: Callable[[], str]
) -> None:
    listener, request = groq_with(status, tmp_path)
    with pytest.raises(ApplicationError) as caught:
        listener.listen(request)
    text = chain(caught.value)
    assert GROQ_KEY not in text
    assert SENTENCE not in text
    assert GROQ_KEY not in seen()


def test_settings_never_print_the_key_or_the_token(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings(groq_api_key=GROQ_KEY, media_internal_token=TOKEN)
    for shown in (repr(settings), str(settings), settings.model_dump_json()):
        assert GROQ_KEY not in shown
        assert TOKEN not in shown
    assert settings.groq_api_key is not None
    assert settings.groq_api_key.get_secret_value() == GROQ_KEY


def test_a_production_boot_refusal_never_repeats_a_value(
    make_settings: Callable[..., Settings],
) -> None:
    from pydantic import ValidationError  # noqa: PLC0415

    with pytest.raises(ValidationError) as caught:
        make_settings(node_env="production", media_simulation=True, groq_api_key=GROQ_KEY)
    assert GROQ_KEY not in str(caught.value)
