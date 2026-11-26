"""The simulated pictures follow the sample plan: a test fails when the copies drift."""

from __future__ import annotations

from postgear_media.core.settings import REPO_ROOT
from postgear_media.providers.vision import simulation
from tests.conftest import read_json

PLAN = REPO_ROOT / "packages" / "media-tools" / "fixtures" / "samples" / "plan.json"


def test_the_stream_copy_matches_the_plan() -> None:
    stream = read_json(PLAN)["stream"]
    scenes = tuple((scene["startSec"], scene["source"]) for scene in stream["scenes"])
    assert scenes == simulation.STREAM_SCENES
    loud = tuple((burst["startSec"], burst["endSec"]) for burst in stream["loudBursts"])
    assert loud == simulation.STREAM_LOUD
    assert simulation.SAMPLE_SECONDS["stream"] == stream["durationSec"]


def test_quiet_bursts_sit_away_from_cuts_and_loud_moments() -> None:
    cuts = [start for start, _ in simulation.STREAM_SCENES]
    for start, end in simulation.STREAM_QUIET_ACTION:
        assert all(abs(cut - start) > 10 and abs(cut - end) > 10 for cut in cuts)
        assert all(end < a or start > b for a, b in simulation.STREAM_LOUD)


def test_every_cut_is_one_spike_and_bursts_last() -> None:
    values = simulation.recorded_motion("stream", 600_000)
    assert len(values) == 1200
    for start, _ in simulation.STREAM_SCENES[1:]:
        index = start * 2
        assert values[index] == simulation.CUT_SPIKE
        assert values[index - 1] < 20
    assert all(values[i] > 25 for i in range(241, 246))  # 120.5 to 122.5 s, a quiet burst


def test_calm_samples_and_uploads_never_spike() -> None:
    for sample in ("talk", "two-speakers", None, "verideck"):
        values = simulation.recorded_motion(sample, 60_000)
        assert len(values) == 120
        assert max(values) < 5


def test_the_same_track_every_time() -> None:
    assert simulation.recorded_motion("stream", 30_000) == simulation.recorded_motion(
        "stream", 30_000
    )
