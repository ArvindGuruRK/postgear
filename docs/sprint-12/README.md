# Sprint 12: Clips (Turn Any Long Video Into Short Clips)

> **Status**: Documents written 2026-11-14, revised 2026-11-17 after Arvind settled every open question (see the Decision Ledger below). Awaiting his final review. No code has been written.
> **The idea** (Arvind, 2026-11-14): paste a YouTube, Twitch or Kick link (or upload a file), get the video, make clips from it by hand or with AI, edit them with layouts, stickers, text, effects and sound the way StreamLadder does, export, and send them to every channel through the composer PostGear already has. It is for every kind of video, not one game or one niche. Speech to text, captions and the heavier AI come in [Sprint 13](../sprint-13/README.md), after this sprint has been tested for real.

## What Is In This Folder

| Document | Read it for |
|---|---|
| [`research/01-reference-products.md`](research/01-reference-products.md) | StreamLadder, OpusClip and VidsSave screen by screen, the feature matrix, what we take and what we leave |
| [`research/02-libraries.md`](research/02-libraries.md) | Every library and tool with its version, licence and verdict |
| [`research/03-open-source-reference-repos.md`](research/03-open-source-reference-repos.md) | Open-source editors, highlight finders and stream tools read for their logic, with the licence rule |
| [`research/04-link-import-and-fetch.md`](research/04-link-import-and-fetch.md) | How yt-dlp reads YouTube, Twitch and Kick, what breaks, how a range is fetched, the error list |
| [`research/05-editor-and-render.md`](research/05-editor-and-render.md) | The editor's fast browser preview, the FFmpeg render plan, the clip document and its two clocks |
| [`research/06-highlight-signals.md`](research/06-highlight-signals.md) | Finding moments without speech: loudness, scene changes, chat bursts, the scorer |
| [`research/07-legal-limits-cost-and-risks.md`](research/07-legal-limits-cost-and-risks.md) | Platform terms, rights and takedown, upload limits per platform, cost, the risks register |
| [`research/08-approach-on-postgear.md`](research/08-approach-on-postgear.md) | How it fits the codebase: data flow, where the code goes, what we reuse, what does not exist yet |
| [`research/09-ffmpeg-render-cookbook.md`](research/09-ffmpeg-render-cookbook.md) | **Verified by running FFmpeg**: every filter recipe the render compiler needs, with measured speeds |
| [`research/10-open-source-sound-and-sticker-libraries.md`](research/10-open-source-sound-and-sticker-libraries.md) | The open-source sound, music, sticker and GIF catalogue: sources, licences, the ingest design |
| [`research/11-channel-browser.md`](research/11-channel-browser.md) | Add a channel by handle and browse its streams and clips: official routes, quotas, design |
| [`research/12-plans-entitlements-and-usage.md`](research/12-plans-entitlements-and-usage.md) | The generic subscription model: entitlements, usage meters, the operator screen |
| [`research/13-screenshot-coverage.md`](research/13-screenshot-coverage.md) | **The audit**: all 48 reference screenshots, screen by screen, and where each is built |
| [`../sprint-documents/sprint-12-clips.md`](../sprint-documents/sprint-12-clips.md) | **The sprint doc**: architecture, the clip document, providers, jobs, data model, API routes, limits, definition of done |
| [`../new-modules/user-stories-clips.md`](../new-modules/user-stories-clips.md) | **The user stories**: journeys, acceptance criteria, UX rules, edge cases, the completion checklist |
| [`clips-implementation-docs/README.md`](clips-implementation-docs/README.md) | **The build plan**: twenty-one modules, one per Claude Code session, with the kickstart prompt |
| [`real-test-plan.md`](real-test-plan.md) | **The real test**: how Arvind tests every module with real links after the build, and the gate before Sprint 13 |

## Reading Order

1. This page, including the Decision Ledger.
2. The sprint doc, for the whole shape in one read.
3. The user stories, section 2 (the journeys), then section 5 (what happens when things go wrong).
4. Research 13 (does every screenshot have a home?) and research 07 (legal, limits, cost).
5. The module index, then the modules in number order when building.
6. The real-test plan, when the build is done.

## The Pitch In One Paragraph

Vikram streams for four hours on Wednesday night. On Thursday he opens **Clips**, pastes the link (or picks the stream from his channel in **My Channels**), ticks "This video is mine, or I have permission to use it." and presses **Import Video**. Ten minutes later he presses **Find Clips** and twelve clips appear with scores and reasons ("Chat exploded", "Loud reaction"). He opens the best one in a full-window editor, picks **Vertical** and the **Gameplay** layout, drags a box over his face camera, adds a sticker from the open library, a line of text, a zoom and a sound, presses **Preview Export** to see the real result in seconds, then **Export Clip**, then **Send To Composer**, and schedules it on TikTok, Shorts and Reels. Priya does the same by hand with her yoga class from YouTube. Karthik uploads a webinar file. Everything they see while they wait is a plain sentence, and nothing about their plan is hard-coded: limits and allowances come from a subscription model the operator edits.

## The Decision Ledger

On 2026-11-17 Arvind handed every open question to Claude and asked for a real production-grade SaaS answer. This is the ledger of those calls. **Nothing here is open.** Each line says what was chosen, why, and the one thing that would make us look at it again. The modules cite these entries as `D12-NN`.

