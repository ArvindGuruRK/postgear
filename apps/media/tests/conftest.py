"""Shared test helpers: settings that never read the repo's `.env`."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from postgear_media.core.settings import REPO_ROOT, Settings, get_settings

CONTRACT_DIR = REPO_ROOT / "packages" / "media-contract"
FIXTURES = CONTRACT_DIR / "fixtures"

_ENV_NAMES = (
    "NODE_ENV",
    "CLIPS_SIMULATION",
    "MEDIA_SIMULATION",
    "MEDIA_INTERNAL_TOKEN",
    "STORAGE_PROVIDER",
    "UPLOAD_DIRECTORY",
    "TRANSCRIBER",
    "TRANSCRIBE_HOSTED_ABOVE_MINUTES",
    "GROQ_API_KEY",
    "MEDIA_MODEL_DIR",
    "MEDIA_SCRATCH_DIR",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in _ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def make_settings(tmp_path: Path) -> Callable[..., Settings]:
    """Settings with no `.env`, a private folder and model folder under `tmp_path`."""

    def build(**overrides: Any) -> Settings:
        values: dict[str, Any] = {
            "upload_directory": str(tmp_path / "uploads"),
            "media_model_dir": str(tmp_path / "models"),
            "media_scratch_dir": str(tmp_path / "scratch"),
            "media_voice_program": str(tmp_path / "voice-program" / "postgear-voice"),
            "media_run_worker": False,
        }
        values.update(overrides)
        return Settings(_env_file=None, **values)

    return build


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
