"""The hosted lane against recorded answers, and the Whisper binding with a stand-in model."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from temporalio.exceptions import ApplicationError

from postgear_media.providers.transcribe.base import Chunk, ListenRequest, Word
from postgear_media.providers.transcribe.faster_whisper import (
    FasterWhisperTranscriber,
    collapse_repeats,
)
from postgear_media.providers.transcribe.groq import GROQ_URL, GroqTranscriber, words_from_answer
from tests.helpers import write_wav

ANSWER = {
    "language": "English",
    "words": [
        {"word": " Hello", "start": 0.2, "end": 0.6},
        {"word": "there.", "start": 0.7, "end": 1.1},
        {"word": "late", "start": 29.9, "end": 31.5},
        {"word": "gone", "start": 31.0, "end": 31.4},
        {"word": "  ", "start": 2.0, "end": 2.2},
    ],
    "segments": [
        {"start": 0.0, "end": 1.2, "avg_logprob": -0.2},
        {"start": 29.0, "end": 32.0, "avg_logprob": -1.4},
    ],
}


def groq_with(handler: Any, tmp_path: Path) -> tuple[GroqTranscriber, ListenRequest, list[float]]:
    pauses: list[float] = []
    listener = GroqTranscriber(
        "gsk-test",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=pauses.append,
    )
    chunk = Chunk(path=write_wav(tmp_path / "chunk.wav", 1), from_ms=60_000, to_ms=90_000)
    return listener, ListenRequest(chunk=chunk, language=None), pauses


def test_groq_answer_becomes_words_inside_the_chunk() -> None:
    words = words_from_answer(ANSWER, 30_000)
    assert [(w.text, w.start, w.end, w.sure) for w in words] == [
        ("Hello", 200, 600, 1.0),
        ("there.", 700, 1100, 1.0),
        # Held to the chunk's end, and unsure because its segment was unlikely as text.
        ("late", 29_900, 30_000, 0.5),
    ]


def test_groq_sends_the_chunk_with_word_timings_and_the_key(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=ANSWER)

    listener, request, _ = groq_with(handler, tmp_path)
    heard = listener.listen(request)
    assert heard.language == "en"
    assert len(heard.words) == 3
    assert str(seen[0].url) == GROQ_URL
    assert seen[0].headers["authorization"] == "Bearer gsk-test"
    body = seen[0].content
    assert b"whisper-large-v3-turbo" in body
    assert b"verbose_json" in body
    assert b'name="timestamp_granularities[]"' in body
    assert b"RIFF" in body


def test_groq_waits_and_tries_again_when_the_service_is_busy(tmp_path: Path) -> None:
    answers = [
        httpx.Response(429, headers={"retry-after": "7"}),
        httpx.Response(503),
        httpx.Response(200, json=ANSWER),
    ]

    def handler(_request: httpx.Request) -> httpx.Response:
        return answers.pop(0)

    listener, request, pauses = groq_with(handler, tmp_path)
    assert len(listener.listen(request).words) == 3
    assert pauses == [7.0, 4.0]


def test_groq_gives_up_after_its_tries_with_a_retryable_error(tmp_path: Path) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503)

    listener, request, _ = groq_with(handler, tmp_path)
    with pytest.raises(ApplicationError) as caught:
        listener.listen(request)
    assert calls == 4
    assert caught.value.type == "MEDIA_TOOL_FAILED"
    assert caught.value.non_retryable is False


def test_groq_does_not_retry_a_refused_key_or_an_unreadable_file(tmp_path: Path) -> None:
    for status, kind in ((401, "MEDIA_BINDING_OFF"), (400, "MEDIA_BAD_AUDIO")):
        calls = 0

        def handler(_request: httpx.Request, status: int = status) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(status, json={"error": {"message": "secret detail"}})

        listener, request, _ = groq_with(handler, tmp_path)
        with pytest.raises(ApplicationError) as caught:
            listener.listen(request)
        assert calls == 1
        assert caught.value.type == kind
        assert caught.value.non_retryable is True
        assert "secret detail" not in str(caught.value)


def test_groq_a_dropped_connection_is_tried_again(tmp_path: Path) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("reset", request=request)
        return httpx.Response(200, json=ANSWER)

    listener, request, pauses = groq_with(handler, tmp_path)
    assert len(listener.listen(request).words) == 3
    assert pauses == [2.0]


def test_a_decoding_loop_is_kept_three_times_at_most() -> None:
    words = [Word(i * 100, i * 100 + 50, "thanks", 1) for i in range(8)]
    words.append(Word(900, 950, "bye", 1))
    assert [w.text for w in collapse_repeats(words)] == ["thanks", "thanks", "thanks", "bye"]


def test_whisper_reads_segments_into_words_and_drops_likely_silence(tmp_path: Path) -> None:
    asked: dict[str, Any] = {}

    class StandInModel:
        def transcribe(self, audio: Any, **options: Any) -> tuple[Any, Any]:
            asked.update(options)
            asked["samples"] = len(audio)
            spoken = SimpleNamespace(
                no_speech_prob=0.1,
                avg_logprob=-0.3,
                words=[
                    SimpleNamespace(word=" Hello", start=0.5, end=0.9, probability=0.97),
                    SimpleNamespace(word=" world.", start=1.0, end=1.4, probability=0.42),
                    SimpleNamespace(word=" past", start=2.5, end=2.9, probability=0.9),
                ],
            )
            silence = SimpleNamespace(
                no_speech_prob=0.9,
                avg_logprob=-1.6,
                words=[SimpleNamespace(word=" Subtitles", start=1.5, end=1.9, probability=0.2)],
            )
            info = SimpleNamespace(language="en", language_probability=0.98)
            return iter([spoken, silence]), info

    pytest.importorskip("numpy", reason="the ml group is not installed")
    listener = FasterWhisperTranscriber("small", tmp_path / "models", local_files_only=True)
    listener._model = StandInModel()
    chunk = Chunk(path=write_wav(tmp_path / "c.wav", 2), from_ms=0, to_ms=2_000)
    ticks = 0

    def tick() -> None:
        nonlocal ticks
        ticks += 1

    heard = listener.listen(ListenRequest(chunk=chunk, language=None, checkpoint=tick))
    assert [(w.text, w.start, w.end, w.sure) for w in heard.words] == [
        ("Hello", 500, 900, 0.97),
        ("world.", 1000, 1400, 0.42),
    ]
    assert heard.language == "en"
    assert heard.language_probability == 0.98
    assert asked["word_timestamps"] is True
    assert asked["vad_filter"] is True
    assert asked["condition_on_previous_text"] is False
    assert asked["samples"] == 32_000
    assert ticks >= 2


def test_whisper_without_its_library_says_so(tmp_path: Path) -> None:
    try:
        import faster_whisper  # type: ignore[import-not-found,unused-ignore]  # noqa: F401, PLC0415
    except ImportError:
        listener = FasterWhisperTranscriber("small", tmp_path / "models", local_files_only=True)
        chunk = Chunk(path=write_wav(tmp_path / "c.wav", 1), from_ms=0, to_ms=1_000)
        with pytest.raises(RuntimeError, match="not installed"):
            listener.listen(ListenRequest(chunk=chunk, language=None))
    else:
        pytest.skip("the ml group is installed here")
