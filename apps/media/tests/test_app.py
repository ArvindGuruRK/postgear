from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

from postgear_media.core.settings import Settings
from postgear_media.main import create_app

TOKEN = "a" * 64


def test_health_is_open(make_settings: Callable[..., Settings]) -> None:
    with TestClient(create_app(make_settings(media_internal_token=TOKEN))) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_and_tools_need_the_token(make_settings: Callable[..., Settings]) -> None:
    with TestClient(create_app(make_settings(media_internal_token=TOKEN))) as client:
        assert client.get("/ready").status_code == 401
        assert client.get("/tools", headers={"X-PostGear-Internal": "wrong"}).status_code == 401
        ready = client.get("/ready", headers={"X-PostGear-Internal": TOKEN})
        tools = client.get("/tools", headers={"X-PostGear-Internal": TOKEN})
    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert ready.json()["checks"]["worker"] == "disabled"
    assert tools.status_code == 200
    assert tools.json()["taskQueue"] == "postgear-media-py"


def test_ready_is_503_when_storage_cannot_be_used(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings(media_internal_token=TOKEN, storage_provider="s3")
    with TestClient(create_app(settings)) as client:
        response = client.get("/ready", headers={"X-PostGear-Internal": TOKEN})
    assert response.status_code == 503
    assert response.json()["checks"]["storage"] == "ValueError"


def test_no_docs_routes_are_served(make_settings: Callable[..., Settings]) -> None:
    with TestClient(create_app(make_settings())) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_ready_is_503_while_temporal_cannot_be_reached(
    make_settings: Callable[..., Settings],
) -> None:
    # Nothing listens on this port: the worker keeps retrying and the HTTP side still answers.
    settings = make_settings(
        media_internal_token=TOKEN,
        media_run_worker=True,
        temporal_host="127.0.0.1:1",
    )
    with TestClient(create_app(settings)) as client:
        health = client.get("/health")
        ready = client.get("/ready", headers={"X-PostGear-Internal": TOKEN})
    assert health.status_code == 200
    assert ready.status_code == 503
    assert ready.json()["checks"]["worker"] in {"starting", "retrying"}
