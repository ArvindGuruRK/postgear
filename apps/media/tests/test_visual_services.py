"""The motion measure and the stills cutter, with pictures drawn in numpy (no decoder)."""

from __future__ import annotations

import dataclasses
import gzip
import json
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from temporalio.exceptions import ApplicationError

from postgear_media.contract.generated import MediaPyMotionInput, MediaPyStillsInput, MotionFile
from postgear_media.core.keys import is_valid_clip_key, job_file_key
from postgear_media.core.storage import LocalPrivateStorage
from postgear_media.services.frames import Frame, sample_times
from postgear_media.services.motion import VisualDeps, measure_motion, motion_values
from postgear_media.services.stills import cut_stills, still_key
from tests.helpers import JOB, ORG, VIDEO

PROXY_KEY = f"clips/{ORG}/{VIDEO}/proxy-{'0123456789abcdef' * 2}.mp4"


class FakeSource:
    """Pictures drawn by `draw(t_ms)`, at the asked rate; remembers what it was asked."""

    name = "fake"

    def __init__(self, draw: Callable[[int], Any]) -> None:
        self.draw = draw
        self.asked: list[tuple[int, int]] = []
        self.closed = False
        self.still_widths: list[int] = []

    def frames(
        self, ranges: Sequence[tuple[int, int]], fps: float, max_width: int, *, grey: bool
    ) -> Iterator[Frame]:
        assert grey
        assert max_width == 320
        for from_ms, to_ms in ranges:
            self.asked.append((from_ms, to_ms))
            for t in sample_times(from_ms, to_ms, fps):
                yield Frame(t_ms=t, pixels=self.draw(t))

    def still(self, t_ms: int, width: int) -> bytes:
        self.still_widths.append(width)
        return f"jpeg at {t_ms}".encode()

    def close(self) -> None:
        self.closed = True


def flat(_t: int) -> Any:
    return np.full((18, 32), 100, dtype=np.uint8)


def change_at(moment_ms: int) -> Callable[[int], Any]:
    def draw(t: int) -> Any:
        return np.full((18, 32), 200 if t >= moment_ms else 40, dtype=np.uint8)

    return draw


def make_deps(
    tmp_path: Path, source: FakeSource | None = None, *, simulated: bool = False
) -> VisualDeps:
    beats: list[dict[str, Any] | None] = []

    def opener(_path: Path) -> FakeSource:
        assert source is not None
        return source

    deps = VisualDeps(
        storage=LocalPrivateStorage(tmp_path / "private"),
        scratch_root=tmp_path / "scratch",
        checkpoint=beats.append,
        simulated=simulated,
        open_source=opener,
        sleep=lambda _s: None,
    )
    proxy = tmp_path / "proxy.mp4"
    proxy.write_bytes(b"not really a video")
    deps.storage.put_file(proxy, PROXY_KEY, "video/mp4")
    return deps


def motion_payload(ranges: list[tuple[int, int]], **overrides: Any) -> MediaPyMotionInput:
    body: dict[str, Any] = {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "videoId": VIDEO,
        "proxyKey": PROXY_KEY,
        "durationMs": 20_000,
        "ranges": [{"fromMs": a, "toMs": b} for a, b in ranges],
        "sampleFps": 2,
        "simulation": None,
    }
    body.update(overrides)
    return MediaPyMotionInput.model_validate(body)


def stills_payload(moments: list[int], **overrides: Any) -> MediaPyStillsInput:
    body: dict[str, Any] = {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "videoId": VIDEO,
        "proxyKey": PROXY_KEY,
        "durationMs": 20_000,
        "momentsMs": moments,
        "width": 768,
        "simulation": None,
    }
    body.update(overrides)
    return MediaPyStillsInput.model_validate(body)


def read_motion(deps: VisualDeps, tmp_path: Path, key: str) -> MotionFile:
    target = tmp_path / "read.json.gz"
    deps.storage.get_to_file(key, target)
    with gzip.open(target, "rt", encoding="utf-8") as handle:
        return MotionFile.model_validate(json.load(handle))


def plain(motion: MotionFile) -> list[float | None]:
    return [None if value is None else value.root for value in motion.values]


# ---- the measure -------------------------------------------------------------------


def test_sample_times_follow_the_grid() -> None:
    assert sample_times(0, 2_000, 2) == [0, 500, 1000, 1500]
    assert sample_times(1_250, 2_600, 2) == [1500, 2000, 2500]
    assert sample_times(5_000, 5_000, 2) == []


def test_a_still_picture_gives_a_flat_track() -> None:
    frames = (Frame(t, flat(t)) for t in sample_times(0, 10_000, 2))
    values, seen = motion_values(frames, [(0, 10_000)], 10_000)
    assert seen == 20
    assert values == [0.0] * 20


def test_a_sudden_change_gives_one_spike() -> None:
    draw = change_at(4_000)
    frames = (Frame(t, draw(t)) for t in sample_times(0, 10_000, 2))
    values, _ = motion_values(frames, [(0, 10_000)], 10_000)
    spikes = [index for index, value in enumerate(values) if value and value > 0]
    assert spikes == [8]
    assert values[8] == 160.0


def test_samples_outside_the_stretches_are_no_data_and_stretches_never_compare() -> None:
    def draw(t: int) -> Any:
        return np.full((4, 4), 0 if t < 5_000 else 250, dtype=np.uint8)

    ranges = [(0, 2_000), (6_000, 8_000)]
    frames = (Frame(t, draw(t)) for a, b in ranges for t in sample_times(a, b, 2))
    values, seen = motion_values(frames, ranges, 10_000)
    assert seen == 8
    assert values[4:12] == [None] * 8
    # The jump from black to white happened between the stretches: never measured.
    assert values[12:16] == [0.0] * 4
    assert values[16:] == [None] * 4


