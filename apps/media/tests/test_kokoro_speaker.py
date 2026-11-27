"""The Kokoro speaker (Module 09): the binding, the voice list and the program it runs.

Every test but the last runs a small fake program in place of the voice
program, so nothing loads a model. The last one runs the real program, and is
skipped unless it and the Kokoro files are on this box.
"""

from __future__ import annotations

import json
import os
import stat
import sys
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError
from temporalio.exceptions import ApplicationError

from postgear_media.activities.health import voice_list
from postgear_media.activities.speech import media_py_speak  # noqa: F401 - imports cleanly
from postgear_media.core.settings import Settings, get_settings
from postgear_media.providers.factory import get_speaker, speaker_is_simulated
from postgear_media.providers.speech.kokoro import (
    KOKORO_VOICES,
    MODEL_FILES,
    KokoroSpeaker,
    kokoro_ready,
)
from postgear_media.providers.speech.simulated import SimulatedSpeaker
from tests.conftest import FIXTURES, read_json

SRC = Path(__file__).resolve().parents[1] / "src" / "postgear_media"

#: A stand-in voice program: checks its flags, reads the line, answers like the real one.
FAKE_PROGRAM = """#!{python}
import json, os, sys
args = sys.argv[1:]
flags = dict(zip(args[::2], args[1::2]))
mode = open({mode!r}).read().strip()
line = open(flags["--text"], encoding="utf-8").read()
open({seen!r}, "w").write(json.dumps({{"args": args, "line": line, "env": sorted(os.environ)}}))
if mode == "code":
    print("voice_unknown", file=sys.stderr); sys.exit(3)
if mode == "noise":
    print("Traceback: something with the line in it", file=sys.stderr); sys.exit(1)
if mode == "hang":
    import time; time.sleep(30)
if mode == "short":
    open(flags["--out"], "wb").write(b"\\x01\\x00" * 10)
    print(json.dumps({{"sampleRate": 24000, "samples": 99}})); sys.exit(0)
open(flags["--out"], "wb").write(b"\\x01\\x00" * 2400)
print("some library chatter")
print(json.dumps({{"sampleRate": 24000, "samples": 2400}}))
"""


def _fake_program(tmp_path: Path, mode: str = "ok") -> tuple[Path, Path, Path]:
    folder = tmp_path / "voice-program"
    folder.mkdir(exist_ok=True)
    mode_file, seen = folder / "mode", folder / "seen.json"
    mode_file.write_text(mode)
    program = folder / "postgear-voice"
    program.write_text(
        FAKE_PROGRAM.format(python=sys.executable, mode=str(mode_file), seen=str(seen))
    )
    program.chmod(program.stat().st_mode | stat.S_IXUSR)
    return program, mode_file, seen


def _model_files(root: Path) -> None:
    folder = root / "kokoro"
    folder.mkdir(parents=True, exist_ok=True)
    for name in MODEL_FILES:
        (folder / name).write_bytes(b"x")


def _ready_settings(
    make_settings: Callable[..., Settings], tmp_path: Path, **extra: object
) -> Settings:
    _fake_program(tmp_path)
    _model_files(tmp_path / "models")
    return make_settings(**extra)


# --- The voices ------------------------------------------------------------------------


def test_the_kokoro_voices_are_the_shared_fixture() -> None:
    fixture = read_json(FIXTURES / "voices" / "kokoro.json")
    assert [
        {"id": e.voice.id, "name": e.voice.name, "languages": list(e.voice.languages)}
        for e in KOKORO_VOICES
    ] == fixture["voices"]


def test_every_voice_maps_to_a_kokoro_voice_and_language() -> None:
    for entry in KOKORO_VOICES:
        assert entry.kokoro_id[:2] in {"af", "am", "bf", "bm", "hf", "hm"}
        assert entry.lang == {"a": "en-us", "b": "en-gb", "h": "hi"}[entry.kokoro_id[0]]


