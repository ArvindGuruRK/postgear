"""The hosted fast lane: Groq's Whisper, behind `TRANSCRIBER=groq` and a key (decision D13-03).

Each chunk (at most ten minutes, a 16 kHz mono WAV of about 19 MB, under the
25 MB a request may carry) is sent with word timings asked for. A busy or
failing service is tried again with a growing pause; a refused key or a file
it cannot read is not. The sound leaves our servers only when this lane is
on, and the privacy text names the provider then.

Word confidence is not in Groq's word list, so words are marked sure (`1`)
unless their segment was unlikely as text.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx
from temporalio.exceptions import ApplicationError

from postgear_media.providers.transcribe.base import Heard, ListenRequest, Word

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"
#: Tries at one chunk before the activity itself is failed (and retried by Temporal).
MAX_TRIES = 4
RETRY_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})
REQUEST_TIMEOUT_SECONDS = 180.0
#: A segment this unlikely as text marks its words unsure.
UNSURE_LOGPROB = -0.8


def _retryable(message: str) -> ApplicationError:
    return ApplicationError(message, type="MEDIA_TOOL_FAILED")


def _binding_off(message: str) -> ApplicationError:
    return ApplicationError(message, type="MEDIA_BINDING_OFF", non_retryable=True)


def words_from_answer(body: dict[str, Any], limit_ms: int) -> list[Word]:
    """Groq's `verbose_json` answer as words, with a confidence borrowed from the segment."""
    segments = body.get("segments") or []

    def sure_at(second: float) -> float:
        for segment in segments:
            if float(segment.get("start", 0)) <= second < float(segment.get("end", 0)):
                return 0.5 if float(segment.get("avg_logprob", 0)) < UNSURE_LOGPROB else 1.0
        return 1.0

    words: list[Word] = []
    for item in body.get("words") or []:
        text = str(item.get("word", "")).strip()
        if not text:
            continue
        start_s = float(item.get("start", 0))
        start = max(0, round(start_s * 1000))
        end = min(limit_ms, max(start + 1, round(float(item.get("end", start_s)) * 1000)))
        if start >= limit_ms:
            continue
        words.append(Word(start=start, end=end, text=text, sure=sure_at(start_s)))
    return words


class GroqTranscriber:
    """Speech to text through Groq."""

    name = f"groq:{GROQ_MODEL}"
    max_chunk_ms = 10 * 60_000

    def __init__(
        self,
        api_key: str,
        *,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._api_key = api_key
        self._client = client or httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS)
        self._sleep = sleep

    def listen(self, request: ListenRequest) -> Heard:
        data: dict[str, Any] = {
            "model": GROQ_MODEL,
            "response_format": "verbose_json",
            "timestamp_granularities[]": ["word", "segment"],
            "temperature": "0",
        }
        if request.language:
            data["language"] = request.language
        audio = request.chunk.path.read_bytes()

        for attempt in range(1, MAX_TRIES + 1):
            request.checkpoint()
            try:
                response = self._client.post(
                    GROQ_URL,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    data=data,
                    files={"file": ("chunk.wav", audio, "audio/wav")},
                )
            except httpx.HTTPError:
                if attempt == MAX_TRIES:
                    raise _retryable("The hosted speech service could not be reached") from None
                self._sleep(min(30.0, 2.0**attempt))
                continue
            if response.status_code == 200:
                body = response.json()
                return Heard(
                    words=words_from_answer(body, request.chunk.length_ms),
                    language=_language_code(body.get("language"), request.language),
                    language_probability=None,
                )
            if response.status_code in {401, 403}:
                raise _binding_off("The hosted speech service refused the key")
            if response.status_code in RETRY_STATUSES:
                if attempt == MAX_TRIES:
                    raise _retryable("The hosted speech service is busy")
                self._sleep(_pause(response, attempt))
                continue
            # 400 and friends: the same chunk fails the same way.
            raise ApplicationError(
                "The hosted speech service could not read this sound",
                type="MEDIA_BAD_AUDIO",
                non_retryable=True,
            )
        raise _retryable("The hosted speech service is busy")


def _pause(response: httpx.Response, attempt: int) -> float:
    """`Retry-After` when the service gave one, else a growing pause, never over a minute."""
    header = response.headers.get("retry-after", "")
    try:
        return min(60.0, max(1.0, float(header)))
    except ValueError:
        return min(30.0, 2.0**attempt)


#: Groq answers the language as an English name; these are the ones Clips offers.
_LANGUAGE_NAMES = {
    "english": "en",
    "hindi": "hi",
    "tamil": "ta",
    "marathi": "mr",
    "spanish": "es",
    "french": "fr",
    "german": "de",
    "portuguese": "pt",
    "italian": "it",
    "dutch": "nl",
    "indonesian": "id",
    "turkish": "tr",
}


def _language_code(answer: object, asked: str | None) -> str | None:
    if asked:
        return asked
    text = str(answer or "").strip().lower()
    if len(text) in {2, 3} and text.isalpha():
        return text
    return _LANGUAGE_NAMES.get(text)
