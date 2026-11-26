"""Structured logs: one line per event, never a payload.

JSON lines in production, a readable console locally. Callers pass only
names, ids, numbers and durations; anything that could hold speech, a token,
a key secret or a signed address must never reach a log line, so the
processor below also drops any field whose name says it might.
"""

from __future__ import annotations

import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

#: Field names that are never logged, whatever a caller passes.
FORBIDDEN_FIELDS = frozenset(
    {
        "payload",
        "input",
        "output",
        "text",
        "transcript",
        "words",
        "token",
        "secret",
        "password",
        "authorization",
        "url",
        "signed_url",
        "api_key",
    },
)


def _drop_forbidden(
    _logger: Any,
    _method: str,
    event: MutableMapping[str, Any],
) -> MutableMapping[str, Any]:
    for key in list(event):
        if key.lower() in FORBIDDEN_FIELDS:
            event[key] = "[hidden]"
    return event


def configure_logging(*, production: bool) -> None:
    """Sets up structlog once for the process."""
    renderer: Any = (
        structlog.processors.JSONRenderer()
        if production
        else structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _drop_forbidden,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> Any:
    """A logger bound to a component name."""
    return structlog.get_logger().bind(component=name)
