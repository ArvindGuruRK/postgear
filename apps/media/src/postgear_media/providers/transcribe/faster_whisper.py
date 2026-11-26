"""Our own machine: faster-whisper (Whisper on CTranslate2), no graphics card needed.

Settings follow research 04: `int8` on a processor, word timings on, the
library's own voice detection on so silence and music are skipped, no
carry-over between windows (one bad window cannot poison the next), and a
two second hallucination guard. The model is loaded once, lazily, behind a
lock; its files live in `MEDIA_MODEL_DIR` and are downloaded on first real
use (one log line says so). Nothing here runs under `MEDIA_SIMULATION`.

The `ml` dependency group must be installed (`uv sync --group ml`); without
it the factory reports this binding as off and never imports this module's
library.
"""

from __future__ import annotations

import threading
import wave
from pathlib import Path
from typing import Any

from temporalio.exceptions import ApplicationError

from postgear_media.core.logging import get_logger
from postgear_media.providers.transcribe.base import (
    Heard,
    ListenRequest,
    TranscriberOffError,
    Word,
)
from postgear_media.services.audio import ANALYSIS_RATE, bad_audio

log = get_logger("faster-whisper")

#: Segments at least this likely to be silence, and this unlikely as text, are dropped.
NO_SPEECH_DROP = 0.6
LOW_LOGPROB_DROP = -1.0
#: A phrase repeated more than this many times in a row is a loop, kept once.
MAX_REPEATS = 3


def collapse_repeats(words: list[Word], max_repeats: int = MAX_REPEATS) -> list[Word]:
    """Drops the tail of a single word repeated over and over (a decoding loop)."""
    out: list[Word] = []
    run = 0
    for word in words:
        same = bool(out) and out[-1].text.strip().lower() == word.text.strip().lower()
        run = run + 1 if same else 1
        if run <= max_repeats:
            out.append(word)
    return out


def load_samples(path: Path) -> Any:
    """The chunk's sound as the float array Whisper takes (16 kHz, mono, -1 to 1).

    The chunk is our own 16 kHz 16-bit WAV, so it is read with the standard
    library and handed over as samples. The library's own decoder (PyAV) is
    never used: its releases break against it, and there is nothing to decode.
    """
    import numpy as np  # type: ignore[import-not-found,unused-ignore]  # noqa: PLC0415

    try:
        with wave.open(str(path), "rb") as source:
            rate = source.getframerate()
            channels = source.getnchannels()
            width = source.getsampwidth()
            frames = source.readframes(source.getnframes())
    except (wave.Error, EOFError, OSError):
        raise bad_audio("The chunk of sound could not be read") from None
    if rate != ANALYSIS_RATE or width != 2 or channels < 1:
        raise bad_audio("The analysis sound must be 16 kHz, 16-bit")
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples


class FasterWhisperTranscriber:
    """Whisper on this machine."""

    max_chunk_ms = 5 * 60_000

    def __init__(
        self, model: str, model_root: Path, *, local_files_only: bool, threads: int = 0
    ) -> None:
        self.model_name = model
        self.name = f"faster-whisper:{model}"
        self._model_root = model_root
        self._local_files_only = local_files_only
        self._threads = threads
        self._model: Any = None
        self._lock = threading.Lock()

    def _load(self) -> Any:
        with self._lock:
            if self._model is not None:
                return self._model
            try:
                from faster_whisper import (  # type: ignore[import-not-found,unused-ignore]  # noqa: PLC0415
                    WhisperModel,
                )
            except ImportError as error:
                raise TranscriberOffError("faster-whisper is not installed") from error
            self._model_root.mkdir(parents=True, exist_ok=True)
            log.info("model.loading", model=self.model_name, local_only=self._local_files_only)
            try:
                self._model = WhisperModel(
                    self.model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=self._threads,
                    download_root=str(self._model_root),
                    local_files_only=self._local_files_only,
                )
            except Exception as error:  # noqa: BLE001 - any load failure is reported by type
                # The message may hold a path or an address: only the type is kept.
                raise ApplicationError(
                    f"The speech model could not be loaded ({type(error).__name__})",
                    type="MEDIA_TOOL_FAILED",
                ) from None
            log.info("model.ready", model=self.model_name)
            return self._model

    def listen(self, request: ListenRequest) -> Heard:
        model = self._load()
        request.checkpoint()
        segments, info = model.transcribe(
            load_samples(request.chunk.path),
            language=request.language,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
            hallucination_silence_threshold=2.0,
            beam_size=5,
        )
        words: list[Word] = []
        limit = request.chunk.length_ms
        # `segments` is lazy: each step decodes one window, so a cancel lands between windows.
        for segment in segments:
            request.checkpoint()
            if segment.no_speech_prob >= NO_SPEECH_DROP and segment.avg_logprob <= LOW_LOGPROB_DROP:
                continue
            for word in segment.words or []:
                text = str(word.word).strip()
                if not text:
                    continue
                start = max(0, round(float(word.start) * 1000))
                end = min(limit, max(start + 1, round(float(word.end) * 1000)))
                if start >= limit:
                    continue
                words.append(
                    Word(start=start, end=end, text=text, sure=round(float(word.probability), 3))
                )
        probability = float(info.language_probability) if request.language is None else None
        return Heard(
            words=collapse_repeats(words),
            language=str(info.language),
            language_probability=probability,
        )
