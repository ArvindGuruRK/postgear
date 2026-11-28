"""`TRANSCRIBER=auto` (Module 15): long jobs to the hosted lane, the rest and any failure to ours.

Fakes only: no test builds a Groq client that could send a request. Where the
factory would build one, `GroqTranscriber` is swapped for a stand-in first.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from temporalio.exceptions import ApplicationError, CancelledError

from postgear_media.activities.health import health_report, hosted_lane
from postgear_media.contract.generated import MediaPyHealthOutput, MediaPyTranscribeInput
from postgear_media.core.settings import DEFAULT_HOSTED_ABOVE_MINUTES, Settings
from postgear_media.core.storage import LocalPrivateStorage
from postgear_media.main import create_app
from postgear_media.providers import factory
from postgear_media.providers.factory import (
    build_provider_table,
    get_hosted_lane,
    get_transcriber,
    reset_transcribers,
)
from postgear_media.providers.transcribe.base import Heard, HostedLane, ListenRequest, Word
from postgear_media.services.transcribe import TranscribeDeps, lane_for, transcribe
from tests.helpers import AUDIO_KEY, JOB, ORG, VIDEO, write_wav

TOKEN = "b" * 64
MINUTE = 60_000


class FakeListener:
    """One word a second, and a record of every chunk it was handed."""

    def __init__(
        self,
        name: str,
        max_chunk_ms: int = 10 * MINUTE,
        fail: Exception | None = None,
        fail_from: int = 1,
    ) -> None:
        self.name = name
        self.max_chunk_ms = max_chunk_ms
        self.fail = fail
        self.fail_from = fail_from
        self.chunks: list[tuple[int, int]] = []

    def listen(self, request: ListenRequest) -> Heard:
        self.chunks.append((request.chunk.from_ms, request.chunk.to_ms))
        if self.fail is not None and len(self.chunks) >= self.fail_from:
            raise self.fail
        words = [
            Word(start=ms, end=ms + 400, text="spoken", sure=0.9)
            for ms in range(0, request.chunk.length_ms, 1000)
        ]
        return Heard(words=words, language="en", language_probability=0.9)


class Recorder:
    """Stands in for the service's logger: keeps each line's event and fields."""

    def __init__(self) -> None:
        self.lines: list[tuple[str, dict[str, Any]]] = []

    def warning(self, event: str, **fields: Any) -> None:
        self.lines.append((event, fields))

    info = warning


def deps_with(
    tmp_path: Path,
    own: FakeListener,
    hosted: FakeListener | None,
    above_minutes: int = 2,
) -> TranscribeDeps:
    return TranscribeDeps(
        storage=LocalPrivateStorage(tmp_path / "private"),
        transcriber=own,
        scratch_root=tmp_path / "scratch",
        checkpoint=lambda _details: None,
        simulated=False,
        hosted=None if hosted is None else HostedLane(hosted, above_minutes * MINUTE),
    )


def payload_for(
    to_ms: int, duration_ms: int = 10 * MINUTE, *, own_machine_only: bool = False
) -> MediaPyTranscribeInput:
    return MediaPyTranscribeInput.model_validate(
        {
            "version": 1,
            "jobId": JOB,
            "orgId": ORG,
            "videoId": VIDEO,
            "audioKey": AUDIO_KEY,
            "durationMs": duration_ms,
            "ranges": [{"fromMs": 0, "toMs": to_ms}],
            "language": "auto",
            "ownMachineOnly": own_machine_only,
            "simulation": None,
        },
    )


def store_audio(deps: TranscribeDeps, tmp_path: Path, seconds: float = 600) -> None:
    deps.storage.put_file(write_wav(tmp_path / "in.wav", seconds), AUDIO_KEY, "audio/wav")


@pytest.fixture(autouse=True)
def _fresh_listeners() -> None:
    reset_transcribers()


@pytest.fixture
def fake_groq(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Swaps the Groq listener for a stand-in that records the key it was given."""
    built: list[str] = []

    class StandIn(FakeListener):
        def __init__(self, api_key: str) -> None:
            super().__init__("groq:stand-in")
            built.append(api_key)

    monkeypatch.setattr("postgear_media.providers.transcribe.groq.GroqTranscriber", StandIn)
    return built


