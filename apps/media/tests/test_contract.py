"""The same fixture files the Jest suite parses, through the generated models,
and the generated file checked against a fresh run of the generator."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from postgear_media.contract import generated
from postgear_media.contract.generate import TARGET, generate
from tests.conftest import FIXTURES, read_json

#: Activity name to its (input, output) models. A module adds its row.
MODELS: dict[str, tuple[type[BaseModel], type[BaseModel]]] = {
    "mediaPyHealth": (generated.MediaPyHealthInput, generated.MediaPyHealthOutput),
    "mediaPyTranscribe": (generated.MediaPyTranscribeInput, generated.MediaPyTranscribeOutput),
    "mediaPyMotion": (generated.MediaPyMotionInput, generated.MediaPyMotionOutput),
    "mediaPyStills": (generated.MediaPyStillsInput, generated.MediaPyStillsOutput),
    "mediaPyDetectFaces": (
        generated.MediaPyDetectFacesInput,
        generated.MediaPyDetectFacesOutput,
    ),
}

#: Stored files both sides read and write, by the shape's name.
FILE_MODELS: dict[str, type[BaseModel]] = {
    "HeardFile": generated.HeardFile,
    "MotionFile": generated.MotionFile,
    "FaceTracksFile": generated.FaceTracksFile,
}


def _cases(kind: str) -> list[tuple[str, Path]]:
    cases: list[tuple[str, Path]] = []
    for activity in sorted(MODELS):
        folder = FIXTURES / activity / kind
        cases.extend((activity, path) for path in sorted(folder.glob("*.json")))
    return cases


def _model(activity: str, path: Path) -> type[BaseModel]:
    input_model, output_model = MODELS[activity]
    return input_model if path.name.startswith("input") else output_model


def test_every_contract_activity_has_models_and_fixtures() -> None:
    folders = {p.name for p in FIXTURES.iterdir() if p.is_dir() and p.name not in {"keys", "files"}}
    assert folders == set(MODELS)
    assert {p.name for p in (FIXTURES / "files").iterdir() if p.is_dir()} == set(FILE_MODELS)
    for activity in MODELS:
        assert list((FIXTURES / activity / "valid").glob("*.json"))
        assert list((FIXTURES / activity / "invalid").glob("*.json"))


@pytest.mark.parametrize(("activity", "path"), _cases("valid"), ids=str)
def test_valid_fixtures_parse(activity: str, path: Path) -> None:
    model = _model(activity, path)
    payload = read_json(path)
    parsed = model.model_validate(payload)
    assert parsed.model_dump(by_alias=True, mode="json") == payload


@pytest.mark.parametrize(("activity", "path"), _cases("invalid"), ids=str)
def test_invalid_fixtures_fail(activity: str, path: Path) -> None:
    with pytest.raises(ValidationError):
        _model(activity, path).model_validate(read_json(path))


def _file_cases(kind: str) -> list[tuple[str, Path]]:
    cases: list[tuple[str, Path]] = []
    for name in sorted(FILE_MODELS):
        cases.extend(
            (name, path) for path in sorted((FIXTURES / "files" / name / kind).glob("*.json"))
        )
    return cases


@pytest.mark.parametrize(("name", "path"), _file_cases("valid"), ids=str)
def test_valid_file_fixtures_parse(name: str, path: Path) -> None:
    payload = read_json(path)
    parsed = FILE_MODELS[name].model_validate(payload)
    assert parsed.model_dump(by_alias=True, mode="json") == payload


@pytest.mark.parametrize(("name", "path"), _file_cases("invalid"), ids=str)
def test_invalid_file_fixtures_fail(name: str, path: Path) -> None:
    with pytest.raises(ValidationError):
        FILE_MODELS[name].model_validate(read_json(path))


def test_generated_models_are_current(tmp_path: Path) -> None:
    fresh = generate(target=tmp_path / "generated.py")
    assert fresh.read_text(encoding="utf-8") == TARGET.read_text(encoding="utf-8"), (
        "generated.py is stale: run `npm run contract:python`"
    )
