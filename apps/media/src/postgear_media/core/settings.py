"""Settings, read once from the repo root `.env` and the real environment.

The root `.env` is shared with the API and the worker, so it holds dozens of
names this service does not declare: `extra="ignore"` keeps them out, and an
empty value reads as unset (`env_ignore_empty`), as the Node side's
`blankAsUnset` does. Real environment variables win over the file.

Never a module-level instance: `get_settings()` is cached, and tests build
their own `Settings(...)` or clear the cache.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path
from tempfile import gettempdir
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from postgear_media import __version__

REPO_ROOT = Path(__file__).resolve().parents[5]
ROOT_ENV = REPO_ROOT / ".env"

MEDIA_PY_TASK_QUEUE = "postgear-media-py"

SIMULATION_IN_PRODUCTION = "MEDIA_SIMULATION cannot be enabled in production"
TOKEN_REQUIRED = "MEDIA_INTERNAL_TOKEN is required in production"  # noqa: S105 - a message


class Settings(BaseSettings):
    """Everything the service reads from its environment."""

    model_config = SettingsConfigDict(
        env_file=ROOT_ENV,
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
        case_sensitive=False,
    )

    node_env: Literal["development", "test", "production"] = "development"

    temporal_host: str = "localhost:7233"
    temporal_namespace: str = "default"

    storage_provider: Literal["local", "s3"] = "local"
    upload_directory: str | None = None
    s3_endpoint: str | None = None
    s3_region: str = "us-east-1"
    s3_access_key: SecretStr | None = None
    s3_secret_key: SecretStr | None = None
    s3_force_path_style: Literal["true", "false"] | None = None
    clips_private_bucket: str = "postgear-clips"

    clips_simulation: bool = False
    media_simulation: bool | None = Field(
        default=None,
        description="Follows CLIPS_SIMULATION when unset.",
    )

    media_url: str = "http://localhost:8100"
    media_internal_token: SecretStr | None = None
    media_scratch_dir: str | None = None
    media_model_dir: str | None = None
    media_max_activities: int = Field(default=1, ge=1, le=16)
    media_run_worker: bool = True

    transcriber: Literal["faster-whisper", "groq", "simulation", "auto"] = "faster-whisper"
    whisper_model: str = "large-v3-turbo"
    groq_api_key: SecretStr | None = None

    @model_validator(mode="after")
    def _refuse_simulation_in_production(self) -> Settings:
        if self.node_env == "production" and self.simulation:
            raise ValueError(SIMULATION_IN_PRODUCTION)
        if self.node_env == "production" and self.media_internal_token is None:
            raise ValueError(TOKEN_REQUIRED)
        return self

    @property
    def simulation(self) -> bool:
        """`MEDIA_SIMULATION`, or `CLIPS_SIMULATION` when it is unset."""
        if self.media_simulation is None:
            return self.clips_simulation
        return self.media_simulation

    @property
    def scratch_root(self) -> Path:
        """Where activities work: `MEDIA_SCRATCH_DIR`, or the system temp folder."""
        if self.media_scratch_dir:
            return Path(self.media_scratch_dir).resolve()
        return Path(gettempdir()) / "postgear-media"

    @property
    def model_root(self) -> Path:
        """Where model files live: `MEDIA_MODEL_DIR`, or `.cache/media-models` in the repo."""
        if self.media_model_dir:
            return Path(self.media_model_dir).resolve()
        return REPO_ROOT / ".cache" / "media-models"

    @property
    def private_directory(self) -> Path:
        """The local private Clips folder: beside the upload directory, as the Node side has it."""
        upload = (
            Path(self.upload_directory).resolve()
            if self.upload_directory
            else REPO_ROOT / "apps" / "api" / "uploads"
        )
        if upload.parent == upload:
            raise ValueError("The upload directory cannot be a filesystem root")
        return upload.parent / f"{upload.name}-private"

    @property
    def http_port(self) -> int:
        """The port in `MEDIA_URL` (8100 by default)."""
        tail = self.media_url.rsplit(":", 1)[-1].split("/", 1)[0]
        return int(tail) if tail.isdigit() else 8100


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The process's settings, read once."""
    return Settings()


def service_version() -> str:
    """The service's own version."""
    return __version__


def python_version() -> str:
    """The running Python, such as `3.13.18`."""
    return ".".join(str(part) for part in sys.version_info[:3])
