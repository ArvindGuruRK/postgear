"""The private Clips space, by key: the local folder or an S3 bucket.

The same two bindings as `@postgear/storage`'s private space, with the same
key rules: a key is validated before any path is built, and a local path is
resolved and refused when it falls outside the folder. Only three calls are
needed here: fetch a key to a file, put a file at a key, and ask whether a key
exists. Blocking calls, which suit activities on a thread pool.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Protocol

from postgear_media.core.keys import assert_valid_clip_key
from postgear_media.core.settings import Settings


class StorageNotFoundError(FileNotFoundError):
    """The key has no file."""


class PrivateStorage(Protocol):
    """What the activities need from the private space."""

    kind: str

    def get_to_file(self, key: str, path: Path) -> None:
        """Copies the file at `key` to `path`."""

    def put_file(self, path: Path, key: str, content_type: str) -> None:
        """Stores `path` at `key`, replacing what was there (a retry writes the same key)."""

    def exists(self, key: str) -> bool:
        """True when `key` has a file."""


class LocalPrivateStorage:
    """Files under the private folder, `apps/api/uploads-private` by default."""

    kind = "local"

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        assert_valid_clip_key(key)
        target = self.root.joinpath(*key.split("/")).resolve()
        # Unreachable for a valid key; kept as the one line between a bad key and the disk.
        if self.root not in target.parents:
            raise ValueError("Refusing to touch a path outside the private folder")
        return target

    def get_to_file(self, key: str, path: Path) -> None:
        source = self._path(key)
        if not source.is_file():
            raise StorageNotFoundError(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, path)

    def put_file(self, path: Path, key: str, content_type: str) -> None:  # noqa: ARG002
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Written beside the target and renamed, so a reader never sees half a file.
        handle, temp = tempfile.mkstemp(dir=target.parent, prefix=".part-")
        os.close(handle)
        try:
            shutil.copyfile(path, temp)
            Path(temp).replace(target)
        finally:
            Path(temp).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


class S3PrivateStorage:
    """The private bucket on S3 or MinIO (path-style for MinIO)."""

    kind = "s3"

    def __init__(self, settings: Settings) -> None:
        import boto3  # noqa: PLC0415 - only the S3 binding needs it loaded
        from botocore.config import Config  # noqa: PLC0415

        if settings.s3_access_key is None or settings.s3_secret_key is None:
            raise ValueError("Clips storage on S3 needs S3_ACCESS_KEY and S3_SECRET_KEY")
        self.bucket = settings.clips_private_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key.get_secret_value(),
            aws_secret_access_key=settings.s3_secret_key.get_secret_value(),
            config=Config(
                s3={
                    "addressing_style": "path" if settings.s3_force_path_style == "true" else "auto"
                },
                retries={"max_attempts": 4, "mode": "standard"},
            ),
        )

    def get_to_file(self, key: str, path: Path) -> None:
        from botocore.exceptions import ClientError  # noqa: PLC0415

        assert_valid_clip_key(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.client.download_file(self.bucket, key, str(path))
        except ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise StorageNotFoundError(key) from None
            raise

    def put_file(self, path: Path, key: str, content_type: str) -> None:
        assert_valid_clip_key(key)
        self.client.upload_file(
            str(path), self.bucket, key, ExtraArgs={"ContentType": content_type}
        )

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError  # noqa: PLC0415

        assert_valid_clip_key(key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True


def create_private_storage(settings: Settings) -> PrivateStorage:
    """The binding `STORAGE_PROVIDER` names; local disk is refused in production."""
    if settings.storage_provider == "s3":
        return S3PrivateStorage(settings)
    if settings.node_env == "production":
        raise ValueError("Clips needs an S3 bucket in production: set the S3 variables.")
    return LocalPrivateStorage(settings.private_directory)