def test_the_voice_list_follows_the_binding(
    make_settings: Callable[..., Settings], tmp_path: Path
) -> None:
    simulated = voice_list(make_settings(media_simulation=True))
    assert simulated.model_dump(mode="json") == read_json(FIXTURES / "voices" / "simulated.json")
    off = voice_list(make_settings(media_simulation=False))
    assert off.model_dump(mode="json") == read_json(FIXTURES / "voices" / "off.json")
    live = voice_list(_ready_settings(make_settings, tmp_path, media_simulation=False))
    assert live.model_dump(mode="json") == read_json(FIXTURES / "voices" / "kokoro.json")


# --- The binding -----------------------------------------------------------------------


def test_kokoro_is_ready_only_with_the_program_and_both_files(tmp_path: Path) -> None:
    program, _, _ = _fake_program(tmp_path)
    root = tmp_path / "models"
    assert kokoro_ready(program, root) is False
    _model_files(root)
    assert kokoro_ready(program, root) is True
    (root / "kokoro" / MODEL_FILES[1]).unlink()
    assert kokoro_ready(program, root) is False


def test_media_speaker_kokoro_speaks_for_real_even_under_simulation(
    make_settings: Callable[..., Settings], tmp_path: Path
) -> None:
    settings = _ready_settings(
        make_settings, tmp_path, media_simulation=True, media_speaker="kokoro"
    )
    assert isinstance(get_speaker(settings), KokoroSpeaker)
    assert speaker_is_simulated(settings) is False


def test_auto_follows_simulation_and_simulation_always_simulates(
    make_settings: Callable[..., Settings], tmp_path: Path
) -> None:
    assert isinstance(get_speaker(make_settings(media_simulation=True)), SimulatedSpeaker)
    ready = _ready_settings(make_settings, tmp_path, media_simulation=False)
    assert isinstance(get_speaker(ready), KokoroSpeaker)
    forced = make_settings(media_simulation=False, media_speaker="simulation")
    assert isinstance(get_speaker(forced), SimulatedSpeaker)
    assert speaker_is_simulated(forced) is True


def test_a_kokoro_without_its_files_is_off(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ApplicationError) as caught:
        get_speaker(make_settings(media_simulation=True, media_speaker="kokoro"))
    assert caught.value.type == "MEDIA_BINDING_OFF"
    assert caught.value.non_retryable is True


def test_the_simulated_speaker_is_refused_in_production(
    make_settings: Callable[..., Settings],
) -> None:
    with pytest.raises(ValidationError, match="MEDIA_SPEAKER=simulation"):
        make_settings(
            node_env="production",
            media_simulation=False,
            media_internal_token="x" * 64,
            media_speaker="simulation",
        )


# --- The program it runs -------------------------------------------------------------


def _speaker(tmp_path: Path, mode: str = "ok", **extra: object) -> tuple[KokoroSpeaker, Path]:
    program, _, seen = _fake_program(tmp_path, mode)
    _model_files(tmp_path / "models")
    speaker = KokoroSpeaker(program, tmp_path / "models", tmp_path / "scratch", **extra)  # type: ignore[arg-type]
    return speaker, seen