| ID | Question | The Call | Why | Reopen If |
|---|---|---|---|---|
| D12-01 | What is it called and where does it sit? | **Clips** in the rail after **Studio**; the long source is a "video" in the UI | It is for every kind of video, not only streams, and Studio and Clips are the two creation tools | Users keep calling it something else |
| D12-02 | Which branch? | `sprint-12-clips`, cut from `instagram-direct-and-threads` | That is the branch the tree is on and it holds the newest channel work. It is pushed but not merged, so merge it first if you can; otherwise this sprint's pull request carries its commits | `instagram-direct-and-threads` is merged first: cut from `master` instead |
| D12-03 | Build the editor or buy a starter? | **Build it** (Modules 08 to 11), learning from the open-source editors | No licence fee, full control, the design system's look, and the only paid starter we found cannot sit in a public repository | The build runs far past its sizes |
| D12-04 | Which render engine? | **FFmpeg only.** The editor draws a fast preview in the browser; **Preview Export** renders the real result at low resolution in seconds; **Export Clip** renders it for real. One compiler turns the clip document into the FFmpeg graph | Arvind's call. It costs no licence, needs no headless browser, renders much faster, and keeps the worker image small. The preview is a second implementation of the look, so parity is guarded by one pure `frameState` function, compiler tests and Preview Export | Parity bugs found in the real test outnumber the savings |
| D12-05 | Where does production keep files? | An **S3-compatible bucket pair** (a public media bucket and a private clips bucket); Cloudflare R2 (free egress) or AWS S3, the code speaks only the S3 API. Video work runs on a separate media worker box, sized from the Module 05 benchmark. Local development keeps MinIO or the local folder | The API and the worker are separate processes, so a shared disk cannot be assumed; signed addresses need object storage | A host offers a shared network disk with signed addresses |
| D12-06 | How big may an uploaded file be? | **2 GB**, resumable multipart upload; the cap is the entitlement `clips.upload_max_gb` | Stream recordings are many gigabytes; multipart avoids a single failing request | Real uploads show people hitting it |
| D12-07 | How are limits and plans modelled? | A **generic, data-driven subscription model**: a registry of entitlement keys in code, per-plan values and per-workspace overrides in the database, usage meters with an idempotent ledger, and an operator-only screen to edit them with a change log. Defaults are seeded for the five plans | A real SaaS changes prices and allowances without a deploy. Clips is the first user; the old numbers in the sprint doc become seed values | A billing provider is adopted that owns entitlements |
| D12-08 | Mark on Free exports? | **Yes**: a small "Made with PostGear" mark (`clips.export_watermark`), off for paid plans | A visible reason to upgrade; one value to change | Free-plan conversion is poor |
| D12-09 | Where do sound effects and music come from? | An **open-source catalogue** (`ClipSound`): CC0 and public-domain audio ingested by an operator-run, licence-guarded job from open sources (Openverse, Freesound's CC0 set, Kenney and the others research 10 verifies), searchable by name, tag and category, with favourites and workspace uploads | A real library, not a handful of files, with licence evidence stored per item | A source changes its terms (the item can be hidden or removed) |
| D12-10 | Where do stickers and GIFs come from? | An **open-source catalogue** (`ClipSticker`): Noto animated emoji (CC BY 4.0, credited), CC0 art, CC0 GIFs through Openverse, and our own pack, all normalised to APNG or PNG; Klipy is not used | Klipy is proprietary and its terms on keeping copies are unclear. The open catalogue is smaller than Giphy's and we say so | Users ask for a bigger library: add a commercial provider behind the same interface (Module 21) |
| D12-11 | How is AI paid for in Clips? | A **metered allowance of AI Minutes** per plan (`clips.ai_minutes_per_month`); one AI minute is one minute of video an AI step works on; a stretch is charged once per step; failures give the minutes back. The existing AI credits stay for text and image AI | Clips work scales with video length, not with the number of buttons pressed | The operator prefers one currency |
| D12-12 | Which browsers? | Chrome, Edge and Firefox supported; Safari best effort, not tested | The editor uses current video and audio APIs; the preview degrades gracefully | Safari users appear in numbers |
| D12-13 | What is refused? | Live streams, private, members-only, subscriber-only and age-restricted videos, always, and never by using a person's login or cookies | It keeps the product out of the worst legal and ethical territory | A platform offers an official route for them |
| D12-14 | Twitch chat for AI picks? | **Off by default** (`CLIPS_TWITCH_CHAT=false`); the real test judges it | It uses a route Twitch does not document and can break | The real test shows it works and holds |
| D12-15 | YouTube import in production? | **On in development and staging; in production it is switched on only after a legal read** (one environment value, `CLIPS_PLATFORMS`) | YouTube's API Developer Policies (III.E.1.a) forbid an API client from downloading or storing YouTube video, and PostGear publishes through that API. Twitch, Kick and uploads are unaffected | The legal read says it is acceptable, or YouTube changes the policy |
| D12-16 | Where do takedown requests go? | `copyright@rkay.in`, forwarded to Arvind, with a public page that says what to send | `rkay.in` is owned; the page and the operator removal route make the promise real | Volume needs a ticket system |
| D12-17 | Is everything in the screenshots covered? | **Yes, after an audit**: all 48 captures were checked screen by screen and seven gaps were added (channel browser, Edit Whole Video, extra layouts, Looks, 720p60, a Clips tab in the media picker, the Coming Up panel) | Arvind asked for confirmation; the first pass missed them | A new reference is added |

## Where Each Decision Lands

| Decision | Modules |
|---|---|
| D12-04 FFmpeg only | 02 (tools), 05 (thin slice), 08 to 15 (editor and render), 20 (worker image) |
| D12-05 S3 | 02 (storage package, buckets), 19 (retention), 20 |
| D12-07, D12-11 entitlements and AI Minutes | 01 (model and service), 04, 15, 16, 19 (operator screen) |
| D12-09 sound library | 01 (tables), 14 (catalogue, ingest, search) |
| D12-10 sticker library | 01 (tables), 12 (catalogue, ingest, search) |
| D12-17 channel browser | 03, 06 |
| D12-15 YouTube switch | 03, 20 |
