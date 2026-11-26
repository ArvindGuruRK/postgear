"""`npm run clips:listen-benchmark`: how fast this machine listens.

    python -m postgear_media.simulation.benchmark --wav analysis.wav --model small --model-root DIR

Listens to a 16 kHz mono WAV with faster-whisper and prints the seconds taken
for each second of sound, the peak memory and the processor count, as a
Markdown table row for the Progress notes. Real mode only, with the owner's
OK: it downloads the model on first use. The plan limits and the hosted-lane
decision (Module 15) read these figures.
"""

from __future__ import annotations

import argparse
import os
import resource
import sys
import time
from pathlib import Path

from postgear_media.providers.transcribe.base import Chunk, ListenRequest
from postgear_media.providers.transcribe.faster_whisper import FasterWhisperTranscriber
from postgear_media.services.audio import read_facts


def main() -> None:
    parser = argparse.ArgumentParser(description="Time speech to text on this machine.")
    parser.add_argument("--wav", required=True, type=Path)
    parser.add_argument("--model", default="small")
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--language", default="auto")
    args = parser.parse_args()

    facts = read_facts(args.wav)
    listener = FasterWhisperTranscriber(args.model, args.model_root, local_files_only=False)
    chunk = Chunk(path=args.wav, from_ms=0, to_ms=facts.duration_ms)
    language = None if args.language == "auto" else args.language

    load_started = time.monotonic()
    listener._load()
    load_seconds = time.monotonic() - load_started

    started = time.monotonic()
    heard = listener.listen(ListenRequest(chunk=chunk, language=language))
    seconds = time.monotonic() - started

    sound_seconds = facts.duration_ms / 1000
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Linux reports kilobytes, macOS bytes.
    peak_mb = peak / 1024 if sys.platform != "darwin" else peak / (1024 * 1024)
    per_second = seconds / sound_seconds if sound_seconds else 0.0
    realtime = sound_seconds / seconds if seconds else 0.0
    sys.stdout.write(
        "| Model | Sound | Listening | Seconds per second of sound | x real time | "
        "Model load | Peak memory | Processors | Words |\n"
        "|---|---|---|---|---|---|---|---|---|\n"
        f"| {args.model} | {sound_seconds:.0f} s | {seconds:.1f} s | {per_second:.2f} | "
        f"{realtime:.1f}x | {load_seconds:.1f} s | {peak_mb:.0f} MB | {os.cpu_count()} | "
        f"{len(heard.words)} |\n",
    )


if __name__ == "__main__":
    main()
