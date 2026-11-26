"""The simulated speaker (Module 09): a tone pattern whose length follows the text.

Every character is 60 ms, so 1,000 characters make about a minute (the pace
the AI Minutes price assumes). A letter or a digit is a short beep, its pitch
picked from the character and the voice, with 5 ms ramps at both ends so it
never clicks; a space or a mark is a 60 ms pause. The same line and voice
always make the same bytes. No model, no file, no network.

The voices are made up. `packages/media-contract/fixtures/voices/simulated.json`
lists the same ones; the API reads that list too, and both sides test against
it, so the voices on offer and the voices that can speak never differ.
"""

from __future__ import annotations

import math
import sys
from array import array

from postgear_media.providers.speech.base import Spoken, Voice

SAMPLE_RATE = 24_000
#: Milliseconds every character takes.
CHARACTER_MS = 60
#: The beep's part of a character; the rest is a short gap, like a syllable.
BEEP_MS = 45
RAMP_MS = 5
AMPLITUDE = 0.3

VOICES: tuple[Voice, ...] = (
    Voice(id="sim-river", name="River", languages=("en",)),
    Voice(id="sim-meadow", name="Meadow", languages=("en", "hi")),
    Voice(id="sim-stone", name="Stone", languages=("en",)),
)

#: Each voice's lowest pitch in Hz, so the voices sound apart.
_BASE_HZ = {"sim-river": 180, "sim-meadow": 240, "sim-stone": 140}
_STEP_HZ = 15
_STEPS = 12


def _beep(frequency: int) -> array[int]:
    """One character's samples: a ramped beep, then silence to the character's end."""
    total = SAMPLE_RATE * CHARACTER_MS // 1000
    beep = SAMPLE_RATE * BEEP_MS // 1000
    ramp = SAMPLE_RATE * RAMP_MS // 1000
    peak = AMPLITUDE * 32_767
    samples = array("h", bytes(2 * total))
    for i in range(beep):
        gain = min(1.0, i / ramp, (beep - 1 - i) / ramp)
        samples[i] = round(peak * gain * math.sin(2 * math.pi * frequency * i / SAMPLE_RATE))
    return samples


class SimulatedSpeaker:
    """The only built binding. See the file comment."""

    name = "simulation"

    def __init__(self) -> None:
        self._cache: dict[int, bytes] = {}
        self._pause = bytes(2 * (SAMPLE_RATE * CHARACTER_MS // 1000))

    def voices(self) -> tuple[Voice, ...]:
        return VOICES

    def _character(self, frequency: int) -> bytes:
        found = self._cache.get(frequency)
        if found is None:
            samples = _beep(frequency)
            if sys.byteorder == "big":
                samples.byteswap()
            found = samples.tobytes()
            self._cache[frequency] = found
        return found

    def speak(self, text: str, voice_id: str) -> Spoken:
        base = _BASE_HZ[voice_id]  # KeyError for a voice this binding does not have
        parts: list[bytes] = []
        for character in text:
            if character.isalnum():
                parts.append(self._character(base + (ord(character) % _STEPS) * _STEP_HZ))
            else:
                parts.append(self._pause)
        return Spoken(pcm=b"".join(parts), sample_rate=SAMPLE_RATE)
