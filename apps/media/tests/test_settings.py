from __future__ import annotations

from collections.abc import Callable

import pytest
from pydantic import ValidationError

from postgear_media.core.settings import Settings


def test_simulation_follows_clips_simulation_when_unset(
    make_settings: Callable[..., Settings],
) -> None:
    assert make_settings(clips_simulation=True).simulation is True
    assert make_settings(clips_simulation=False).simulation is False


def test_media_simulation_wins_when_set(make_settings: Callable[..., Settings]) -> None:
    assert make_settings(clips_simulation=True, media_simulation=False).simulation is False
    assert make_settings(clips_simulation=False, media_simulation=True).simulation is True


def test_simulation_is_refused_in_production(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ValidationError, match="MEDIA_SIMULATION cannot be enabled"):
        make_settings(node_env="production", media_simulation=True, media_internal_token="x" * 64)


def test_production_needs_the_internal_token(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ValidationError, match="MEDIA_INTERNAL_TOKEN is required"):
        make_settings(node_env="production", media_simulation=False, storage_provider="s3")


def test_port_comes_from_media_url(make_settings: Callable[..., Settings]) -> None:
    assert make_settings().http_port == 8100
    assert make_settings(media_url="http://127.0.0.1:9123").http_port == 9123


def test_private_directory_sits_beside_the_upload_directory(
    make_settings: Callable[..., Settings],
) -> None:
    settings = make_settings()
    assert settings.private_directory.name == "uploads-private"


def test_empty_values_read_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_INTERNAL_TOKEN", "")
    monkeypatch.setenv("TRANSCRIBER", "")
    settings = Settings(_env_file=None)
    assert settings.media_internal_token is None
    assert settings.transcriber == "faster-whisper"


def test_unknown_names_in_the_environment_are_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOMETHING_THE_API_READS", "1")
    Settings(_env_file=None)
