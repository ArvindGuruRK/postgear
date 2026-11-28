"""Sprint 13, Module 16 section 2: the listening switches, end to end in the service.

- `[simulate:no-speech]` (any video's title) reaches the service as the
  forced state `no-speech`: the simulated listener hears nothing, and the
  answer is `noSpeech`, never an error (story row "No speech in the video").
- `[simulate:listen-fail]` reaches it as `fail`: a failure Temporal may try
  again, which ends as "We could not finish listening to this video" on the
  Node side (story row "Listening fails half way").
- With the real bindings (`simulated=False`) neither the forced state nor the
  sample is ever handed to the listener: a title cannot steer real work.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from temporalio.exceptions import ApplicationError

from postgear_media.providers.transcribe.base import Heard, ListenRequest, Word
from postgear_media.providers.transcribe.simulation import SimulatedTranscriber
from postgear_media.services.transcribe import transcribe
from tests.test_transcribe_service import make_deps, make_payload, store_audio


class Recording:
    """A stand-in for a real listener: one word a chunk, and what it was told."""

    name = "real:1"
    max_chunk_ms = 60_000

    def __init__(self) -> None:
        self.told: list[tuple[str | None, str | None]] = []

    def listen(self, request: ListenRequest) -> Heard:
        self.told.append((request.sample, request.force))
        request.checkpoint()
        return Heard(words=[Word(start=0, end=400, text="hello", sure=0.9)], language="en")


def forced(force: str) -> dict[str, object]:
    return {"simulation": {"sample": "talk", "force": force}}


def test_no_speech_under_simulation_is_a_finished_listen_with_no_words(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, SimulatedTranscriber(), simulated=True)
    store_audio(deps, tmp_path)
    result = transcribe(make_payload([(0, 30_000)], **forced("no-speech")), deps)
    assert result.no_speech is True
    assert result.word_count == 0


def test_listen_fail_under_simulation_is_a_failure_that_may_be_tried_again(
    tmp_path: Path,
) -> None:
    deps = make_deps(tmp_path, SimulatedTranscriber(), simulated=True)
    store_audio(deps, tmp_path)
    with pytest.raises(ApplicationError) as caught:
        transcribe(make_payload([(0, 30_000)], **forced("fail")), deps)
    assert caught.value.type == "MEDIA_TOOL_FAILED"
    assert caught.value.non_retryable is False


@pytest.mark.parametrize("force", ["no-speech", "fail", "slow"])
def test_a_forced_state_never_reaches_a_real_listener(tmp_path: Path, force: str) -> None:
    listener = Recording()
    deps = make_deps(tmp_path, listener, simulated=False)
    store_audio(deps, tmp_path)
    result = transcribe(make_payload([(0, 30_000)], **forced(force)), deps)
    assert listener.told == [(None, None)]
    assert result.no_speech is False
    assert result.word_count == 1
