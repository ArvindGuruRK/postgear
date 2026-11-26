"""Scratch folders: one per activity attempt, always removed.

`scratch_folder(root, job_id)` makes `<root>/<job id>-<random>/` and removes it
when the block ends, however it ends. `sweep_old(root)` runs at boot and
removes folders older than a day that a killed process left behind.
"""

from __future__ import annotations

import re
import secrets
import shutil
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

#: A folder older than this at boot was left by a process that died.
STALE_AFTER_SECONDS = 24 * 60 * 60

_SAFE = re.compile(r"[^a-z0-9-]")


@contextmanager
def scratch_folder(root: Path, job_id: str) -> Iterator[Path]:
    """A fresh folder for one attempt, removed in `finally`."""
    name = _SAFE.sub("", job_id.lower())[:64] or "job"
    folder = root / f"{name}-{secrets.token_hex(4)}"
    folder.mkdir(parents=True, exist_ok=False)
    try:
        yield folder
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def sweep_old(root: Path, *, now: float | None = None) -> int:
    """Removes folders under `root` older than a day; answers how many went."""
    if not root.is_dir():
        return 0
    cutoff = (now if now is not None else time.time()) - STALE_AFTER_SECONDS
    removed = 0
    for child in root.iterdir():
        if child.is_dir() and child.stat().st_mtime < cutoff:
            shutil.rmtree(child, ignore_errors=True)
            removed += 1
    return removed
