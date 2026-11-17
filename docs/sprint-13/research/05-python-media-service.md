# Sprint 13 Research: The Python Media Service

> **Written**: 2026-11-14. Versions, licences and wheel lists were read from pypi.org, registry.npmjs.org and Docker Hub on that day; prices from each vendor's own pricing page. Lines marked **verified** were read today, lines marked **reported** were not. The repo facts (scripts, env names, worker patterns) were read from the code on the same day.
> **Scope**: `apps/media`, the first Python in PostGear. It hosts the models (speech to text, faces, scenes) and nothing else. FFmpeg (which also draws captions through libass and ASS files), yt-dlp and the render compiler stay in the Node worker from Sprint 12.

## 1. What The Service Is

- **A Temporal worker first**: it polls its own task queue, `postgear-media-py` (reserved in Sprint 12), and serves activities that the TypeScript workflows call by name. Every heavy job arrives this way, so retries, cancel, progress and the `ClipJob` reconcile work exactly as they do for the Node worker.
- **A small FastAPI app second**: health, readiness and an info route for the doctor check. No job is started over HTTP.
- **One process locally** (the FastAPI lifespan starts the worker), one container in production; a second, worker-only entry point exists for a GPU box.
- **Stateless**: it reads and writes storage by key, keeps nothing between jobs except the loaded model, and owns no database table.

## 2. Project Layout

FastAPI's own "Bigger Applications" guide splits an app into a package with `main.py`, `dependencies.py`, `routers/` and `internal/`, each router an `APIRouter` with its own `prefix`, `tags` and `dependencies`, joined in `main.py` with `include_router()` (fastapi.tiangolo.com/tutorial/bigger-applications, verified 2026-11-14). The layout below is that guide plus the `src/` layout and the layering most FastAPI structure guides use (reported):

```
apps/media/
  package.json            scripts only, so Turborepo and npm see the folder (section 6)
  pyproject.toml          project, dependency groups, Ruff, mypy and pytest settings
  uv.lock                 committed
  .python-version         3.13
  Dockerfile
  src/media/
    main.py               create_app(): lifespan, routers, error handlers
    worker.py             build_worker(), and "python -m media.worker" for a worker-only box
    core/                 config.py (Settings), logging.py, storage.py, scratch.py, security.py, errors.py
    api/deps.py           get_settings, get_storage, require_internal_token
    api/v1/routes/        health.py, info.py (one APIRouter each)
    schemas/              pydantic models that mirror the contract (generated.py plus small hand-written ones)
    services/             transcriber/, face_tracker/, scenes/: a Protocol, the real bindings, one factory
    activities/           thin Temporal activities: validate input, call a service, return keys
    simulation/           fixture-backed bindings; imports no model library
  tests/                  unit/, contract/ (shared fixtures), conftest.py
```

Rules: routes and activities hold no logic (they validate, call a service, shape the answer); services never import FastAPI or Temporal, so they are tested with plain pytest; only `services/*/real_*.py` may import a model library, and only inside a function.

## 3. Settings, Injection, Lifespan, Logging, Health

