"""Makes the short sample each Kokoro voice plays in the editor (Module 09).

    npm run voice:samples --workspace=@postgear/media

Runs the voice program once per voice (the same `KokoroSpeaker` jobs use)
and writes `apps/web/public/clips/voice-samples/<voice id>.m4a` (mono AAC,
64 kb/s) through FFmpeg (`FFMPEG_PATH`, or `ffmpeg`). Run it again after the
voice list changes; `voices.spec.ts` in the API fails while a Kokoro voice
has no sample. The lines are ours, fixed, and the made sound is Kokoro's
output (its weights are Apache-2.0), so the files may ship with the web app.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from postgear_media.core.settings import REPO_ROOT, get_settings
from postgear_media.providers.speech.kokoro import KOKORO_VOICES, KokoroSpeaker, kokoro_ready
from postgear_media.services.speech import write_wav

OUT = REPO_ROOT / "apps" / "web" / "public" / "clips" / "voice-samples"

ENGLISH = "Hi, I am {name}. This is how I will sound in your clip."
HINDI = "नमस्ते, मैं {name} हूँ। आपकी क्लिप में मेरी आवाज़ ऐसी लगेगी।"


def main() -> int:
    """Writes every sample; 1 when the voice program or the model files are missing."""
    settings = get_settings()
    if not kokoro_ready(settings.voice_program, settings.model_root):
        print("The voice program or the Kokoro files are missing.", file=sys.stderr)  # noqa: T201
        return 1
    ffmpeg = os.environ.get("FFMPEG_PATH", "ffmpeg")
    speaker = KokoroSpeaker(settings.voice_program, settings.model_root, settings.scratch_root)
    OUT.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=REPO_ROOT / ".cache") as folder:
        for entry in KOKORO_VOICES:
            name = entry.voice.name.split(" (")[0]
            line = (HINDI if entry.lang == "hi" else ENGLISH).format(name=name)
            wav = Path(folder) / f"{entry.voice.id}.wav"
            write_wav(wav, speaker.speak(line, entry.voice.id))
            target = OUT / f"{entry.voice.id}.m4a"
            # A fixed program and flags on our own files.
            subprocess.run(  # noqa: S603
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-y",
                    "-i",
                    str(wav),
                    "-ac",
                    "1",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "64k",
                    "-movflags",
                    "+faststart",
                    str(target),
                ],
                check=True,
            )
            print(f"{target.relative_to(REPO_ROOT)}")  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main())
