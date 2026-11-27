"""The Temporal worker on `postgear-media-py`: activities only, on a thread pool.

No Python workflow is registered, so the workflow sandbox never applies here.
Activities are plain `def` functions (blocking native work), so they run on a
`ThreadPoolExecutor`; `MEDIA_MAX_ACTIVITIES` slots (1 on a CPU box, where the
model is the bottleneck).

Run on its own with `python -m postgear_media.worker`, or inside the FastAPI
lifespan (`main.py`), which is what `npm run dev` does.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

from temporalio.client import Client
from temporalio.worker import Worker

from postgear_media.activities.health import media_py_health
from postgear_media.activities.speech import media_py_speak
from postgear_media.activities.transcribe import media_py_transcribe
from postgear_media.activities.visual import (
    media_py_detect_faces,
    media_py_motion,
    media_py_stills,
)
from postgear_media.core.logging import configure_logging, get_logger
from postgear_media.core.scratch import sweep_old
from postgear_media.core.settings import MEDIA_PY_TASK_QUEUE, Settings, get_settings

log = get_logger("worker")

#: The longest gap between heartbeats the SDK sends. A cancel reaches an
#: activity only in a heartbeat's answer, so this is how quickly a cancelled
#: step stops (the SDK's default is 60 seconds; the Node clip workers use 5).
HEARTBEAT_THROTTLE = timedelta(seconds=2)

#: Every activity this service serves. A module adds its function here.
ACTIVITIES: Sequence[Callable[..., Any]] = (
    media_py_health,
    media_py_transcribe,
    media_py_motion,
    media_py_stills,
    media_py_detect_faces,
    media_py_speak,
)


async def connect(settings: Settings) -> Client:
    """The Temporal client for the shared server and namespace."""
    return await Client.connect(settings.temporal_host, namespace=settings.temporal_namespace)


def build_worker(
    client: Client,
    settings: Settings,
    executor: ThreadPoolExecutor,
    task_queue: str = MEDIA_PY_TASK_QUEUE,
) -> Worker:
    """The worker, ready to `run()`."""
    return Worker(
        client,
        task_queue=task_queue,
        activities=list(ACTIVITIES),
        activity_executor=executor,
        max_concurrent_activities=settings.media_max_activities,
        graceful_shutdown_timeout=timedelta(minutes=2),
        max_heartbeat_throttle_interval=HEARTBEAT_THROTTLE,
        default_heartbeat_throttle_interval=HEARTBEAT_THROTTLE,
    )


async def run_worker(settings: Settings, on_serving: Callable[[], None] | None = None) -> None:
    """Connects and polls until cancelled. `on_serving` runs once the server answered."""
    removed = sweep_old(settings.scratch_root)
    if removed:
        log.info("scratch.swept", removed=removed)
    client = await connect(settings)
    with ThreadPoolExecutor(max_workers=settings.media_max_activities) as executor:
        worker = build_worker(client, settings, executor)
        if on_serving is not None:
            on_serving()
        log.info(
            "worker.serving",
            queue=MEDIA_PY_TASK_QUEUE,
            simulation=settings.simulation,
            slots=settings.media_max_activities,
        )
        await worker.run()


def main() -> None:
    """`python -m postgear_media.worker`: the worker without the HTTP side."""
    settings = get_settings()
    configure_logging(production=settings.node_env == "production")
    try:
        asyncio.run(run_worker(settings))
    except KeyboardInterrupt:
        log.info("worker.stopped")


if __name__ == "__main__":
    main()
