# Module 02: Media Runtime

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 01](module-01-contracts-and-data.md)
> **Stories**: foundations for CL-1.4, CL-10.1; CL-13.3 (videos are private); CL-9.4 and CL-7.5 (the public `library/` prefix the catalogue files live under)
> **Next**: [Module 03](module-03-link-engine.md) (Link Engine)

## Goal

After this module the machinery for video work exists and is proven with a harmless job: storage the worker can read and write, a private space with signed addresses, one safe way to start an outside program, a doctor that checks the tools, the worker serving the new queues by role, a job row with a live progress stream, and a reconcile for jobs that never started. Nothing is downloaded or rendered yet.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- Sprint doc: Jobs And Queues, Storage, Simulation.
- Research: [`08-approach-on-postgear.md`](../research/08-approach-on-postgear.md) sections 3, 4, 5 and 7; [`02-libraries.md`](../research/02-libraries.md) (the AWS SDK rows, FFmpeg builds, yt-dlp and its JavaScript runtime); [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md), the abuse and security section; [`10-open-source-sound-and-sticker-libraries.md`](../research/10-open-source-sound-and-sticker-libraries.md), section 8.2 step 8 (where catalogue files are stored); [`05-editor-and-render.md`](../research/05-editor-and-render.md) and [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md) (what the FFmpeg build must support).
- Code: `apps/api/src/modules/media/storage/` (all of it: `storage.interface.ts`, `storage.factory.ts`, `s3.storage.ts`, `local.storage.ts`, `storage-keys.ts`), `apps/api/src/modules/media/media.module.ts` (`storageConfigFrom`); `apps/worker/src/lib/media-url.ts` (the duplicated key pattern); `apps/worker/src/index.ts`, `activities/index.ts`, `activities/deps.ts`; `apps/worker/src/workflows/maintenance.workflow.ts`; `apps/api/src/modules/scheduling/scheduling.service.ts` (`startAutomationRun`, `signalAutomationRun`, `attempt`); `apps/api/src/modules/automations/runs/automation-run-events.service.ts` and `automation-runs.controller.ts`; `apps/api/src/common/sse.ts`; `apps/web/src/components/workflows/runs/use-run-stream.ts`; `docker-compose.yml`; `.claude/skills/temporal-workflow/SKILL.md`.

## Design

### 1. Shared Storage (`packages/storage`)

Move the storage code out of the API into `@postgear/storage` (Node, not pure) and import it from both the API and the worker. Behaviour of the public space does not change; the media module's tests must pass untouched apart from import paths.

- Keep `StorageBackend` (public space) as it is. Move `storage-keys.ts` here and delete the copy of `KEY_PATTERN` in `apps/worker/src/lib/media-url.ts` (import it).
- Add `PrivateStorage`, a second interface for the clips space:

```ts
interface PrivateStorage {
  putFile(key: string, filePath: string, contentType: string): Promise<{ bytes: number }>;   // multipart above 64 MB
  getToFile(key: string, filePath: string, signal?: AbortSignal): Promise<void>;             // streamed, never buffered
  stat(key: string): Promise<{ bytes: number } | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  signedUrl(key: string, opts: { expiresInSeconds: number; downloadName?: string }): Promise<string>;
  createUpload(key: string, contentType: string): Promise<{ uploadId: string }>;             // browser uploads in parts (Module 04)
  signPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeUpload(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<{ bytes: number }>;
  abortUpload(key: string, uploadId: string): Promise<void>;
}
```

