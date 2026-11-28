"""Security sweep, the Python service (Sprint 13, Module 16 section 1).

What must hold, one test (or a cited one) each:

- Every HTTP route but `/health` needs `MEDIA_INTERNAL_TOKEN` in
  `X-PostGear-Internal` (production cannot start without one:
  `test_settings.py::test_production_needs_the_internal_token`).
- No outside program is started through a shell, and only the voice runner
  and the contract generator start one at all.
- Only keys of the strict private pattern are read or written
  (`test_storage.py::test_bad_keys_never_reach_the_disk`), and a job reads
  only the files of the video it names: a valid key of another video or
  another workspace is refused before storage is asked.
- Scratch folders are removed on success and on failure, and the finished
  chunks of a listen (words already heard) go as soon as no attempt follows.
- The documented deployment keeps the service off the internet.
- `MEDIA_SIMULATION` (or `CLIPS_SIMULATION` when it is unset) is refused in
  production.
"""

from __future__ import annotations

import ast
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import ValidationError
from temporalio.exceptions import ApplicationError, CancelledError

from postgear_media.core.keys import is_video_key
from postgear_media.core.settings import REPO_ROOT, Settings
from postgear_media.core.storage import LocalPrivateStorage
from postgear_media.main import create_app
from postgear_media.providers.transcribe.base import Heard, ListenRequest, Word
from postgear_media.services.faces import FacesDeps, detect_faces
from postgear_media.services.motion import VisualDeps, measure_motion
from postgear_media.services.stills import cut_stills
from postgear_media.services.transcribe import TranscribeDeps, transcribe
from tests import test_faces_service as faces_tests
from tests import test_visual_services as visual_tests
from tests.helpers import AUDIO_KEY, JOB, ORG, VIDEO, write_wav

SRC = Path(__file__).resolve().parents[1] / "src" / "postgear_media"
TOKEN = "t" * 64
OTHER_VIDEO = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a"
OTHER_ORG = "seed-second-org"
HEX = "0123456789abcdef" * 2


# --- The token on every route but /health ------------------------------------------------


def _routes(app: Any) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            out.extend((method, route.path) for method in sorted(route.methods or ()))
    return out


def test_every_route_but_health_needs_the_internal_token(
    make_settings: Callable[..., Settings],
) -> None:
    app = create_app(make_settings(media_internal_token=TOKEN, media_simulation=True))
    routes = _routes(app)
    # A new route is checked as soon as it exists: nothing here names the list.
    assert ("GET", "/health") in routes
    guarded = [(method, path) for method, path in routes if path != "/health"]
    assert len(guarded) >= 3
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        for method, path in guarded:
            assert client.request(method, path).status_code == 401, path
            wrong = {"X-PostGear-Internal": "w" * 64}
            assert client.request(method, path, headers=wrong).status_code == 401, path
            near = {"X-PostGear-Internal": TOKEN[:-1]}
            assert client.request(method, path, headers=near).status_code == 401, path
            right = {"X-PostGear-Internal": TOKEN}
            assert client.request(method, path, headers=right).status_code != 401, path


def test_the_refusal_never_says_what_the_token_is(make_settings: Callable[..., Settings]) -> None:
    app = create_app(make_settings(media_internal_token=TOKEN))
    with TestClient(app) as client:
        answer = client.get("/ready", headers={"X-PostGear-Internal": "w" * 64})
    assert answer.status_code == 401
    assert TOKEN not in answer.text
    assert answer.json() == {"detail": "unauthorised"}


# --- Outside programs ----------------------------------------------------------------------

#: The only modules allowed to start a program, each with a fixed program and an argument list.
PROGRAM_STARTERS = {
    "providers/speech/kokoro.py",
    "contract/generate.py",
}

SHELL_CALLS = {
    ("os", "system"),
    ("os", "popen"),
    ("os", "spawnl"),
    ("os", "spawnlp"),
    ("os", "spawnv"),
    ("os", "spawnvp"),
    ("os", "execl"),
    ("os", "execlp"),
    ("os", "execv"),
    ("os", "execvp"),
    ("subprocess", "getoutput"),
    ("subprocess", "getstatusoutput"),
    ("asyncio", "create_subprocess_shell"),
}
SUBPROCESS_RUNNERS = {"run", "Popen", "call", "check_call", "check_output"}