def test_it_hands_the_line_in_a_file_and_reads_the_samples(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MEDIA_INTERNAL_TOKEN", "a-secret-token-value")
    speaker, seen = _speaker(tmp_path)
    spoken = speaker.speak("नमस्ते, a secret line", "kokoro-alpha")
    assert spoken.sample_rate == 24_000
    assert spoken.duration_ms == 100
    record = json.loads(seen.read_text())
    assert record["line"] == "नमस्ते, a secret line"
    # The line is never an argument, and the voice and language are Kokoro's own.
    assert all("secret" not in arg for arg in record["args"])
    flags = dict(zip(record["args"][::2], record["args"][1::2], strict=True))
    assert (flags["--voice"], flags["--lang"]) == ("hf_alpha", "hi")
    assert flags["--model-dir"] == str(tmp_path / "models")
    # It never sees the service's tokens or keys.
    assert "MEDIA_INTERNAL_TOKEN" not in record["env"]
    assert set(record["env"]) <= {
        "PATH",
        "HOME",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "LC_CTYPE",
        "__CF_USER_TEXT_ENCODING",
    }
    # Its scratch files are gone.
    assert list((tmp_path / "scratch").iterdir()) == []


def test_an_unknown_voice_is_a_key_error(tmp_path: Path) -> None:
    speaker, _ = _speaker(tmp_path)
    with pytest.raises(KeyError):
        speaker.speak("Hello", "sim-river")


def test_a_known_code_is_kept_and_not_retried(tmp_path: Path) -> None:
    speaker, _ = _speaker(tmp_path, "code")
    with pytest.raises(ApplicationError) as caught:
        speaker.speak("Hello", "kokoro-heart")
    assert caught.value.type == "MEDIA_TOOL_FAILED"
    assert "voice_unknown" in str(caught.value)
    assert caught.value.non_retryable is True


def test_anything_else_it_prints_is_never_kept(tmp_path: Path) -> None:
    speaker, _ = _speaker(tmp_path, "noise")
    with pytest.raises(ApplicationError) as caught:
        speaker.speak("Hello", "kokoro-heart")
    assert "line" not in str(caught.value)
    assert "speak_failed" in str(caught.value)
    assert caught.value.non_retryable is False


def test_samples_that_do_not_match_its_answer_are_refused(tmp_path: Path) -> None:
    speaker, _ = _speaker(tmp_path, "short")
    with pytest.raises(ApplicationError, match="speak_failed"):
        speaker.speak("Hello", "kokoro-heart")


def test_a_cancel_kills_the_program(tmp_path: Path) -> None:
    speaker, _ = _speaker(tmp_path, "hang")

    class CancelledError(Exception):
        pass

    ticks: list[int] = []

    def tick() -> None:
        ticks.append(1)
        if len(ticks) >= 2:
            raise CancelledError

    with pytest.raises(CancelledError):
        speaker.speak("Hello", "kokoro-heart", tick)
    assert len(ticks) == 2


def test_a_run_past_the_limit_is_stopped(tmp_path: Path) -> None:
    times = iter([0.0, 1.0, 500.0, 500.0])
    speaker, _ = _speaker(tmp_path, "hang", clock=lambda: next(times))
    with pytest.raises(ApplicationError, match="timeout") as caught:
        speaker.speak("Hello", "kokoro-heart")
    # A second try would get less time than the first: never retried.
    assert caught.value.non_retryable is True


def test_a_program_that_cannot_run_is_not_ready_and_never_names_a_path(tmp_path: Path) -> None:
    program, _, _ = _fake_program(tmp_path)
    _model_files(tmp_path / "models")
    program.chmod(0o644)
    assert kokoro_ready(program, tmp_path / "models") is False
    speaker = KokoroSpeaker(program, tmp_path / "models", tmp_path / "scratch")
    with pytest.raises(ApplicationError) as caught:
        speaker.speak("Hello", "kokoro-heart")
    assert "speak_failed" in str(caught.value)
    assert str(tmp_path) not in str(caught.value)
    assert caught.value.__cause__ is None


# --- The licence wall ----------------------------------------------------------------


def test_the_service_never_imports_kokoro_or_espeak() -> None:
    banned = ("kokoro_onnx", "phonemizer", "espeakng", "espeakng_loader")
    for path in SRC.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for name in banned:
            assert f"import {name}" not in text, path
            assert f"from {name}" not in text, path


# --- The real program ------------------------------------------------------------------


@pytest.mark.voice
def test_the_real_voice_program_speaks() -> None:
    settings = get_settings()
    if not kokoro_ready(settings.voice_program, settings.model_root):
        pytest.skip("the voice program or the Kokoro files are not on this box")
    if os.environ.get("CI"):
        pytest.skip("not on CI")
    speaker = KokoroSpeaker(settings.voice_program, settings.model_root, settings.scratch_root)
    spoken = speaker.speak("Wait for it. This is the best part.", "kokoro-heart")
    assert spoken.sample_rate == 24_000
    assert 1_000 < spoken.duration_ms < 6_000