- **S3 binding**: a second bucket, `CLIPS_PRIVATE_BUCKET` (default `postgear-clips`), never public. `@aws-sdk/lib-storage` for `putFile`, `@aws-sdk/s3-request-presigner` for `signedUrl` and `signPart`. Objects carry `Cache-Control: private, max-age=3600`.
- **Local binding** (development): files under `<UPLOAD_DIRECTORY>/private/`. `signedUrl` returns `${API_URL}/clips/files/<token>` where the token is the key, the expiry and an HMAC over both with `CLIPS_URL_SECRET`; the API serves it with `Range` support and a constant-time check (`ClipFilesController`, `@Public()`, the token is the authority). Uploads in parts are stored as part files and joined on complete.
- **Keys**: `clipKeys` builders and a strict pattern for the three shapes in the README Names table; `assertValidClipKey` refuses anything else. Ids in keys are UUIDs; the file part is random hex. `libraryKeys` builders and `assertValidLibraryKey` cover the catalogue's public files: `library/sounds/<first 2 hex>/<sha256>.m4a`, `library/stickers/<first 2 hex>/<sha256>.apng` or `.png`, `library/previews/<first 2 hex>/<sha256>.webp` (the key is the content hash, so the files are immutable and cached for a year).
- `resolveUploadDirectory()` today finds the folder by looking for `@postgear/api`, which fails in the worker. Make the directory explicit: `UPLOAD_DIRECTORY` if set, else the repo root's `apps/api/uploads` found from the workspace root marker. Local mode needs both processes on one machine.
- **Production needs S3 (decision D12-05).** The API and the worker are separate processes, and signed addresses need object storage, so the storage factory **refuses to start the clips space on the local binding when `NODE_ENV=production`** ("Clips needs an S3 bucket in production: set the S3 variables."). Production uses an S3-compatible bucket pair, a public media bucket and a private clips bucket (Cloudflare R2 or AWS S3: the code uses only the S3 API). Development keeps MinIO or the local folder. `.env.example` says so in one comment.
- The worker env gains the storage variables the API already has (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `UPLOAD_DIRECTORY`) plus `CLIPS_PRIVATE_BUCKET` and `CLIPS_URL_SECRET`. `ActivityDeps` gains `storage` and `privateStorage`.
- `docker-compose.yml`: a one-shot `minio-setup` service (the `minio/mc` image) that creates both buckets, sets anonymous read on the public one only, and applies CORS for `http://localhost:3000` with `Range` allowed and `Content-Range`, `Accept-Ranges`, `Content-Length` and `ETag` exposed. The editor's preview (Module 08) and the source player (Module 07) need this. The **public bucket's `library/` prefix** is where the sound and sticker catalogue lives: anonymous read, uploaded with `Cache-Control: public, max-age=31536000, immutable`; the setup service creates the prefix with a placeholder so the console shows it, and says in a comment that production applies the same read policy to `library/*` on the public bucket.

### 2. The Process Runner And The Doctor (`packages/media-tools`)

`@postgear/media-tools`, Node only, imported by the worker alone.

- `runTool(tool, args, opts)`: `spawn` with an argument array and `shell: false`, `windowsHide: true`, a working directory inside the job's scratch folder, a minimal environment, a timeout, caps on captured output (the last 8 KB of stderr are kept for the log only), line callbacks for progress (FFmpeg is always started with `-progress pipe:1 -nostats`, and the `key=value` lines are parsed into `{ outTimeMs, speed, frame }` for Module 05's compiler), and an `AbortSignal` that kills the whole process tree (on Windows through `taskkill /T /F`). It rejects with a typed `ToolError` (`tool`, `exitCode`, `timedOut`, `aborted`); the message never contains the tool's output. A filter graph is never put in a shell string: the compiler writes it to a file in the scratch folder and passes it with `-/filter_complex <file>` (FFmpeg 9.0.2 has no `-filter_complex_script`).
- A lint rule or a test that fails if `child_process` is imported anywhere outside this package.
- `toolPaths(env)`: `YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_JS_RUNTIME` (default: the names on `PATH`).
- `doctor(paths)`: runs each tool's version command and returns `{ ffmpeg, ffprobe, ytDlp, jsRuntime }` with `ok`, `version` and a plain reason; minimum versions are constants taken from the research. For FFmpeg it also checks what the render needs, each as its own line: **`-/filter_complex` support** (it runs a one-line graph file against `nullsrc` into the null muxer), and the build flags **libass**, **libharfbuzz** and **libx264** read from `ffmpeg -buildconf`. A build missing any of the four is `ok: false` with a plain reason ("This FFmpeg cannot draw text: it has no libass."), because titles and captions cannot be drawn without them. It also reports whether yt-dlp has its browser-impersonation extra, which Kick needs (a warning, not a stop: without it Kick is treated as paused). `npm run clips:doctor` prints the table.
- `withScratch(jobId, fn)`: makes `<CLIPS_SCRATCH_DIR>/<jobId>/`, runs `fn`, removes the folder in `finally`. `assertFreeDisk(bytes)` refuses a job when the scratch disk has less than the job needs plus 2 GB.
- `probeFile(filePath)`: ffprobe as JSON to `MediaFacts` (`durationMs`, `width`, `height`, `fps`, `videoCodec`, `audioCodec`, `hasAudio`, `container`), with a container and codec allowlist; anything else is `upload_not_video`.