# The routing rule.


def test_the_threshold_comes_from_module_02s_benchmark(
    make_settings: Callable[..., Settings],
) -> None:
    # (600 - 4.7) / 0.17 x 297 / 300 is about 57.8 minutes, rounded down.
    assert DEFAULT_HOSTED_ABOVE_MINUTES == 55
    assert make_settings().transcribe_hosted_above_minutes == 55
    assert make_settings(transcribe_hosted_above_minutes=20).transcribe_hosted_above_minutes == 20


def test_the_threshold_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRANSCRIBE_HOSTED_ABOVE_MINUTES", "30")
    assert Settings(_env_file=None).transcribe_hosted_above_minutes == 30


def test_a_job_up_to_the_threshold_stays_on_our_machine_and_a_longer_one_goes_hosted(
    tmp_path: Path,
) -> None:
    own, hosted = FakeListener("own"), FakeListener("hosted")
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    assert lane_for(2 * MINUTE, deps) == (own, None)
    assert lane_for(2 * MINUTE + 1, deps) == (hosted, own)
    # Without a hosted lane every job is the bound listener alone.
    assert lane_for(600 * MINUTE, deps_with(tmp_path, own, None)) == (own, None)


# Module 17 item 26: a workspace that keeps speech on our own machine.


def test_a_workspace_that_keeps_speech_here_never_takes_the_hosted_lane(tmp_path: Path) -> None:
    own, hosted = FakeListener("own"), FakeListener("hosted")
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    assert lane_for(600 * MINUTE, deps, own_machine_only=True) == (own, None)
    assert lane_for(MINUTE, deps, own_machine_only=True) == (own, None)


def test_a_long_job_that_must_stay_here_is_heard_by_our_machine(tmp_path: Path) -> None:
    own, hosted = FakeListener("own", max_chunk_ms=5 * MINUTE), FakeListener("hosted")
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    result = transcribe(payload_for(6 * MINUTE, own_machine_only=True), deps)

    assert hosted.chunks == []
    # Our machine hears the whole six minutes, in its own (overlapping) chunks.
    assert own.chunks[0][0] == 0 and own.chunks[-1][1] == 6 * MINUTE
    assert result.model == "own"


def test_with_a_hosted_listener_only_the_job_is_refused_before_any_sound_leaves(
    tmp_path: Path,
) -> None:
    groq = FakeListener("groq:whisper-large-v3-turbo")
    deps = deps_with(tmp_path, groq, None)
    store_audio(deps, tmp_path)
    with pytest.raises(ApplicationError) as refused:
        transcribe(payload_for(MINUTE, own_machine_only=True), deps)

    assert refused.value.type == "MEDIA_BINDING_OFF"
    assert refused.value.non_retryable
    assert groq.chunks == []
    # Without the switch the same service listens through Groq as before.
    assert transcribe(payload_for(MINUTE), deps).model == "groq:whisper-large-v3-turbo"


def test_a_long_job_is_heard_by_the_hosted_lane(tmp_path: Path) -> None:
    own, hosted = FakeListener("own", max_chunk_ms=5 * MINUTE), FakeListener("hosted")
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    result = transcribe(payload_for(6 * MINUTE), deps)

    assert hosted.chunks == [(0, 6 * MINUTE)]
    assert own.chunks == []
    assert result.model == "hosted"
    assert result.word_count == 360


def test_a_short_job_never_touches_the_hosted_lane(tmp_path: Path) -> None:
    own, hosted = FakeListener("own"), FakeListener("hosted")
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    result = transcribe(payload_for(MINUTE), deps)

    assert hosted.chunks == []
    assert own.chunks == [(0, MINUTE)]
    assert result.model == "own"


