# Module 01: Media Service Foundations

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session)
> **Depends on**: Sprint 12, built and through its exit gate (first module; creates the branch)
> **Stories**: foundations for every story
> **Next**: [Module 02](module-02-transcription.md) (Transcription), [Module 07](module-07-face-detection-and-detect-camera.md) (Face Detection)

## Goal

After this module there is a Python service in the repo that behaves like any other workspace: `npm run dev` starts it, `npm run validate` lints, type-checks and tests it, and a TypeScript workflow can call a Python activity on its own queue and get a typed answer back. Shapes shared by the two languages are written once. It runs in simulation with no model installed. No AI feature exists yet.

## Read First

- `CLAUDE.md`; Sprint 12's README (rules, names, **its whole Decision Log and Progress notes**) and the sprint doc's Deviations section; then the README in this folder.
- Sprint doc: What The Research Settled (items 1 and 2), The Media Service And Its Contract, Simulation.
- Research: [`05-python-media-service.md`](../research/05-python-media-service.md), all of it; [`02-libraries.md`](../research/02-libraries.md), the Python rows and their pinned versions; [`08-approach-on-postgear.md`](../research/08-approach-on-postgear.md).
- Code: `turbo.json`, the root `package.json`, `apps/worker/package.json`, `apps/worker/src/index.ts` (the roles from Sprint 12), `packages/scheduling/src/clips.ts` (the reserved queue name), `apps/worker/src/clips/providers.ts`, `apps/worker/src/config/env.ts`, `.github/` (CI), `docker-compose.yml`, `.claude/skills/temporal-workflow/SKILL.md`.

## Design

### 1. Refresh Against Sprint 12 (Do This First)

Read Sprint 12's Decision Log, Progress notes, Deviations and completion checklist. For every name, path, route or shape that differs from what the Sprint 13 documents assume, fix the Sprint 13 document (the sprint doc, this README's names table, the affected module) and add one Decision Log row listing what was corrected. Then save the **regression set**: export five varied Sprint 12 clips under simulation (each layout, text, a sticker, a zoom, two speeds, a sound) and keep their documents as JSON fixtures in `packages/video-engine/fixtures/v1-clips/` with a small record of each export's length, size and five frame hashes. Module 16 re-exports them and compares (the frames are taken with `ffmpeg -ss ... -frames:v 1`).

### 2. The Contract (`packages/media-contract`)

