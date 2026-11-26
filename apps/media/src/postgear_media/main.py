"""FastAPI for people and health checks; all real work arrives through Temporal.

- `GET /health`: the process is up. Open, touches nothing.
- `GET /ready`: the worker is polling and storage answers; 503 otherwise.
- `GET /tools`: the `mediaPyHealth` report (versions and bindings).

`/ready` and `/tools` need `MEDIA_INTERNAL_TOKEN` in `X-PostGear-Internal`
(required in production; without one locally they stay open to this machine).

The lifespan runs the Temporal worker as a supervised background task: if
Temporal is not reachable the HTTP side still answers (`/ready` says why) and
the worker tries again with a growing pause, so starting the service before
Docker never needs a restart.
"""

from __future__ import annotations

import asyncio
import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse

from postgear_media.activities.base import answer
from postgear_media.activities.health import health_report
from postgear_media.core.logging import configure_logging, get_logger
from postgear_media.core.settings import MEDIA_PY_TASK_QUEUE, Settings, get_settings
from postgear_media.core.storage import create_private_storage
from postgear_media.worker import run_worker

log = get_logger("http")

WorkerState = Literal["starting", "running", "retrying", "stopped", "disabled"]

#: The longest pause between two tries at reaching Temporal.
MAX_BACKOFF_SECONDS = 30.0


@dataclass
class Supervisor:
    """The worker task and what it last said."""

    state: WorkerState = "starting"
    failures: int = 0
    reason: str | None = None
    task: asyncio.Task[None] | None = field(default=None, repr=False)


async def supervise(settings: Settings, supervisor: Supervisor) -> None:
    """Keeps the worker running; never lets one failure stop the service."""
    while True:
        try:
            supervisor.state = "starting"

            def serving() -> None:
                supervisor.state = "running"
                supervisor.reason = None
                supervisor.failures = 0

            await run_worker(settings, serving)
            supervisor.state = "stopped"
            return
        except asyncio.CancelledError:
            supervisor.state = "stopped"
            raise
        except Exception as error:  # noqa: BLE001 - any failure is retried, by design
            supervisor.failures += 1
            supervisor.state = "retrying"
            # The type only: a message could carry an address.
            supervisor.reason = type(error).__name__
            pause = min(MAX_BACKOFF_SECONDS, 2.0 ** min(supervisor.failures, 5))
            log.warning("worker.retry", reason=supervisor.reason, pause_s=pause)
            await asyncio.sleep(pause)


def create_app(settings: Settings | None = None) -> FastAPI:
    """The app. Tests pass their own settings and usually no worker."""
    active = settings or get_settings()
    supervisor = Supervisor()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        configure_logging(production=active.node_env == "production")
        if active.media_run_worker:
            supervisor.task = asyncio.create_task(supervise(active, supervisor))
        else:
            supervisor.state = "disabled"
        log.info("service.started", queue=MEDIA_PY_TASK_QUEUE, simulation=active.simulation)
        try:
            yield
        finally:
            if supervisor.task is not None:
                supervisor.task.cancel()
                with suppress(asyncio.CancelledError):
                    await supervisor.task
            log.info("service.stopped")

    app = FastAPI(
        title="PostGear Media",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = active
    app.state.supervisor = supervisor

    def internal_only(
        x_postgear_internal: Annotated[str | None, Header()] = None,
    ) -> None:
        token = active.media_internal_token
        if token is None:
            return
        given = x_postgear_internal or ""
        if not hmac.compare_digest(given.encode(), token.get_secret_value().encode()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorised")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready", dependencies=[Depends(internal_only)])
    def ready() -> JSONResponse:
        checks: dict[str, Any] = {"worker": supervisor.state, "storage": "ok"}
        try:
            storage = create_private_storage(active)
            checks["storageKind"] = storage.kind
        except Exception as error:  # noqa: BLE001 - reported, never raised
            checks["storage"] = type(error).__name__
        is_ready = supervisor.state in {"running", "disabled"} and checks["storage"] == "ok"
        if supervisor.reason:
            checks["reason"] = supervisor.reason
        return JSONResponse(
            {"ready": is_ready, "checks": checks},
            status_code=status.HTTP_200_OK if is_ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    @app.get("/tools", dependencies=[Depends(internal_only)])
    def tools() -> dict[str, Any]:
        return answer(health_report(active))

    return app


def __getattr__(name: str) -> Any:
    """`uvicorn postgear_media.main:app` builds the app on first use, not at import."""
    if name == "app":
        built = create_app()
        globals()["app"] = built
        return built
    raise AttributeError(name)