def test_a_hosted_failure_hands_the_whole_job_to_our_machine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    recorder = Recorder()
    monkeypatch.setattr("postgear_media.services.transcribe.log", recorder)
    own = FakeListener("own", max_chunk_ms=5 * MINUTE)
    hosted = FakeListener("hosted", fail=ApplicationError("busy", type="MEDIA_TOOL_FAILED"))
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    result = transcribe(payload_for(6 * MINUTE), deps)

    assert hosted.chunks == [(0, 6 * MINUTE)]
    assert own.chunks == [(0, 5 * MINUTE), (297_000, 6 * MINUTE)]
    assert result.model == "own"
    assert result.word_count == 360
    # One line, with ids, counts and a fixed code: never a word or the error's message.
    assert recorder.lines == [
        (
            "listen.fallback",
            {
                "job_id": JOB,
                "lane": "hosted",
                "to": "own",
                "reason": "MEDIA_TOOL_FAILED",
                "ranges": 1,
                "seconds": 360,
            },
        ),
    ]
    assert "spoken" not in repr(recorder.lines)
    assert "busy" not in repr(recorder.lines)
    # Nothing is left behind once the job is done.
    assert list((tmp_path / "scratch").iterdir()) == []


def test_any_hosted_failure_falls_back_not_only_temporal_errors(tmp_path: Path) -> None:
    own = FakeListener("own")
    hosted = FakeListener("hosted", fail=OSError("socket"))
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    assert transcribe(payload_for(6 * MINUTE), deps).model == "own"


def test_a_cancel_is_never_a_reason_to_fall_back(tmp_path: Path) -> None:
    own = FakeListener("own")
    hosted = FakeListener("hosted", fail=CancelledError("The caller cancelled this step"))
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    with pytest.raises(CancelledError):
        transcribe(payload_for(6 * MINUTE), deps)
    assert own.chunks == []


def test_when_our_machine_fails_after_the_hosted_lane_the_job_fails(tmp_path: Path) -> None:
    own = FakeListener("own", fail=ApplicationError("no", type="MEDIA_TOOL_FAILED"))
    hosted = FakeListener("hosted", fail=ApplicationError("no", type="MEDIA_BINDING_OFF"))
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    with pytest.raises(ApplicationError) as caught:
        transcribe(payload_for(6 * MINUTE), deps)
    assert caught.value.type == "MEDIA_TOOL_FAILED"


def test_each_lane_keeps_its_own_finished_chunks_for_the_next_attempt(tmp_path: Path) -> None:
    hosted = FakeListener("groq:turbo", max_chunk_ms=4 * MINUTE, fail=OSError(), fail_from=2)
    own = FakeListener("own:1", max_chunk_ms=5 * MINUTE, fail=OSError(), fail_from=2)
    deps = deps_with(tmp_path, own, hosted, above_minutes=2)
    store_audio(deps, tmp_path)
    with pytest.raises(OSError):
        transcribe(payload_for(6 * MINUTE), deps)
    # Each finished its first chunk, kept apart (they cut the stretch differently),
    # in folders named safely for any file system.
    done = tmp_path / "scratch" / f"{JOB}-chunks"
    assert sorted(p.name for p in done.iterdir()) == ["groq-turbo", "own-1"]
    assert [p.name for p in (done / "groq-turbo").iterdir()] == ["0-240000.json"]
    assert [p.name for p in (done / "own-1").iterdir()] == ["0-300000.json"]

    # The next attempt resumes the hosted lane where it stopped.
    again = FakeListener("groq:turbo", max_chunk_ms=4 * MINUTE)
    retry = deps_with(tmp_path, FakeListener("own:1", max_chunk_ms=5 * MINUTE), again, 2)
    result = transcribe(payload_for(6 * MINUTE), retry)
    assert again.chunks == [(237_000, 6 * MINUTE)]
    assert result.model == "groq:turbo"
    assert not done.exists()


# What the factory, the health report and `/ready` say.


