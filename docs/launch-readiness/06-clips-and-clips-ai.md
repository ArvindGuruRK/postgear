# Hosting Clips And Clips AI 🎬

Written on 2026-11-28 (Sprint 13, Module 15). Written for: Arvind, and whoever deploys PostGear next.
It adds the video side to [`05-hosting-and-costs.md`](05-hosting-and-costs.md): what Clips (Sprint 12) and Clips AI (Sprint 13) need to run, where, and when to move up to a bigger setup. Prices are USD unless marked EUR and come from [research 07](../sprint-13/research/07-cost-deploy-and-risks.md) (read on the providers' own pages on 2026-11-14). Every speed below is a benchmark from this project unless it says **planning figure**; the real-test plan measures the real box and replaces those.

---

## 1. The Three Processes Video Needs 🧩

The API never touches a video file. Three background processes do, each polling its own Temporal queue, so a long render never delays a scheduled post or a transcript:

| Process | Image | Started as | Queues | What it does |
|---|---|---|---|---|
| **Media worker** (Node) | `infra/docker/Dockerfile.worker` | `WORKER_ROLES=media` | `postgear-media`, `postgear-media-quick` | Imports, sharp ranges, downloads, Media posters; the quick helpers (link probe, channel lists, the runtime check) |
| **Render worker** (Node) | the same image | `WORKER_ROLES=render` | `postgear-render` | FFmpeg exports, Preview Export, montage, batch export, emote exports |
| **Python media service** | `infra/docker/Dockerfile.media` (`slim` or `full`) | its own container (FastAPI on 8100 plus a Temporal worker) | `postgear-media-py` | Speech to text, faces, motion, stills, the voice |

The publishing worker (`WORKER_ROLES=publishing`, queue `postgear-scheduling`) stays as it is in guide 05. One worker image serves every Node role; `WORKER_ROLES` picks the role per container.

### What Each One Needs (From The Benchmarks)

| Process | Processor | Memory | Where the numbers come from |
|---|---|---|---|
| Media worker | 2 vCPU is enough: the work is mostly network and one FFmpeg copy per job. How many jobs run is the API's `CLIPS_MEDIA_SLOTS` (4) and `CLIPS_MEDIA_PY_SLOTS` (2); give the media workers at least their sum in `WORKER_MEDIA_CONCURRENCY` (6, the default), because a Find Clips run keeps its slot while it waits for its listening and the listening's own short steps need one too (the worker warns at boot when short). Lower `CLIPS_MEDIA_SLOTS`, not the worker's slots, to ease a small box | **Planning figure** (nothing measured it): 1 GB | Concurrency from research 07, section 6 |
| Render worker | An x264 encode uses every core: `RENDER_CONCURRENCY=1` per 4 vCPU, 2 on 8 vCPU only after the box's own benchmark says so. 4 **dedicated** vCPU recommended | 192 to 785 MB peak per export, plus the Node process | Sprint 12 Module 05 on an i7-10850H laptop (FFmpeg 9.0.2): 1080p Fullscreen at 1.92 times real time, Blurred 1.28, 1080p60 0.87. Worst case measured 2026-11-17 on a 12 thread desktop: about real time, 481 CPU seconds for a 60 s clip; captions add about 0.3 CPU seconds a second |
| Python media service | Our own listening takes every thread it is given: `MEDIA_MAX_ACTIVITIES=1` on a processor-only box. 4 vCPU minimum, 8 better | 997 MB peak with `small`. **Planning figure** (not measured) for `large-v3-turbo`: 2 to 3 GB; give the container 4 GB | Sprint 13 Module 02 (Intel i7-8750H, 4 processors given to the container, faster-whisper `small`, int8, a 60 s recording): 10.2 s of listening (0.17 s a second of sound, 5.9 times real time), 4.7 s to load the model. `large-v3-turbo` and faces were not measured on a processor |

**Disk**: each job works in its own scratch folder (`CLIPS_SCRATCH_DIR`, `MEDIA_SCRATCH_DIR`), removed when it ends; a long video needs several GB while it is worked on. The Python service's model folder holds about 1.6 GB for `large-v3-turbo` (0.5 GB for `small`), a few MB for the face detector, and 353 MB for the Kokoro voice (research 07, section 5; Module 09).

**Images, as built on 2026-11-28** (disk size, then the compressed download):

| Image | Size |
|---|---|
| `postgear-worker` (Sprint 12 Module 20: FFmpeg, yt-dlp, Deno, the fonts, no browser) | 1.57 GB, 406 MB |
| `postgear-media:slim` (base packages: simulation, or `TRANSCRIBER=groq` only) | 352 MB, 86 MB |
| `postgear-media:full` (plus the `ml` group: faster-whisper, OpenCV, MediaPipe) | 1.47 GB, 359 MB |

### Which Can Share A Box

- **The media worker shares with anything.** It waits on the network most of the time.
- **The render worker and the Python service both want every core.** On one box they slow each other down; set `RENDER_CONCURRENCY=1` and `MEDIA_MAX_ACTIVITIES=1` and accept that a render and a listen at the same time each take longer. This is fine at launch volumes.
- **The publishing worker should not sit behind heavy video.** It keeps its own queue either way, but when video moves to its own box (step 1 below), publishing stays on the app's box with the API.
- **The Python service is never public.** It binds a private network only; the API (for `/ready` and `/voices`, with `MEDIA_INTERNAL_TOKEN`) and Temporal are the only things that reach it.

---

## 2. Storage Is S3-Compatible, Always 🪣

Production needs S3-compatible storage: Clips refuses the local folder when `NODE_ENV=production`, and separate boxes cannot share a disk anyway. Every process reads the same names (`STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`):

| Bucket | Setting | Who reads it | Rule |
|---|---|---|---|
| Public media | `S3_BUCKET_NAME`, `S3_PUBLIC_URL` | the web app, the social platforms | anonymous reads of objects |
| Private clips | `CLIPS_PRIVATE_BUCKET` | the API (signed addresses only), the Node workers, the Python service | **never public** |

Give the Python service credentials for the private bucket only. Cloudflare R2 fits best: $0.015 per GB a month (10 GB free) and no egress fee (verified 2026-11-14). Research 07 puts storage at about $0.02 a source hour for each month it is kept; the retention rule (Sprint 12 Module 19) deletes old working files.

---

## 3. The Ladder: From One Box To A Graphics Card 🪜

The ladder never changes code: each step is a different `WORKER_ROLES` layout and a different binding of the listener (`TRANSCRIBER`). Move up only when the trigger fires.

| Step | Shape | Speech to text | Monthly cost (research 07) | Move up when |
|---|---|---|---|---|
| **0. One box, with the hosted lane** | The app's host runs every role and the Python service (`full` image) | `TRANSCRIBER=auto`: our own machine up to 55 minutes a job, Groq above it (section 4) | About $5 of usage at 30 source hours a month, on the existing host (Hetzner CPX42 EUR 59.49 or CCX23 EUR 73.49 if the host itself is new) | Render wait p95 passes 5 minutes for a week, or media jobs hold the host's processor above 70 percent for an hour a day |
| **1. A separate media box** | The API and the publishing worker stay put; a second machine (Hetzner CCX33: 8 dedicated vCPU, 32 GB, EUR 117.99 a month or EUR 0.1891 an hour) runs `WORKER_ROLES=media`, `WORKER_ROLES=render` and the Python service, on a private route to Temporal, Postgres and storage | The same | About $165 at 300 source hours a month | Audio must stay in our own account (a customer or the legal read asks), Groq's limits or terms get in the way, or its bill passes $100 a month (about 2,500 source hours) |
| **2. A card rented by the second** | The media box, plus a serverless graphics card the Python service calls (section 6) | The card for long audio, Groq as the fallback when the card's provider is down | About $0.05 a source hour (Modal L4 $0.000222 a second; RunPod serverless 24 GB $0.75 an hour) | The serverless bill passes $200 a month (about 260 card hours), or cold starts push p95 past 2 minutes |
| **3. An always-on card** | Two media boxes plus a card pod on the reserved queue `postgear-media-gpu` (decision D13-11) | The pod, with serverless for bursts | RunPod RTX A5000 $0.27 an hour (about $197 a month), RTX 4090 $0.89 (about $650) | Review each quarter |

**An always-on card only pays at thousands of hours a month.** At $321 a month it breaks even with Groq turbo near **8,000 source hours a month** and with a serverless card near 5,800 (research 04, section 6). Below that, a card that is always on is a cost with no return, which is why D13-11 says no always-on card.

---

## 4. The Hosted Lane (`TRANSCRIBER=auto`) 🚀

A processor listens at about real time or slower, so a three hour stream would take hours on our own machine. The hosted lane sends only the long jobs out:

| Setting | Value | Notes |
|---|---|---|
| `TRANSCRIBER` | `auto` | `faster-whisper` keeps everything on our machine; `groq` sends every job (no fallback, runs on `slim`); `simulation` answers from recorded files |
| `TRANSCRIBE_HOSTED_ABOVE_MINUTES` | `55` (default) | A job asking for more minutes of sound than this goes to Groq |
| `GROQ_API_KEY` | from Groq's console | Without it, `auto` is always our own machine. How to get it: [the keys guide, Recipe 4](../sprint-12/clips-keys-guide.md#recipe-4-groq-key-for-long-listening-sprint-13-module-15) |
| `WHISPER_MODEL` | `large-v3-turbo` | Our own machine's model |

- **Where 55 comes from**: the stretch our machine would listen to in about ten minutes, from Module 02's benchmark. Ten minutes is 600 s; minus 4.7 s to load the model, at 0.17 s a second of sound, that is 3,502 s of sound. Our machine's 5 minute chunks overlap by 3 s, so a stretch costs 300 / 297 of its length: 3,467 s, about 57.8 minutes, rounded down to 55.
- **Set it per box.** The benchmark ran `small`; the default `large-v3-turbo` is slower and was not measured. On the real box: `npm run clips:listen-benchmark -- --wav <a real recording> --model large-v3-turbo --model-root <the model folder>` (with the models already in place), then minutes = (600 - load seconds) / (seconds per second of sound) x 297 / 300 / 60.
- **Fallback**: any Groq failure but a cancel (busy after four tries, a refused key, an unreadable chunk, a dropped connection) hands that whole job to our own machine, so a job never fails just because Groq did. The log line has the job id, both listeners' names, a fixed failure code and counts, never a word.
- **Simulation wins** over all of it: with `MEDIA_SIMULATION=true` no sound ever leaves.
- **Needs the `full` image**: `auto` reports off when our own machine cannot run.
- **Price**: Groq turbo $0.04 an audio hour, at least 10 s billed a request (research 04). At 2,500 source hours a month that is $100, the trigger to step 1 or 2.
- **Privacy**: while the lane is on, `GET /clips/status` says so (`ai.hostedLane`: `on`, `providerName`, `aboveMinutes`) and the privacy hint beside the AI minutes chip in Clip Setup names Groq. Groq must be named in the privacy policy as a sub-processor with a data processing agreement before the lane is switched on for real users (research 07, section 7.1; needs a legal read).
- **Check**: `GET /tools` on the media service shows `bindings.transcriber` as `auto` with our machine's state, `bindings.hostedTranscriber` with Groq's, and `hostedAboveMinutes`.

---

## 5. Deploying The Media Image 📦

```bash
docker build -f infra/docker/Dockerfile.media --target full -t postgear-media:full .
docker build -f infra/docker/Dockerfile.media --target slim -t postgear-media:slim .
# Optional voice (GPL-3.0 program inside: keep the image in a private registry):
docker build -f infra/docker/Dockerfile.media --target full --build-arg VOICE=kokoro -t postgear-media:full-voice .
```

- Runs as uid 10002 (non-root) under tini, `NODE_ENV=production` by default. Writable: the scratch volume (`/var/lib/postgear/media-scratch`) and the model volume (`/var/lib/postgear/media-models`) only.
- Health: the image's own check calls `GET /health` (open, touches nothing). Use `GET /ready` (needs `MEDIA_INTERNAL_TOKEN` in `X-PostGear-Internal`) for readiness: it is 503 until the worker polls and storage answers.
- Required in production: `MEDIA_INTERNAL_TOKEN`, `TEMPORAL_HOST`, `TEMPORAL_NAMESPACE`, the storage names of section 2. `MEDIA_SIMULATION` is refused there.
- `/licenses` in the image: the project's note, every Python package with its licence (written at build time from installed metadata), and with `VOICE=kokoro` the GPL text.
- Locally: `docker compose --profile media-image up -d --build media` runs it against the compose services, with every simulation flag forced on (see the comment in `docker-compose.yml`; stop `npm run dev:media` first).

### Filling The Model Volume (An Operator Step, Once Per Deploy)

Model files are never in the image and never fetched when it starts. In production the service loads models from local files only, so a missing model fails the job loudly ("The speech model could not be loaded") instead of reaching out. Fill the volume once, on a machine with internet, **with the owner's OK** (it downloads about 1.6 GB):

```bash
# 1. The speech model, into faster-whisper's own cache layout inside the volume.
docker run --rm -v postgear_media_models:/var/lib/postgear/media-models \
  --entrypoint python postgear-media:full -c \
  "from faster_whisper.utils import download_model; download_model('large-v3-turbo', cache_dir='/var/lib/postgear/media-models')"

# 2. The face detector: copy MediaPipe's blaze_face_short_range.tflite (from MediaPipe's
#    face detector model page) to the volume's root, and note its SHA-256 here.
docker run --rm -v postgear_media_models:/models -v "$PWD":/in alpine \
  cp /in/blaze_face_short_range.tflite /models/

# 3. Only with VOICE=kokoro: kokoro-v1.0.onnx and voices-v1.0.bin into kokoro/
#    (sizes and SHA-256 in apps/media/voice-program/README.md).
```

Then check `GET /tools`: `modelsPresent` is true, `faces` is `live`, `transcriber` is `live` (or `auto` and live). `faster-whisper` maps `large-v3-turbo` to the `mobiuslabsgmbh/faster-whisper-large-v3-turbo` files and `small` to `Systran/faster-whisper-small`; a model change is a new download into the same volume, never a rebuild.

---

## 6. The Rented Card Lane (Reserved, Not Built) 🔒

Step 2 of the ladder. It is documented here and **not built**: the provider is Module 17's item 19. No setting or code stub is reserved for it; the queue name `postgear-media-gpu` stays reserved for an always-on card only (D13-11).

**Why it is a provider, not a queue**: a card scaled to zero has no process running, so it cannot poll a Temporal queue. The always-on Python service keeps taking `mediaPyTranscribe` on `postgear-media-py` and calls the card over HTTPS for each chunk, heartbeating while it waits (research 05, section 11).

The steps, when the trigger fires:

1. **Pick the provider.** Research 05 recommends Modal (per-second billing, $30 of free credit a month, container start in 1 to 2 seconds by its own page; L4 $0.000222 a second, T4 $0.000164; non-preemptible runs cost three times as much). RunPod serverless 24 GB ($0.75 an hour, billed from worker start, a 5 second idle window) is the second choice.
2. **Build the card image** from the same `apps/media` code with CUDA 12 and cuDNN 9 (CTranslate2's requirement; stay off CUDA 13 until it is proven), `float16`, no PyTorch, and **the model baked in**: on a card that sleeps, cold start is model load (10 to 40 s for 1.6 to 3 GB, a planning figure). This is the one image where a model belongs inside.
3. **Deploy one function**: it takes a short-lived signed address to one chunk (a 16 kHz mono WAV of at most ten minutes, from the private bucket) and answers the words with times relative to the chunk, the same `Heard` shape every listener returns. It keeps nothing.
4. **Add the binding** in `apps/media/src/postgear_media/providers/transcribe/`: a `Transcriber` that signs the chunk, calls the function with its own token, heartbeats, and treats a preempted run as safe to repeat (chunks are keyed by job id). Bind it as the hosted lane under `TRANSCRIBER`, with Groq as its fallback when the provider is down, and our own machine behind both.
5. **Report it**: a binding in the provider table, `bindings.hostedTranscriber` named after it, and its name in `PROVIDER_NAMES` (`apps/api/src/modules/clips/status/media-service.probe.ts`) so the privacy hint names it.
6. **Test** with fakes, then **one real run on a small file with the owner's OK**, then leave it switched off until the trigger fires.
7. **Privacy**: the audio stays in our own account, but the card's provider still processes it; name it in the privacy policy (needs a legal read).

**The always-on card (step 3)** runs the card image as a worker only, on `postgear-media-gpu`, with its own activity names, because every worker on a Temporal queue must be able to run every activity sent to it. Only at thousands of source hours a month (section 3).

---

## 7. Deploy Checklist ✅

- [ ] S3-compatible storage with both buckets; the Python service's key scoped to the private one.
- [ ] Worker image deployed per role (`WORKER_ROLES=media`, `WORKER_ROLES=render`), private registry.
- [ ] `postgear-media:full` deployed with `MEDIA_INTERNAL_TOKEN`, the scratch and model volumes, on the private network only.
- [ ] Model volume filled (section 5), `GET /tools` says `modelsPresent: true`.
- [ ] `npm run clips:listen-benchmark` on the real box; `TRANSCRIBE_HOSTED_ABOVE_MINUTES` set from it.
- [ ] Hosted lane: Groq named in the privacy policy before `TRANSCRIBER=auto` and `GROQ_API_KEY` are set.
- [ ] `GET /clips/status` shows `ai.service: ok` and the right `ai.hostedLane`.
- [ ] The ladder's triggers on a dashboard: render wait p95, host processor, Groq's monthly bill.
