"""The face service with a fake detector and pictures drawn in numpy (no decoder, no model)."""

from __future__ import annotations

import gzip
import json
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from temporalio.exceptions import ApplicationError

from postgear_media.contract.generated import FaceTracksFile, MediaPyDetectFacesInput
from postgear_media.core.keys import job_file_key
from postgear_media.core.settings import Settings
from postgear_media.core.storage import LocalPrivateStorage
from postgear_media.providers.factory import build_provider_table
from postgear_media.providers.vision import simulated_faces
from postgear_media.providers.vision.mediapipe_faces import (
    FACE_MODEL_FILE,
    MediaPipeFaceDetector,
)
from postgear_media.services.faces import (
    HEARTBEAT_EVERY,
    MAX_PER_PICTURE,
    FacesDeps,
    PixelBox,
    clean_boxes,
    detect_faces,
)
from postgear_media.services.frames import Frame, sample_times
from tests.helpers import JOB, ORG, VIDEO

PROXY_KEY = f"clips/{ORG}/{VIDEO}/proxy-{'0123456789abcdef' * 2}.mp4"
PLAN = Path(__file__).resolve().parents[3] / "packages/media-tools/fixtures/samples/plan.json"
WIDTH, HEIGHT = 640, 360


class FakeSource:
    """Colour pictures at the asked rate; remembers what it was asked."""

    name = "fake"

    def __init__(self) -> None:
        self.asked: list[tuple[tuple[int, int], float, int, bool]] = []
        self.closed = False

    def frames(
        self, ranges: Sequence[tuple[int, int]], fps: float, max_width: int, *, grey: bool
    ) -> Iterator[Frame]:
        for from_ms, to_ms in ranges:
            self.asked.append(((from_ms, to_ms), fps, max_width, grey))
            for t in sample_times(from_ms, to_ms, fps):
                yield Frame(t_ms=t, pixels=np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8))

    def still(self, _t_ms: int, _width: int) -> bytes:
        raise AssertionError("the face service never cuts stills")

    def close(self) -> None:
        self.closed = True


class FakeDetector:
    """Answers `answer(picture number)` in pixels."""

    name = "fake-detector"

    def __init__(self, answer: Callable[[int], list[PixelBox]]) -> None:
        self.answer = answer
        self.calls = 0
        self.closed = False

    def detect(self, pixels: Any) -> list[PixelBox]:
        assert pixels.shape == (HEIGHT, WIDTH, 3)
        self.calls += 1
        return self.answer(self.calls)

    def close(self) -> None:
        self.closed = True


def make_deps(
    tmp_path: Path,
    detector: FakeDetector | None = None,
    *,
    simulated: bool = False,
    source: FakeSource | None = None,
) -> tuple[FacesDeps, list[dict[str, Any] | None]]:
    beats: list[dict[str, Any] | None] = []
    picked = source or FakeSource()

    def open_detector() -> FakeDetector:
        assert detector is not None, "a simulated run never loads the detector"
        return detector

    deps = FacesDeps(
        storage=LocalPrivateStorage(tmp_path / "private"),
        scratch_root=tmp_path / "scratch",
        checkpoint=beats.append,
        simulated=simulated,
        open_source=lambda _path: picked,
        open_detector=open_detector,
        sleep=lambda _s: None,
    )
    proxy = tmp_path / "proxy.mp4"
    proxy.write_bytes(b"not really a video")
    deps.storage.put_file(proxy, PROXY_KEY, "video/mp4")
    return deps, beats


def payload(ranges: list[tuple[int, int]], **overrides: Any) -> MediaPyDetectFacesInput:
    body: dict[str, Any] = {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "videoId": VIDEO,
        "proxyKey": PROXY_KEY,
        "durationMs": 240_000,
        "ranges": [{"fromMs": a, "toMs": b} for a, b in ranges],
        "sampleFps": 5,
        "maxWidth": 640,
        "simulation": None,
    }
    body.update(overrides)
    return MediaPyDetectFacesInput.model_validate(body)


def read_file(deps: FacesDeps, key: str, tmp_path: Path) -> dict[str, Any]:
    out = tmp_path / "read.json.gz"
    deps.storage.get_to_file(key, out)
    with gzip.open(out, "rt", encoding="utf-8") as handle:
        data: dict[str, Any] = json.load(handle)
    FaceTracksFile.model_validate(data)
    return data


