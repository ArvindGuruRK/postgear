"""Listening to stretches of a video: the work behind `mediaPyTranscribe`.

1. Fetch the analysis sound (a 16 kHz mono WAV) to a scratch folder.
2. Cut the asked stretches into chunks the bound listener takes (with a short
   overlap for a real listener, so a word cut at a seam is whole in one of the
   two chunks).
3. Listen to each chunk, heartbeating between them. A finished chunk is kept
   on disk under the job's id until the job succeeds, so a retry on the same
   box starts at the first unfinished chunk.
4. Shift every word into the video's own time, drop seam duplicates, and work
   out the speech curve.
5. Write the heard file to a key made from the job's id (a retry overwrites
   it) and answer its key and a few numbers. Never the words themselves.

A stretch with no speech is not an error: it answers no words and
`noSpeech`, and the caller records it as covered so it is never listened to
again.

`TRANSCRIBER=auto` (Module 15): a job asking for more sound than the hosted
lane's threshold goes to the hosted listener; any failure there but a cancel
hands the whole job to our own machine, logged with ids and counts only. The
answer's `model` names the listener that actually produced the words.
"""

from __future__ import annotations

import gzip
import json
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from temporalio.exceptions import ApplicationError, CancelledError

from postgear_media.contract.generated import (
    HeardFile,
    MediaPyTranscribeInput,
    MediaPyTranscribeOutput,
)
from postgear_media.core.keys import assert_valid_clip_key, is_video_key
from postgear_media.core.logging import get_logger
from postgear_media.core.scratch import scratch_folder
from postgear_media.core.storage import PrivateStorage, StorageNotFoundError
from postgear_media.providers.transcribe.base import (
    Chunk,
    Heard,
    HostedLane,
    ListenRequest,
    Transcriber,
    Word,
)
from postgear_media.services.audio import cut_chunk, read_facts
from postgear_media.services.speech_track import SPEECH_RATE_HZ, speech_values

#: A real listener's chunks overlap by this much, so a word at a seam is whole in one of them.
SEAM_OVERLAP_MS = 3_000
MAX_WORD_CHARS = 80

log = get_logger("transcribe")

#: The caller cancelled (Temporal's own type, raised at a heartbeat): never a reason to fall back.
Cancelled = CancelledError


@dataclass(frozen=True, slots=True)
class TranscribeDeps:
    """What the service needs from outside."""

    storage: PrivateStorage
    transcriber: Transcriber
    scratch_root: Path
    #: Heartbeats and raises when the caller cancelled. Takes the progress details.
    checkpoint: Callable[[dict[str, Any] | None], None]
    #: True for the simulated listener: no overlap, and the hint is passed through.
    simulated: bool
    #: `TRANSCRIBER=auto`: the hosted lane for long jobs; `transcriber` is then
    #: our own machine, which takes every other job and any hosted failure.
    hosted: HostedLane | None = None
    #: True when no attempt follows a retryable failure of this one (its last try).
    last_attempt: Callable[[], bool] = lambda: False


@dataclass(frozen=True, slots=True)
class _Listened:
    """Every chunk's words in the video's time, and the language first heard."""

    pieces: list[tuple[tuple[int, int], list[Word]]]
    language: str | None
    probability: float | None


def lane_for(asked_ms: int, deps: TranscribeDeps) -> tuple[Transcriber, Transcriber | None]:
    """Who listens to a job asking for `asked_ms` of sound, and who takes over if it fails.

    With a hosted lane (`TRANSCRIBER=auto`), a job longer than its threshold goes
    there with our own machine behind it. Everything else is the bound listener
    alone: a short job, `faster-whisper`, `groq` and simulation.
    """
    hosted = deps.hosted
    if hosted is not None and asked_ms > hosted.above_ms:
        return hosted.transcriber, deps.transcriber
    return deps.transcriber, None


def _folder_name(name: str) -> str:
    """A listener's name as a folder name (`groq:whisper-large-v3-turbo` has a colon)."""
    return "".join(char if char.isalnum() or char in "-_." else "-" for char in name)


def bad_input(message: str) -> ApplicationError:
    return ApplicationError(message, type="MEDIA_BAD_INPUT", non_retryable=True)


def heard_key(org_id: str, video_id: str, job_id: str) -> str:
    """The heard file's key: the same for every attempt of one job.

    The worker's own convention for a job's files (`apps/worker/src/clips/keys.ts`):
    the 32 hex characters are the job id without its dashes, so the failure
    and cancel bookkeeping know the key without being told.
    """
    return assert_valid_clip_key(
        f"clips/{org_id}/{video_id}/heard-{job_id.replace('-', '').lower()}.json.gz",
    )


