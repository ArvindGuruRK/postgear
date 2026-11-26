"""Records a sample's transcript from one real listen (a developer's own sample).

    python -m postgear_media.simulation.record --sample verideck --wav /path/to/analysis.wav

The WAV is the sample's 16 kHz mono analysis sound. It is listened to with
faster-whisper through the very same service the `mediaPyTranscribe` activity
runs (chunks, seams, clean-up), and the words are written to
`simulation/transcripts/<sample>.json`, where the simulated listener answers
from. Run it once per own sample, with the owner's OK: it downloads the
speech model on first use. Needs the `ml` dependency group.

The file it writes holds what was said in the developer's own video, so it is
committed only when they are happy for it to be.
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from postgear_media.contract.generated import MediaPyTranscribeInput
from postgear_media.core.storage import LocalPrivateStorage
from postgear_media.providers.transcribe.faster_whisper import FasterWhisperTranscriber
from postgear_media.services.audio import read_facts
from postgear_media.services.transcribe import TranscribeDeps, transcribe

TRANSCRIPTS = Path(__file__).resolve().parent / "transcripts"
ORG = "recording"
VIDEO = "00000000-0000-4000-8000-0000000000aa"
JOB = "00000000-0000-4000-8000-0000000000bb"
AUDIO_KEY = f"clips/{ORG}/{VIDEO}/analysis-audio-{'0' * 32}.wav"


def record(sample: str, wav: Path, model: str, language: str, model_root: Path) -> Path:
    """Listens to `wav` and writes the sample's transcript file."""
    facts = read_facts(wav)
    with tempfile.TemporaryDirectory(prefix="postgear-record-") as temp:
        root = Path(temp)
        storage = LocalPrivateStorage(root / "private")
        storage.put_file(wav, AUDIO_KEY, "audio/wav")
        listener = FasterWhisperTranscriber(model, model_root, local_files_only=False)
        payload = MediaPyTranscribeInput.model_validate(
            {
                "version": 1,
                "jobId": JOB,
                "orgId": ORG,
                "videoId": VIDEO,
                "audioKey": AUDIO_KEY,
                "durationMs": facts.duration_ms,
                "ranges": [{"fromMs": 0, "toMs": facts.duration_ms}],
                "language": language,
                "simulation": None,
            },
        )

        def progress(details: dict[str, Any] | None) -> None:
            if details:
                sys.stdout.write(f"  chunk {details['chunk']} of {details['of']}\n")

        result = transcribe(
            payload,
            TranscribeDeps(
                storage=storage,
                transcriber=listener,
                scratch_root=root / "scratch",
                checkpoint=progress,
                simulated=False,
            ),
        )
        heard_path = root / "heard.json.gz"
        storage.get_to_file(result.heard_key, heard_path)
        with gzip.open(heard_path, "rt", encoding="utf-8") as handle:
            heard = json.load(handle)
        shutil.rmtree(root / "scratch", ignore_errors=True)

    rows = ",\n".join(f"    {json.dumps(word, ensure_ascii=False)}" for word in heard["words"])
    head = {
        "sample": sample,
        "language": heard["language"],
        "note": (
            f"Recorded once from a real listen with {listener.name} on "
            f"{datetime.now(UTC).date().isoformat()} by simulation/record.py. Do not edit."
        ),
    }
    body = ",\n".join(f"  {json.dumps(key)}: {json.dumps(value)}" for key, value in head.items())
    words_block = f"\n{rows}\n  " if rows else ""
    TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
    target = TRANSCRIPTS / f"{sample}.json"
    target.write_text(f'{{\n{body},\n  "words": [{words_block}]\n}}\n', encoding="utf-8")
    sys.stdout.write(
        f"Wrote {target.name}: {len(heard['words'])} words, language {heard['language']}\n",
    )
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Record a sample's transcript from a real listen.")
    parser.add_argument("--sample", required=True, help="The sample's name, such as verideck")
    parser.add_argument("--wav", required=True, type=Path, help="Its 16 kHz mono analysis sound")
    parser.add_argument("--model", default="small", help="The Whisper model (default: small)")
    parser.add_argument("--language", default="auto", help="auto, or an ISO 639-1 code")
    parser.add_argument("--model-root", required=True, type=Path, help="Where model files are kept")
    args = parser.parse_args()
    if not args.sample.replace("-", "").isalnum():
        parser.error("The sample's name may hold letters, digits and dashes only")
    record(args.sample, args.wav, args.model, args.language, args.model_root)


if __name__ == "__main__":
    main()