def test_samples_five_colour_pictures_a_second_at_most_640_wide(tmp_path: Path) -> None:
    source = FakeSource()
    detector = FakeDetector(lambda _n: [])
    deps, _ = make_deps(tmp_path, detector, source=source)
    out = detect_faces(payload([(1_000, 3_000), (10_000, 10_600)]), deps)
    assert source.asked == [((1_000, 3_000), 5, 640, False), ((10_000, 10_600), 5, 640, False)]
    assert out.sampled == 10 + 3
    data = read_file(deps, out.faces_key, tmp_path)
    assert [p["t"] for p in data["frames"]][:3] == [1_000, 1_200, 1_400]
    assert source.closed and detector.closed


def test_boxes_become_fractions_of_the_picture(tmp_path: Path) -> None:
    detector = FakeDetector(lambda _n: [(64.0, 36.0, 128.0, 144.0, 0.9)])
    deps, _ = make_deps(tmp_path, detector)
    out = detect_faces(payload([(0, 400)]), deps)
    data = read_file(deps, out.faces_key, tmp_path)
    assert data["frames"][0]["boxes"] == [{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.4, "score": 0.9}]
    assert out.found == 2
    assert out.producer == "fake-detector"
    assert out.faces_key == job_file_key(ORG, VIDEO, "faces", JOB)


def test_clean_boxes_drops_unsure_tiny_and_outside_boxes_and_keeps_the_largest() -> None:
    found: list[PixelBox] = [
        (10, 10, 50, 50, 0.2),  # unsure
        (10, 10, 8, 8, 0.9),  # a poster far behind
        (700, 10, 40, 40, 0.9),  # wholly outside
        (600, 300, 100, 100, 0.8),  # clipped at the corner
        (100, 100, 60, 60, 0.7),
    ]
    boxes = clean_boxes(found, WIDTH, HEIGHT)
    assert len(boxes) == 2
    assert boxes[0]["w"] == pytest.approx(60 / WIDTH, abs=1e-4)
    assert boxes[1]["w"] == pytest.approx(40 / WIDTH, abs=1e-4)
    assert boxes[1]["x"] + boxes[1]["w"] <= 1
    many: list[PixelBox] = [(i * 20.0, 0.0, 20.0 + i, 40.0, 0.9) for i in range(12)]
    kept = clean_boxes(many, WIDTH, HEIGHT)
    assert len(kept) == MAX_PER_PICTURE
    assert kept[0]["w"] >= kept[-1]["w"]


def test_heartbeats_every_few_seconds_of_video(tmp_path: Path) -> None:
    deps, beats = make_deps(tmp_path, FakeDetector(lambda _n: []))
    detect_faces(payload([(0, 20_000)]), deps)
    assert sum(1 for b in beats if b and "pictures" in b) == 100 // HEARTBEAT_EVERY + 1


def test_a_stretch_with_no_face_is_an_empty_file_not_a_failure(tmp_path: Path) -> None:
    deps, _ = make_deps(tmp_path, FakeDetector(lambda _n: []))
    out = detect_faces(payload([(0, 2_000)]), deps)
    assert out.found == 0
    data = read_file(deps, out.faces_key, tmp_path)
    assert all(p["boxes"] == [] for p in data["frames"])


def test_the_file_holds_boxes_and_times_only(tmp_path: Path) -> None:
    detector = FakeDetector(lambda _n: [(64.0, 36.0, 128.0, 144.0, 0.9)])
    deps, _ = make_deps(tmp_path, detector)
    data = read_file(deps, detect_faces(payload([(0, 1_000)]), deps).faces_key, tmp_path)
    assert set(data) == {"version", "sampleFps", "frames"}
    assert {k for p in data["frames"] for k in p} == {"t", "boxes"}
    assert {k for p in data["frames"] for b in p["boxes"] for k in b} == {
        "x",
        "y",
        "w",
        "h",
        "score",
    }


def test_a_missing_light_copy_is_permanent(tmp_path: Path) -> None:
    deps, _ = make_deps(tmp_path, FakeDetector(lambda _n: []))
    gone = PROXY_KEY.replace("0123456789abcdef" * 2, "f" * 32)
    with pytest.raises(ApplicationError) as error:
        detect_faces(payload([(0, 1_000)], proxyKey=gone), deps)
    assert error.value.type == "MEDIA_KEY_NOT_FOUND"


def sim(sample: str | None, force: str | None = None) -> dict[str, Any]:
    return {"simulation": {"sample": sample, "force": force}}


