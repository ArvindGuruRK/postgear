"""The recorded transcripts the simulated listener answers from."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from temporalio.exceptions import ApplicationError

from postgear_media.core.settings import REPO_ROOT
from postgear_media.providers.transcribe.base import Chunk, ListenRequest
from postgear_media.providers.transcribe.simulation import (
    TRANSCRIPTS,
    SimulatedTranscriber,
    recorded,
    stand_in_words,
)
from postgear_media.simulation.build_transcripts import ScriptError, lay_out, render
from postgear_media.simulation.scripts import SAMPLE_SECONDS, SCRIPTS, SILENT

PLAN = json.loads(
    (REPO_ROOT / "packages" / "media-tools" / "fixtures" / "samples" / "plan.json").read_text(
        encoding="utf-8",
    ),
)


def chunk(from_ms: int, to_ms: int) -> Chunk:
    return Chunk(path=Path("unused.wav"), from_ms=from_ms, to_ms=to_ms)


@pytest.mark.parametrize("sample", sorted(SCRIPTS))
def test_the_committed_file_is_what_the_script_builds(sample: str) -> None:
    on_disk = (TRANSCRIPTS / f"{sample}.json").read_text(encoding="utf-8")
    assert on_disk == render(sample), (
        "run `uv run python -m postgear_media.simulation.build_transcripts`"
    )


@pytest.mark.parametrize("sample", sorted(SCRIPTS))
def test_words_are_in_order_inside_the_sample_and_never_overlap(sample: str) -> None:
    record = recorded(sample)
    assert record is not None
    previous_end = 0
    for word in record.words:
        assert word.start >= previous_end
        assert word.end > word.start
        assert 0.0 <= word.sure <= 1.0
        assert word.text
        previous_end = word.end
    assert previous_end <= SAMPLE_SECONDS[sample] * 1000


def test_the_talk_has_a_whole_silent_listening_block() -> None:
    record = recorded("talk")
    assert record is not None
    (quiet_from, quiet_to) = SILENT["talk"][0]
    assert record.between(round(quiet_from * 1000), round(quiet_to * 1000)) == []
    assert (quiet_to - quiet_from) >= 30
    assert quiet_from % 30 == 0


def test_every_script_has_fillers_unsure_words_and_a_bad_word_to_find() -> None:
    for sample in SCRIPTS:
        record = recorded(sample)
        assert record is not None
        texts = [word.text.lower().strip(".,!?") for word in record.words]
        assert "um" in texts
        assert any(word.sure < 0.6 for word in record.words)
        assert any(text in {"damn", "hell", "crap"} for text in texts)


def test_the_talk_has_two_planted_bleep_words() -> None:
    record = recorded("talk")
    assert record is not None
    planted = [(w.start, w.end, w.text) for w in record.words if w.text in {"bullshit", "shitty"}]
    assert planted == [(15_511, 15_989, "bullshit"), (100_551, 100_920, "shitty")]


def test_the_stream_has_a_stretch_of_tamil() -> None:
    record = recorded("stream")
    assert record is not None
    tamil = [w for w in record.words if any("஀" <= char <= "௿" for char in w.text)]
    assert len(tamil) >= 10
    assert 420_000 <= tamil[0].start < 440_000


def test_two_speakers_lines_sit_inside_the_planned_turns() -> None:
    record = recorded("two-speakers")
    assert record is not None
    turns = [(t["startSec"] * 1000, t["endSec"] * 1000) for t in PLAN["twoSpeakers"]["turns"]]
    for word in record.words:
        assert any(start <= word.start and word.end <= end for start, end in turns), word
    # Every turn has something said in it.
    for start, end in turns:
        assert record.between(round(start), round(end))


def test_a_line_that_runs_into_the_next_is_refused() -> None:
    with pytest.raises(ScriptError, match="into the next one"):
        lay_out("talk", [(1.0, "one two three four five six seven eight"), (2.0, "next")])
    with pytest.raises(ScriptError, match="silent stretch"):
        lay_out("talk", [(125.0, "not allowed here")])


def test_the_listener_answers_recorded_words_relative_to_the_chunk() -> None:
    heard = SimulatedTranscriber().listen(
        ListenRequest(chunk=chunk(60_000, 120_000), language=None, sample="stream"),
    )
    assert heard.language == "en"
    assert heard.words
    assert all(0 <= word.start < 60_000 for word in heard.words)
    record = recorded("stream")
    assert record is not None
    assert len(heard.words) == len(record.between(60_000, 120_000))


def test_an_unknown_video_gets_stand_in_speech_that_does_not_depend_on_how_it_was_asked() -> None:
    whole = stand_in_words(0, 120_000)
    parts = stand_in_words(0, 45_000) + stand_in_words(45_000, 120_000)
    assert whole == parts
    assert len(whole) > 100
    heard = SimulatedTranscriber().listen(
        ListenRequest(chunk=chunk(30_000, 60_000), language=None, sample=None),
    )
    assert [word.text for word in heard.words] == [w.text for w in stand_in_words(30_000, 60_000)]
    assert any(word.sure < 0.6 for word in whole)


def test_a_sample_name_can_never_reach_another_file() -> None:
    assert recorded("../../../etc/passwd") is None
    assert recorded("") is None
    assert recorded("no-such-sample") is None


def test_forcing_switches() -> None:
    listener = SimulatedTranscriber()
    silent = listener.listen(
        ListenRequest(chunk=chunk(0, 30_000), language="ta", sample="stream", force="no-speech"),
    )
    assert silent.words == []
    assert silent.language == "ta"
    with pytest.raises(ApplicationError) as caught:
        listener.listen(
            ListenRequest(chunk=chunk(0, 30_000), language=None, sample="stream", force="fail"),
        )
    assert caught.value.type == "MEDIA_TOOL_FAILED"
    assert caught.value.non_retryable is False