def test_auto_reports_our_machine_and_the_hosted_lane(
    make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(factory, "_installed", lambda module: module == "faster_whisper")
    table = build_provider_table(make_settings(transcriber="auto", groq_api_key="k"))
    assert (table.transcriber.state, table.transcriber.name) == ("live", "auto")
    assert (table.hosted_transcriber.state, table.hosted_transcriber.name) == ("live", "groq")
    assert table.hosted_above_minutes == 55


def test_auto_without_the_key_is_always_our_machine(
    make_settings: Callable[..., Settings], fake_groq: list[str]
) -> None:
    settings = make_settings(transcriber="auto")
    table = build_provider_table(settings)
    assert table.hosted_transcriber.state == "off"
    assert table.hosted_above_minutes is None
    assert get_hosted_lane(settings) is None
    assert fake_groq == []


def test_the_key_alone_never_turns_the_lane_on(
    make_settings: Callable[..., Settings], fake_groq: list[str]
) -> None:
    settings = make_settings(transcriber="faster-whisper", groq_api_key="k")
    assert build_provider_table(settings).hosted_transcriber.state == "off"
    assert get_hosted_lane(settings) is None
    assert fake_groq == []


def test_groq_alone_sends_every_job(make_settings: Callable[..., Settings]) -> None:
    table = build_provider_table(make_settings(transcriber="groq", groq_api_key="k"))
    assert table.hosted_transcriber.state == "live"
    assert table.hosted_above_minutes == 0


def test_simulation_wins_over_auto_and_a_key(
    make_settings: Callable[..., Settings], fake_groq: list[str]
) -> None:
    settings = make_settings(media_simulation=True, transcriber="auto", groq_api_key="k")
    table = build_provider_table(settings)
    assert table.transcriber.state == table.hosted_transcriber.state == "simulation"
    assert table.hosted_above_minutes is None
    assert get_hosted_lane(settings) is None
    assert hosted_lane(settings) is None
    assert fake_groq == []


def test_the_hosted_lane_is_built_once_with_its_threshold(
    make_settings: Callable[..., Settings], fake_groq: list[str]
) -> None:
    settings = make_settings(
        transcriber="auto", groq_api_key="k", transcribe_hosted_above_minutes=20
    )
    first = get_hosted_lane(settings)
    second = get_hosted_lane(settings)
    assert first is not None and second is not None
    assert first.above_ms == 20 * MINUTE
    assert first.transcriber is second.transcriber
    assert fake_groq == ["k"]


def test_auto_with_our_machine_missing_fails_at_once_naming_it(
    make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(factory, "_installed", lambda _module: False)
    with pytest.raises(ApplicationError) as caught:
        get_transcriber(make_settings(transcriber="auto", groq_api_key="k"))
    assert caught.value.type == "MEDIA_BINDING_OFF"
    assert "faster-whisper" in str(caught.value)


def test_the_health_report_carries_both_listeners(
    make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(factory, "_installed", lambda module: module == "faster_whisper")
    report = health_report(make_settings(transcriber="auto", groq_api_key="secret-key"))
    wire = report.model_dump(by_alias=True, mode="json")
    assert wire["bindings"]["transcriber"] == {"state": "live", "name": "auto"}
    assert wire["bindings"]["hostedTranscriber"] == {"state": "live", "name": "groq"}
    assert wire["hostedAboveMinutes"] == 55
    # The answer is the contract's shape, and the key is nowhere in it.
    MediaPyHealthOutput.model_validate(wire)
    assert "secret-key" not in report.model_dump_json()


def test_ready_says_where_long_speech_goes(make_settings: Callable[..., Settings]) -> None:
    on = make_settings(media_internal_token=TOKEN, transcriber="auto", groq_api_key="secret")
    off = make_settings(media_internal_token=TOKEN, transcriber="auto")
    headers = {"X-PostGear-Internal": TOKEN}
    with TestClient(create_app(on)) as client:
        answer = client.get("/ready", headers=headers)
    with TestClient(create_app(off)) as client:
        quiet = client.get("/ready", headers=headers)
    assert answer.json()["hostedLane"] == {"provider": "groq", "aboveMinutes": 55}
    assert "secret" not in answer.text
    assert quiet.json()["hostedLane"] is None
