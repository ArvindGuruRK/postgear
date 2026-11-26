from __future__ import annotations

import os
import time
from collections.abc import Callable
from pathlib import Path

import pytest

from postgear_media.core.scratch import STALE_AFTER_SECONDS, scratch_folder, sweep_old
from postgear_media.core.settings import Settings
from postgear_media.providers.factory import build_provider_table


def test_scratch_folder_is_removed_however_the_block_ends(tmp_path: Path) -> None:
    with scratch_folder(tmp_path, "Job/../1") as folder:
        (folder / "f.txt").write_text("x", encoding="utf-8")
        assert folder.parent == tmp_path
        kept = folder
    assert not kept.exists()
    with pytest.raises(RuntimeError), scratch_folder(tmp_path, "job") as folder:
        kept = folder
        raise RuntimeError
    assert not kept.exists()


def test_sweep_removes_only_old_folders(tmp_path: Path) -> None:
    old = tmp_path / "old"
    young = tmp_path / "young"
    old.mkdir()
    young.mkdir()
    past = time.time() - STALE_AFTER_SECONDS - 60
    os.utime(old, (past, past))
    assert sweep_old(tmp_path) == 1
    assert not old.exists()
    assert young.exists()
    assert sweep_old(tmp_path / "missing") == 0


def test_simulation_makes_every_binding_simulated(make_settings: Callable[..., Settings]) -> None:
    table = build_provider_table(make_settings(clips_simulation=True))
    assert {table.transcriber.state, table.faces.state, table.motion.state, table.stills.state} == {
        "simulation"
    }


def test_hosted_lane_is_live_only_with_a_key(make_settings: Callable[..., Settings]) -> None:
    on = build_provider_table(make_settings(transcriber="groq", groq_api_key="k"))
    off = build_provider_table(make_settings(transcriber="groq"))
    assert on.transcriber.state == "live"
    assert off.transcriber.state == "off"


def test_models_present_reads_the_model_folder(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings()
    assert build_provider_table(settings).models_present is False
    settings.model_root.mkdir(parents=True)
    (settings.model_root / "m.bin").write_bytes(b"0")
    assert build_provider_table(settings).models_present is True
