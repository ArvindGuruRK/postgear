"""What every activity does around its work.

- Validates its one input with the generated model; a mismatch is a
  non-retryable `MEDIA_BAD_INPUT`, and a different contract version is
  `MEDIA_CONTRACT_MISMATCH`, so a half-finished deploy fails loudly.
- Logs one line at the start and one at the end with its name, the job id,
  the attempt and the time taken, never the input.
- Answers `model_dump(by_alias=True, mode="json")`: camelCase, JSON types.
- Turns a cancel into Temporal's own `CancelledError` at the next heartbeat.
- Turns any other exception into a fixed `MEDIA_TOOL_FAILED` (an invalid key
  into `MEDIA_BAD_INPUT`) naming only its type, with no cause chain: a
  library's message can repeat speech, a path or an address, and Temporal
  stores a failure's message and logs it with its traceback.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ValidationError
from temporalio import activity
from temporalio.exceptions import ApplicationError, CancelledError

from postgear_media.core.keys import InvalidKeyError
from postgear_media.core.logging import get_logger

CONTRACT_VERSION = 1

log = get_logger("activity")


#: The caller cancelled; raised from `checkpoint` between chunks. Temporal's own
#: type, so the server records the activity as cancelled, not failed.
Cancelled = CancelledError


def bad_input(message: str) -> ApplicationError:
    """A non-retryable error for an input the contract refuses."""
    return ApplicationError(message, type="MEDIA_BAD_INPUT", non_retryable=True)


def parse_input[T: BaseModel](model: type[T], payload: Any) -> T:
    """The input as its model, or a non-retryable error naming only the fields."""
    if isinstance(payload, dict) and payload.get("version") not in (None, CONTRACT_VERSION):
        raise ApplicationError(
            "The caller speaks a different contract version",
            type="MEDIA_CONTRACT_MISMATCH",
            non_retryable=True,
        )
    try:
        return model.model_validate(payload)
    except ValidationError as error:
        fields = sorted({".".join(str(part) for part in issue["loc"]) for issue in error.errors()})
        raise bad_input(f"The input does not match the contract: {', '.join(fields)}") from None


def answer(model: BaseModel) -> dict[str, Any]:
    """The output as the wire wants it: camelCase, JSON types, every key present.

    A `None` is sent as `null`, never left out: the contract has no optional
    keys (a value that may be absent is nullable and required), and the Node
    side refuses an answer with a key missing.
    """
    return model.model_dump(by_alias=True, mode="json")


def checkpoint(details: dict[str, Any] | None = None) -> None:
    """Heartbeats (when running inside Temporal) and stops if the caller cancelled."""
    if not activity.in_activity():
        return
    if details is None:
        activity.heartbeat()
    else:
        activity.heartbeat(details)
    if activity.is_cancelled():
        raise Cancelled("The caller cancelled this step")


def last_attempt() -> bool:
    """True inside the last try the caller's retry policy allows (False outside Temporal)."""
    if not activity.in_activity():
        return False
    info = activity.info()
    policy = info.retry_policy
    if policy is None or policy.maximum_attempts <= 0:
        return False
    return info.attempt >= policy.maximum_attempts


def plain_failure(name: str, error: Exception) -> ApplicationError:
    """`error` as a failure that names its type only: never its message or its cause."""
    if isinstance(error, InvalidKeyError):
        return bad_input("A key in the input is not one of ours")
    return ApplicationError(
        f"{name} failed on this box ({type(error).__name__})",
        type="MEDIA_TOOL_FAILED",
    )


def logged[R](name: str, job_id: str | None, work: Callable[[], R]) -> R:
    """Runs `work` with one start line and one end line."""
    attempt = activity.info().attempt if activity.in_activity() else 1
    started = time.monotonic()
    log.info("activity.start", activity=name, job_id=job_id, attempt=attempt)
    outcome = "failed"
    try:
        result = work()
        outcome = "ok"
        return result
    except Cancelled:
        outcome = "cancelled"
        raise
    except ApplicationError:
        # Ours: a fixed sentence and a type from the contract's table.
        raise
    except Exception as error:  # noqa: BLE001 - any other error leaves as its type only, by design
        raise plain_failure(name, error) from None
    finally:
        log.info(
            "activity.end",
            activity=name,
            job_id=job_id,
            attempt=attempt,
            outcome=outcome,
            ms=round((time.monotonic() - started) * 1000),
        )
