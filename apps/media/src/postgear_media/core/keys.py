"""The private Clips key rules: a Python copy of `@postgear/storage`'s allowlist.

The pattern is the contract's `CLIP_KEY_PATTERN_SOURCE`, word for word, and
`tests/test_keys.py` checks it against the same `fixtures/keys/examples.json`
the TypeScript side checks, so the two copies cannot drift apart unnoticed.

The service writes only under a job's own folders, with names it makes here.
"""

from __future__ import annotations

import re
import secrets

CLIP_KEY_PATTERN = re.compile(
    r"^clips/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}/"
    r"(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"
    r"[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}"
    r"|(?:exports|proofs|downloads)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"
    r"[a-z0-9]+(?:[-_][a-z0-9]+){0,7}"
    r"|library/[0-9a-f]{32})"
    r"\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\.gz|ass|vtt)$",
)

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_ORG = re.compile(r"^[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}$")
_KIND = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}$")

EXTENSIONS = frozenset(
    {
        "mp4",
        "webm",
        "mkv",
        "mov",
        "m4a",
        "mp3",
        "wav",
        "ogg",
        "opus",
        "aac",
        "jpg",
        "png",
        "apng",
        "gif",
        "webp",
        "json",
        "json.gz",
        "ass",
        "vtt",
    },
)


class InvalidKeyError(ValueError):
    """A key this service did not, and could not, have made."""


def is_valid_clip_key(key: object) -> bool:
    """True for a key one of the builders could have produced."""
    return isinstance(key, str) and len(key) <= 512 and CLIP_KEY_PATTERN.match(key) is not None


def assert_valid_clip_key(key: object) -> str:
    """The key, or `InvalidKeyError` for anything outside the private shapes."""
    if not is_valid_clip_key(key):
        raise InvalidKeyError("Refusing to touch a private key PostGear did not generate")
    return str(key)


def video_file_key(org_id: str, video_id: str, kind: str, ext: str) -> str:
    """A new random key for one of a video's files, as `clipKeys.videoFile` makes it."""
    if len(org_id) > 64 or not _ORG.match(org_id):
        raise InvalidKeyError("A private key needs a workspace id of lowercase letters and dashes")
    if not _UUID.match(video_id):
        raise InvalidKeyError("A private key needs a lowercase UUID for the video")
    segment = kind.lower().replace("_", "-")
    if len(segment) > 48 or not _KIND.match(segment):
        raise InvalidKeyError("A private key needs a short kind of letters, digits and dashes")
    if ext not in EXTENSIONS:
        raise InvalidKeyError("A private key needs an allowed file extension")
    return assert_valid_clip_key(
        f"clips/{org_id}/{video_id}/{segment}-{secrets.token_hex(16)}.{ext}"
    )