def test_measure_motion_stores_the_file_at_the_jobs_key(tmp_path: Path) -> None:
    source = FakeSource(change_at(3_000))
    deps = make_deps(tmp_path, source)
    out = measure_motion(motion_payload([(0, 6_000)]), deps)
    assert out.track_key == job_file_key(ORG, VIDEO, "motion", JOB)
    assert is_valid_clip_key(out.track_key)
    assert out.sampled == 12
    assert out.producer == "fake"
    assert source.closed
    motion = read_motion(deps, tmp_path, out.track_key)
    assert motion.sample_rate_hz == 2
    values = plain(motion)
    assert len(values) == 40
    assert values[6] == 160.0
    assert all(value is None for value in values[12:])
    # The scratch folder is gone with the attempt.
    assert list((tmp_path / "scratch").iterdir()) == []


def test_ranges_out_of_order_or_past_the_end_are_refused(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, FakeSource(flat))
    with pytest.raises(ApplicationError) as error:
        measure_motion(motion_payload([(5_000, 8_000), (1_000, 2_000)]), deps)
    assert error.value.type == "MEDIA_BAD_INPUT"
    with pytest.raises(ApplicationError) as error:
        measure_motion(motion_payload([(30_000, 40_000)]), deps)
    assert error.value.type == "MEDIA_BAD_INPUT"


def test_a_missing_light_copy_is_not_retried(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, FakeSource(flat))
    other = f"clips/{ORG}/{VIDEO}/proxy-{'f' * 32}.mp4"
    for simulated in (False, True):
        sim_deps = dataclasses.replace(deps, simulated=simulated)
        with pytest.raises(ApplicationError) as error:
            measure_motion(motion_payload([(0, 2_000)], proxyKey=other), sim_deps)
        assert error.value.type == "MEDIA_KEY_NOT_FOUND"
        assert error.value.non_retryable


def test_simulation_answers_the_recorded_motion_without_a_decoder(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, None, simulated=True)
    payload = motion_payload(
        [(55_000, 70_000)],
        durationMs=600_000,
        simulation={"sample": "stream", "force": None},
    )
    out = measure_motion(payload, deps)
    assert out.producer == "simulation"
    values = plain(read_motion(deps, tmp_path, out.track_key))
    assert values[109] is None
    assert values[110] is not None
    # The cut at 62 s is one spike; the loud moment after it moves for seconds.
    assert values[124] == 72.0
    assert all(v is not None and v > 30 for v in values[125:132])
    assert values[140] is None


def test_simulation_forces_a_failure(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, None, simulated=True)
    payload = motion_payload([(0, 2_000)], simulation={"sample": "stream", "force": "fail"})
    with pytest.raises(ApplicationError) as error:
        measure_motion(payload, deps)
    assert error.value.type == "MEDIA_TOOL_FAILED"
    assert not error.value.non_retryable


# ---- stills ------------------------------------------------------------------------


def test_stills_are_one_per_moment_at_the_asked_width_and_keys_from_the_job(
    tmp_path: Path,
) -> None:
    source = FakeSource(flat)
    deps = make_deps(tmp_path, source)
    out = cut_stills(stills_payload([1_000, 2_000, 3_000, 5_000]), deps)
    assert [key.root for key in out.keys] == [still_key(ORG, VIDEO, JOB, i) for i in range(4)]
    assert all(is_valid_clip_key(key.root) for key in out.keys)
    assert source.still_widths == [768] * 4
    assert source.closed
    target = tmp_path / "back.jpg"
    deps.storage.get_to_file(out.keys[3].root, target)
    assert target.read_bytes() == b"jpeg at 5000"
    assert list((tmp_path / "scratch").iterdir()) == []


def test_simulated_stills_are_the_placeholder_and_never_decode(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, None, simulated=True)
    out = cut_stills(
        stills_payload([1_000, 2_000], simulation={"sample": "stream", "force": None}), deps
    )
    target = tmp_path / "back.jpg"
    deps.storage.get_to_file(out.keys[0].root, target)
    assert target.read_bytes()[:2] == b"\xff\xd8"


def test_a_still_past_the_end_is_refused(tmp_path: Path) -> None:
    deps = make_deps(tmp_path, FakeSource(flat))
    with pytest.raises(ApplicationError) as error:
        cut_stills(stills_payload([25_000]), deps)
    assert error.value.type == "MEDIA_BAD_INPUT"


@pytest.mark.ml
def test_opencv_reads_a_real_file(tmp_path: Path) -> None:
    cv2 = pytest.importorskip("cv2")
    from postgear_media.services.frames import OpenCvFrameSource  # noqa: PLC0415

    path = tmp_path / "moving.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (64, 36))
    for index in range(40):
        writer.write(np.full((36, 64, 3), 220 if index >= 20 else 20, dtype=np.uint8))
    writer.release()
    source = OpenCvFrameSource(path)
    try:
        frames = list(source.frames([(0, 4_000)], 2, 320, grey=True))
        values, _ = motion_values(iter(frames), [(0, 4_000)], 4_000)
        assert len(frames) == 8
        peak = max(range(len(values)), key=lambda i: values[i] or 0)
        assert peak == 4
        assert source.still(1_000, 160)[:2] == b"\xff\xd8"
    finally:
        source.close()
