# Sprint 13 Research: Cost, Deploy And Risks

> **Written**: 2026-11-14. Prices marked **verified** were read on the provider's own page that day; **reported** means a secondary source, an unreadable page, or another PostGear document. Every speed that is not from a published benchmark is labelled **assumption** and is replaced by Module 14's own measurements. This is not legal advice: where the law matters the text says "needs a legal read".
> **Money**: USD unless marked EUR. EUR 1 is taken as USD 1.10 (assumption). All prices exclude tax.

## 1. Prices Read Today

| Provider | What | Price | Source |
|---|---|---|---|
| Groq | `whisper-large-v3-turbo`; `whisper-large-v3` | $0.04; $0.111 per audio hour. Word timings with `verbose_json`. At least 10 seconds billed per request | console.groq.com/docs/speech-to-text, verified 2026-11-14 |
| OpenAI | `gpt-4o-mini-transcribe`; `gpt-4o-transcribe` and Whisper | $0.003; $0.006 a minute. All three shut down on 2027-02-26 | developers.openai.com/api/docs/pricing and /deprecations, verified 2026-11-14 |
| OpenAI | `gpt-4.1-mini` (PostGear's model today, `packages/ai-engine/src/types.ts`) | $0.40 in, $1.60 out per 1M tokens. The `gpt-4.1-mini-2025-04-14` snapshot shuts down on 2027-01-14; the named replacement is `gpt-6-luna` | same |
| OpenAI | `gpt-6-luna`; `gpt-5-mini` | $0.10 in, $0.50 out; $0.25 in, $2.00 out per 1M tokens | developers.openai.com/api/docs/pricing, verified 2026-11-14 |
| OpenAI | `tts-1` | $15 per 1M characters. Shuts down on 2027-01-06 | developers.openai.com/api/docs/pricing and /deprecations, verified 2026-11-14 |
| Deepgram | Nova-3 pre-recorded | $0.0043 a minute (one language), $0.0052 (multilingual) | deepgram.com/pricing, verified 2026-11-14 |
| Deepgram | Whisper Large; Aura-2 speech | $0.0048 a minute; $0.030 per 1,000 characters | same |
| Hetzner | CCX23: 4 dedicated vCPU, 16 GB | EUR 0.1178 an hour, EUR 73.49 a month (Helsinki) | hetzner.com/cloud/general-purpose, verified 2026-11-14 |
| Hetzner | CCX33: 8 dedicated vCPU, 32 GB, 240 GB NVMe | EUR 0.1891 an hour, EUR 117.99 a month (Helsinki) | same |
| Hetzner | CPX42: 8 shared vCPU, 16 GB | EUR 59.49 a month (Helsinki) | hetzner.com/cloud/regular-performance, verified 2026-11-14 |
| RunPod | Pods, Secure Cloud: RTX A5000, RTX 3090, L4, RTX 4090 | $0.27, $0.50, $0.69, $0.89 an hour | runpod.io/pricing, verified 2026-11-14 |
| RunPod | Serverless: 16 GB, 24 GB (L4, A5000, 3090), 24 GB (4090) | $0.58, $0.75, $1.34 an hour | same |
| RunPod | Network storage | $0.07 per GB a month | same |
| Modal | T4, L4, A10 | $0.000164, $0.000222, $0.000306 a second | modal.com/pricing, verified 2026-11-14 |
| Modal | CPU core, memory; Starter plan | $0.0000131 a core-second, $0.00000222 a GiB-second; $30 of free credits a month | same |
| Modal | Non-preemptible runs | 3 times the base price | same |
| Cloudflare R2 | Storage; egress | $0.015 per GB a month (10 GB free); free | developers.cloudflare.com/r2/pricing, verified 2026-11-14 |
| FFmpeg (GPL build, run as a separate program) | No fee per render or per person | $0 | Decision of 2026-11-17: the render engine is FFmpeg only, so the render licence line of earlier drafts is gone |
| Railway | CPU, memory | About $20 per vCPU and $10 per GB a month, billed by use | [hosting guide](../../launch-readiness/05-hosting-and-costs.md) of 2026-11-12 (reported) |

## 2. Compute Cost Per Source Hour

The published benchmark: faster-whisper transcribes 13 minutes of audio in 17 seconds with `large-v2`, fp16, `batch_size=8` on an RTX 3070 Ti (46 times real time), and in 51 seconds with the `small` model, int8, `batch_size=8` on 8 threads of an i7-12700K (15 times real time) (github.com/SYSTRAN/faster-whisper, verified 2026-11-14).

| Job | Assumptions | Cost Per Source Hour |
|---|---|---|
| Transcription, CPU, `small` | Cloud vCPUs run at half the benchmark desktop (assumption): 8 minutes on a CCX33 | EUR 0.025 (about $0.03) |
| Transcription, CPU, `large-v3-turbo` | 1 times real time on 8 vCPU (the assumption `04-transcription.md` uses): 60 minutes on a CCX33 | EUR 0.19 (about $0.21) when the box is billed for it; nothing extra on a box that is already running |
| Transcription, GPU | 78 seconds at benchmark speed; 120 seconds allowed for model load and word alignment (assumption) | $0.009 (A5000 pod), $0.025 (RunPod serverless 24 GB), $0.027 (Modal L4), $0.03 (4090 pod) |
| Transcription, API | Billed per audio minute or hour | $0.04 (Groq turbo), $0.11 (Groq `large-v3`), $0.26 (Deepgram Nova-3). OpenAI's $0.18 to $0.36 models end in 2027-02 |
| Face detection at 5 fps | 18,000 frames at 10 ms each on one vCPU, 360p proxy (assumption): 3 vCPU-minutes | Under EUR 0.01. Run on clip ranges only, it is a tenth of that |
| Motion analysis | 2 fps frame difference and optical flow at 360p, 15 ms a frame plus decode (assumption): 3 vCPU-minutes | Under EUR 0.01 |
| LLM highlight scoring | 150 words a minute, 12,000 transcript tokens, 16,000 in and 2,500 out with overlap; a second pass for titles and reasons (assumption) | $0.01 to $0.03 on `gpt-4.1-mini`; under $0.01 on `gpt-6-luna` |
| Vision checks | 20 candidates, 4 frames each, 500 tokens a frame (assumption) | $0.01 to $0.05 |
| Render | 10 clip minutes per source hour; 1080p at half real time on 4 dedicated vCPU (assumption until Sprint 12's Module 05 benchmark): 20 minutes on a CCX23 | EUR 0.04. No render licence. Measured on 2026-11-17 on a shared 12 thread desktop, worst case (a noisy synthetic picture, `veryfast`, 1080x1920 with captions and a following crop): about real time, 481 CPU seconds for a 60 s clip; captions alone add about 0.3 CPU seconds a second. The half real time assumption therefore holds for hard footage and is likely pessimistic for talking heads (research 09, section 13) |
| Storage | 0.9 GB of proxy (2 Mbit/s) and 0.3 GB of clips (assumption) | $0.02 for each month kept |

**All jobs, one source hour**: about $0.13 with Groq turbo or a per-second GPU, $0.30 on a CPU box billed for the hour, $0.35 with Deepgram. Transcription is the only line that moves the total, and on the cheap routes render and the LLM cost more than the transcript.

Notes on the API route: captions need word timings. Groq's Whisper returns them (verified above). OpenAI's Whisper family shuts down on 2027-02-26, and `04-transcription.md` found no word timings documented for its replacement, so OpenAI is not a transcription choice. The same deprecations page lists the `gpt-4.1-mini` snapshot (2027-01-14) and `tts-1` (2027-01-06): Sprint 13's LLM and speech calls must not be written against either.

## 3. Three Usage Scenarios

Ten clips rendered per source hour. Storage is the steady state after retention deletes old proxies.

| | Hobby | Growing | Busy |
|---|---|---|---|
| Source hours a month | 30 | 300 | 3,000 |
| Clip renders a month | 300 | 3,000 | 30,000 |
| Stored | 40 GB | 400 GB | 4 TB |
| Hosting shape | One box (the existing host) | Separate media box (1 CCX33) | 2 media boxes, a fast lane for transcription |
| Transcription | Groq turbo: $1 | Groq turbo: $12, or serverless GPU: $15 | Groq turbo: $120, serverless GPU: $120, or an A5000 pod: $197. By Deepgram it would be $780 |
| LLM and vision | $2 | $15 | $150 |
| Media boxes | $0 extra | $130 | $260 |
| Storage | $1 | $6 | $60 |
| **Monthly total** | **about $5** | **about $165** | **about $590 to $670** |

Capacity check for Busy: 30,000 renders at 2 minutes each is 1,000 hours of a 4 vCPU slot (the 2 minutes is a planning figure for a one minute clip; the measured worst case was one minute per clip minute on a 12 thread machine, so a 4 vCPU slot may take two to three times longer on hard footage and far less on talking heads: the Sprint 12 benchmark settles it). One CCX33 offers two slots, 1,460 hours a month, so one box runs at 68 percent on average and queues at peaks. Two boxes are the honest number.

## 4. Credit Pricing Proposal

> **Settled 2026-11-17 (decision D13-02).** The open question below is closed: Clips AI uses the **AI Minutes** meter (`clips.ai_minutes_per_month`, rates in [Sprint 12 research 12](../../sprint-12/research/12-plans-entitlements-and-usage.md)), set per plan through the entitlements registry. No `clip_*` credit type is created. Options A to C and the cost-per-minute table stay as the cost reasoning behind the rates.

### 4.1 What PostGear Has Today

`AI_CREDIT_COSTS` in `apps/api/src/modules/ai/credits/credits.policy.ts`: a generated post is 5 credits, an image 10, a Copilot message 1. Allowances per month in `billing/plans.ts`: FREE 25, STANDARD 100, PRO 500, TEAM 2,000, ULTIMATE 10,000, at $0, $29, $49, $99 and $199 (placeholder prices). The ledger is the `Credits` table: an integer and a `type` string per row, refunds as negative rows, and "used this cycle" sums only the types the policy knows.

### 4.2 Our Cost Per Source Minute

| Job | GPU Route | API Route |
|---|---|---|
| Transcription | $0.0004 to $0.0008 | $0.0007 (Groq turbo) to $0.0043 (Deepgram) |
| AI Highlights V2 (LLM and vision) | $0.0003 to $0.0013 | same |
| Captions | $0 (they reuse the transcript; the cost is in the render) | $0 |
| Auto-Reframe | Under $0.0001 per clip minute | same |

### 4.3 Options

| Option | How It Charges | For | Against |
|---|---|---|---|
| A. Share the AI credits | Per source minute: transcription 0.3, AI Highlights V2 0.2, captions 0, auto-reframe 0 (1 credit per clip instead). 30 credits a source hour, rounded up per job | One balance, no new plan field | One 3 hour stream is 90 credits: all of STANDARD's month. Clips starve posts and Copilot. FREE gets 50 minutes |
| **B. A separate Clip Minutes allowance** (recommended) | 1 Clip Minute per source minute sent through Clip Setup covers transcription, AI Highlights V2, captions and visual moments. Captions on a hand-made clip: 1 per clip minute. Auto-reframe: 0, gated by plan. Per month: FREE 30, STANDARD 300, PRO 900, TEAM 3,000, ULTIMATE 10,000 | Matches how OpusClip charges (1 credit a minute, reported; 300 at $29). Easy to say: "300 minutes of video a month". AI credits keep their meaning | A second meter in the UI; a `clipMinutes` field on `Plan` |
| C. B, with a top-up | As B; when minutes run out, 1 AI credit buys 2 Clip Minutes | No dead end mid-month | Two balances move on one click; needs clear copy |
| D. No meter | Plan tiers unlock AI clipping (StreamLadder's way, reported) with a fair-use cap on source hours | Simplest to sell | Open-ended cost; only safe once transcription is self-hosted |

**Margin check for B, worst case (the dearest route, Deepgram, $0.007 a minute with LLM, vision and render)**: STANDARD 300 minutes costs $2.10 of $29; PRO 900 costs $6.30 of $49; TEAM 3,000 costs $21 of $99; ULTIMATE 10,000 costs $70 of $199. On the Groq or GPU route ($0.002 a minute) ULTIMATE costs $20. Every tier keeps more than 60 percent after compute. A FREE workspace costs at most $0.21 a month.

**Margin check for A**: a credit earns $0.29 on STANDARD, $0.098 on PRO, $0.05 on TEAM and $0.02 on ULTIMATE. At 30 credits a source hour that is $8.70, $2.94, $1.49 and $0.60 against a processing cost of $0.06 to $0.34. ULTIMATE on the Deepgram route is thin.

**Generative extras stay on AI credits** in every option: hook intro title 1 credit, caption translation 1 credit a clip, text to speech 2 credits for up to 500 characters (our cost is about $0.015 at Deepgram's Aura-2 price). Word censoring and silence removal are free: they only read the transcript.

**How B fits the code**: Clip Minutes are `Credits` rows with their own `type` (for example `clip_minutes`), so no table changes; the AI sum already ignores unknown types. The charge is made when Create is pressed and refunded on failure, like every other credit. Sprint 12's signal highlights keep whatever that sprint priced.

**Open question for Arvind**: shared credits or a separate minutes allowance? Recommendation: option B with C's top-up, and FREE at 30 minutes with the watermark. The approved plan says "credits per processed minute"; B keeps that idea and gives it its own balance.

## 5. Deployment Shapes

| Shape | What Runs Where | What It Needs | List Price Read Today |
|---|---|---|---|
| 1. One box | Node media and render roles and the Python service beside the API | Node worker image on Debian slim with the FFmpeg GPL static build, yt-dlp, Deno and the fonts (the Studio fonts plus Noto Tamil and Devanagari and an emoji font), no Chrome, about 1 GB (assumption). Python CPU image 2 to 3 GB (assumption). Models on a volume: `small` 0.5 GB, `large-v3-turbo` 1.6 GB, `large-v3` 3 GB, Silero and the face detector a few MB (reported). No cold start | Hetzner CPX42 EUR 59.49 or CCX23 EUR 73.49 a month (verified). On Railway about $20 per vCPU a month of use (reported) |
| 2. Separate media box | API and publishing worker stay put; a second machine runs `postgear-media`, `postgear-render` and `postgear-media-py` | The same images, `WORKER_ROLES` set per container, a private route to Temporal, Postgres and storage. No cold start | Hetzner CCX33 EUR 117.99 a month or EUR 0.1891 an hour (verified) |
| 3. Rented GPU, always on | A GPU pod runs transcription only | CUDA 12 and cuDNN 9 (faster-whisper's requirement, verified); image 6 to 8 GB (assumption); model cache on a network volume at $0.07 per GB a month (verified). No cold start while it runs | RunPod Secure Cloud RTX A5000 $0.27 an hour, about $197 a month; RTX 4090 $0.89 an hour, about $650 a month (verified) |
| 4. Serverless GPU | The Python activity calls a GPU function and waits; billed while it runs | The image in the provider's registry, the model baked in or on a volume, jobs safe to run twice (a preempted run is retried). Cold start: container start is "1-2 seconds" by Modal's own page (verified); loading a 1.6 to 3 GB model adds 10 to 40 seconds (assumption) | RunPod serverless 24 GB $0.75 an hour (verified). Modal L4 $0.000222 a second, T4 $0.000164, $30 free a month, 3 times the price for non-preemptible (verified) |

Hosting today: staging is planned on Railway (usage-billed, no GPU found in the guide) with Cloudflare R2, and one Hetzner box with Coolify or Dokploy is the written fallback ([hosting guide](../../launch-readiness/05-hosting-and-costs.md), 2026-11-12). Sprint 12's default is already a separate media worker box.

### 5.1 Recommendation Ladder

| Step | Shape | Transcription | Move Up When |
|---|---|---|---|
| 0 | One box (the app's host runs every role) | CPU `large-v3-turbo` for clip-length audio; Groq turbo for long audio, as `04-transcription.md` recommends | Render wait p95 passes 5 minutes for a week, or media jobs hold the host's CPU above 70 percent for an hour a day |
| 1 | Separate media box (CCX33) | The same | Audio must stay in our own account (a customer or the legal read asks), Groq's limits or terms get in the way, or its bill passes $100 a month (2,500 source hours) |
| 2 | Media box plus serverless GPU | Serverless GPU for long audio, Groq as the fallback when the GPU provider is down | The serverless bill passes $200 a month (about 260 GPU hours), or cold starts push p95 past 2 minutes |
| 3 | Two media boxes plus an always-on GPU pod | The pod, with serverless for bursts | Review per quarter |

An always-on GPU only beats serverless near 8,000 source hours a month, so step 3 is far away. The ladder never changes code: each step is a different binding of the `Transcriber` provider and a different `WORKER_ROLES` layout.

**Open question for Arvind**: build the GPU path inside Sprint 13 or only document it? Recommendation: Module 14 builds and tests the serverless call once (one real run on a small file, on the owner's word), then leaves it switched off. Groq at $0.04 an hour costs the same as a serverless GPU and removes the GPU image, the model cache and the cold start from the sprint's critical path.

## 6. Queues And Scaling

| Task Queue | Worker | Jobs | Concurrency Per Worker |
|---|---|---|---|
| `postgear-media` | Node | Probe, proxy fetch, HD segment fetch, signal analysis, downloads | 2 on 4 vCPU, 4 on 8 vCPU (network-bound, one FFmpeg each) |
| `postgear-render` | Node | FFmpeg renders, Preview Export, montage, batch export | 1 (an x264 encode uses every core); 2 on an 8 vCPU box only after the benchmark says so |
| `postgear-media-py` | Python | Transcription, alignment, silence detection, face detection, motion analysis | 1 for CPU transcription (it takes every thread), 2 for face and motion jobs |

- **A GPU does not need a fourth queue** if it is serverless: the activity on `postgear-media-py` makes the call. An always-on GPU worker does need its own queue, because every worker on a Temporal task queue must be able to run every activity sent to it. Recommendation: reserve the name `postgear-media-gpu` and leave it unused.
- **Back-pressure**: the API admits a job only when the workspace is under its cap of running jobs and the role's waiting count is under a global cap (starting values: 20 for render, 10 for transcription). Past the cap the answer is a 429 with a `code` and an honest wait estimate from the last hour's run times. Nothing is dropped silently.
- **Fairness between workspaces**: at most 1 job running per role for FREE and 2 for paid plans, extra jobs wait as `ClipJob` rows. A small dispatcher starts the oldest waiting job of the workspace with the fewest running, so one person exporting 40 clips cannot hold the queue.
- **Priority for paid plans**: the dispatcher orders by plan tier first, then by wait time, with a ceiling so a FREE job never waits more than 30 minutes behind paid work. Temporal's own task priority is reported as a preview feature; the table-based dispatcher does not depend on it.
- **Long sources**: transcription is chunked (10 minute pieces at silence boundaries) with a heartbeat per chunk, so a retry resumes and a 6 hour stream never holds one activity for an hour.
- **Scratch disk**: each job gets its own folder with a size cap and is cleaned on finish, failure and worker start.

### 6.1 What To Log And Measure Per Job

| Field | Why |
|---|---|
| Job id, workspace id, kind, queue, attempt | Tracing and fairness |
| Queued at, started at, finished at | Queue time and run time, p50 and p95 per queue |
| Input minutes, output bytes, frames rendered | Real-time factor (run seconds per source minute) |
| Provider and model (`local-cpu`, `serverless-gpu`, an API name) | Cost by route |
| Compute seconds, tokens in and out, audio minutes billed | Estimated cost in micro-dollars, stored on the `ClipJob` row |
| Clip Minutes or credits charged and refunded | Margin per job and per plan |
| Error code from a fixed list, not free text | Failure rate by cause |

Never logged: transcript text, prompts with transcript text, signed URLs, file names typed by the user. Dashboards: queue depth and wait per queue, cost per source hour by route, spend per day against a budget with an alert at 80 percent.

## 7. Privacy And Safety For AI Features

### 7.1 Voice And Face Data

- **Face tracks are biometric-adjacent.** Store only boxes over time (`t`, `x`, `y`, `w`, `h`, confidence). No embeddings, no landmarks, no face crops, no identity. Tracking joins boxes by overlap, never by recognising a face. The track is a `ClipAsset` file and is deleted with its source.
- **Why this matters**: GDPR treats biometric data as a special category when it is used to identify a person, and some laws (Illinois BIPA is the usual example) cover any scan of face geometry (reported; needs a legal read). Detection without identification is the safer side of that line, and we stay on it.
- **Voice**: a transcript is personal data and often holds other people's words. No voiceprints, no "who is speaking" by voice in this sprint, no voice cloning.
- **Sub-processors**: on the API route, audio leaves our machines for the transcription provider, and transcripts go to the LLM provider. Both must be named in the privacy policy with a data processing agreement (needs a legal read). The self-hosted route keeps audio on our boxes.
- **Deletion**: deleting a source deletes its proxy, analysis audio, transcript, face track, signal tracks and working files by key prefix. Exported clips live in Media and follow Media's rules.

### 7.2 GDPR And India's DPDP Act (Needs A Legal Read)

- **GDPR basics** (reported): a lawful basis for each use, only the data the feature needs, a stated retention period, erasure and export on request, a list of sub-processors, safeguards for transfers outside the EU, and an impact assessment when processing is large in scale. For people who appear in a video, the uploader is likely the controller and PostGear the processor.
- **India's Digital Personal Data Protection Act, 2023** (reported): the Rules were notified in November 2025 and apply in stages, with consent manager registration from November 2026 and the main duties (notice and consent, security safeguards, breach notices, erasure, children's data) from about 2027-05-13. Dates differ by a day between sources; the Gazette decides.
- **EU AI Act, Article 50** (reported): from 2026-08-02 those who publish realistic AI-made image, audio or video must say so. Text to speech is the Sprint 13 feature this could touch.

### 7.3 AI Disclosure Labels

| Platform | What Its Policy Asks | API Field | Status |
|---|---|---|---|
| YouTube | Disclose realistic altered or synthetic content (a real person made to say or do something, altered real events, realistic invented scenes). Not needed for captions, colour and lighting changes, beauty filters or production help such as scripts and titles. Repeated non-disclosure can bring removal or suspension from the Partner Programme | `status.containsSyntheticMedia` (boolean) on `videos.insert` and `videos.update` | support.google.com/youtube/answer/14328491 and developers.google.com/youtube/v3/docs/videos, verified 2026-11-14 |
| Instagram | "AI info" labels come from self-disclosure or from AI signals Meta detects in the file | `is_ai_generated=true` on the media container (`POST /{ig_user_id}/media`); on the carousel container only for carousels; both login types | developers.facebook.com/documentation/instagram-platform/changelog (entry of 2026-06-22) and transparency.meta.com/governance/tracking-impact/labeling-ai-content, verified 2026-11-14 |
| Facebook Reels | Same Meta policy | `is_ai_generated` (boolean, default false) when finishing `/{page-id}/video_reels`: "Set to `true` to disclose that the reel was created or edited using AI." | developers.facebook.com/docs/video-api/guides/reels-publishing, verified 2026-11-14 |
| TikTok | Label realistic AI-generated images, audio and video; a caption line does not count (reported) | `is_aigc` (boolean) in Direct Post `post_info` (reported) | Reported: TikTok's support and developer sites refused the connection on 2026-11-14. Confirm in Module 13 |
| Threads | Same Meta policy | No field found | Reported |
| X | A "Made with AI" label exists (the Postiz reference shows the checkbox) | Field name not confirmed | Reported |
| Pinterest | Labels by metadata and its own detection | `is_ai_modified_or_generated` | Reported |
| LinkedIn | Labels from Content Credentials in the file | None | Reported |

**How the toggle maps**: one per-channel setting, `aiGenerated`, beside the settings each provider already reads (YouTube's `madeForKids`, TikTok's `privacyLevel`). `social-core` has no such field today (checked in the code 2026-11-14). Module 13 adds it to YouTube, Instagram (both providers), Facebook and TikTok, and hides it where no field exists.

**When it should be on**: cutting, captions, reframing and silence removal are edits, and YouTube's page lists that kind of work as not needing disclosure. A synthetic voice is different. The clip document records which AI features touched it; when text to speech (and later dubbing, B-roll or eye contact) was used, the composer turns the switch on and says why. The person can change it. Facebook's wording ("created or edited using AI") is wider than YouTube's, so the help text is per platform (needs a legal read).

**Open question for Arvind**: default the switch to on whenever any AI feature was used, or only for synthetic voice and picture? Recommendation: only for synthetic voice and picture, with a one-line note under the switch on Facebook.

### 7.4 Text To Speech Voice Rights

Only stock voices the provider licenses for commercial use. No cloning, no uploading a voice sample, no voices that imitate a named person. OpenAI's `tts-1` family shuts down on 2027-01-06 (verified, section 1), so the speech provider sits behind an interface like the transcriber; Deepgram's Aura-2 at $0.030 per 1,000 characters is the price used here. Providers commonly ask that listeners be told the voice is AI-made (reported), which the disclosure switch covers. The provider and voice id are stored on the clip. A self-hosted voice model is a later step and its licence is read first.

### 7.5 Prompt Injection Through Transcripts

A transcript is whatever was said in the video, so it can say "ignore your instructions". The same holds for text visible in frames and for the "moments to include" box.

- Transcript text goes into a labelled data block, never the system prompt, after control characters are stripped and the size is capped.
- The model has no tools and returns a fixed JSON shape: start, end, score, reason, title. Every range is checked against the source length and the clip length rules; anything else is dropped.
- Titles, hooks and captions made from a transcript are shown for approval. Nothing the model writes is posted without a person pressing a button, and none of it is rendered as HTML.
- The score is clamped and combined with Sprint 12's signals, so a transcript cannot talk its way to the top alone.

## 8. What We Never Do

- Store face embeddings, landmarks or face crops, or recognise who a face belongs to.
- Clone a voice, keep a voiceprint, or offer a voice that imitates a real person.
- Train or fine-tune any model on customers' audio, video or transcripts.
- Send audio or transcripts to a provider that is not listed in the privacy policy.
- Keep a transcript, face track or proxy after its source is deleted.
- Set a platform's AI label silently, or hide the switch on a platform that has the field.
- Post model-written text without a person's approval.
- Let transcript text into a system prompt, a log line or an error message.
- Run a paid AI job before the price was shown and the charge was accepted.
- Start a job that the workspace's allowance cannot pay for, or leave a failed job charged.
- Make a real AI call while the simulation flag is on, or allow simulation in production.
- Promise that a clip will go viral: the number is a Clip Score with reasons.

## 9. Risks Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CPU transcription is slower than assumed | high | Long waits even for clip-length audio | Module 02 benchmark on the real box before choosing; the fast lane for anything over 10 minutes; chunked jobs |
| The AI bill grows faster than revenue | medium | Margin lost on TEAM and ULTIMATE | Cost stored per job, daily budget alert, the minutes allowance, the ladder's triggers |
| A free tier is farmed for transcription | medium | Spend with no revenue | 30 minutes a month, source length cap, one running job, sign-up throttles |
| A provider retires or reprices a model (OpenAI retires Whisper, `tts-1` and the `gpt-4.1-mini` snapshot in early 2027) | certain | A feature stops on a known date | Providers behind interfaces, model names in config, the deprecations page re-read at each closeout; move `ai-engine` off `gpt-4.1-mini` before 2027-01-14 |
| The one cheap transcription API (Groq) limits, reprices or drops word timings | medium | Long jobs fall back to the slow CPU path | Self-hosted provider always works; serverless GPU built in Module 14; Deepgram as a swap-in |
| Poor accuracy in Tamil, Hindi and mixed speech | high | Wrong captions, bad highlights | Language picker, caption editing, brand vocabulary, a per-language test set in the real-test plan |
| Serverless GPU cold start or preemption | medium | Slow first job, repeated work | Idempotent chunks, API fallback, a warm window at peak hours |
| GPU image and model cache drift (CUDA, cuDNN versions) | medium | The GPU worker will not start | Pin the image, a doctor check at start, keep the CPU path alive |
| A render box runs out of disk or memory | medium | Failed exports | Per-job scratch cap, concurrency 1, cleanup at worker start |
| One workspace floods the queues | medium | Everyone waits | Per-workspace caps, the fair dispatcher, 429 with a wait estimate |
| Platforms change their AI label rules or fields | high over time | Wrong or missing labels | One setting mapped per provider, fields re-read at closeout, help text per platform |
| TikTok's label field is not what the secondary sources say | medium | The switch does nothing on TikTok | Confirm on TikTok's own page in Module 13 before shipping the switch there |
| Face data is judged biometric by a regulator | low | Legal exposure | Boxes only, no identity, deleted with the source, a legal read before launch |
| A transcript or frame carries a prompt injection | medium | Odd clips or text | Labelled data block, fixed output shape, range checks, approval before posting |
| Text to speech is used to imitate a person | low | Takedowns, platform strikes | Stock voices only, no cloning, disclosure switch on by default for speech |
| The preview and the FFmpeg export differ, or captions fall back to the wrong font | medium | A clip that does not look as edited | `frameState` and compiler tests, Preview Export at 360p, the `fontselect:` log checked against the font manifest, caption fixtures rendered inside the real image (research 09) |
| Caption burn slows exports | medium | About 12 s of wall time a 60 s export on the test machine | Counted in the render time; the caption draw is single threaded and scales with the output size, so Preview Export (360p) costs a third |
| A second meter (Clip Minutes) confuses people | medium | Support load | One chip that shows minutes left, the receipt panel before Create, top-up from credits |
| Provider prices change | certain | Numbers in this file age | Costs live in one config file; re-read the price pages at each closeout |
| DPDP and EU AI Act duties land during the sprint's life | medium | Rework of notices and consent | A legal read before public launch; retention and deletion already built in |

## 10. Open Questions

- **Settled 2026-11-17 (D13-02): AI Minutes, not Clip Minutes or shared credits.** Earlier question: Clip Minutes or shared credits (section 4.3)? Recommendation: Clip Minutes with a credit top-up.
- **Open question for Arvind**: is the serverless GPU built and proven in Module 14 or only documented (section 5.1)? Recommendation: built, run once for real, left switched off while Groq carries long audio.
- **Open question for Arvind**: `ai-engine` uses `gpt-4.1-mini`, whose snapshot OpenAI retires on 2027-01-14. Recommendation: Sprint 13's scoring and vision calls take the model name from config and are tested on the named replacement; moving the rest of PostGear is a small task of its own before that date.
- **Open question for Arvind**: who gives the legal read on face data, DPDP and the AI labels before public launch? Recommendation: one paid hour with a lawyer who handles Indian SaaS, with sections 7.1 to 7.3 as the brief.
- **Open question for Arvind**: is `postgear-media-gpu` reserved now as a fourth queue name? Recommendation: yes, unused, so step 3 needs no rename.