A pure TypeScript package. For each activity: its name as a constant and two shapes written with `zod/v4` (research 05 found that the JSON Schema export works on version 4 shapes and not on the repo's version 3 ones; the installed zod ships both).

- `npm run contract:export` writes `schema/*.json`; `npm run contract:python` generates Pydantic models into `apps/media/src/postgear_media/contract/` (generated files are committed and carry a "do not edit" header); a test fails if the generated files are out of date.
- `fixtures/<activity>/*.json`: example inputs and outputs. Jest parses each with the Zod shape; pytest parses the same files with the generated models. Both must pass.
- Rules written in the package's README: one JSON object in, one out; camelCase keys; only JSON types; storage keys, never paths or addresses; a `version` field on every input so a newer Node side can be told from an older Python side.
- First entry: `mediaPyHealth` (no input; output: the service version, Python version, which bindings are live, whether models are present).

### 3. The Service (`apps/media`)

The layout research 05 gives, kept small:

```
apps/media/
  package.json            dev, lint, typecheck, test, format scripts that call `uv run`
  pyproject.toml          Python >=3.13,<3.14; base deps; an `ml` dependency group for model libraries
  uv.lock
  .python-version
  src/postgear_media/
    main.py               FastAPI app: /health, /ready, /tools; starts the worker in its lifespan
    worker.py             the Temporal worker on postgear-media-py (activities only)
    core/                 settings (pydantic-settings, reads the repo root .env), logging (no payloads), storage, scratch
    contract/             generated models
    activities/           one thin function per contract entry
    services/             the real work (empty until Module 02)
    providers/            real and simulated bindings, chosen in one factory
    simulation/           recorded answers for the samples
  tests/
```

- One process: FastAPI serves health and readiness on `MEDIA_URL`'s port (8100) and runs the Temporal worker as a background task in its lifespan. FastAPI is for people and health checks; all real work arrives through Temporal. Every HTTP route except `/health` needs `MEDIA_INTERNAL_TOKEN`.
- Activities are plain `def` functions run on a thread pool (Temporal's own advice for blocking work), named explicitly from the contract (`@activity.defn(name=...)`), each validating its input with the generated model, heartbeating, and stopping at the next chunk when cancelled.
- Storage: the same two spaces as Sprint 12 through boto3 (S3 or MinIO) or the local folder, with the same key rules (a small Python copy of the clip key pattern, tested against the same examples as the TypeScript one). Scratch folders per activity, removed in `finally`.
- Logs: structured, one line per activity start and end with its name, job id and time taken. Never an input's content.
- `MEDIA_SIMULATION`: read by the provider factory; when on, every provider is the simulated one and the `ml` group need not be installed.

### 4. Calling It From TypeScript

- `packages/scheduling/src/clips.ts`: `MEDIA_PY_TASK_QUEUE` is used now; add `MEDIA_GPU_TASK_QUEUE = 'postgear-media-gpu'` as reserved; timeouts and heartbeat values per Python activity as data.
- `apps/worker/src/clips/media-py.ts`: `mediaPy = proxyActivities<MediaPyActivities>({ taskQueue: MEDIA_PY_TASK_QUEUE, ... })`, where `MediaPyActivities` is a type built from the contract. Workflows import this stub; nothing else knows Python exists.
- `clipRuntimeCheckWorkflow` (Sprint 12 Module 02) also calls `mediaPyHealth` with a short timeout. `GET /clips/status` gains `ai.service: 'ok' | 'off'`, which every later AI button reads.
- Worker and API env: `MEDIA_SIMULATION` (the enum shape of the other flags; refused in production; when unset it follows `CLIPS_SIMULATION`), `MEDIA_URL`, `MEDIA_INTERNAL_TOKEN`.

### 5. Tooling And Turborepo

- `apps/media/package.json` scripts: `dev` (`uv run` the app with reload, the root `.env` loaded), `lint` (Ruff check and format check), `typecheck` (mypy, strict on `src`), `test` (pytest). Root `package.json` and `turbo.json` need no change beyond what research 05 says; confirm `npm run validate` now runs the Python tasks.
- `npm run dev` starts it with the others. If `uv` is missing, the script prints one clear line and exits without failing the rest (the app still works; AI shows as off).
- CI: add a uv setup step and cache.
- `docs/local-testing-guide.md`: how to install uv, `uv sync` (base only for simulation; `--group ml` for real runs).

### 6. The Third Sample And The Image

- `npm run clips:samples` gains `two-speakers`: a generated 4 minute video with two face-like markers side by side taking turns, with distinct tone patterns as "speech" at times written in its facts JSON. Beside each sample, recorded answer files for later modules will be added by those modules.
- `infra/docker/Dockerfile.media`: the base image and uv steps research 05 gives; a slim image with the base group for simulation and a full one with the `ml` group; a non-root user; a model cache folder as a volume. Build it once here to prove it; deployment is Module 15.

### 7. Tests

- Contract: export is current; every fixture passes on both sides.
- Python: settings, the provider factory (simulation on and off), storage (local), key pattern examples, the health activity, cancellation at a heartbeat.
- Node: the stub's types, the runtime check with the Python queue up and down, `ai.service` in the status.
- One cross-language test under simulation: start the Python worker and the Node worker, run a workflow that calls `mediaPyHealth`, assert the typed answer.

## Scope

**In**: the refresh and regression set, the contract package with generation, the service skeleton, the stub and health call, env flags, tooling, CI, the third sample, the image.
**Out**: any model or AI feature (02 onward), deployment and scaling (14).

## Tasks

- [ ] Refresh the Sprint 13 documents against the built Sprint 12; the Decision Log row.
- [ ] The regression set in `packages/video-engine/fixtures/v1-clips/`.
- [ ] Branch `sprint-13-clips-ai`; note it in the README.
- [ ] `packages/media-contract`: `mediaPyHealth`, export, generation, shared fixtures, the freshness test.
- [ ] `apps/media`: project files, settings, logging, storage, scratch, the provider factory, `main.py`, `worker.py`, the health activity.
- [ ] The TypeScript stub, the runtime check, `ai.service`, env flags in the API and the worker.
- [ ] Turborepo scripts, the missing-uv message, CI, the testing guide.
- [ ] The `two-speakers` sample; `Dockerfile.media` built once.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npm run contract:export
npx jest --config packages/media-contract/jest.config.js
npm run test --workspace=apps/media
npm run lint --workspace=apps/media
npm run typecheck --workspace=apps/media
npx jest --config apps/worker/jest.config.js clips
npm run validate
```

## Done When

- `npm run dev` starts the Python service beside the API, the worker and the web app; its log names the queue it serves.
- `GET /clips/status` says `ai.service: 'ok'`; with the Python service stopped it says `'off'` within about 10 seconds and nothing else breaks.
- A TypeScript workflow gets a typed answer from `mediaPyHealth`.
- `npm run validate` runs Ruff, mypy and pytest and is green.
- Changing a shape in the contract without regenerating fails a test.
- With `MEDIA_SIMULATION=true` and only the base packages installed, everything above works.
- The regression set is saved, and the Sprint 13 documents match the Sprint 12 code.

## Hand Check

1. `uv --version` works; `npm run dev`: four processes, the Python one logs "serving postgear-media-py".
2. Open `http://localhost:8100/health`: OK.
3. Clips page, network tab, `GET /clips/status`: `ai.service` is `ok`.
4. Stop the Python service: reload, `ai.service` is `off`; the Clips page and the editor work as before.
5. `npm run validate`: the Python tasks appear in the output and pass.
6. Read the Decision Log row that lists what was corrected against Sprint 12.

## Handoff

Module 02 adds `mediaPyTranscribe` to the contract and its service. Module 07 adds `mediaPyDetectFaces`. Module 06 adds `mediaPyMotion` and `mediaPyStills`. Every one follows the pattern proved here: a contract entry, a generated model, fixtures on both sides, a thin activity, a service, a simulated binding.
