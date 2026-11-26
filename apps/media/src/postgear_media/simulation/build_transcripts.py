"""Turns the sample scripts into word-timed transcript files.

`python -m postgear_media.simulation.build_transcripts` writes
`simulation/transcripts/<sample>.json` for every script in `scripts.py`.
The files are committed; `tests/test_simulation_transcripts.py` builds them
again and fails when one is stale, so the scripts and the files cannot drift.

A line's words start at its second and run at a talking pace. A longer word
takes longer, a word that ends a sentence is followed by a short breath, and
the listener's confidence is a steady number worked out from the word's place
(never random), lower for a word the script marks unsure with `~`.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from postgear_media.simulation.scripts import (
    PACE_WORDS_PER_SECOND,
    SAMPLE_SECONDS,
    SCRIPTS,
    SILENT,
    Line,
)

TRANSCRIPTS = Path(__file__).resolve().parent / "transcripts"

#: The share of a word's slot that is sound; the rest is the gap before the next word.
SPOKEN_SHARE = 0.86
#: Extra slot units after a word that ends a sentence (a breath).
BREATH_UNITS = 5
#: How sure the listener is of a word the script marks with `~`.
UNSURE = 0.41
SENTENCE_END = (".", "!", "?", "।")


class ScriptError(ValueError):
    """A script breaks its own rules (a line runs into the next, or past the end)."""


def _units(word: str) -> int:
    return len(word) + 2 + (BREATH_UNITS if word.endswith(SENTENCE_END) else 0)


def _sure(sample: str, index: int, unsure: bool) -> float:
    if unsure:
        return UNSURE
    digest = hashlib.sha256(f"{sample}:{index}".encode()).digest()
    return round(0.84 + (digest[0] % 150) / 1000, 3)


def lay_out(sample: str, lines: list[Line]) -> list[dict[str, object]]:
    """The script's words with a start and an end each, in whole milliseconds."""
    words: list[dict[str, object]] = []
    limit = SAMPLE_SECONDS[sample]
    silent = SILENT.get(sample, [])
    for position, (start_s, text) in enumerate(lines):
        tokens = text.split()
        if not tokens:
            raise ScriptError(f"{sample}: an empty line at {start_s}")
        total_units = sum(_units(token.lstrip("~")) for token in tokens)
        length_s = len(tokens) / PACE_WORDS_PER_SECOND
        end_s = start_s + length_s
        next_start = lines[position + 1][0] if position + 1 < len(lines) else limit
        if end_s > next_start - 0.1:
            raise ScriptError(
                f"{sample}: the line at {start_s} s runs to {end_s:.1f} s, "
                f"into the next one at {next_start} s",
            )
        cursor = start_s
        for token in tokens:
            unsure = token.startswith("~")
            word = token.lstrip("~")
            slot = length_s * _units(word) / total_units
            spoken = slot * (len(word) + 2) / _units(word) * SPOKEN_SHARE
            start_ms = round(cursor * 1000)
            end_ms = max(start_ms + 60, round((cursor + spoken) * 1000))
            middle = (start_ms + end_ms) / 2000
            for quiet_from, quiet_to in silent:
                if quiet_from <= middle < quiet_to:
                    raise ScriptError(f"{sample}: a word at {middle:.1f} s is in a silent stretch")
            words.append(
                {
                    "start": start_ms,
                    "end": end_ms,
                    "text": word,
                    "sure": _sure(sample, len(words), unsure),
                },
            )
            cursor += slot
    return words


def render(sample: str) -> str:
    """The file's text for one sample: one word a line, so a diff reads well."""
    language, lines = SCRIPTS[sample]
    words = lay_out(sample, lines)
    rows = ",\n".join(f"    {json.dumps(word, ensure_ascii=False)}" for word in words)
    head = {
        "sample": sample,
        "language": language,
        "note": "Built from simulation/scripts.py by build_transcripts.py. Do not edit.",
    }
    body = ",\n".join(f"  {json.dumps(key)}: {json.dumps(value)}" for key, value in head.items())
    return f'{{\n{body},\n  "words": [\n{rows}\n  ]\n}}\n'


def main() -> None:
    TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
    for sample in SCRIPTS:
        path = TRANSCRIPTS / f"{sample}.json"
        path.write_text(render(sample), encoding="utf-8")
        sys.stdout.write(f"Wrote {path.name}\n")


if __name__ == "__main__":
    main()
