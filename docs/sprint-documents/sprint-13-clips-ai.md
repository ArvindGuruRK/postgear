# Sprint 13: Clips AI (Captions, Smarter AI And Auto-Reframe)

> **PRD Coverage**: extends the Clips module of Sprint 12, not in `prd.md` section 5 yet. It touches 5.5 (AI: the AI Minutes meter, the first use of speech to text and vision), 5.3 (the composer: posting slots with windows, an AI label), 5.4 (media), the team settings (the Editor seat) and Design Studio (the schedule layout).
> **User stories**: [`../new-modules/user-stories-clips-ai.md`](../new-modules/user-stories-clips-ai.md) holds the journeys, acceptance criteria, UX rules and the completion checklist. This document decides *how* to build; the stories decide *what the user experiences*.
> **Research**: [`../sprint-13/README.md`](../sprint-13/README.md) (the features left after Sprint 12, libraries, open-source repos, transcription, the Python service, captions and vision, cost and deploy, the approach). Every outside fact named below was read on 2026-11-14 unless marked reported.
> **Depends on**: [Sprint 12](sprint-12-clips.md), built, tested for real and through its exit gate ([`../sprint-12/real-test-plan.md`](../sprint-12/real-test-plan.md), section 7). Everything here adds to Sprint 12's clip document, job table, queues, storage, entitlement registry and AI Minutes meter; nothing replaces them. Also [Sprint 6](sprint-06-ai-content-engine.md) (the model client; AI credits stay for text and images) and [Sprint 9](sprint-09-design-studio.md) (brand kits, and the layouts the Schedule Maker adds to).
> **Branch**: `sprint-13-clips-ai`, cut from `sprint-12-clips`, or from the branch Sprint 12 was merged into (decision D13-01 in the [Decision Ledger](../sprint-13/README.md)).
> **Reference**: OpusClip (the setup screen, captions, the transcript pane, following the speaker, recipe chips, Auto-Edit) and StreamLadder (word bleeping, hook title, montage, posting slots, Emote Maker, Schedule Maker, Editors) for placement and behaviour only, never their code or art; the open-source projects in [`../sprint-13/research/03-open-source-reference-repos.md`](../sprint-13/research/03-open-source-reference-repos.md) under the licence rule written there.
> **Read this first**: these documents were written on 2026-11-14 and 2026-11-15, before Sprint 12 was built. Module 01 begins with a refresh: read Sprint 12's Decision Log and Deviations, and correct any name, path or shape here that the build changed.

## Sprint Goal

Clips learns to listen and to look. A video's speech becomes text with a time for every word, once. From that text come **captions** in ready styles that follow every edit, a **transcript** where deleting a sentence cuts the video, and AI that picks moments that make sense on their own, steered by what the user asks for on a **Clip Setup** screen. From the picture come **Detect Camera** and **Follow The Speaker**, which keep a person in a tall frame, and **Look For Action**, which finds sudden moments nobody shouted about. Around these: bleeped words, a hook title, a hook clip, a voice from text, captions from a file the user already has, saved recipes (five starter recipes included) with **Auto-Edit Video** and a brand kit, Export All and montage, more places to bring video from, **Creator Tools** (an Emote Maker and a Schedule Maker) with a restricted **Editor** seat for a freelancer, and posting slots with a window per time and times per weekday that look natural, with an AI label where a platform has one. Every AI step is paid in **AI Minutes**, Sprint 12's meter, with the price shown first.

Example: *Anjali opens last week's 58 minute podcast, presses Find Clips, types "the part about quitting my job", picks 30 To 60 Seconds and Vertical, ticks Follow The Speaker, and reads "58 min, 73 AI minutes" in the summary (58 for listening and 15 for reading; sound and picture are included when the run also listens). Eight clips come back, each with a title, a score and reasons like "Strong opening line". She opens one: the frame is on whoever is talking, captions show word by word, she fixes one name in the transcript, deletes a rambling sentence, presses Remove Silences, exports, and sends it to the composer.*

## What The Research Settled