def checked_ranges(payload: MediaPyTranscribeInput, audio_ms: int) -> list[tuple[int, int]]:
    """The asked stretches, in order, apart, and inside both the video and its sound."""
    limit = min(payload.duration_ms, audio_ms) if audio_ms > 0 else payload.duration_ms
    ranges: list[tuple[int, int]] = []
    previous_end = -1
    for item in payload.ranges:
        if item.to_ms <= item.from_ms:
            raise bad_input("A range must end after it starts")
        if item.from_ms < previous_end:
            raise bad_input("The ranges must be in order and must not overlap")
        if item.from_ms >= payload.duration_ms:
            raise bad_input("A range starts past the end of the video")
        previous_end = item.to_ms
        clamped = (item.from_ms, min(item.to_ms, limit))
        if clamped[1] > clamped[0]:
            ranges.append(clamped)
    return ranges


def plan_chunks(
    ranges: list[tuple[int, int]], max_chunk_ms: int, overlap_ms: int
) -> list[tuple[int, int]]:
    """Each range as chunks no longer than the listener takes, overlapping at their seams."""
    chunks: list[tuple[int, int]] = []
    step = max(1_000, max_chunk_ms - overlap_ms)
    for from_ms, to_ms in ranges:
        cursor = from_ms
        while cursor < to_ms:
            end = min(to_ms, cursor + max_chunk_ms)
            chunks.append((cursor, end))
            if end >= to_ms:
                break
            cursor += step
    return chunks


def stitch(pieces: list[tuple[tuple[int, int], list[Word]]]) -> list[Word]:
    """Words of every chunk in the video's time, each kept from one side of a seam only.

    Where two chunks overlap, the seam is the middle of the overlap: the left
    chunk keeps the words whose middle is before it, the right chunk the rest.
    """
    out: list[Word] = []
    for index, ((from_ms, to_ms), words) in enumerate(pieces):
        low = float(from_ms)
        high = float(to_ms)
        if index > 0:
            previous_to = pieces[index - 1][0][1]
            if previous_to > from_ms:
                low = (from_ms + previous_to) / 2
        if index + 1 < len(pieces):
            next_from = pieces[index + 1][0][0]
            if next_from < to_ms:
                high = (next_from + to_ms) / 2
        for word in words:
            middle = (word.start + word.end) / 2
            if low <= middle < high:
                out.append(word)
    out.sort(key=lambda word: (word.start, word.end))
    return out


def _shift(heard: Heard, chunk: Chunk) -> list[Word]:
    """A chunk's words in the video's time, held inside the chunk."""
    words: list[Word] = []
    for word in heard.words:
        text = " ".join(word.text.split())[:MAX_WORD_CHARS]
        if not text:
            continue
        start = max(chunk.from_ms, chunk.from_ms + max(0, word.start))
        end = min(chunk.to_ms, max(start + 1, chunk.from_ms + word.end))
        if start >= chunk.to_ms or end <= start:
            continue
        words.append(Word(start=start, end=end, text=text, sure=min(1.0, max(0.0, word.sure))))
    return words


def _load_done(path: Path) -> tuple[list[Word], str | None, float | None] | None:
    """A chunk an earlier attempt finished, or None when it has to be listened to."""
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        words = [
            Word(start=int(w[0]), end=int(w[1]), text=str(w[2]), sure=float(w[3]))
            for w in data["words"]
        ]
        return words, data.get("language"), data.get("languageProbability")
    except (ValueError, KeyError, TypeError, IndexError):
        return None


def _save_done(path: Path, words: list[Word], heard: Heard) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".part")
    temp.write_text(
        json.dumps(
            {
                "words": [[w.start, w.end, w.text, w.sure] for w in words],
                "language": heard.language,
                "languageProbability": heard.language_probability,
            },
        ),
        encoding="utf-8",
    )
    temp.replace(path)


def _listen_all(
    ranges: list[tuple[int, int]],
    transcriber: Transcriber,
    deps: TranscribeDeps,
    *,
    audio: Path,
    folder: Path,
    done_dir: Path,
    request: tuple[str | None, str | None, str | None],
) -> _Listened:
    """Listens to every chunk with one listener, reusing chunks an earlier attempt finished.

    Each listener keeps its finished chunks in its own folder, since two
    listeners cut the same stretch differently.
    """
    language, sample, force = request
    overlap = 0 if deps.simulated else SEAM_OVERLAP_MS
    plan = plan_chunks(ranges, transcriber.max_chunk_ms, overlap)
    pieces: list[tuple[tuple[int, int], list[Word]]] = []
    found_language: str | None = None
    probability: float | None = None
    for index, (from_ms, to_ms) in enumerate(plan):
        deps.checkpoint({"chunk": index, "of": len(plan)})
        done_path = done_dir / f"{from_ms}-{to_ms}.json"
        done = _load_done(done_path)
        if done is None:
            chunk = Chunk(path=folder / f"chunk-{index}.wav", from_ms=from_ms, to_ms=to_ms)
            cut_chunk(audio, chunk.path, from_ms, to_ms)
            heard = transcriber.listen(
                ListenRequest(
                    chunk=chunk,
                    language=language,
                    sample=sample,
                    force=force,
                    checkpoint=lambda: deps.checkpoint(None),
                ),
            )
            words = _shift(heard, chunk)
            _save_done(done_path, words, heard)
            chunk.path.unlink(missing_ok=True)
            done = (words, heard.language, heard.language_probability)
        words, chunk_language, chunk_probability = done
        pieces.append(((from_ms, to_ms), words))
        if found_language is None and chunk_language and words:
            found_language = chunk_language
            probability = chunk_probability
    deps.checkpoint({"chunk": len(plan), "of": len(plan)})
    return _Listened(pieces=pieces, language=found_language, probability=probability)