| Concern | Practice | Source |
|---|---|---|
| Settings | One `Settings(BaseSettings)` with `SettingsConfigDict(env_file=<repo root>/.env, extra="ignore")`. It reads the names the Node apps already use (`TEMPORAL_HOST`, `TEMPORAL_NAMESPACE`, `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `UPLOAD_DIRECTORY`, `NODE_ENV`) plus new `MEDIA_*` and `TRANSCRIBE_*` ones. `extra="ignore"` matters: the root `.env` holds dozens of names this service does not declare (reported: undeclared dotenv names raise by default). Real environment variables win over the file. | fastapi.tiangolo.com/advanced/settings, verified 2026-11-14 |
| Injection | `@lru_cache def get_settings()` used through `Depends`; tests swap it with `app.dependency_overrides`. Never a module-level `settings = Settings()`. | same page, verified |
| Lifespan | An `@asynccontextmanager` passed to `FastAPI(lifespan=...)`: before `yield` set up logging, storage, the provider factory, the Temporal client and the worker task; after `yield` stop the worker and wait for running activities. `on_event` is the deprecated way. Lifespan does not run for mounted sub-apps. | fastapi.tiangolo.com/advanced/events, verified 2026-11-14 |
| Model loading | Lazy, on the first job, behind a lock; `/readyz` says whether it is loaded. Boot stays fast and simulation never loads one. | our rule |
| Logging | `structlog` 26.1.0 (MIT or Apache-2.0): JSON lines in production, coloured console locally; every line carries `jobId`, `activity` and `attempt`. Never log a token, a key secret or a signed URL. | pypi.org/pypi/structlog/json, verified 2026-11-14 |
| Health | `GET /healthz`: the process is up, touches nothing. `GET /readyz`: storage reachable, Temporal connected, provider usable; 503 otherwise. `GET /v1/info` (token needed): contract version, provider, model, device, simulation flag, library versions. | our rule |

The simulation flag follows the house rule: `MEDIA_SIMULATION=true` with `NODE_ENV=production` refuses to boot.

## 4. The Temporal Python Worker

**The SDK**: `temporalio` 1.36.1, MIT, released 2026-11-14, Python 3.11 or newer. It ships one `abi3` wheel per platform (Windows x64, Linux x64 and ARM, musl, macOS), about 15 MB (pypi.org/pypi/temporalio/json, verified 2026-11-14). The Node worker is on `@temporalio/*` `^1.24.0` (`apps/worker/package.json`); the two SDKs version separately and meet at the server.

**Activities only**: the SDK says workers "host workflows and/or activities" (github.com/temporalio/sdk-python, verified 2026-11-14). We register no Python workflow, so the Python workflow sandbox and its import rules never apply to us. Workflows stay in `apps/worker/src/workflows`.

**Which kind of activity**: "By default, Activities should be synchronous rather than asynchronous", run on a `ThreadPoolExecutor`; a blocking call inside an `async def` activity can freeze the worker and block workflow progress (docs.temporal.io/develop/python/python-sdk-sync-vs-async, verified 2026-11-14). Model inference is blocking native code, so every media activity is a plain `def`. The README prefers threads over a process pool (process activities must be picklable and cannot be interrupted by an exception).

```python
worker = Worker(
    client,
    task_queue="postgear-media-py",
    activities=[media_py_transcribe, media_py_track_faces, media_py_detect_scenes],
    activity_executor=ThreadPoolExecutor(max_workers=settings.media_max_activities),
    max_concurrent_activities=settings.media_max_activities,   # 1 on a CPU box: the model is the bottleneck
    graceful_shutdown_timeout=timedelta(minutes=2),
)
```

**Heartbeats and cancel** (sdk-python README and docs.temporal.io/develop/python/activities/timeouts, verified 2026-11-14):

- "Activities that don't Heartbeat can't receive a Cancellation." The caller must set `heartbeat_timeout`, and the activity must call `activity.heartbeat()` regularly. Heartbeats may be throttled by the worker.
- Values passed to `heartbeat()` are kept by the server and come back in `activity.info().heartbeat_details` on the next attempt. We heartbeat `{ chunk, of }` after every finished chunk and resume from there.
- In a threaded activity, cancel arrives as `temporalio.exceptions.CancelledError` raised inside the thread; `activity.is_cancelled()` can also be polled. A native call (one model batch) cannot be interrupted, so cancel lands between chunks: keep a chunk under a minute of work.
- On shutdown, activities are told (`activity.is_worker_shutdown()`), then cancelled after `graceful_shutdown_timeout`. `shutdown()` waits for activities, so one that ignores cancel blocks the stop.

**Long-running rules we adopt**: one activity per job stage, not per chunk (history stays small); `start_to_close_timeout` sized to the longest allowed source, `heartbeat_timeout` 2 minutes; the default retry is unlimited with backoff, so the contract sets `maximum_attempts` and the non-retryable error types; an activity is at-least-once, so its outputs are written to deterministic keys and a retry overwrites them; scratch is removed in `finally`.

## 5. Cross-Language Rules (TypeScript Workflow, Python Activity)

Temporal's guidance: a workflow "can include Activities written in other languages"; "you will need a separate Worker and different task queue names for the Activities in each language"; each needs "a distinct Activity Type"; and "We recommend appending the language to the Activity name" (temporal.io/blog/community-threads-is-it-possible-to-write-a-single-workflow-with-different, verified 2026-11-14).

```ts
const { mediaPyTranscribe } = proxyActivities<MediaPyActivities>({
  taskQueue: MEDIA_PY_TASK_QUEUE,                 // 'postgear-media-py', from the contract package
  startToCloseTimeout: '6 hours',
  heartbeatTimeout: '2 minutes',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,   // as post-publish.workflow.ts does
  retry: MEDIA_PY_RETRY,
});
```

| # | Rule | Why |
|---|---|---|
| 1 | `MediaPyActivities` is a **type only**. The Node worker registers no function under those names. | The `taskQueue` option routes the task; its default is "the current worker's task queue" (typescript.temporal.io/api/interfaces/common.ActivityOptions, verified 2026-11-14). |
| 2 | **Names are explicit and shared**: Python uses `@activity.defn(name="mediaPyTranscribe")`; the string lives once in the contract package. Without `name=` Python would register the function's own snake_case name. | The activity type is a plain string match (README, verified). |
| 3 | **One argument, one result, both JSON objects.** | The README recommends a single object parameter "so fields can be added later"; activities take positional arguments only (verified). |
| 4 | **JSON types only**: strings, numbers, booleans, null, arrays, objects. No `Date`, `BigInt`, `undefined`, `Map`, bytes. Times are seconds as numbers; file sizes are numbers under 2^53. | Both SDKs default to a JSON payload converter ("Temporal uses a default PayloadConverter that handles JSON serialization", docs.temporal.io/develop/typescript/converters-and-encryption; Python's default handles "JSON-serializable values"; both verified). No custom converter or codec on either side. |
| 5 | **camelCase on the wire**, validated at the edge: the Python activity takes a `dict`, runs `Model.model_validate(payload)`, and returns `model.model_dump(by_alias=True, mode="json")`. | Explicit, and independent of how any converter treats aliases. `temporalio.contrib.pydantic` exists (verified) but is not needed. |
| 6 | **Payloads carry storage keys, never paths, URLs or file bodies.** A transcript is a file; the result is its key and a few numbers. | Workers do not share a disk; Temporal payloads are size-limited (2 MB each, reported) and live in history. |
| 7 | **Timeouts, heartbeat timeout and retry are set by the caller**, in TypeScript, from the contract. | They are options of the activity call (verified). |
| 8 | **Errors have a type**: Python raises `ApplicationError(message, type="MEDIA_BAD_AUDIO", non_retryable=True)`; the contract lists the types and which do not retry. | The type string is what crosses languages (reported; standard SDK behaviour). |
| 9 | **Same namespace, same server**, read from `TEMPORAL_HOST` and `TEMPORAL_NAMESPACE` in the root `.env`. | One Temporal from `docker compose`. |
| 10 | **A version handshake**: `/v1/info` returns `contractVersion`; the Node doctor refuses a mismatch. | The two sides deploy separately. |

A contract test runs a TypeScript workflow against a Python worker in simulation, once, in CI (Module 01's Done When).

## 6. Tooling And Turborepo Wiring

| Tool | Version read | Licence | Job |
|---|---|---|---|
| uv | 0.13.8 (2026-11-12); the owner's machine has 0.12.7 | MIT or Apache-2.0 | Python install, environment, lockfile, runner |
| Ruff | 0.17.5 (2026-11-12) | MIT | Lint and format (the Biome of Python) |
| mypy | 2.4.1 (2026-10-28) | MIT | Type check, strict, with the pydantic plugin |
| pytest | 9.2.0 (2026-10-27) | MIT | Tests |

(pypi.org/pypi/uv/json, ruff, mypy, pytest, verified 2026-11-14.) **Pyright** 1.1.414 (MIT) is the alternative; its PyPI package downloads its own Node (`nodeenv`), so mypy is the lighter install. **Open question for Arvind**: mypy or Pyright? Recommendation: mypy.

**uv facts** (docs.astral.sh/uv, verified 2026-11-14): `uv.lock` is a universal, cross-platform lockfile that "should be checked into version control" and never edited by hand; `.venv` is not committed (uv ignores it for git itself); `uv run` locks and syncs before it runs the command; `uv sync --locked` fails if the lockfile is stale (CI and the image); the `dev` group is installed by default and `--no-dev` leaves it out; `uv run --env-file` exists (checked locally).

**Dependency groups**: `dev` (Ruff, mypy, pytest), `ml` (faster-whisper, MediaPipe, OpenCV, PySceneDetect), `gpu` (the CUDA libraries). The base install is only FastAPI, pydantic, temporalio, boto3 and structlog, so simulation, lint, type check and tests need no model library. Tests that need one carry `@pytest.mark.ml` and are skipped unless the group is installed.

**Turborepo** (turborepo.dev/docs/guides/multi-language, verified 2026-11-14): a non-JavaScript project is visible once its folder has a `package.json` with a `name` and `scripts` and sits inside the workspaces. The root already lists `apps/*`, and `turbo.json` already has `lint`, `typecheck`, `test` and `dev`, so this file is the whole wiring:

```json
{
  "name": "@postgear/media",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "uv run uvicorn media.main:app --reload --reload-dir src --host 127.0.0.1 --port 8100",
    "start": "uv run --no-dev python -m media.worker",
    "lint": "uv run ruff check . && uv run ruff format --check .",
    "lint:fix": "uv run ruff check --fix . && uv run ruff format .",
    "typecheck": "uv run mypy src tests",
    "test": "uv run pytest -q",
    "clean": "rm -rf .venv .mypy_cache .ruff_cache .pytest_cache"
  },
  "dependencies": { "@postgear/media-contract": "*" }
}
```

- `npm run validate` (`turbo run lint typecheck test`) and `npm run dev` now include Python with no change to `turbo.json`.
- The `dependencies` line is how Turborepo knows to re-run the Python checks when the contract changes; with npm the range is `*` (same guide, verified).
- Turborepo hashes every file that git does not ignore, so `.venv`, `.mypy_cache`, `.ruff_cache`, `.pytest_cache`, `__pycache__` and the model folder go in `.gitignore`.
- **CI** (`.github/workflows/ci.yml` runs checkout, setup-node, `npm ci`, `db:generate`, `npm run validate` today): add a uv setup step and `uv sync --locked` in `apps/media` before `validate`. A machine without uv fails `validate` at this package, which is the wanted behaviour.

## 7. Windows Notes And The Python Version

The owner's machine: Windows 11, Python 3.13.15, uv 0.12.7 (checked locally 2026-11-14). A dry run (`uv pip compile --only-binary :all:`) resolved the whole stack from wheels alone for **Windows x64 and Linux x64, on Python 3.13 and on 3.14** (run 2026-11-14, nothing installed).

| Package | Windows x64 wheel for 3.13 | Python range | Note |
|---|---|---|---|
| faster-whisper 1.2.1 | pure Python wheel | 3.9 or newer | classifiers stop at 3.11, but it installs |
| ctranslate2 4.9.0 | `cp313-win_amd64`, 20 MB (also cp39 to cp315) | 3.9 or newer | CPU on Windows out of the box |
| onnxruntime 1.32.0 | `cp313-win_amd64`, 17 MB | 3.11 or newer | used by faster-whisper's VAD |
| av (PyAV) 19.0.2 | `cp312-abi3-win_amd64`, 28 MB | **3.12 or newer** | bundles the FFmpeg libraries (reported) |
| mediapipe 1.2.3 | `py3-none-win_amd64`, 26 MB | classifiers 3.9 to 3.14 | no macOS Intel wheel |
| opencv-python-headless 5.0.0.93 | `cp37-abi3-win_amd64`, 44 MB | 3.6 or newer | see the OpenCV note in `02-libraries.md` |
| numpy 2.5.4 | `cp313-win_amd64`, 13 MB | **3.12 or newer** | |
| temporalio 1.36.1 | `cp311-abi3-win_amd64`, 16 MB | 3.11 or newer | |
| whisperx 3.8.6 (not picked) | pure Python, pins `torch~=2.8.0` | 3.10 to 3.13 only | the ceiling that rules out 3.14 if ever added |

(pypi.org/pypi/<name>/json file lists, verified 2026-11-14.)

**Pin Python 3.13**: `requires-python = ">=3.13,<3.14"` and `.python-version` `3.13`. It is what the owner has, every package ships a 3.13 wheel, the floor set by numpy and PyAV is 3.12, and 3.14 would shut out WhisperX and `kokoro-onnx` (both `<3.14`) should they be added later. The image uses the same minor.

Windows specifics: develop on CPU (a Windows GPU needs the cuBLAS and cuDNN DLLs on `PATH`; not worth it for dev); Hugging Face's cache uses symlinks and falls back to copies without Developer Mode (reported); `loop.add_signal_handler` does not exist on Windows, so the worker stops on `KeyboardInterrupt` there and on SIGTERM in Linux (reported); use `pathlib` everywhere and keep scratch on the same drive as the model folder; npm runs scripts through `cmd.exe`, where `&&` works.

## 8. The Typed Contract Between Node And Python

One pure TypeScript package (`packages/media-contract`, or the name Sprint 12 gave the reserved contract package) owns: the queue name, activity names, input and result shapes, error types, timeouts and retry, `contractVersion`, and shared fixtures.

1. **Shapes are written with Zod's version 4 API** (`import { z } from 'zod/v4'`, `z.strictObject`). The repo has zod 3.25.76, which ships that subpath. Tested locally on 2026-11-14: `z.toJSONSchema()` emits draft 2020-12 with `additionalProperties: false`; handed a Zod 3 schema (the `import { z } from 'zod'` style used everywhere else) it throws. So this package is the first to use `zod/v4`, and its schemas are not mixed with Zod 3 ones.
2. **JSON Schema is generated and committed**: a script writes `schema/*.json`; a Jest test fails on drift. `zod-to-json-schema` is not used (archived 2026-06-30, see `02-libraries.md`).
3. **Pydantic models are generated from that JSON Schema** with `datamodel-code-generator` 0.96.0 (MIT) into `schemas/generated.py`, committed; `lint` fails if a fresh run changes the file. Hand-mirroring is the fallback if the generated code reads badly. **Open question for Arvind**: generated or hand-mirrored? Recommendation: generated, with the fixture test as the judge.
4. **The same fixtures are parsed in both languages**: `fixtures/valid/*.json` must pass Zod in Jest and pydantic in pytest; `fixtures/invalid/*.json` must fail in both. This is the test that catches a drifted field.
5. **The HTTP surface**: FastAPI writes an OpenAPI document; `python -m media.openapi` dumps it without a running server, and `openapi-typescript` 7.13.0 (MIT, OpenAPI 3.0 and 3.1, types only, no runtime) turns it into `media-api.d.ts` (openapi-ts.dev/introduction, verified 2026-11-14). Its docs ask for `module` ESNext or NodeNext; the API compiles as CommonJS, so Module 01 checks that the generated types load there. With three routes, hand-written Zod shapes in the contract are an acceptable fallback.
6. **Keys, never paths**: every file crosses as a storage key in the private clip key space; each side resolves it with its own storage code.

## 9. Storage, Scratch And The Model Cache

- **S3 and MinIO**: `boto3` 1.44.3 (Apache-2.0, 2026-11-13) (pypi.org/pypi/boto3/json, verified 2026-11-14). It is blocking, which suits threaded activities. Path-style addressing for MinIO, as `S3_FORCE_PATH_STYLE` does on the Node side. Its managed transfers handle multipart (reported).
- **Local directory mode** (`STORAGE_PROVIDER=local`): keys map to files under the same private directory the Node storage package uses. The join is guarded: resolve the path and refuse anything outside the root.
- **One small interface**: `get_to_file(key, path)`, `put_file(path, key, content_type)`, `exists(key)`. The key layout is defined once, in the contract; a fixture list of keys is checked by both sides.
- **Scratch**: `MEDIA_SCRATCH_DIR/<jobId>/`, made per attempt, removed in `finally`; a sweep at boot deletes folders older than a day; free disk is checked before a download.
- **Models**: `MEDIA_MODEL_DIR`, passed as `download_root`; `local_files_only=True` in production so a missing model fails loudly (both are `WhisperModel` arguments, verified in `transcribe.py`). Models are pinned by revision (supported since faster-whisper 1.2.0, verified in its release notes).

| Where the model comes from | Good | Bad | Use |
|---|---|---|---|
| Downloaded on first use | nothing to set up | first job is slow; needs outbound internet; fails if the Hub is down | local development |
| Baked into the image | starts ready, fully offline | image grows by the model (about 1.6 GB for turbo, reported); a model change is a rebuild | serverless GPU |
| A mounted volume filled by `python -m media.fetch_models` at deploy | small image, offline at run time, one copy for many workers | one more deploy step | **production default** |

## 10. Docker Image

The uv Docker guide (docs.astral.sh/uv/guides/integration/docker, verified 2026-11-14) gives the recipe: copy the pinned binary with `COPY --from=ghcr.io/astral-sh/uv:0.13.8 /uv /uvx /bin/`; set `UV_COMPILE_BYTECODE=1`, `UV_LINK_MODE=copy`, `UV_NO_DEV=1`, `UV_PYTHON_DOWNLOADS=0`; mount the cache (`--mount=type=cache,target=/root/.cache/uv`); sync in two steps so dependencies are their own layer (`uv sync --frozen --no-install-project` with only the lockfile, then copy the source and `uv sync --locked`); build in one stage and copy only `/app/.venv` into the final one; put `/app/.venv/bin` on `PATH`; list `.venv` in `.dockerignore`.

| Variant | Base | Adds | Expected size |
|---|---|---|---|
| CPU | `python:3.13-slim-trixie` (43 MB compressed, 2026-11-08) | the `ml` group; no PyTorch | under 1 GB without models (estimate) |
| GPU | the same base plus the `gpu` group (`nvidia-cublas-cu12` 12.9.3.13, `nvidia-cudnn-cu12` 9.28.1.4, with `LD_LIBRARY_PATH`), or `nvidia/cuda:12.9.2-cudnn-runtime-ubuntu24.04` (3.09 GB compressed, 2026-05-20) | CUDA 12 and cuDNN 9, which CTranslate2 needs | 3 to 6 GB (estimate) |

(hub.docker.com tag lists and pypi.org, verified 2026-11-14.) Notes: Docker Hub's newest `nvidia/cuda` tags are CUDA 13 (13.5.0, 2026-11-05); faster-whisper's README says CTranslate2 supports CUDA 12 with cuDNN 9, and nothing read today says 13 works, so the GPU image stays on the last CUDA 12 tag until Module 14 proves otherwise. Keep PyTorch out: on Linux `torch` 2.15.0 pulls the CUDA 13 toolkit and cuDNN as dependencies (pypi.org/pypi/torch/json, verified), which is gigabytes. The image runs as a non-root user with a read-only root file system and a writable scratch mount. Debian, not Alpine, matching the Sprint 12 worker image.

## 11. Deployment Options And Cost (Read 2026-11-14)

| Option | Example | Price read today |
|---|---|---|
| CPU box | Hetzner CCX23 (4 dedicated vCPU, 16 GB) / CCX33 (8, 32 GB) / CCX43 (16, 64 GB) | EUR 0.1178 / 0.1891 / 0.3766 an hour; EUR 73.49 / 117.99 / 234.99 a month, Helsinki, excluding VAT |
| Rented GPU, RunPod | L4 24 GB; RTX A5000 24 GB; A40 48 GB | $0.69 / $0.27 / $0.59 an hour (Secure Cloud); $0.44 / $0.16 / $0.35 (Community Cloud). No T4 or A10 listed |
| Rented GPU, Lambda | Quadro RTX 6000 24 GB; A10 24 GB | $0.69; $1.29 an hour (the page says these take effect 2026-11-16) |
| Rented GPU, Hetzner | GEX45, RTX PRO 4000 Blackwell 24 GB, 64 GB RAM | EUR 0.3429 an hour, EUR 214 a month, EUR 209 setup, excluding VAT |
| Serverless GPU, Modal | T4; L4; A10 | $0.000164; $0.000222; $0.000306 a second ($0.59; $0.80; $1.10 an hour), plus $0.0000131 a core-second and $0.00000222 a GiB-second; $30 free credit a month on the $0 plan |
| Serverless GPU, RunPod | 16 GB class; 24 GB class (L4, A5000, 3090); 48 GB (A6000, A40) | $0.58; $0.75; $1.22 an hour |
| Serverless GPU, Replicate | T4; L40S; CPU | $0.000225 a second ($0.81 an hour); $3.51; $0.36 an hour |

(hetzner.com/cloud/general-purpose, hetzner.com/dedicated-rootserver/matrix-gpu, runpod.io/pricing, lambda.com/pricing, modal.com/pricing, replicate.com/pricing, verified 2026-11-14. AWS's G4 page showed no price for the T4 instance and Google's GPU page did not load, so neither is quoted.)

**Scale to zero, the trade-offs**: Modal bills by the second and nothing at zero containers, but keeps a container 60 seconds after the last call by default, billed. RunPod bills from worker start to stop, cold start included (the image pull is not billed, loading the model is), with a 5 second idle window (docs.runpod.io/serverless/pricing, verified 2026-11-14). Replicate bills a private model for set-up and idle time too. Two consequences for us:

- **A sleeping container cannot poll a Temporal queue.** Serverless GPU therefore sits behind the always-on Python worker as one more `Transcriber` binding: the worker takes the activity, calls the GPU function over HTTPS with short-lived signed URLs, and heartbeats while it waits. An always-on GPU box instead runs the same image with `python -m media.worker` on its own queue.
- **Cold start is model load**: bake the model into the serverless image, and expect about a minute before the first word (estimate).

**The ladder**:

1. **Launch**: one CPU box (8 vCPU, 32 GB, about EUR 118 a month) runs the service. Faces, scenes and clip-length transcription run there. Long transcription uses the API fast lane (`04-transcription.md`, section 8).
2. **If audio may not leave our account**: add the serverless GPU binding (about $0.05 a source hour; the first 500 hours a month fit inside Modal's free credit).
3. **At about 5,000 to 8,000 source hours of long transcription a month**: an always-on 24 GB GPU pays for itself (EUR 214 dedicated, or $321 to $504 rented, against $200 to $320 of API calls), and the wait at peak gets shorter. Below that volume a GPU is a cost with no return.

## 12. Simulation

`MEDIA_SIMULATION=true` (default: follows `CLIPS_SIMULATION`, the way `ANALYTICS_SIMULATION` follows `PUBLISH_SIMULATION`; refused in production):

- The factory binds `SimulationTranscriber`, `SimulationFaceTracker` and `SimulationSceneDetector`. They read recorded outputs for the bundled sample video from the contract package's `fixtures/` (a transcript with word timings, face tracks, scene cuts), recorded once by a script from a real run.
- For any other audio key the sample is repeated to cover the file's length, so every screen has words to show.
- No model library is imported and nothing is downloaded: the `ml` group need not be installed. A test asserts that importing `media.main` under simulation leaves `faster_whisper`, `cv2` and `mediapipe` out of `sys.modules`.
- Jobs take a short, configurable time and heartbeat as real ones do, so progress, cancel and retry can be tested. An optional `simulate` field in the input (honoured only under simulation) forces a named failure, the media version of `[simulate:429]`.
- The same fixtures feed the Jest and pytest contract tests, so the stand-in cannot drift from the real shape.

## 13. Security

- **Never public**: binds `127.0.0.1` locally and a private network in production; no ingress rule, no public DNS name. Only the API and the Node worker reach it.
- **Internal token**: every route except `/healthz` needs `MEDIA_INTERNAL_TOKEN` in a header, compared in constant time (`hmac.compare_digest`), the same idea as `InternalTokenGuard` and `AUTOMATION_INTERNAL_TOKEN`. `/docs` and `/openapi.json` are off in production.
- **No shell, no child process**: the service starts no program. Decoding is PyAV in-process; FFmpeg and yt-dlp stay behind the Node worker's safe runner. Ruff's security rules (the `S` set) flag `shell=True`, `eval` and `pickle` loads (reported).
- **Inputs are keys only**: a key must match the private clip pattern and the job's organisation prefix; no URL is accepted, so there is nothing to forge a request with. The one outbound host (the transcription API, if enabled) is fixed in code.
- **It only opens files we made**: the analysis audio and proxy written by the Node worker after `ffprobe`, never a raw upload.
- **Resource limits**: container memory and CPU limits; `max_concurrent_activities`; a maximum audio length and file size checked before download; a scratch quota and free-disk check; `start_to_close_timeout`; a fixed thread count for the model.
- **Secrets and supply chain**: storage credentials scoped to the private clip bucket; `uv.lock` committed and `uv sync --locked` everywhere; models pinned by revision and loaded with `local_files_only`.

## 14. Open Questions

- **Open question for Arvind**: one process (FastAPI starts the worker) or two? Recommendation: one locally and at launch, with the worker-only entry point ready for a GPU box.
- **Open question for Arvind**: the port. Recommendation: 8100, local only, set by `MEDIA_PORT`.
- **Open question for Arvind**: which serverless GPU vendor, if one is needed? Recommendation: Modal (per-second billing, monthly free credit); decide in Module 14, not before.
- **Open question for Arvind**: should simulation need Python at all? Recommendation: yes. It exercises the queue, the contract and cancel, the base install is small, and CI installs uv in seconds.
- **To confirm in Module 01**: the generated types under CommonJS; one OpenCV build in the lockfile; the cross-language test in CI; `uv` minimum version on the owner's machine (0.12.7 today, 0.13.8 current).
