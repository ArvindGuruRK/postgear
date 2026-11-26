# PostGear Media Service (`apps/media`)

The Python half of Clips AI (Sprint 13). It does **sound and pictures** (speech to text, faces, motion, stills) as Temporal activities on the `postgear-media-py` queue. It never decides order, retries or progress: the TypeScript workflows in `apps/worker` call its activities by name and own all of that. No language model is ever called from here.

## Layout

| Path | What it holds |
|---|---|
| `src/postgear_media/main.py` | FastAPI: `/health` (open), `/ready` and `/tools` (internal token); starts the worker in its lifespan |
| `src/postgear_media/worker.py` | The Temporal worker (activities only, a thread pool) |
| `src/postgear_media/core/` | Settings (the repo root `.env`), logging (never a payload), storage (keys, never paths), scratch folders |
| `src/postgear_media/contract/` | `generated.py`: Pydantic models generated from `packages/media-contract/schema/contract.json` (do not edit) |
| `src/postgear_media/activities/` | One thin function per contract entry: validate, heartbeat, call a service, answer |
| `src/postgear_media/services/` | The real work |
| `src/postgear_media/providers/` | Real and simulated bindings, chosen in one factory |
| `src/postgear_media/simulation/` | Recorded answers for the sample videos |

## Running It

```bash
uv --version                       # install uv first: https://docs.astral.sh/uv/
uv sync                            # base and dev packages: enough for simulation, lint, types, tests
uv sync --group ml                 # the model libraries, only for real runs
npm run dev --workspace=@postgear/media   # FastAPI on :8100 plus the worker, root .env loaded
```

`npm run dev` at the repo root starts it with the API, the worker and the web app. Without `uv` the script prints one line and exits cleanly; Clips still works and AI shows as off.

## The Contract

Shapes are written once, in Zod, in `packages/media-contract`. After changing one:

```bash
npm run contract:export     # writes packages/media-contract/schema/contract.json
npm run contract:python     # regenerates src/postgear_media/contract/generated.py
```

A Jest test and a pytest test both fail when either file is stale, and the same fixture files are parsed on both sides.

## Rules

- One JSON object in, one out; camelCase keys; JSON types only.
- Storage keys cross the boundary, never paths or addresses.
- Activities are plain `def` functions on a thread pool, heartbeat, and stop at the next chunk when cancelled.
- Never log an input's content, a transcript, a token or a signed address.
- `MEDIA_SIMULATION=true` (refused in production; follows `CLIPS_SIMULATION` when unset) answers every activity from recorded files with no model installed.