### 3. Worker Roles And Queues

- `apps/worker/src/index.ts`: read `WORKER_ROLES`; build one `Worker` per role and run them together. `publishing` is the existing worker unchanged. `media` serves `MEDIA_TASK_QUEUE` with `maxConcurrentActivityTaskExecutions` from `WORKER_MEDIA_CONCURRENCY` (default 2). `render` serves `RENDER_TASK_QUEUE` with concurrency 1. Each has its own `shutdownGraceTime`.
- On boot with the `media` or `render` role: run the doctor and log one line per tool. A missing FFmpeg stops the boot (it is needed even in simulation), and so does one that fails the render checks (no `-/filter_complex`, libass, libharfbuzz or libx264) when the `render` role is on. A missing yt-dlp only warns when `CLIPS_SIMULATION=true`. The worker has **no browser dependency of any kind**: a Debian slim image with FFmpeg and fonts is enough, and the image itself is built in Module 20.
- `apps/worker/src/clips/providers.ts`: `createClipProviders(env)` returns `{ downloader, channelLister, signalProducers, stickerProvider, renderer }`. In this module every member is a stand-in that throws "arrives in Module NN"; later modules replace them one by one, real and simulated side by side.

### 4. Jobs And Progress

- API `ClipJobsService`: `create(orgId, userId, kind, input, refs)` validates `input` with the engine's schema for that kind and writes the row (the job id is made here, before any charge, so a meter charge can use it as its idempotency key; `priority` is copied from `clips.queue_priority` through the resolver and stored on the row); `start(job)` goes through new `SchedulingService` methods `startClipJob` (queue chosen by kind, id `clip-job:<id>`, `REJECT_DUPLICATE`, an execution timeout from the contract) and `cancelClipJob` (the cancel signal). Both are best-effort like the existing ones; a failed start leaves the row QUEUED for the reconcile.
- `ClipJobEventsService`: a copy in spirit of `AutomationRunEventsService`: re-read the row every 750 ms, emit `progress` when `stage` or `progress` changed, `done` or `failed` at the end, close after 30 minutes. `GET /clips/jobs/:jobId` and `GET /clips/jobs/:jobId/events` (`@SkipThrottle()`, 404 before the stream opens for another workspace's job).
- Worker `apps/worker/src/clips/job-progress.ts`: `jobProgress(jobId)` with `running()`, `report({ stage, progress })` (at most one write a second), `done(output)`, `failed(error)`, `cancelled()`. Activities heartbeat with the `setInterval` pattern.
- `clipRuntimeCheckWorkflow` on `postgear-media`: one activity that runs the doctor inside the worker and returns the versions. `GET /clips/status` calls it (10 s wait, the answer cached for a minute) so the page can say when video tools are not running. This is the harmless job that proves the queue, the role switch and the wait-for-result path that probing will use.
- Reconcile: the maintenance workflow gains an activity `reconcileClipJobs`: a QUEUED job older than two minutes with no running workflow is started; a RUNNING job whose workflow is gone is marked FAILED with "This did not finish. Try again."
- Web: `lib/clips-api.ts` (`getStatus`, `getJob`) and `components/clips/use-clip-job.ts`, a copy in spirit of `use-run-stream.ts` (load, stream, fall back to polling every 1.5 s).

### 5. Tests

- `packages/storage`: the moved tests; new ones for clip keys, the local private binding (put, get to file, delete prefix, the signed token: good, expired, tampered, wrong key), and the part upload round trip. S3 is tested against MinIO only when `S3_ENDPOINT` is set, skipped otherwise.
- `packages/media-tools`: `runTool` against the Node binary itself (echo args, a timeout, an abort, an output cap), the doctor with fake paths (including a build without libass and one without `-/filter_complex`), the FFmpeg progress parser against captured `-progress` output, `withScratch` cleanup on throw, `probeFile` with a fake runner.
- API: job service (schema refusal, start failure leaves QUEUED), the events service with a fake repository, the files controller's token checks, tenancy on every route.
- Worker: the role switch builds the right workers; the reconcile activity with fake rows.

## Scope

**In**: the storage package and the private space, MinIO setup, the process runner, doctor, scratch and probe helpers, worker roles and queues, the job service, events stream and reconcile, the runtime check, `GET /clips/status`.
**Out**: yt-dlp calls and link probing (03), import and its FFmpeg work (04), the render compiler and the render host (05), any page beyond what Module 01 left.

## Tasks

- [ ] `packages/storage`: move the code, fix imports in the API and the worker, delete the duplicated key pattern; media tests green.
- [ ] `PrivateStorage` with the local and S3 bindings, clip keys, the signed file route with Range.
- [ ] Explicit upload directory; storage variables in the worker env; `ActivityDeps` gains both storages.
- [ ] `minio-setup` in `docker-compose.yml` (buckets, policy, CORS); `.env.example` updated.
- [ ] `packages/media-tools`: `runTool`, `toolPaths`, `doctor`, `withScratch`, `assertFreeDisk`, `probeFile`; the `child_process` guard; `npm run clips:doctor`.
- [ ] Worker roles and queues; boot doctor; `createClipProviders` with stand-ins.
- [ ] `ClipJobsService`, `startClipJob`, `cancelClipJob`, the events service and routes, `job-progress.ts`.
- [ ] `clipRuntimeCheckWorkflow`, `GET /clips/status`, the reconcile activity.
- [ ] `clips-api.ts`, `use-clip-job.ts`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/storage/jest.config.js
npx jest --config packages/media-tools/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips apps/api/src/modules/media apps/api/src/modules/scheduling
npx jest --config apps/worker/jest.config.js
npm run clips:doctor
```

## Done When

- The Media library uploads, lists and deletes exactly as before, now through `@postgear/storage`.
- A file put in the private space is not reachable by its key; its signed address works, supports `Range`, and stops working after it expires or if one character is changed.
- `npm run clips:doctor` prints a version for FFmpeg and ffprobe, a line each for `-/filter_complex`, libass, libharfbuzz and libx264, and a version for yt-dlp and its JavaScript runtime when they are installed. A FFmpeg without libass is reported as not OK.
- In production mode the clips space refuses to start on the local binding.
- With `WORKER_ROLES=publishing` the worker serves only publishing; with the default it serves all three queues; publishing a post still works.
- `GET /clips/status` answers with the tool state through the worker; with the worker stopped it answers that video tools are not running, within about 10 seconds.
- No file under `apps` or `packages` other than `packages/media-tools` imports `child_process`.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin:

1. `docker compose up -d`: the MinIO console (`:9001`) shows two buckets, `postgear-media` and `postgear-clips`.
2. `npm run clips:doctor`: FFmpeg and ffprobe are OK, and so are the filter graph, libass, libharfbuzz and libx264 lines.
3. `npm run dev`: the worker's log names the three roles and prints the doctor lines.
4. Media: upload an image, see it, delete it.
5. Call `GET /clips/status` (the browser's network tab on the Clips page): `tools.ok` is true. Stop the worker and reload: the answer says the tools are not running.
6. Schedule a post in simulation and see it publish as before.

## Handoff

Module 03 adds the real and simulated `Downloader` to `createClipProviders` and uses `runTool` for yt-dlp. Module 04 uses `PrivateStorage`, the part upload calls, `withScratch`, `probeFile` and the job service. Module 05 needs the doctor's render checks and `runTool`'s progress parsing; Modules 07 and 08 need the signed address for the players and the CORS setup done here; Modules 12 and 14 need the `library/` key builders. Module 20 builds the worker image.