def _never_retried(error: BaseException, deps: TranscribeDeps) -> bool:
    """True when no later attempt will read this job's finished chunks."""
    if isinstance(error, Cancelled):
        return True
    if isinstance(error, ApplicationError) and error.non_retryable:
        return True
    return deps.last_attempt()


def transcribe(payload: MediaPyTranscribeInput, deps: TranscribeDeps) -> MediaPyTranscribeOutput:
    """Listens to the asked stretches and stores the heard file.

    The finished chunks (words already heard) are kept across attempts on this
    box so a retry starts where the last one stopped. They go when the job
    succeeds, and as soon as no attempt can follow: a cancel, a failure a retry
    cannot fix, or the last try. Only a killed process leaves them, for the
    boot sweep a day later.
    """
    if not is_video_key(payload.audio_key, payload.org_id, payload.video_id):
        raise bad_input("A job reads only the files of its own video")
    done_dir = deps.scratch_root / f"{payload.job_id}-chunks"
    try:
        return _transcribe(payload, deps, done_dir)
    except BaseException as error:
        if _never_retried(error, deps):
            shutil.rmtree(done_dir, ignore_errors=True)
        raise


def _transcribe(
    payload: MediaPyTranscribeInput, deps: TranscribeDeps, done_dir: Path
) -> MediaPyTranscribeOutput:
    language = None if payload.language == "auto" else payload.language
    hint = payload.simulation if deps.simulated else None
    # The generated model wraps a nullable pattern string; the listener takes plain text.
    sample = str(hint.sample.root) if hint and hint.sample else None
    force = hint.force if hint else None

    with scratch_folder(deps.scratch_root, payload.job_id) as folder:
        audio_path = folder / "analysis.wav"
        try:
            deps.storage.get_to_file(payload.audio_key, audio_path)
        except StorageNotFoundError:
            raise ApplicationError(
                "The analysis sound is not in storage",
                type="MEDIA_KEY_NOT_FOUND",
                non_retryable=True,
            ) from None
        facts = read_facts(audio_path)
        ranges = checked_ranges(payload, facts.duration_ms)
        asked_ms = sum(to_ms - from_ms for from_ms, to_ms in ranges)
        listener, fallback = lane_for(asked_ms, deps)

        def listen_with(transcriber: Transcriber) -> _Listened:
            return _listen_all(
                ranges,
                transcriber,
                deps,
                audio=audio_path,
                folder=folder,
                done_dir=done_dir / _folder_name(transcriber.name),
                request=(language, sample, force),
            )

        try:
            listened = listen_with(listener)
        except Cancelled:
            raise
        except Exception as error:
            if fallback is None:
                raise
            # Ids, counts and a fixed code only: never a word or a message.
            log.warning(
                "listen.fallback",
                job_id=payload.job_id,
                lane=listener.name,
                to=fallback.name,
                reason=getattr(error, "type", None) or type(error).__name__,
                ranges=len(ranges),
                seconds=round(asked_ms / 1000),
            )
            listener = fallback
            listened = listen_with(listener)

        words = stitch(listened.pieces)
        final_language = language or listened.language or "en"
        probability = listened.probability
        heard_file = HeardFile.model_validate(
            {
                "version": 1,
                "language": final_language,
                "model": listener.name,
                "ranges": [{"fromMs": a, "toMs": b} for a, b in ranges]
                or [{"fromMs": r.from_ms, "toMs": r.to_ms} for r in payload.ranges],
                "words": [
                    {"start": w.start, "end": w.end, "text": w.text, "sure": round(w.sure, 3)}
                    for w in words
                ],
                "speech": {
                    "sampleRateHz": SPEECH_RATE_HZ,
                    "values": speech_values(words, ranges, payload.duration_ms),
                },
            },
        )
        out_path = folder / "heard.json.gz"
        with gzip.open(out_path, "wt", encoding="utf-8") as handle:
            json.dump(heard_file.model_dump(by_alias=True, mode="json"), handle, ensure_ascii=False)
        key = heard_key(payload.org_id, payload.video_id, payload.job_id)
        deps.storage.put_file(out_path, key, "application/gzip")

    shutil.rmtree(done_dir, ignore_errors=True)
    return MediaPyTranscribeOutput.model_validate(
        {
            "heardKey": key,
            "language": final_language,
            "languageProbability": None if language else probability,
            "model": listener.name,
            "secondsListened": round(sum(b - a for a, b in ranges) / 1000, 3),
            "wordCount": len(words),
            "noSpeech": len(words) == 0,
        },
    )
