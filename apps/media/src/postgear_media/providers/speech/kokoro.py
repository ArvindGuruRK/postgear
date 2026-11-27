"""The Kokoro speaker (Module 09): runs PostGear's voice program, never imports it.

`kokoro-onnx` loads espeak-ng (GPL-3.0) inside whatever process imports it,
so it lives in its own program with its own environment
(`apps/media/voice-program`, GPL-3.0-or-later). This service hands it a file
and gets a file back, the way it runs FFmpeg:

1. The line goes into a text file in the attempt's scratch folder (never on
   the command line, where `ps` would show it).
2. The program runs with the model folder, the Kokoro voice and its language.
   While it runs, `tick` is called every half second (the activity's
   heartbeat, which also raises when the job is cancelled); a cancel or a
   run past `TIMEOUT_S` kills it.
3. Its answer is the last stdout line (`{"sampleRate", "samples"}`) and the
   raw samples file. A failure is one short code on stderr, which is the only
   thing kept from it: the program never prints the line, and this file never
   logs what it prints.

The model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`, Apache-2.0) live in
`MEDIA_MODEL_DIR/kokoro`; nothing here downloads them.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from temporalio import activity
from temporalio.exceptions import ApplicationError

from postgear_media.providers.speech.base import Spoken, Voice

MODEL_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
SAMPLE_RATE = 24_000
#: The longest one line may take (500 characters on a slow CPU take well under a minute).
TIMEOUT_S = 180.0
POLL_S = 0.5
#: The codes the program answers with, kept as the failure's reason.
KNOWN_CODES = frozenset({"model_missing", "voice_unknown", "text_empty", "speak_failed"})
#: The only parts of the service's environment the program sees: never a token or a key.
PASSED_ENV = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")


@dataclass(frozen=True, slots=True)
class KokoroVoice:
    """One voice on offer and the Kokoro voice and language behind it."""

    voice: Voice
    kokoro_id: str
    lang: str


def _voice(our_id: str, name: str, kokoro_id: str, lang: str, *languages: str) -> KokoroVoice:
    return KokoroVoice(Voice(id=our_id, name=name, languages=languages), kokoro_id, lang)


#: A short pick of Kokoro v1.0's voices, its best graded first. The same list
#: is `packages/media-contract/fixtures/voices/kokoro.json`, tested on both sides.
KOKORO_VOICES: tuple[KokoroVoice, ...] = (
    _voice("kokoro-heart", "Heart", "af_heart", "en-us", "en"),
    _voice("kokoro-bella", "Bella", "af_bella", "en-us", "en"),
    _voice("kokoro-sarah", "Sarah", "af_sarah", "en-us", "en"),
    _voice("kokoro-michael", "Michael", "am_michael", "en-us", "en"),
    _voice("kokoro-fenrir", "Fenrir", "am_fenrir", "en-us", "en"),
    _voice("kokoro-puck", "Puck", "am_puck", "en-us", "en"),
    _voice("kokoro-emma", "Emma (British)", "bf_emma", "en-gb", "en"),
    _voice("kokoro-george", "George (British)", "bm_george", "en-gb", "en"),
    # espeak-ng's Hindi reads English words inside a Hindi line too.
    _voice("kokoro-alpha", "Alpha (Hindi)", "hf_alpha", "hi", "hi", "en"),
    _voice("kokoro-omega", "Omega (Hindi)", "hm_omega", "hi", "hi", "en"),
)

_BY_ID = {entry.voice.id: entry for entry in KOKORO_VOICES}


def kokoro_ready(program: Path, model_root: Path) -> bool:
    """True when the program can run and both model files are on this box."""
    folder = model_root / "kokoro"
    runnable = program.is_file() and os.access(program, os.X_OK)
    return runnable and all((folder / name).is_file() for name in MODEL_FILES)


def _failed(reason: str) -> ApplicationError:
    # Only a crash may pass on a second try: a missing model, an unknown voice
    # or a line too slow for one try (the second would get less time) never does.
    retry = reason == "speak_failed"
    return ApplicationError(
        f"The voice program failed ({reason})",
        type="MEDIA_TOOL_FAILED",
        non_retryable=not retry,
    )


class KokoroSpeaker:
    """Speaks through the voice program. See the file comment."""

    name = "kokoro"

    def __init__(
        self,
        program: Path,
        model_root: Path,
        scratch_root: Path,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._program = program
        self._model_root = model_root
        self._scratch_root = scratch_root
        self._clock = clock

    def voices(self) -> tuple[Voice, ...]:
        return tuple(entry.voice for entry in KOKORO_VOICES)

    def speak(self, text: str, voice_id: str, tick: Callable[[], None] | None = None) -> Spoken:
        entry = _BY_ID[voice_id]  # KeyError for a voice this binding does not have
        self._scratch_root.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix="voice-", dir=self._scratch_root) as folder:
            line, out = Path(folder) / "line.txt", Path(folder) / "voice.pcm"
            line.write_text(text, encoding="utf-8")
            command = [
                str(self._program),
                "--model-dir",
                str(self._model_root),
                "--voice",
                entry.kokoro_id,
                "--lang",
                entry.lang,
                "--text",
                str(line),
                "--out",
                str(out),
            ]
            stdout, stderr, code = self._run(command, tick)
            if code != 0:
                last = stderr.strip().splitlines()[-1:] or [""]
                raise _failed(last[0] if last[0] in KNOWN_CODES else "speak_failed")
            try:
                answer = json.loads(stdout.strip().splitlines()[-1])
                rate, samples = int(answer["sampleRate"]), int(answer["samples"])
            except (ValueError, KeyError, IndexError, TypeError):
                raise _failed("speak_failed") from None
            try:
                pcm = out.read_bytes()
            except OSError:
                raise _failed("speak_failed") from None
            if rate != SAMPLE_RATE or len(pcm) != 2 * samples:
                raise _failed("speak_failed")
            return Spoken(pcm=pcm, sample_rate=rate)

    def _run(self, command: list[str], tick: Callable[[], None] | None) -> tuple[str, str, int]:
        # Inside an activity the SDK may also raise a cancel straight into this
        # thread; shielded, `tick` is the only way a cancel arrives, so the kill
        # in `finally` always runs.
        with _shielded():
            started = self._clock()
            try:
                # A fixed program with fixed flags; the line is in a file, never an argument.
                process = subprocess.Popen(  # noqa: S603
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    env={key: os.environ[key] for key in PASSED_ENV if key in os.environ},
                )
            except OSError:
                # Never the error itself: it names our paths.
                raise _failed("speak_failed") from None
            try:
                while True:
                    try:
                        stdout, stderr = process.communicate(timeout=POLL_S)
                        return stdout, stderr, process.returncode
                    except subprocess.TimeoutExpired:
                        if tick is not None:
                            tick()  # raises when the job was cancelled
                        if self._clock() - started > TIMEOUT_S:
                            raise _failed("timeout") from None
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()


@contextmanager
def _shielded() -> Iterator[None]:
    """`activity.shield_thread_cancel_exception()` inside an activity, nothing outside one."""
    shield = activity.shield_thread_cancel_exception() if activity.in_activity() else nullcontext()
    with shield:
        yield
