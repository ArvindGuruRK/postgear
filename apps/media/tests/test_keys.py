from __future__ import annotations

import re

import pytest

from postgear_media.core.keys import (
    CLIP_KEY_PATTERN,
    InvalidKeyError,
    assert_valid_clip_key,
    is_valid_clip_key,
    video_file_key,
)
from tests.conftest import CONTRACT_DIR, FIXTURES, read_json

EXAMPLES = read_json(FIXTURES / "keys" / "examples.json")
VIDEO = "2f1c8a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b"


@pytest.mark.parametrize("key", EXAMPLES["valid"])
def test_shared_valid_examples_pass(key: str) -> None:
    assert is_valid_clip_key(key)


@pytest.mark.parametrize("key", EXAMPLES["invalid"])
def test_shared_invalid_examples_fail(key: str) -> None:
    assert not is_valid_clip_key(key)
    with pytest.raises(InvalidKeyError):
        assert_valid_clip_key(key)


def test_the_pattern_is_the_contracts_word_for_word() -> None:
    source = (CONTRACT_DIR / "src" / "shapes" / "common.ts").read_text(encoding="utf-8")
    match = re.search(r"CLIP_KEY_PATTERN_SOURCE =\s*'([^']+)'", source)
    assert match is not None
    contract_pattern = match.group(1).replace("\\\\", "\\")
    assert contract_pattern == CLIP_KEY_PATTERN.pattern


def test_video_file_key_builds_a_valid_random_key() -> None:
    first = video_file_key("seed-demo-org", VIDEO, "TRANSCRIPT", "json.gz")
    second = video_file_key("seed-demo-org", VIDEO, "TRANSCRIPT", "json.gz")
    assert is_valid_clip_key(first)
    assert first != second
    assert first.startswith(f"clips/seed-demo-org/{VIDEO}/transcript-")


@pytest.mark.parametrize(
    ("org", "video", "kind", "ext"),
    [
        ("../x", VIDEO, "transcript", "json"),
        ("seed-demo-org", "not-a-uuid", "transcript", "json"),
        ("seed-demo-org", VIDEO, "../x", "json"),
        ("seed-demo-org", VIDEO, "transcript", "html"),
    ],
)
def test_video_file_key_refuses_bad_parts(org: str, video: str, kind: str, ext: str) -> None:
    with pytest.raises(InvalidKeyError):
        video_file_key(org, video, kind, ext)