def _sources() -> list[tuple[str, ast.Module]]:
    out = []
    for path in sorted(SRC.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        relative = path.relative_to(SRC).as_posix()
        out.append((relative, ast.parse(path.read_text(encoding="utf-8"), filename=relative)))
    return out


def _dotted(node: ast.expr) -> tuple[str, str] | None:
    if (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and isinstance(node.attr, str)
    ):
        return node.value.id, node.attr
    return None


def test_no_program_is_ever_started_through_a_shell() -> None:
    sources = _sources()
    assert len(sources) > 20
    offenders: list[str] = []
    for relative, tree in sources:
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = _dotted(node.func)
            if name in SHELL_CALLS:
                offenders.append(f"{relative}:{node.lineno} {name[0]}.{name[1]}")
            for keyword in node.keywords:
                if keyword.arg == "shell" and not (
                    isinstance(keyword.value, ast.Constant) and keyword.value.value is False
                ):
                    offenders.append(f"{relative}:{node.lineno} shell=")
            if name is not None and name[0] == "subprocess" and name[1] in SUBPROCESS_RUNNERS:
                first = node.args[0] if node.args else None
                # A plain string is a command line; an argument list (or a name for one) is not.
                if isinstance(first, ast.Constant | ast.JoinedStr | ast.BinOp):
                    offenders.append(f"{relative}:{node.lineno} a command line, not a list")
    assert offenders == []


def test_only_the_voice_runner_and_the_contract_generator_start_programs() -> None:
    starters: set[str] = set()
    for relative, tree in _sources():
        for node in ast.walk(tree):
            if isinstance(node, ast.Import | ast.ImportFrom):
                names = (
                    [alias.name for alias in node.names]
                    if isinstance(node, ast.Import)
                    else [node.module or ""]
                )
                if any(name in {"subprocess", "pty", "multiprocessing"} for name in names):
                    starters.add(relative)
    assert starters == PROGRAM_STARTERS


# --- Keys: only the job's own video ------------------------------------------------------


def test_a_video_key_must_sit_under_its_own_workspace_and_video() -> None:
    own = f"clips/{ORG}/{VIDEO}/proxy-{HEX}.mp4"
    assert is_video_key(own, ORG, VIDEO)
    assert not is_video_key(f"clips/{ORG}/{OTHER_VIDEO}/proxy-{HEX}.mp4", ORG, VIDEO)
    assert not is_video_key(f"clips/{OTHER_ORG}/{VIDEO}/proxy-{HEX}.mp4", ORG, VIDEO)
    # A prefix that only starts the same is not the same workspace.
    assert not is_video_key(f"clips/{ORG}x/{VIDEO}/proxy-{HEX}.mp4", ORG, VIDEO)
    assert not is_video_key(f"clips/{ORG}/{VIDEO}/../proxy-{HEX}.mp4", ORG, VIDEO)
    assert not is_video_key("/etc/passwd", ORG, VIDEO)
    assert not is_video_key(None, ORG, VIDEO)


class AskedStorage(LocalPrivateStorage):
    """The local binding, remembering every key it was asked about."""

    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.asked: list[str] = []

    def get_to_file(self, key: str, path: Path) -> None:
        self.asked.append(key)
        super().get_to_file(key, path)

    def exists(self, key: str) -> bool:
        self.asked.append(key)
        return super().exists(key)


ANOTHER_VIDEOS_KEYS = [
    pytest.param(f"clips/{ORG}/{OTHER_VIDEO}/proxy-{HEX}.mp4", id="another-video"),
    pytest.param(f"clips/{OTHER_ORG}/{VIDEO}/proxy-{HEX}.mp4", id="another-workspace"),
]


@pytest.mark.parametrize("key", ANOTHER_VIDEOS_KEYS)
@pytest.mark.parametrize("simulated", [True, False])
def test_the_picture_jobs_read_only_their_own_videos_light_copy(
    tmp_path: Path, key: str, simulated: bool
) -> None:
    storage = AskedStorage(tmp_path / "private")
    visual = VisualDeps(
        storage=storage,
        scratch_root=tmp_path / "scratch",
        checkpoint=lambda _details: None,
        simulated=simulated,
        open_source=lambda _path: pytest.fail("no picture is decoded"),
        sleep=lambda _s: None,
    )
    faces = FacesDeps(
        storage=storage,
        scratch_root=tmp_path / "scratch",
        checkpoint=lambda _details: None,
        simulated=simulated,
        open_source=lambda _path: pytest.fail("no picture is decoded"),
        open_detector=lambda: pytest.fail("no detector is loaded"),
        sleep=lambda _s: None,
    )
    runs: list[Callable[[], Any]] = [
        lambda: measure_motion(visual_tests.motion_payload([(0, 2_000)], proxyKey=key), visual),
        lambda: cut_stills(visual_tests.stills_payload([1_000], proxyKey=key), visual),
        lambda: detect_faces(faces_tests.payload([(0, 2_000)], proxyKey=key), faces),
    ]
    for run in runs:
        with pytest.raises(ApplicationError) as caught:
            run()
        assert caught.value.type == "MEDIA_BAD_INPUT"
        assert caught.value.non_retryable is True
    assert storage.asked == []
    assert not (tmp_path / "scratch").exists() or list((tmp_path / "scratch").iterdir()) == []


@pytest.mark.parametrize(
    "key",
    [
        pytest.param(f"clips/{ORG}/{OTHER_VIDEO}/analysis-audio-{HEX}.wav", id="another-video"),
        pytest.param(f"clips/{OTHER_ORG}/{VIDEO}/analysis-audio-{HEX}.wav", id="another-workspace"),
    ],
)
def test_a_listen_reads_only_its_own_videos_sound(tmp_path: Path, key: str) -> None:
    storage = AskedStorage(tmp_path / "private")
    deps = TranscribeDeps(
        storage=storage,
        transcriber=Listener(),
        scratch_root=tmp_path / "scratch",
        checkpoint=lambda _details: None,
        simulated=True,
    )
    with pytest.raises(ApplicationError) as caught:
        transcribe(listen_payload(audioKey=key), deps)
    assert caught.value.type == "MEDIA_BAD_INPUT"
    assert storage.asked == []


# --- Scratch folders and the finished chunks ------------------------------------------------


class Listener:
    """Hears one word a second; fails at the call named, with the error given."""

    name = "fake"
    max_chunk_ms = 60_000

    def __init__(self, fail_on: int | None = None, error: BaseException | None = None) -> None:
        self.calls = 0
        self.fail_on = fail_on
        self.error = error

    def listen(self, request: ListenRequest) -> Heard:
        self.calls += 1
        if self.fail_on is not None and self.calls == self.fail_on and self.error is not None:
            raise self.error
        length = request.chunk.length_ms
        words = [
            Word(start=ms, end=ms + 400, text="word", sure=0.9) for ms in range(0, length, 1000)
        ]
        return Heard(words=words, language="en", language_probability=0.9)


def listen_payload(**overrides: Any) -> Any:
    from postgear_media.contract.generated import MediaPyTranscribeInput  # noqa: PLC0415

    body: dict[str, Any] = {
        "version": 1,
        "jobId": JOB,
        "orgId": ORG,
        "videoId": VIDEO,
        "audioKey": AUDIO_KEY,
        "durationMs": 300_000,
        "ranges": [{"fromMs": 0, "toMs": 180_000}],
        "language": "auto",
        "simulation": None,
    }
    body.update(overrides)
    return MediaPyTranscribeInput.model_validate(body)


def listen_deps(tmp_path: Path, listener: Listener, *, last: bool = False) -> TranscribeDeps:
    deps = TranscribeDeps(
        storage=LocalPrivateStorage(tmp_path / "private"),
        transcriber=listener,
        scratch_root=tmp_path / "scratch",
        checkpoint=lambda _details: None,
        simulated=True,
        last_attempt=lambda: last,
    )
    deps.storage.put_file(write_wav(tmp_path / "in.wav", 300), AUDIO_KEY, "audio/wav")
    return deps


def left_in_scratch(tmp_path: Path) -> list[str]:
    root = tmp_path / "scratch"
    return sorted(path.name for path in root.iterdir()) if root.exists() else []


@pytest.mark.parametrize(
    "error",
    [
        pytest.param(CancelledError("The caller cancelled this step"), id="a-cancel"),
        pytest.param(
            ApplicationError("no", type="MEDIA_BINDING_OFF", non_retryable=True),
            id="a-failure-no-retry-can-fix",
        ),
    ],
)
def test_no_heard_words_stay_on_disk_when_no_attempt_follows(
    tmp_path: Path, error: BaseException
) -> None:
    listener = Listener(fail_on=3, error=error)
    with pytest.raises(type(error)):
        transcribe(listen_payload(), listen_deps(tmp_path, listener))
    assert listener.calls == 3
    assert left_in_scratch(tmp_path) == []


def test_the_last_attempt_takes_the_heard_words_with_it(tmp_path: Path) -> None:
    listener = Listener(fail_on=3, error=ApplicationError("busy", type="MEDIA_TOOL_FAILED"))
    with pytest.raises(ApplicationError):
        transcribe(listen_payload(), listen_deps(tmp_path, listener, last=True))
    assert left_in_scratch(tmp_path) == []


def test_a_failure_a_retry_can_fix_keeps_only_the_finished_chunks_for_it(tmp_path: Path) -> None:
    listener = Listener(fail_on=3, error=ApplicationError("busy", type="MEDIA_TOOL_FAILED"))
    with pytest.raises(ApplicationError):
        transcribe(listen_payload(), listen_deps(tmp_path, listener))
    # The attempt's own folder (the sound, the cut chunks) is gone; the next attempt reads these.
    assert left_in_scratch(tmp_path) == [f"{JOB}-chunks"]
    transcribe(listen_payload(), listen_deps(tmp_path, Listener()))
    assert left_in_scratch(tmp_path) == []


def test_the_face_job_leaves_no_scratch_folder_on_success_or_failure(tmp_path: Path) -> None:
    deps, _beats = faces_tests.make_deps(tmp_path, simulated=True)
    detect_faces(faces_tests.payload([(0, 1_000)], **faces_tests.sim("stream", None)), deps)
    assert left_in_scratch(tmp_path) == []
    with pytest.raises(ApplicationError):
        detect_faces(faces_tests.payload([(0, 1_000)], **faces_tests.sim("stream", "fail")), deps)
    assert left_in_scratch(tmp_path) == []


# --- Off the internet --------------------------------------------------------------------------


def _compose_service(text: str, name: str) -> list[str]:
    """The lines of one top-level service in docker-compose.yml."""
    lines = text.splitlines()
    start = lines.index(f"  {name}:")
    body: list[str] = []
    for line in lines[start + 1 :]:
        if line.startswith("  ") and not line.startswith("   ") and line.strip():
            break
        if line and not line.startswith(" "):
            break
        body.append(line)
    return body


def test_the_documented_deployment_keeps_the_service_off_the_internet() -> None:
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    media = _compose_service(compose, "media")
    at = next(index for index, line in enumerate(media) if line.strip() == "ports:")
    published = []
    for line in media[at + 1 :]:
        if not line.strip().startswith("- "):
            break
        published.append(line.strip()[2:].strip().strip('"'))
    assert published, "the media image publishes its port"
    for mapping in published:
        assert mapping.startswith("127.0.0.1:"), mapping

    # The local service binds this machine only.
    scripts = json.loads((REPO_ROOT / "apps" / "media" / "package.json").read_text())["scripts"]
    assert "--host 127.0.0.1" in scripts["dev"]
    assert "0.0.0.0" not in scripts["dev"]

    guide = (REPO_ROOT / "docs" / "launch-readiness" / "06-clips-and-clips-ai.md").read_text(
        encoding="utf-8"
    )
    assert "The Python service is never public." in guide


# --- Simulation in production -----------------------------------------------------------------


@pytest.mark.parametrize(
    "values",
    [
        pytest.param({"media_simulation": True}, id="MEDIA_SIMULATION"),
        pytest.param({"clips_simulation": True}, id="CLIPS_SIMULATION-followed"),
        pytest.param({"clips_simulation": False, "media_simulation": True}, id="either-one"),
    ],
)
def test_simulation_is_refused_in_production_however_it_is_switched_on(
    make_settings: Callable[..., Settings], values: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError, match="MEDIA_SIMULATION cannot be enabled in production"):
        make_settings(node_env="production", media_internal_token=TOKEN, **values)


def test_production_with_simulation_off_boots(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings(
        node_env="production",
        media_internal_token=TOKEN,
        clips_simulation=True,
        media_simulation=False,
    )
    assert settings.simulation is False
