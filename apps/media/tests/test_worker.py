"""The Python worker's own settings (Module 09: how quickly a cancel is heard)."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import pytest

from postgear_media import worker as worker_module
from postgear_media.core.settings import Settings


def test_a_cancel_is_heard_within_two_seconds(
    make_settings: Callable[..., Settings], monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}

    def fake_worker(_client: object, **options: Any) -> object:
        seen.update(options)
        return object()

    monkeypatch.setattr(worker_module, "Worker", fake_worker)
    with ThreadPoolExecutor(max_workers=1) as executor:
        worker_module.build_worker(object(), make_settings(), executor)  # type: ignore[arg-type]
    assert seen["max_heartbeat_throttle_interval"] == timedelta(seconds=2)
    assert seen["default_heartbeat_throttle_interval"] == timedelta(seconds=2)