1. **The Python service is a second worker, not a second API.** `apps/media` is a FastAPI process that also runs a Temporal worker on its own queue, `postgear-media-py`. It serves activities only; the workflows stay in TypeScript and call them by name. Payloads are one JSON object each way and carry storage keys, never paths. See [`05-python-media-service.md`](../sprint-13/research/05-python-media-service.md).
2. **Python 3.13, uv, and no PyTorch.** The whole stack resolves from ready-made packages on Windows and Linux for Python 3.13. Turborepo runs it through a small `package.json`, so `npm run validate` covers Python too.
3. **Speech to text runs on our own machine by default.** faster-whisper with the `large-v3-turbo` model gives a time for every word and needs no graphics card to work (it is slower without one). A hosted fast lane (Groq, about $0.04 an audio hour) sits behind a switch for long videos. OpenAI's transcription models are being retired in early 2027 and are not used. See [`04-transcription.md`](../sprint-13/research/04-transcription.md).
4. **Tamil and Hindi are covered, Tamil less well.** Captions are always editable, and words the model was unsure of are underlined. None of the 52 Studio fonts covers Tamil or Devanagari, so two open-licence fonts are added.
5. **Captions store no times of their own.** They are the transcript (in the video's time) plus a style and a list of the user's word fixes. The engine maps words to the clip through the segment list, so trims, cuts, speed changes and a hook clip all keep them in step. FFmpeg draws them from an ASS subtitle file written by the render compiler (libass with HarfBuzz shaping; Tamil and Hindi verified on 2026-11-17). See [`06-captions-moments-and-vision.md`](../sprint-13/research/06-captions-moments-and-vision.md).
6. **Smarter AI reads sentences, not timestamps.** The model is shown the transcript in numbered rows and answers with row numbers, so it cannot invent a time. Windows of about 90 seconds overlap; each gets a score built from five parts; the engine snaps to sentence ends, trims to the asked length and removes near-duplicates. Sprint 12's signals are blended in, not replaced.
7. **Following a face is detection plus our own smoothing.** MediaPipe finds faces at five pictures a second; matching them into people, choosing the speaker and moving the frame gently are ours, in the pure engine, so the editor can change the result without asking Python again. Only boxes are stored, never who a face is.
8. **Speech cleanup, transcript edits and the hook clip are just more segments.** A cleaned clip can have thirty or more parts, which Sprint 12's segment list and single sharp range per clip already allow.
9. **Scheduling already has posting times.** Each channel has a list of times of day and a "next free slot" function, used only by workflows today. This sprint adds a window around each time, a way to generate a week, and Next Available in the composer. See [`01-reference-features.md`](../sprint-13/research/01-reference-features.md).
10. **AI labels exist on some platforms only.** YouTube, Instagram and Facebook Reels have a field (read on their own pages); TikTok's and Pinterest's are reported; Threads and LinkedIn have none. YouTube's own rule says captions and cuts need no label; a made-up voice or picture does.
11. **Cost is small per hour and grows with speed, not volume.** About $0.13 to $0.35 for every hour of video across all AI steps, depending on where speech to text runs. A graphics card that is always on only pays at thousands of hours a month. See [`07-cost-deploy-and-risks.md`](../sprint-13/research/07-cost-deploy-and-risks.md).
12. **FFmpeg 9.0.2 was run, and the render recipes are verified** (2026-11-17, [`09-ass-captions-and-edit-cookbook.md`](../sprint-13/research/09-ass-captions-and-edit-cookbook.md)). The graph goes in a file passed with `-/filter_complex` (there is no `-filter_complex_script` in this build). The spoken word is marked by one ASS event per word (the default), or `\k` karaoke for the "words keep the accent" style, always reset with `\r`. A crop that moves over time is a balanced `if` expression (a flat chain fails near 95 terms). Bleeps are `aeval` mutes plus one `aevalsrc` sine, with 5 ms ramps; every cut join gets a 15 ms audio fade. A missing font falls back silently, so the compiler reads the `fontselect:` log lines and fails with `font_missing`.
13. **Tamil and Hindi shape correctly, but highlight whole words only.** libass with HarfBuzz draws both scripts right; a colour change inside a letter cluster draws dotted circles, so the active word is marked as a whole word, and Tamil and translated captions default to a page-level highlight. Colour emoji become sticker overlays (libass draws emoji in one colour). The browser preview of captions is an approximation; **Preview Export** shows the real result.
14. **The Editor seat is a new role with a measured blast radius.** `Role.EDITOR` fails closed on the API: 9 of 57 `@Roles` decorators change and 2 are added, and 6 web checks of the form `role !== 'USER'` would fail open and are replaced by one capabilities table. A route-matrix test makes every new route a decision. Seats are counted by their own entitlement, `members.editors_max`. See [`10-creator-tools-and-editor-seats.md`](../sprint-13/research/10-creator-tools-and-editor-seats.md).

## Names And Placement

| Thing | Name |
|---|---|
| Where it lives | Inside Clips: no new rail entry. New things are a **Captions** tab and a **Transcript** pane in the editor, a **Clip Setup** screen behind **Find Clips**, switches in **Layouts** and **Effects**, **Recipes** and **Brand Kit** in the Clips page's actions row, a bulk bar in the Clips tab, and a **Creator Tools** page (Emote Maker, Schedule Maker) reached from the Clips page's actions row |
| Routes | `/[orgId]/clips/video/[videoId]/setup` (Clip Setup), `/[orgId]/clips/kit` (recipes and the brand kit for clips), `/[orgId]/clips/tools` (Creator Tools), `/[orgId]/clips/tools/emote` (Emote Maker), `/[orgId]/clips/tools/schedule` (Schedule Maker); the editor and the Clips page gain parts |
| Primary actions | Add Captions, Find Clips (now through Clip Setup), Auto-Edit Video, Follow The Speaker, Detect Camera, Remove Silences, Export All, Create Montage, Save As Recipe, Make An Emote, Make A Schedule Picture, Invite An Editor |
| UI words | captions, transcript, speaker, recipe, brand kit, montage, emote, editor, AI minutes. Never "ASR", "diarization", "inference", "model", "tokens", "keyframes", "VAD" |
| Python service | `apps/media` (the package `postgear_media`), FastAPI on port 8100, a Temporal worker on `postgear-media-py` |
| Contract | `packages/media-contract` (`@postgear/media-contract`): the activity names and their input and output shapes, written once in Zod and exported to JSON Schema for the Python models |
| Engine additions | `packages/video-engine`: `captions/` (including the SRT and VTT reader), `transcript/`, `reframe/`, `highlights/` (the picker's pure parts, with the genre paragraphs), `recipes/` (including the five starter recipes and the Auto-Edit planner), `emotes/` (profiles as data, the size ladder); clip document version 2 |
| Render | `packages/video-engine/src/render`: an ASS caption writer (`buildAss`), bleep and mute audio filters, many-segment, hook, montage and Follow The Speaker graph recipes in the compiler; `packages/video-preview` shows captions in the editor (an approximation: **Preview Export** shows the real result); `emoteExport` encodes the emote sizes |
| API | `apps/api/src/modules/clips` grows (and gains `emotes`); `apps/api/src/modules/studio` gains the schedule routes; `apps/api/src/modules/org` gains the Editor role; `apps/api/src/modules/posts` and `channels` for the publisher module |
| Modules | **17**: 01 to 13 as before, **14 Creator Tools And Editor Seats** (new), **15 Scale, Cost And Deploy** (was 14), **16 Hardening, E2E, Closeout** (was 15), **17 P2 Backlog** (was 16). Module index: [`../sprint-13/clips-ai-implementation-docs/README.md`](../sprint-13/clips-ai-implementation-docs/README.md) |
| Models | `ClipRecipe`, `ClipCaptionStyle`, `ClipWordList` (posting slots are a validated JSON list on `Integration`, no table); new values on `ClipAssetKind` (`TRANSCRIPT`, `FACE_TRACKS`), `ClipJobKind` (`TRANSCRIBE`, `FACES`, `TRANSLATE`, `SPEECH`, `EMOTE`), `ClipOrigin` (`AI_TRANSCRIPT`, `MONTAGE`, `AUTO_EDIT`), and `Role.EDITOR`; clip fields on `BrandKit`; a per-channel AI label setting. A `ClipEmote` table only if the Module 14 spike shows it is needed (research 10 does not need one) |
| Design Studio | Document **schema version 3**: a `schedule` slide role, a `rows` slot kind, the `schedule-week@1` layout, five schedule themes. Version 2 designs open unchanged |
| Entitlement keys | From Sprint 12's registry and used here: `clips.ai_minutes_per_month` (the meter), `clips.queue_priority`, `clips.downloads_per_day` (emote and schedule downloads count). New in this sprint: **`members.editors_max`** (number; placeholders FREE 0, STANDARD 1, PRO 3, TEAM 10, ULTIMATE 25) |
| Queues | `postgear-media-py` (reserved in Sprint 12, used now); `postgear-media-gpu` is reserved for an always-on graphics card worker |
| Env | `MEDIA_SIMULATION`, `MEDIA_URL`, `MEDIA_INTERNAL_TOKEN`, `TRANSCRIBER` (`faster-whisper`, `groq` or `simulation`), `WHISPER_MODEL`, `GROQ_API_KEY`, `CLIPS_ACTION_VISION`, `CLIPS_TTS`, more values allowed in `CLIPS_PLATFORMS` (adds Reddit, Pinterest and Threads; TikTok and Instagram stay off until switched on), `GOOGLE_DRIVE_PICKER_KEY` (optional), `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (the app token for the Schedule Maker; the same pair Sprint 12's channel browser reads) |
| AI Minutes meter | Sprint 12's usage meter `clips.ai_minutes_per_month`; the credit types `clip_listen`, `clip_highlights`, `clip_action`, `clip_translate` and `clip_voice` are **not created**. Rates live in `packages/video-engine/src/pricing.ts`: `signals` 0.25 (free when the run also listens), `listen` 1.0 (minimum 2), `read` 0.25, `action` 0.5 and `translate` 0.25 per minute, `voice` 1 per 1000 characters; price is `ceil(minutes x rate)`, at least 1. Following the speaker, Detect Camera, Upload SRT, the emote tools and the schedule tools are free. The existing AI credits stay for text and images |
| Story prefix | `CA-` |

## Screens

The wireframes, states and exact copy are in [`../sprint-13/clips-ai-implementation-docs/00-ux-blueprint.md`](../sprint-13/clips-ai-implementation-docs/00-ux-blueprint.md). In short:

### Clip Setup

- A framed page reached from **Find Clips**. Left: the video's poster with **Spoken Language**, **Upload SRT** (captions from a file the user already has) and a range strip with two handles ("Use less of the video to spend fewer AI minutes"); **Recipe** (the five starter recipes and the user's own) and **Brand Kit** pickers; **Genre** (Auto, Podcast, Gaming, Education, Interview, Vlog); **What Should We Look For?**; **Clip Length**; **Shape** and **Layouts AI May Use**; switches for **Captions** (with the style), **Follow The Speaker**, **Look For Action**, **Remove Silences**, **Hook Title**. Right: a **Summary** card that reads the choices back with the price and the AI minutes left, and **Find Clips**.

### Starter Recipes And Auto-Edit Video

- On the Create tab and in the Clip Setup recipe picker: five starter recipes as chips, **Clean Up Recording**, **Auto-Edit Talking Video**, **Captions Only**, **Reframe** and **Social Edit**. Each is ordinary recipe data that the user can copy and change.
- **Auto-Edit Video** (a button on the video page menu and on the recipe chips): one press turns a whole video into one edited clip by applying a recipe. A recipe whose part is missing (a deleted style, no face found) still runs and says which part it skipped.

### Editor Additions

- **Captions** tab (between Audio and Export): **Add Captions**, the language, **Upload SRT**, style tiles, position and size, **Create A Style**, **Translate Captions**.
- **Transcript** pane, opened from the top bar, on the left of the clip: the words with the spoken one marked; click to jump, type to fix, select and Delete to cut, **Remove Silences**, **Remove Filler Words**.
- **Layouts**: **Detect Camera**, **Follow The Speaker** (with **Show Both** and **Fix By Hand**).
- **Effects**: **Bleep Bad Words**, **Add Hook Title**, **Add Hook Clip**, **Text To Speech**.
- Top bar: **Save As Recipe** in a menu.

### Clips Page Additions

- The Clips tab gains tick boxes and a bulk bar: **Export All**, **Create Montage**, **Hide**, **Delete**.
- The link box reads more sites (Reddit, Pinterest and Threads join the list; TikTok and Instagram are built but off until switched on); **Google Drive** sits beside **Upload A Video**.
- The video page's transcript can be searched, and a selected stretch of text can become a clip.
- A **Creator Tools** button in the actions row opens the two tools below.

### Creator Tools

- **Emote Maker**: pick a clip or video, drag a square crop box over a face, set a trim bar of at most 3 seconds, see the emote at 28, 56 and 112 px next to a **chat preview**, then **Export For Twitch**, **Export For 7TV** or **Export For BTTV**, each a download of files with their sizes. Optional background removal by colour key.
- **Schedule Maker**: a Twitch name field (placeholder "Enter your Twitch name"; or **Fill It In By Hand**), pick one of five themes and a shape (Portrait or Landscape), and land in the normal Design Studio editor with the week filled in; edit any word, then export a PNG or send it to the composer.

### Editor Seats

- The Team page's invite dialog gains an **Editor** choice with a seat line ("2 of 3 editor seats used"). An Editor sees a reduced app: Clips, Design Studio, Media, the Composer for drafts only, Calendar (read), AI Copilot and Home. Channels, Analytics, SEO, Discover, Workflows, Billing, API Keys and Webhooks are simply absent from the rail, and typing their address shows a plain "You do not have access to this page". Trying to schedule or publish shows "Editors cannot do this. Ask an admin."

### Composer Additions

- **Next Available** beside the date; in the channel's preferences, **posting slots** (each with a time, a window and the weekdays it applies to), **Shuffle Times**, and a **random time picker** (Morning, Noon, Afternoon, Evening) in the schedule dialog; and **Made With AI** for posts with video.

## The Clip Document, Version 2

`schemaVersion: 2`, with one `upgrade()` step from version 1 that changes nothing a Sprint 12 clip relies on: every version 1 document is a valid version 2 document after it. Additions:

```ts
interface ClipDocumentV2 extends ClipDocumentV1 {
  schemaVersion: 2;
  segments: Array<SegmentV1 & { role?: 'hook' }>;            // a hook clip is a segment played first
  layout: LayoutV1 & {
    follow?: {                                               // Follow The Speaker
      mode: 'speaker' | 'both';
      faceAssetId: string;                                   // the FACE_TRACKS asset the crops were made from
      overrides: Array<{ from: number; to: number; rect: Rect }>;   // Fix By Hand, SOURCE time
    };
  };
  tracks: Array<
    | OverlayTrackV1 | AudioTrackV1
    | {
        id: string; kind: 'captions';
        transcriptAssetId: string;                           // words and their times live in the asset, in SOURCE time
        language: string;                                    // which transcript (the spoken one or a translation)
        styleId: string;                                     // a built-in style or a ClipCaptionStyle
        position: { x: number; y: number }; sizePx: number; maxWords: number;
        edits: Record<string, { text?: string; hidden?: boolean }>;   // by word index; no times are stored here
      }
  >;
  bleeps: Array<{ id: string; source: string; from: number; to: number; mode: 'bleep' | 'mute' }>;   // SOURCE time
  recipeId?: string;
}
```

Words removed in the transcript, silences and filler words are not a new structure: they are the segment list with those stretches left out. Follow The Speaker writes its result as more keyframes in `layout.areas[].crop`, which Sprint 12's `areaCropAt` already reads. A montage is a document with several `sources`.

## The Media Service And Its Contract

- `apps/media` follows the layout in research 05: `src/postgear_media/` with `main.py` (FastAPI: health, readiness, a tools report), `worker.py` (the Temporal worker), `core/` (settings from the repo's root `.env`, logging), `activities/` (thin, one per contract entry), `services/` (the real work), `providers/` (real and simulated bindings), `simulation/` (fixtures), and `tests/`. A small `package.json` gives it `dev`, `lint`, `typecheck` and `test` scripts that call `uv run`, so Turborepo treats it like any workspace.
- `packages/media-contract`: for each activity, a name and two Zod shapes. A script exports JSON Schema; the Python models are generated from it; the same fixture files are parsed by Jest and by pytest, so the two sides cannot drift.

| Activity | Input | Output |
|---|---|---|
| `mediaPyTranscribe` | The analysis sound's key, a range, a language hint | A transcript file's key, the language found, the speech track |
| `mediaPyDetectFaces` | The light copy's key, a range | A face file's key (boxes in time, grouped into people) |
| `mediaPyMotion` | The light copy's key, a range | The motion track |
| `mediaPyStills` | A key and a list of moments | Keys of small still pictures (for the vision check) |
| `mediaPyHealth` | none | Versions and which bindings are live |

- TypeScript workflows on `postgear-media` call these through a typed stub with `taskQueue: 'postgear-media-py'`. Python activities heartbeat and stop when cancelled.
- Language models (reading transcripts, writing titles, checking stills) stay in `packages/ai-engine` on the Node side, behind the existing model client and `AI_SIMULATION`. Python does sound and pictures only.
- `MEDIA_SIMULATION=true` (refused in production; follows `CLIPS_SIMULATION` when unset) makes every Python activity answer from recorded files for the sample videos, with no model downloaded.

## Jobs

New kinds on Sprint 12's `ClipJob`, each a workflow on `postgear-media` that calls Python where it needs to:

| Job | Stages (what the user reads) | Result |
|---|---|---|
| `TRANSCRIBE` | "Listening to what is said" | A TRANSCRIPT asset covering the asked range; later requests only fill gaps |
| `HIGHLIGHTS` (extended) | Sprint 12's steps, then "Listening to what is said", "Reading for the best moments", and "Watching for action" when asked | Clips with status NEW, origin `AI_TRANSCRIPT` or `AI_SIGNALS`, titles, scores, reasons |
| `FACES` | "Finding faces" | A FACE_TRACKS asset for the clip's range |
| `TRANSLATE` | "Translating the captions" | A second transcript in the asked language |
| `SPEECH` | "Making the voice" | A sound in the workspace's library |
| `RENDER` (extended) | unchanged | Captions and bleeps drawn; many jobs queued by Export All |
| `EMOTE` | "Making your emote" (one encode per size, the ladder stepping down when a file is over its cap) | The files of one platform in the private clips bucket, each with its size in bytes and a signed link; free of AI Minutes, counted by `clips.downloads_per_day` |

## Database

Use the `prisma-change` skill. Each module adds what it needs; nothing from Sprint 12 is renamed.

```prisma
// enum additions
// ClipAssetKind: + TRANSCRIPT, FACE_TRACKS
// ClipJobKind:   + TRANSCRIBE, FACES, TRANSLATE, SPEECH, EMOTE
// ClipOrigin:    + AI_TRANSCRIPT, MONTAGE
// Role:          + EDITOR   (its own migration that adds the value and nothing else: Postgres cannot
//                            use a new enum value in the transaction that adds it)

model ClipRecipe {
  id             String   @id @default(uuid())
  organizationId String
  name           String
  settings       Json                                          // validated by the engine's recipe schema
  brandKitId     String?
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([organizationId])
}

model ClipCaptionStyle {                                       // a workspace's own caption styles
  id             String   @id @default(uuid())
  organizationId String
  name           String
  style          Json
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([organizationId])
}

model ClipWordList {                                           // a workspace's own words to bleep, and its word fixes
  organizationId String   @id
  bleepWords     String[] @default([])
  updatedAt      DateTime @updatedAt
}
```

Posting slots need no new table. `Integration.postingTimes` is already a JSON list read by about 28 files, so it becomes a validated list of slots, `{ time, windowMinutes, days }` (a time of day, a window of 0, 5, 15 or 30 minutes for that time only, and the weekdays it applies to). Module 13 holds the exact shape and the idempotent migration; there is no `ChannelPostingSlot` model and no `postingWindowMinutes` column.

`BrandKit` gains `clipLogoPosition`, `clipCaptionStyleId`, `clipIntroAssetId`, `clipOutroAssetId`. Posting slots keep every existing channel's times: the migration turns each old time into one slot for all seven days with window 0, and `nextFreeSlot()` reads the new shape. Word fixes made in one clip and kept for the whole video live in the TRANSCRIPT asset's `meta`, not in a table. Transcripts and face files are `ClipAsset` rows, so Sprint 12's removal and storage counting already cover them. A supplied SRT becomes a TRANSCRIPT asset marked `source: 'supplied'`. The Editor seat adds no table: invites stay signed tokens, seats are counted from `UserOrganization` rows with `role = EDITOR` and `disabled = false`, and the cap is the entitlement `members.editors_max`. No emote table is planned: the `EMOTE` job's output lists its files (a `ClipEmote` table is added only if the Module 14 spike shows a need). **Design Studio** moves to document schema version 3 (a `schedule` role, a `rows` slot kind, an optional `schedule` source on the document; version 2 designs upgrade with no change). `SCHEMA_NOTES.md` gets a "Sprint 13 additions" entry.

## API Routes

All under `apps/api/src/modules/clips` unless noted, with Sprint 12's rules (authenticated, roles, strict Zod, tenancy, 404 for another workspace).

| Route | Answers |
|---|---|
| `GET /clips/status` | gains `ai: { captions, action, voice, sites, languages }` and the prices |
| `POST /clips/videos/:videoId/transcript` | `{ fromMs?, toMs?, language? }`; 202 `{ job, price }` (price in AI minutes); 402 `clips_ai_minutes_used` when they are short |
| `POST /clips/videos/:videoId/transcript/from-file` | A multipart SRT or VTT file and a language; reads it into a TRANSCRIPT asset marked supplied; 201 `{ transcript }`; free. Refuses a file over 2 MB or with no readable lines |
| `GET /clips/videos/:videoId/transcript?fromMs&toMs&language` | `{ transcript }` for the covered part, with `covered` ranges |
| `PATCH /clips/videos/:videoId/transcript/words` | `{ fixes: [{ index, text }] }` or `{ replace: { from, to } }`; kept for the whole video |
| `POST /clips/videos/:videoId/setup/price` | The setup's choices; `{ minutes: { signals, listen, read, action }, total, remaining }` (AI minutes) |
| `POST /clips/videos/:videoId/highlights` (extended) | The setup's choices (range, genre, prompt, clip length, shape, layouts, captions, follow, action, recipe); 202 `{ run, job, price }` |
| `POST /clips/videos/:videoId/auto-edit` | `{ recipeId }` (a starter or the user's own); turns the whole video, up to the clip maximum, into one clip with the recipe applied; 202 `{ run, job, price }`; 402 when AI minutes are short |
| `POST /clips/:clipId/captions` | `{ styleId, language? }`; adds the captions track, starting a TRANSCRIBE job when the range is not covered |
| `POST /clips/:clipId/captions/from-file` | A multipart SRT or VTT file; adds the captions track from the supplied transcript with no listening; 201 `{ clip }`; free. A file whose times fall outside the clip says so |
| `POST /clips/:clipId/captions/translate` | `{ language }`; 202 `{ job, price }` |
| `GET /clips/caption-styles`, `POST`, `PATCH /:id`, `DELETE /:id` | Built-in and workspace styles |
| `POST /clips/:clipId/faces` | 202 `{ job }` (free); `GET /clips/:clipId/faces` answers the people found |
| `POST /clips/:clipId/hook-titles` | `{ titles: [three] }` from the clip's words (through the model client) |
| `GET /clips/word-list`, `PUT /clips/word-list` | The workspace's own words to bleep |
| `POST /clips/voice` | `{ text, voiceId }`; 202 `{ job, price }`; 503 `voice_off` |
| `GET /clips/recipes`, `POST`, `PATCH /:id`, `DELETE /:id`, `POST /clips/:clipId/apply-recipe` | Recipes. `GET` returns the five starter recipes (read-only, `starter: true`: Clean Up Recording, Auto-Edit Talking Video, Captions Only, Reframe, Social Edit) before the workspace's own; a starter can be copied |
| `GET /clips/emote-profiles` | The platform profiles as data (sizes, formats, byte caps, frame caps) so the page never hard-codes a limit |
| `POST /clips/emotes` | `{ sourceClipId or videoId, startMs, endMs (at most 3000 apart), crop: { x, y, size }, platform, removeBackground? }`; 202 `{ job }`, or 200 `{ files }` when the encodes finish within about 25 seconds; 422 `emote_too_long`, 422 `emote_too_big` (after the ladder); counts one download |
| `GET /clips/emotes/:jobId` | The job's files with sizes and signed links |
| `POST /studio/schedules/fetch` (`modules/studio`) | `{ login, timeZone, weekStart }`; looks the name up and reads the week's segments from Twitch's public schedule with the app token; `{ rows, vacation }`; 404 `twitch_channel_not_found`; 200 with empty rows and `noSchedule: true` when Twitch has none. Cached 10 minutes |
| `POST /studio/designs` (existing) | accepts a schedule preset with `elements.schedule.rows` and a `schedule` source (Design Studio schema version 3) |
| `POST /orgs/:id/invites` (`modules/org`, existing) | accepts `role: 'EDITOR'` (address required for an Editor, soft seat check, the link bound to the address); 409 `no_editor_seats` |
| `POST /orgs/invites/accept` (existing) | for an Editor token, the hard seat check inside the transaction under a per-workspace advisory lock; 409 `no_editor_seats` |
| `PATCH /orgs/:id/members/:userId` (existing) | accepts `EDITOR`; re-checks the seat cap |
| `GET /orgs/:id/editor-seats` | `{ used, max }` for the Team page's seat line and the over-the-cap banner |
| Editor limits (existing routes) | `@Roles` gains `EDITOR` on studio, media, tags, signatures, posts (read, and write for drafts only), search, notifications, ai and the dashboard's member route; `schedule` and `publish-now` stay `ADMIN, USER`. A checked-in table `editor-access.json` and a route-matrix test make every route an explicit decision. `rbac.denied` is logged on every refusal |
| `PATCH /studio/brand-kits/:id` (existing, `modules/studio`) | accepts the clip fields |
| `POST /clips/exports` | `{ clipIds, quality }`; 202 `{ jobs }` (Export All) |
| `POST /clips/montages` | `{ clipIds, transition, titleCard? }`; 201 `{ clip }` with origin `MONTAGE` |
| `POST /clips/videos/drive` | `{ fileId, accessToken }` from Google's picker; `{ video, job }` |
| `GET /channels/:id/posting-slots`, `PUT /channels/:id/posting-slots` (`modules/channels`) | The channel's slots, each `{ weekday, minuteOfDay, windowMinutes }`; `PUT` replaces the whole list (1 to 14 slots a day). **Replaces** the old `PATCH /channels/:id/posting-times` and its `windowMinutes` field |
| `POST /channels/:id/posting-slots/shuffle` | `{ perDay, seed? }`; answers a suggested week of slots (not saved until the user presses **Use These Times**) |
| `GET /channels/next-slot?channelIds` | Answers the next free time of the first channel listed, moved a little inside that slot's window |
| `GET /channels/:id/random-time?part=morning\|noon\|afternoon\|evening&date=` | One free time inside that part of the day, for the schedule dialog's random time picker |
| `POST /posts` and `PATCH` (`modules/posts`) | gain `madeWithAi` per post; providers map it to their field |

Messages live in `clips.messages.ts` in plain words ("We could not hear any speech in this video.").

## AI Minutes, Limits And Plans

Decided in D13-02 and built on Sprint 12's entitlement system ([`../sprint-12/research/12-plans-entitlements-and-usage.md`](../sprint-12/research/12-plans-entitlements-and-usage.md)). Nothing here is a code constant per plan.

- **The meter.** One AI minute is one minute of video an AI step works on. Each AI step spends from the workspace's `clips.ai_minutes_per_month` allowance through `consume`, with an idempotency key per step and job (`clips.ai:<step>:<jobId>`). A failed step, a video with no speech or an empty result gives the minutes back through a **reversal** entry, so the ledger never loses its history and a job that fails twice cannot refund twice.
- **The rates** (constants in `packages/video-engine/src/pricing.ts`, price = `ceil(minutes x rate)`, at least 1):

| Step | Used by | Rate |
|---|---|---|
| `signals` | Find Clips from sound, picture and chat (Sprint 12); free when the run also listens | 0.25 per video minute |
| `listen` | Speech to text (Module 02) | 1.0 per video minute, at least 2; once per stretch |
| `read` | The model picking moments from the transcript (Module 05) | 0.25 per video minute |
| `action` | Look For Action (Module 06) | 0.5 per video minute |
| `translate` | Translate Captions (Module 09) | 0.25 per clip minute |
| `voice` | Text To Speech (Module 09) | 1 per 1000 characters |

  Following the speaker, Detect Camera, hook titles, Upload SRT, the Emote Maker and the Schedule Maker cost nothing. A stretch is charged once per step: later captions, transcript features and AI runs on a listened stretch cost nothing more for listening. A 58 minute podcast with captions and clip picking costs about 73 AI minutes (58 for listening, 15 for reading), a quarter of Standard's placeholder 300 a month; this is why listening is on demand (D13-04) and the range strip shows the price falling as it is narrowed.
- **The entitlements** Sprint 12 seeded and this sprint reads: `clips.ai_minutes_per_month` (placeholders FREE 30, STANDARD 300, PRO 900, TEAM 3000, ULTIMATE 10000), `clips.queue_priority` (FREE low, STANDARD and PRO normal, TEAM and ULTIMATE high), `clips.downloads_per_day` (emote and schedule downloads count), and the new `members.editors_max`. Labels read "Find Clips (73 AI Minutes)"; the chip reads "38 of 300 AI minutes left"; a short meter says "This needs {need} AI minutes and you have {n} left. They come back on {date}, or you can upgrade the plan." and the Setup button is disabled with the missing number.
- **Queue priority** comes from `clips.queue_priority`, copied into `ClipJob.priority` when the job is made; the scheduler (Module 15) picks higher priority first and the Free plan's wait message says "Paid plans go first."
- **The operator edits plan values** on the Operator screen built in Sprint 12 Module 19 (the plan table, per-workspace overrides, the change log, the usage views). No code change and no deploy is needed to change an allowance, a seat cap or a priority. Module 15 only audits that every price in `pricing.ts` is what the stories show.
- The existing AI credits stay for text and image AI (Copilot, Create Post). The billing page shows both chips: "AI credits" and "AI minutes".

## Simulation

`CLIPS_SIMULATION=true` and `MEDIA_SIMULATION=true` together run every screen with no network, no AI model and no graphics card: the sample videos gain a recorded transcript (English, with a Tamil stretch), recorded face boxes for a two-person sample and a face-camera sample, a recorded motion track, and recorded model answers for the picker, titles and vision checks (through `AI_SIMULATION`). A recorded Twitch schedule (one week with a recurring segment, a cancelled one and a vacation, plus a "no schedule" answer and an unknown name) stands in for Twitch in the Schedule Maker, and a sample SRT and VTT file come with the sample videos. A third sample video is generated for this sprint: two "speakers" (coloured shapes with a face-like marker) taking turns, with tone patterns standing in for speech at known times. The Python service still starts in simulation, with only its base packages installed.

## Task Breakdown

Ordered checklist; each phase ends with `verify-change`. The phases are the modules in [`../sprint-13/clips-ai-implementation-docs/README.md`](../sprint-13/clips-ai-implementation-docs/README.md).

1. **Media service foundations** (Module 01): the refresh against Sprint 12's Decision Log, the branch, `apps/media` with FastAPI and the Temporal worker, `packages/media-contract` with generated Python models, Turborepo scripts, the health activity called from a TypeScript workflow, `MEDIA_SIMULATION`, the image.
2. **Transcription** (Module 02): the `Transcriber` interface with three bindings, the TRANSCRIBE job, the transcript file and its covered ranges, the speech track, the `listen` AI minutes step, Upload SRT, a speed benchmark.
3. **Captions** (Module 03, Demo 1): document version 2, the pager and the ASS writer, the Captions tab with styles, word fixes, custom styles, translation, Captions From A File, the two added fonts.
4. **Transcript editing and speech cleanup** (Module 04, Demo 2): the Transcript pane, delete words to cut, Remove Silences, Remove Filler Words, search and clip from text on the video page.
5. **Clip Setup and highlights V2** (Module 05, Demo 3): the setup screen with its price in AI minutes, the Genre select, the transcript picker through the model client, titles, blending with signals, dedup.
6. **Visual moments** (Module 06): the motion track, the vision check on stills, Look For Action.
7. **Face detection and Detect Camera** (Module 07): the FACES job, people from boxes, the face-camera finder.
8. **Auto-Reframe** (Module 08, Demo 4): Follow The Speaker in the engine and the Layouts tab, Show Both, Fix By Hand.
9. **AI effects** (Module 09): Bleep Bad Words, Add Hook Title, Add Hook Clip, Text To Speech behind its switch.
10. **Recipes, starter recipes and brand kit** (Module 10): recipes end to end, the five starter recipes, Auto-Edit Video, clip fields on the brand kit, intro and outro.
11. **Montage and batch export** (Module 11): Export All with one notice, Create Montage with several sources.
12. **More sources and platforms** (Module 12): more sites in the link box and the downloader (Reddit, Pinterest and Threads added), each behind its switch; Google Drive.
13. **Publisher upgrades** (Module 13): posting slots with a window per time and times per weekday, the schedule dialog with the random time picker, Shuffle Times, Next Available in the composer, Made With AI.
14. **Creator Tools and Editor seats** (Module 14, new): the Editor role and its seat cap (lands first, because new Clips routes carry the Editor value from the start), the capabilities table and route matrix test, the invite and Team page, the Emote Maker, the Schedule Maker (Design Studio schema version 3).
15. **Scale, cost and deploy** (Module 15, was 14): queue priority from `clips.queue_priority` and fairness, the wait message, the hosted fast lane, cost per job recorded, the images, an audit of every AI Minutes price against `pricing.ts`.
16. **Hardening, e2e, closeout** (Module 16, was 15): security and privacy sweep (the Editor abuse cases included), edge cases from the stories' section 5, `e2e/clips-ai.spec.ts`, the Sprint 12 regression set, the completion checklist via `sprint-closeout`.
17. **P2** (Module 17, was 16, only when Arvind decides): dubbing, B-roll, eye contact, AI emoji, auto zoom, enhance sound, auto-import, per-Editor AI caps, an audit table, approval before an Editor schedules.

## Definition Of Done

Evidence for each line goes in the completion checklist when the sprint closes.

- [x] `apps/media` starts with `npm run dev`, is linted, type-checked and tested by `npm run validate`, and answers a health activity called from a TypeScript workflow on `postgear-media-py`. **Verified live** (Module 01): `media-py.live.test.ts` on the local Temporal; Python lint, types and tests run in validate (291).
- [x] The contract's shapes are written once; the Python models are generated from them; one set of fixtures passes in Jest and in pytest. **Verified**: freshness tests on both sides and shared fixtures; `contract.security.test.ts` (Module 16).
- [x] A stretch of video is listened to once: the transcript has a time for every word, covers only what was asked, and a second request for the same stretch costs nothing. **Built and tested, but in simulation** (the one real listen was the `small` benchmark).
- [x] Add Captions puts word-by-word captions on a clip in six styles; a word can be fixed once for the whole video; unsure words are underlined; captions stay in step after a trim, a split, a deleted part, a speed change and a hook clip, in the editor and in the export (the editor is an approximation; Preview Export matches the export). **Built, but in simulation**: Module 03 browser pass and the time map tests.
- [x] Tamil and Hindi captions render with the right shapes in the export, highlighting whole words only, with a missing font failing the render as `font_missing` instead of changing silently. **Verified** with the real FFmpeg: caption parity and `caption-box.security.test.ts`; Preview Export with Tamil captions.
- [ ] Upload SRT: a supplied SRT or VTT file becomes the transcript with no listening and no AI minutes, on the video and on a clip; a file that cannot be read says why and changes nothing. **Not met, partly built**: Upload SRT works on a clip (free, with its sentence); there is no upload on the video itself.
- [x] Deleting words in the transcript cuts the video between words with one undo step; Remove Silences and Remove Filler Words show what they will remove first. **Built, but in simulation**: Module 04 browser pass, `cuts-parity`.
- [x] Clip Setup shows the price in AI minutes before anything runs; Find Clips returns clips that start and end on a sentence, each with a title, a score and reasons; what the user asked for and the chosen Genre change what comes back; signal and speech picks are one list with no duplicates. **Built, but in simulation**: the simulated model's answers.
- [x] Look For Action adds moments found from the picture, says what it saw, and says what it cannot know. **Built, but in simulation**: recorded motion and simulated stills.
- [x] Detect Camera places the Camera box on a face camera or says it found none; Follow The Speaker keeps the speaker in frame smoothly, cuts when the speaker changes, marks where it lost them, can be fixed by hand, and restores the user's own boxes when switched off. **Built, but in simulation**: recorded face boxes; the real wide-shot and podcast checks are in the real-test plan.
- [x] Bleep Bad Words, Add Hook Title and Add Hook Clip work and are each one undo step; Text To Speech works behind its switch or is recorded as parked with the reason. **Built, but in simulation**; Text To Speech behind `CLIPS_TTS`, run for real with Kokoro on this laptop.
- [x] A recipe carries a clip's settings to another clip and another member; the brand kit adds a logo, a caption style, an intro and an outro. **Verified** (Module 10 browser pass); a second member's view not tried with a second account.
- [x] The five starter recipes (Clean Up Recording, Auto-Edit Talking Video, Captions Only, Reframe, Social Edit) are listed read-only and can be copied; **Auto-Edit Video** turns a whole video into one edited clip with a recipe in one press, and a recipe with a missing part still runs and names what it skipped. **Built, but in simulation** (Module 10 and the Module 16 skip toast).
- [x] Export All exports many clips with one notice; Create Montage stitches clips from one or more videos into one clip that exports. **Verified** with the real FFmpeg on the local samples (Module 11).
- [ ] The link box and the downloader read the added sites (Reddit, Pinterest and Threads included), each behind its switch, with TikTok and Instagram off until switched on; a Google Drive file comes in through Google's own picker. **Not met, partly built, in simulation**: the sites read fixtures only; Threads cannot be switched on outside simulation; Drive works through the stand-in picker, not Google's own.
- [x] Posting slots: a channel has times per weekday, each with its own window; the schedule dialog's random time picker (Morning, Noon, Afternoon, Evening) gives a free time inside that part of the day; Shuffle Times suggests a week; Next Available is in the composer; old posting times migrate to all seven weekdays; a post placed by hand stays exact; Made With AI reaches the platforms that have a field for it. **Built, but in simulation** (`PUBLISH_SIMULATION`); TikTok and Pinterest have no field, so `'none'`.
- [x] Emote Maker: a clip of 3 seconds at most becomes files for Twitch, 7TV and BTTV; the size ladder stops at the first file under the cap and the frame limit; a result that still does not fit says "too big" in plain words; the chat preview shows the emote at its real sizes. **Verified** with the real FFmpeg on local samples; no platform has accepted a file yet.
- [x] Schedule Maker: a Twitch name becomes a week in the user's time zone (across a clock change, a midnight crossing, a cancelled segment and a vacation); a channel with no schedule or an unknown name opens with a clear sentence; five themes and two shapes export as PNG; the person can edit every word. **Built, but in simulation**: recorded Twitch weeks; no real Twitch read.
- [x] Editor seat: an Editor can make clips, designs and post drafts and cannot connect channels, schedule, publish, see billing, analytics, SEO, Discover, workflows, API keys or webhooks, or manage people; **every denial** is a 403 with the plain sentence and a log line, the route matrix test lists every route, the web hides what the API refuses, and **seats are counted** (soft check at invite, hard check at accept under a lock, role change re-checks, a disabled Editor does not count, a downgrade never removes an Editor). **Verified**: the route matrix spec, `editor-seats.security.spec.ts`, e2e test 18 and the Module 16 hand check (six admin routes refused with the sentence).
- [x] AI Minutes ledger: every AI step shows its price first and is charged once (**idempotent** by step and job), is **reversed on failure** and when no speech or nothing is found, never refunds twice, never charges a stretch twice for the same step, and refuses with the plain sentence when the allowance is short; the operator can change an allowance, a seat cap or a priority with no deploy; paid plans go first; a queued step says it is waiting. **Verified** in tests and the browser under simulation: `ai-minutes.security.spec.ts`, the charge-site audit, Module 15's queue pass.
- [x] Transcripts and face positions are deleted with their video; no face is ever identified; no speech text leaves the system except to the model providers named in the settings. **Verified** in tests: the face file schema, the removal of the private folder, the speech-text security tests; Module 16's log search found no speech.
- [x] Every Sprint 12 clip in the regression set opens, plays and exports the same as before. **Verified**: `clips:regression` 5 of 5 with the real FFmpeg, v1 fixtures 16 of 16; three version 1 clips opened in the editor and exported by hand (Module 16).
- [ ] `CLIPS_SIMULATION=true` and `MEDIA_SIMULATION=true` run every screen with no network and no model; `e2e/clips-ai.spec.ts` and `e2e/clips.spec.ts` pass; `npm run validate` is green. **Not met, partly**: both e2e suites pass under simulation (19 of 19, 18 of 18) and no screen needs the network or a model; `npm run validate` is red on seven tests that predate Sprint 13's last modules (the completion checklist's section 12).
- [x] Light, dark and Lilac checked at 1366 px and 1920 px; the title-case test is green; no em dash and no middle dot anywhere. **Verified**: the Module 16 look pass (`docs/design-patterns/sprint-13-clips-ai-look-pass.md`, light, dark and Lilac at 1366 and 1920); the title-case test is green; no em dash or middle dot in the changed files.

## Deviations

Where the build differs from this document, the module docs or the UX blueprint. Each has its full reason in the implementation README's Decision Log, under the module named. Plan changes made before the build (FFmpeg only, AI Minutes as the one meter, the creator tools brought in as Module 14, Editors cannot schedule in v1) are decisions, not deviations.

- **Paths follow the built Sprint 12** (Module 01): the worker's render code is `apps/worker/src/clips/render/` and its workflows `apps/worker/src/workflows/clips/`, not the paths these documents guessed before Sprint 12 existed.
- **Listening answers one heard file** (`heard-<job>.json.gz`: words and the speech curve), not a transcript key and a speech track key; the Node side merges it into the video's transcript (Module 02).
- **Languages on offer are the twelve whose captions can be drawn** (Module 02): a language the caption fonts cannot shape is not offered rather than offered and drawn wrong.
- **Captions routes never write the clip document** (Module 03): they answer the captions track and the editor saves it as one undo step, so there is one writer of the document.
- **Cut points are rounded where the cut is made** (`removeSourceRanges`), not in `buildRenderPlan`; and the 15 ms fades at cuts apply to version 1 clips too, whose render graph changes only by those fades (Module 04). `npm run clips:regression` still passes.
- **Crop keyframes have no `ease` field** (Module 08): a cut is two keyframes 1 ms apart. **The export writes the moving crop itself** with `sendcmd` command files: Sprint 12 refused any moving crop, where the module doc said it already handled one.
- **The bleep gate is a balanced `if` tree**, not the research's flat sum, and **a hook clip keeps its own seeked input** rather than one input with `split` (Module 09); both keep long clips inside FFmpeg's expression limits.
- **The preview's word pop is a font-size change**, not a CSS scale, to grow the line as libass does (Module 09).
- **Text To Speech is Kokoro as a separate GPL program** (`apps/media/voice-program`), started per line, after the owner's OK (Module 09): `kokoro-onnx` loads a GPL library, so the media service never imports it.
- **Brand kit clip fields are ClipVideo ids** (`clipIntroVideoId`, `clipOutroVideoId`, ...), not asset ids, and brand kit ids may be readable strings (Module 10).
- **Starter recipes show a Built In badge and Duplicate**, not the blueprint's Starter and Copy To My Recipes; `layoutsAiMayUse` was dropped from recipes (Module 10).
- **`ClipPlatform` stays an enum widened by 14 values**, not a free string; **Threads is built but off** (the pinned yt-dlp has no Threads reader); the "Works with" logo chips became a help line; **Google Drive files are stored as uploads** (platform `UPLOAD`) (Module 12).
- **No posting slots on the public API** (`/v1/channels` never carried posting times), and **Facebook, TikTok and Pinterest have no AI label field** (`aiLabel: 'none'`, the composer says so) (Module 13).
- **Editor seats** (Module 14): `Post.createdById` was added; the capability table follows the code (any member may start a channel connection; billing reads stay admin and member); channel connect now needs `@Roles(ADMIN, USER)`, so a request with no workspace answers 403 instead of a redirect; the schedule route is `PUT /posts/:group/schedule`, not POST; the seat line is singular at a limit of 1.
- **Schedule Maker and Emote Maker look** (Module 14): a Portrait row is about 7 percent of the picture, not 12; the emote job's time limit is 30 minutes, not 10 (the worker keeps 10 of any limit for cleanup); the emote trim bar has no waveform; schedule pictures are not metered and carry no watermark (metering is Module 17 item 25).
- **The queue** (Module 15): a low job ranks with high after 20 minutes, stronger than the doc's 30; the second waiting line is "Plans with a higher priority go first." rather than "Paid plans go first."; the worker's `WORKER_MEDIA_CONCURRENCY` default rose from 2 to 6, because waiting runs hold activity slots.
- **The privacy sentences live in Clip Setup's privacy hint** (Module 15), since the app has no privacy page; the rented graphics card lane is documented only (Module 17 item 16).
- **Hardening** (Module 16): an Editor refused by any role check reads "Editors cannot do this. Ask an admin." (`editor_forbidden`), not only on the posts wall; a refused cookie for another workspace keeps the one answer for all. **Auto-Edit's Follow The Speaker skip is a toast on the clip's first open**, since following runs there and not in the job. **Detect Automatically refuses a heard language we cannot draw** in the worker's finish step (the API still refuses a named one before any charge). Where a code sentence says more than the stories (the next step, the site's name, the way out), the code's sentence stayed. A busy queue is forced with `CLIPS_MEDIA_SLOTS=1` and the existing slow sample, not a new switch; the two new switches are the no-speech sample link and `[simulate:model-bad-rows]`.
- **Routes as built differ from the route table** (found at the close-out): there is no video-level Upload SRT route (a captions file is read on a clip only, `POST /clips/:clipId/captions/from-file`); posting slots are saved through `PATCH /channels/:id` and Shuffle Times and the random time picker are pure functions in `packages/automation`, so they have no routes; the seats are `GET /orgs/:id/seats`; the emote export is `POST /clips/emotes/export` and the emote profiles are engine data with no route; the voice is `POST /clips/:clipId/voice`.

## Risks

See [`../sprint-13/research/07-cost-deploy-and-risks.md`](../sprint-13/research/07-cost-deploy-and-risks.md) for the register. The four that shape the build: speech to text on a processor is slow for long videos (a hosted fast lane behind a switch, a benchmark in Module 02, and listening only to what is asked); captions in Tamil and under game sound will have errors (always editable, unsure words marked, a fix kept for the whole video); following a speaker fails on crowds, profiles and people who leave the picture (the frame holds, the stretch is marked, Fix By Hand); and a second language and a second service raise the cost of every change (one contract with generated models, one set of fixtures, simulation for both).

Three more come with the creator tools and the render engine:

- **Editor seat blast radius.** A new role touches 9 existing route decorators, 6 web checks that would fail open, invites, mail and the Team page. Handled by landing it first in Module 14, replacing the six checks with one capabilities table compared against the API's in a test, a route-matrix test where every route is an explicit allow or deny, drafts-only posts for Editors, and `rbac.denied` logging. Editors spend the workspace's AI minutes; a per-Editor cap is P2. An Editor still cannot schedule in this sprint, so there is no approval step to build.
- **Hosted-service rate limits.** The Schedule Maker and the channel browser share Twitch Helix with one app token; the answer is cached 10 minutes in Redis and the call is throttled per workspace. The hosted speech lane (Groq) has its own limits; the media service queues and retries with backoff and falls back to our own machine.
- **ASS highlight limits.** libass marks whole words only for Tamil and Hindi (a colour change inside a cluster draws dotted circles), draws emoji in one colour, and has square boxes. The default for Tamil and translated captions is a page-level highlight, emoji become sticker overlays, and rounded boxes are a drawn shape sized from a measured width. A missing font falls back silently, so the compiler fails the render with `font_missing` instead.
