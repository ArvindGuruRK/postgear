PostGear media image: licences and notices
==========================================

This image runs PostGear's Python media service (apps/media) on PostGear's
own servers. Keep it in a private registry and never publish it.

What is in here, and where each notice is:

PROJECT.txt
  PostGear's own code in this image (apps/media/src). The repository has no
  licence file today; this note says so and what that means.

python-packages.md
  Every Python package in the service's environment (/app/apps/media/.venv),
  with its version and licence, generated at build time from the installed
  packages' own metadata (no network). The `slim` target holds the base
  packages only (FastAPI, Pydantic, Temporal's SDK, boto3, httpx, structlog
  and what they need); the `full` target adds the `ml` group (faster-whisper
  on CTranslate2 and onnxruntime, PyAV, OpenCV headless, NumPy, MediaPipe).
  Each package's full licence texts are in its .dist-info folder inside the
  environment.

voice-program/
  Only in an image built with VOICE=kokoro. COPYING is the GNU General
  Public License version 3: the voice program (apps/media/voice-program)
  bundles espeak-ng, which is GPL-3.0-or-later. The service only runs it as
  a separate program and swaps files with it; it never links to it.
  python-packages.md lists that program's own environment.

No model file is in this image. Speech, face and voice models live in the
MEDIA_MODEL_DIR volume, filled by an operator at deploy (see
docs/launch-readiness/06-clips-and-clips-ai.md); each model keeps its own
licence beside it there.
