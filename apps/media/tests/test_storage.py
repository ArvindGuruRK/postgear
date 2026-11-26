from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from postgear_media.core.keys import InvalidKeyError
from postgear_media.core.settings import Settings
from postgear_media.core.storage import (
    LocalPrivateStorage,
    StorageNotFoundError,
    create_private_storage,
)

KEY = (
    "clips/seed-demo-org/2f1c8a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/"
    "transcript-0123456789abcdef0123456789abcdef.json"
)


def test_local_put_get_exists(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    source = tmp_path / "in.json"
    source.write_text('{"a":1}', encoding="utf-8")
    assert not storage.exists(KEY)
    storage.put_file(source, KEY, "application/json")
    assert storage.exists(KEY)
    target = tmp_path / "out" / "copy.json"
    storage.get_to_file(KEY, target)
    assert target.read_text(encoding="utf-8") == '{"a":1}'


def test_a_retry_overwrites_the_same_key(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    first = tmp_path / "a.json"
    first.write_text("1", encoding="utf-8")
    second = tmp_path / "b.json"
    second.write_text("2", encoding="utf-8")
    storage.put_file(first, KEY, "application/json")
    storage.put_file(second, KEY, "application/json")
    out = tmp_path / "c.json"
    storage.get_to_file(KEY, out)
    assert out.read_text(encoding="utf-8") == "2"
    leftovers = [p.name for p in (tmp_path / "private").rglob(".part-*")]
    assert leftovers == []


def test_missing_key_is_not_found(tmp_path: Path) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    with pytest.raises(StorageNotFoundError):
        storage.get_to_file(KEY, tmp_path / "x.json")


@pytest.mark.parametrize("key", ["../../etc/passwd", "clips/../../x.json", "/tmp/x.json"])
def test_bad_keys_never_reach_the_disk(tmp_path: Path, key: str) -> None:
    storage = LocalPrivateStorage(tmp_path / "private")
    with pytest.raises(InvalidKeyError):
        storage.exists(key)


def test_local_storage_is_refused_in_production(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings(node_env="production", media_internal_token="x" * 64)
    with pytest.raises(ValueError, match="S3 bucket in production"):
        create_private_storage(settings)


def test_s3_needs_its_keys(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ValueError, match="S3_ACCESS_KEY"):
        create_private_storage(make_settings(storage_provider="s3"))