def test_simulated_two_speakers_shows_both_markers_from_the_plan(tmp_path: Path) -> None:
    plan = json.loads(PLAN.read_text())["twoSpeakers"]
    expected = [
        (s["centreX"], s["centreY"], s["faceWidth"], s["faceHeight"]) for s in plan["speakers"]
    ]
    assert list(simulated_faces.TWO_SPEAKERS_FACES) == expected
    assert simulated_faces.SAMPLE_SECONDS["two-speakers"] == plan["durationSec"]

    deps, _ = make_deps(tmp_path, simulated=True)
    out = detect_faces(payload([(0, 60_000)], **sim("two-speakers")), deps)
    data = read_file(deps, out.faces_key, tmp_path)
    counts = [len(p["boxes"]) for p in data["frames"]]
    assert counts.count(2) > 0.9 * len(counts)
    assert counts.count(1) > 0
    left = next(p["boxes"] for p in data["frames"] if len(p["boxes"]) == 2)
    assert sorted(round(b["x"] + b["w"] / 2, 2) for b in left) == [0.27, 0.73]
    assert out.producer == "simulation"


def test_simulated_two_speakers_talk_in_the_plans_turns_and_one_is_lost_for_a_while() -> None:
    plan = json.loads(PLAN.read_text())["twoSpeakers"]
    ids = [s["id"] for s in plan["speakers"]]
    turns = [(ids.index(t["speaker"]), t["startSec"], t["endSec"]) for t in plan["turns"]]
    assert list(simulated_faces.TWO_SPEAKERS_TURNS) == turns

    def heights(from_s: float, to_s: float, centre_x: float) -> list[float]:
        out = []
        for t in range(int(from_s * 1000), int(to_s * 1000), 200):
            out += [
                f.h
                for f in simulated_faces.recorded_faces("two-speakers", t)
                if round(f.x + f.w / 2, 2) == centre_x
            ]
        return out

    # 15 to 26.5 s is the right marker's turn: its box height moves, the left one's stays.
    talking = heights(15.2, 26.4, 0.73)
    listening = heights(15.2, 26.4, 0.27)
    assert len(set(talking)) > 5
    assert set(listening) == {0.44}
    assert all(abs(h - 0.44) <= 0.44 * simulated_faces.MOUTH_MOVE + 1e-9 for h in talking)

    who, lost_from, lost_to = simulated_faces.LOST_SPEAKER
    assert lost_to - lost_from >= 2_500
    assert any(who == w and s * 1000 < lost_from and lost_to < e * 1000 for w, s, e in turns)
    for t in range(lost_from, lost_to, 200):
        boxes = simulated_faces.recorded_faces("two-speakers", t)
        assert all(round(b.x + b.w / 2, 2) != 0.27 for b in boxes)


def test_simulated_stream_has_a_still_small_face_in_the_corner(tmp_path: Path) -> None:
    deps, _ = make_deps(tmp_path, simulated=True)
    out = detect_faces(payload([(30_000, 90_000)], durationMs=600_000, **sim("stream")), deps)
    data = read_file(deps, out.faces_key, tmp_path)
    boxes = [b for p in data["frames"] for b in p["boxes"]]
    assert len(boxes) > 0.9 * len(data["frames"])
    assert all(b["x"] > 2 / 3 and b["y"] > 2 / 3 and b["h"] < 0.2 for b in boxes)


def test_simulated_talk_and_any_upload_have_no_face(tmp_path: Path) -> None:
    deps, _ = make_deps(tmp_path, simulated=True)
    for sample in ("talk", None):
        out = detect_faces(payload([(0, 10_000)], **sim(sample)), deps)
        assert out.found == 0


def test_simulated_failure_and_slow_switches(tmp_path: Path) -> None:
    deps, beats = make_deps(tmp_path, simulated=True)
    with pytest.raises(ApplicationError) as error:
        detect_faces(payload([(0, 1_000)], **sim("stream", "fail")), deps)
    assert error.value.type == "MEDIA_TOOL_FAILED"
    detect_faces(payload([(0, 1_000)], **sim("stream", "slow")), deps)
    assert sum(1 for b in beats if b and "step" in b) == 40


def test_the_real_detector_is_off_without_its_model_and_never_fetches_it(tmp_path: Path) -> None:
    root = tmp_path / "models"
    root.mkdir()
    with pytest.raises(ApplicationError) as error:
        MediaPipeFaceDetector(root)
    assert error.value.type == "MEDIA_BINDING_OFF"
    assert list(root.iterdir()) == []


def test_the_faces_binding_is_live_only_with_library_and_model(
    make_settings: Callable[..., Settings], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "models"
    root.mkdir()
    settings = make_settings(media_simulation=False, media_model_dir=str(root))
    monkeypatch.setattr("postgear_media.providers.factory._installed", lambda _m: True)
    assert build_provider_table(settings).faces.state == "off"
    (root / FACE_MODEL_FILE).write_bytes(b"model")
    assert build_provider_table(settings).faces.state == "live"
    monkeypatch.setattr("postgear_media.providers.factory._installed", lambda _m: False)
    assert build_provider_table(settings).faces.state == "off"
