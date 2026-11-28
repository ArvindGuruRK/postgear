"""The transcription service with a fake listener: cutting, shifting, seams, resume."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import pytest
from temporalio.exceptions import ApplicationError

from postgear_media.contract.generated import HeardFile, MediaPyTranscribeInput
from postgear_media.core.storage import LocalPrivateStorage
from postgear_media.providers.transcribe.base import Heard, ListenRequest, Word
from postgear_media.services.audio import read_facts
from postgear_media.services.speech_track import speech_values
from postgear_media.services.transcribe import (
    TranscribeDeps,
    heard_key,
    plan_chunks,
    stitch,
    transcribe,
)
from tests.helpers import AUDIO_KEY, JOB, ORG, VIDEO, write_wav


class FakeListener:
    """Says one word a second into each chunk, and remembers what it was asked."""

    name = "fake:1"

    def __init__(self, max_chunk_ms: int = 60_000, fail_on_call: int | None = None) -> None:
        self.max_chunk_ms = max_chunk_ms
        self.fail_on_call = fail_on_call
        self.requests: list[tuple[int, int, int]] = []
        self.languages: list[str | None] = []

    def listen(self, request: ListenRequest) -> Heard:
        chunk = request.chunk
        frames = read_facts(chunk.path).frames
        self.requests.append((chunk.from_ms, chunk.to_ms, frames))
        self.languages.append(request.language)
        if self.fail_on_call is not None and len(self.requests) == self.fail_on_call:
            raise ApplicationError("boom", type="MEDIA_TOOL_FAILED")
        request.checkpoint()
        words = [
            Word(start=ms, end=ms + 400, text=f"w{(chunk.from_ms + ms) // 1000}", sure=0.9)
            for ms in range(0, chunk.length_ms, 1000)
        ]
        return Heard(words=words, language="en", language_probability=0.9)


def make_deps(tmp_path: Path, listener: Any, *, simulated: bool = False) -> TranscribeDeps:
    return TranscribeDeps(
        storage=LocalPrivateStorage(tmp_path / "private"),
        transcriber=listener,
        scratch_root=tmp_path / "scratch",
        checkpoint=lambda _details: None,
        simulated=simulated,
    )


def make_payload(ranges: list[tuple[int, int]], **overrides: Any) -> MediaPyTranscribeInput:
    body: dict[str, Any] = {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "videoId": VIDEO,
        "audioKey": AUDIO_KEY,
        "durationMs": 300_000,
        "ranges": [{"fromMs": a, "toMs": b} for a, b in ranges],
        "language": "auto",
        "ownMachineOnly": False,
        "simulation": None,
    }
    body.update(overrides)
    return MediaPyTranscribeInput.model_validate(body)


def store_audio(deps: TranscribeDeps, tmp_path: Path, seconds: float = 300) -> None:
    deps.storage.put_file(write_wav(tmp_path / "in.wav", seconds), AUDIO_KEY, "audio/wav")


def read_heard(deps: TranscribeDeps, tmp_path: Path, key: str) -> HeardFile:
    target = tmp_path / "heard.json.gz"
    deps.storage.get_to_file(key, target)
    with gzip.open(target, "rt", encoding="utf-8") as handle:
        return HeardFile.model_validate(json.load(handle))


def speech_of(heard: HeardFile) -> list[float | None]:
    """The speech curve as plain numbers (the generated model wraps each value)."""
    values: list[float | None] = heard.model_dump(mode="json")["speech"]["values"]
    return values


def test_words_come_back_in_the_videos_time_inside_the_asked_stretch(tmp_path: Path) -> None:
    listener = FakeListener()
    deps = make_deps(tmp_path, listener, simulated=True)
    store_audio(deps, tmp_path)
    result = transcribe(make_payload([(60_000, 120_000)]), deps)

    assert listener.requests == [(60_000, 120_000, 60 * 16_000)]
    assert result.word_count == 60
    assert result.no_speech is False
    assert result.seconds_listened == 60
    assert result.model == "fake:1"
    heard = read_heard(deps, tmp_path, result.heard_key)
    assert heard.words[0].start == 60_000
    assert heard.words[0].text == "w60"
    assert all(60_000 <= word.start < 120_000 and word.end <= 120_000 for word in heard.words)
    assert [(r.from_ms, r.to_ms) for r in heard.ranges] == [(60_000, 120_000)]


def test_a_long_stretch_is_cut_into_chunks_and_every_word_is_kept_once(tmp_path: Path) -> None:
    listener = FakeListener(max_chunk_ms=60_000)
    deps = make_deps(tmp_path, listener)
    store_audio(deps, tmp_path)
    result = transcribe(make_payload([(0, 150_000)]), deps)

    # A real listener's chunks overlap by three seconds at each seam.
    assert [(a, b) for a, b, _ in listener.requests] == [
        (0, 60_000),
        (57_000, 117_000),
        (114_000, 150_000),
    ]
    heard = read_heard(deps, tmp_path, result.heard_key)
    starts = [word.start for word in heard.words]
    assert starts == sorted(starts)
    assert len(starts) == len(set(starts))
    # Nothing is lost at a seam: there is a word in every second.
    assert {start // 1000 for start in starts} == set(range(150))


def test_two_stretches_are_listened_to_apart_and_the_gap_is_not(tmp_path: Path) -> None:
    listener = FakeListener()
    deps = make_deps(tmp_path, listener, simulated=True)
    store_audio(deps, tmp_path)
    result = transcribe(make_payload([(0, 30_000), (120_000, 150_000)]), deps)
    heard = read_heard(deps, tmp_path, result.heard_key)
    assert [(a, b) for a, b, _ in listener.requests] == [(0, 30_000), (120_000, 150_000)]
    assert not [word for word in heard.words if 30_000 <= word.start < 120_000]
    values = speech_of(heard)
    assert len(values) == 600
    assert values[0] is not None and values[100] is None and values[250] is not None


def test_a_silent_stretch_is_no_speech_not_an_error(tmp_path: Path) -> None:
    class Silent(FakeListener):
        def listen(self, request: ListenRequest) -> Heard:
            super().listen(request)
            return Heard(words=[], language=None)

    deps = make_deps(tmp_path, Silent(), simulated=True)
    store_audio(deps, tmp_path)
    result = transcribe(make_payload([(0, 30_000)]), deps)
    assert result.no_speech is True
    assert result.word_count == 0
    assert result.language == "en"
    heard = read_heard(deps, tmp_path, result.heard_key)
    assert heard.words == []
    assert set(speech_of(heard)[:60]) == {0.0}


def test_a_retry_starts_at_the_first_unfinished_chunk(tmp_path: Path) -> None:
    failing = FakeListener(max_chunk_ms=60_000, fail_on_call=3)
    deps = make_deps(tmp_path, failing, simulated=True)
    store_audio(deps, tmp_path)
    payload = make_payload([(0, 180_000)])
    with pytest.raises(ApplicationError):
        transcribe(payload, deps)
    assert len(failing.requests) == 3
    # The attempt's own scratch folder is gone; only the finished chunks are kept.
    left = sorted(p.name for p in (tmp_path / "scratch").iterdir())
    assert left == [f"{JOB}-chunks"]

    again = FakeListener(max_chunk_ms=60_000)
    result = transcribe(payload, make_deps(tmp_path, again, simulated=True))
    assert [(a, b) for a, b, _ in again.requests] == [(120_000, 180_000)]
    assert result.word_count == 180
    assert list((tmp_path / "scratch").iterdir()) == []


def test_the_heard_file_key_is_the_same_for_every_attempt(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, FakeListener(), simulated=True)
    store_audio(deps, tmp_path)
    first = transcribe(make_payload([(0, 30_000)]), deps)
    second = transcribe(make_payload([(0, 30_000)]), deps)
    assert first.heard_key == second.heard_key == heard_key(ORG, VIDEO, JOB)


def test_an_asked_language_is_passed_on_and_auto_is_not(tmp_path: Path) -> None:
    listener = FakeListener()
    deps = make_deps(tmp_path, listener, simulated=True)
    store_audio(deps, tmp_path)
    asked = transcribe(make_payload([(0, 30_000)], language="ta"), deps)
    detected = transcribe(make_payload([(30_000, 60_000)], language="auto"), deps)
    assert listener.languages == ["ta", None]
    assert asked.language == "ta"
    assert asked.language_probability is None
    assert detected.language == "en"


def test_a_stretch_past_the_sound_is_held_to_what_exists(tmp_path: Path) -> None:
    listener = FakeListener()
    deps = make_deps(tmp_path, listener, simulated=True)
    store_audio(deps, tmp_path, seconds=45)
    result = transcribe(make_payload([(30_000, 60_000)]), deps)
    assert [(a, b) for a, b, _ in listener.requests] == [(30_000, 45_000)]
    assert result.seconds_listened == 15


@pytest.mark.parametrize(
    "ranges",
    [[(30_000, 60_000), (0, 30_000)], [(0, 40_000), (30_000, 60_000)], [(400_000, 420_000)]],
)
def test_bad_ranges_are_refused_before_any_listening(
    tmp_path: Path, ranges: list[tuple[int, int]]
) -> None:
    listener = FakeListener()
    deps = make_deps(tmp_path, listener)
    store_audio(deps, tmp_path)
    with pytest.raises(ApplicationError) as caught:
        transcribe(make_payload(ranges), deps)
    assert caught.value.type == "MEDIA_BAD_INPUT"
    assert caught.value.non_retryable is True
    assert listener.requests == []


def test_a_missing_sound_is_not_retried(tmp_path: Path) -> None:
    with pytest.raises(ApplicationError) as caught:
        transcribe(make_payload([(0, 30_000)]), make_deps(tmp_path, FakeListener()))
    assert caught.value.type == "MEDIA_KEY_NOT_FOUND"
    assert caught.value.non_retryable is True


def test_a_file_that_is_not_sound_is_bad_audio(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, FakeListener())
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"not a wav at all")
    deps.storage.put_file(junk, AUDIO_KEY, "audio/wav")
    with pytest.raises(ApplicationError) as caught:
        transcribe(make_payload([(0, 30_000)]), deps)
    assert caught.value.type == "MEDIA_BAD_AUDIO"


def test_cancel_reaches_the_service_between_chunks(tmp_path: Path) -> None:
    class StopError(Exception):
        pass

    calls = 0

    def checkpoint(_details: dict[str, Any] | None) -> None:
        nonlocal calls
        calls += 1
        if calls == 4:
            raise StopError

    listener = FakeListener(max_chunk_ms=30_000)
    deps = TranscribeDeps(
        storage=LocalPrivateStorage(tmp_path / "private"),
        transcriber=listener,
        scratch_root=tmp_path / "scratch",
        checkpoint=checkpoint,
        simulated=True,
    )
    store_audio(deps, tmp_path)
    with pytest.raises(StopError):
        transcribe(make_payload([(0, 300_000)]), deps)
    assert len(listener.requests) < 10


def test_plan_chunks_and_stitch() -> None:
    assert plan_chunks([(0, 100)], 1_000, 0) == [(0, 100)]
    assert plan_chunks([(0, 25_000)], 10_000, 0) == [
        (0, 10_000),
        (10_000, 20_000),
        (20_000, 25_000),
    ]
    left = [Word(9_000, 9_400, "left", 1), Word(9_800, 10_000, "seam", 1)]
    right = [
        Word(9_000, 9_300, "dup", 1),
        Word(9_800, 10_200, "seam", 1),
        Word(11_000, 11_300, "x", 1),
    ]
    joined = stitch([((0, 10_500), left), ((8_500, 20_000), right)])
    # The seam is at 9,500: the left chunk keeps what is before it, the right the rest.
    assert [word.text for word in joined] == ["left", "seam", "x"]


def test_speech_values_are_two_a_second_and_none_where_nothing_listened() -> None:
    words = [Word(1_000, 1_500, "a", 1.0), Word(1_500, 1_750, "b", 0.5)]
    values = speech_values(words, [(1_000, 3_000)], 4_000)
    assert len(values) == 8
    assert values[:2] == [None, None]
    assert values[2] == 1.0
    assert values[3] == 0.25
    assert values[4:6] == [0.0, 0.0]
    assert values[6:] == [None, None]
