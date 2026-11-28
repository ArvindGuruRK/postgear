# Sprint 12: Clips (Turn Any Long Video Into Short Clips)

> **PRD Coverage**: new module, not in `prd.md` section 5 yet. It touches 5.4 (media: exported clips land in the library), 5.3 (the composer receives clips), 5.5 (AI: a new usage meter, AI minutes) and billing and plans (limits become data an operator edits).
> **User stories**: [`../new-modules/user-stories-clips.md`](../new-modules/user-stories-clips.md) holds the journeys, acceptance criteria, UX rules and the completion checklist. This document decides *how* to build; the stories decide *what the user experiences*.
> **Research**: [`../sprint-12/README.md`](../sprint-12/README.md) (the Decision Ledger, reference products, libraries, open-source repos, link import, editor and render, highlight signals, legal and cost, the approach, the FFmpeg cookbook, the sound and sticker libraries, the channel browser, plans and entitlements, the screenshot audit). Every outside fact named below was read on 2026-11-14 or 2026-11-17 unless marked reported; every FFmpeg fact was produced by running FFmpeg 9.0.2 on 2026-11-17.
> **Depends on**: [Sprint 4](sprint-04-post-composer-and-media.md) (the Media library and the composer), [Sprint 5](sprint-05-scheduling-and-publishing.md) (Temporal, the worker, `packages/scheduling`), [Sprint 6](sprint-06-ai-content-engine.md) (the AI credits ledger, which stays for text and image AI), [Sprint 8](sprint-08-billing-notifications-api-launch.md) (plans, the subscription tier, notifications), [Sprint 9](sprint-09-design-studio.md) (the document pattern, the editor frame, the fonts), [Sprint 10](sprint-10-workflow-builder.md) (the run events stream, the internal worker routes).
> **Branch**: `sprint-12-clips`, cut from `instagram-direct-and-threads` (decision D12-02). That branch is pushed but not merged, so merge it first if you can; otherwise this sprint's pull request carries its commits.
> **Reference**: StreamLadder (flow and screens) and OpusClip (setup and AI ideas) for placement and behaviour only, never their code or art; the open-source projects in [`../sprint-12/research/03-open-source-reference-repos.md`](../sprint-12/research/03-open-source-reference-repos.md) under the licence rule written there. Screenshots are local only, in `docs/screenshots/streamladder/`, `opusclip/` and `vidssave/`; the audit of every screen is [`../sprint-12/research/13-screenshot-coverage.md`](../sprint-12/research/13-screenshot-coverage.md).
> **Next**: [Sprint 13](sprint-13-clips-ai.md) adds speech to text, captions, smarter AI and the Python service on top of what this sprint reserves.

## Sprint Goal

A user opens **Clips** from the rail, pastes a YouTube, Twitch or Kick link (picks a stream from a channel they added, or uploads a file), and PostGear brings the video in. They mark clips by hand or press **Find Clips** and AI proposes the best moments with a score and a reason. Each clip opens in a full-window editor: layouts and crops, text, stickers from an open library, looks, zoom and speed, sound effects and music, trim and split on a timeline. **Preview Export** renders the real result at a small size in seconds. **Export** makes an MP4 that matches the editor closely, puts it in Media, and **Send To Composer** schedules it on every channel. A pasted link can also be downloaded in the quality the user picks. Every limit comes from plan values that an operator can change without a release.

Example: *Vikram streams for four hours on Twitch on Wednesday night. On Thursday morning he opens Streams, picks the stream from his channel, ticks "This video is mine, or I have permission to use it." and presses Import Video. Ten minutes later he presses Find Clips (56 AI Minutes); twelve clips appear, the best one scored 92 for "Chat exploded" and "Loud reaction". He opens it, picks Vertical and the Gameplay layout, drags one box over his game and one over his face camera, adds a "W" sticker from the library and a line of text, presses Preview Export to see the real result, exports at 1080p, and sends it to the composer for TikTok, Shorts and Reels.*

## What The Research Settled

1. **FFmpeg only: one compiler, a fast preview, and a Preview Export.** The clip document is compiled by pure TypeScript in `packages/video-engine/src/render/` into one FFmpeg command: a filter graph in a file, ASS subtitle files for text, an argument array. `frameState(doc, outputMs)` is the single definition of what is on screen at a moment; the browser preview and the compiler tests both read it. The editor's preview (`packages/video-preview`) is a fast approximation of the export, not the export, so the editor "matches closely" and **Preview Export** (a render of the same plan at about 360 pixels wide) "shows it exactly". No Remotion, no headless Chrome. See [`05-editor-and-render.md`](../sprint-12/research/05-editor-and-render.md) and [`09-ffmpeg-render-cookbook.md`](../sprint-12/research/09-ffmpeg-render-cookbook.md).
2. **Speed is per part, not a smooth ramp.** A constant speed on a part of the video is built (`setpts` per segment and a chained `atempo`); a smooth ramp is now feasible but stays parked (Module 21).
3. **A clip is a list of segments with two clocks.** Things that belong to the picture (crops, zooms, and captions in Sprint 13) are stored in the video's time; things laid on top (text, stickers, sound) in the clip's time. Trim, split, delete and speed only change the map between the two.
4. **yt-dlp reads all three platforms, with conditions.** YouTube needs an outside JavaScript runtime (Deno, or Node 22 and up) and often shows a bot check to server addresses; Kick needs yt-dlp's impersonation extra and its section download is broken on some streams. So: a proxy and cookies setting, a switch per platform, our own playlist slicing for Twitch and Kick, and the upload path always offered. See [`04-link-import-and-fetch.md`](../sprint-12/research/04-link-import-and-fetch.md).
5. **Bring in a light copy first, the sharp range later.** Import keeps a 720p-or-lower copy for watching and editing. The sharp copy of a clip's range, with 30 seconds each side, is fetched when the clip is made or first opened. If the platform copy is gone by then, the clip exports at 720p from the copy we kept.
6. **Signals find gaming and reaction moments well, calm talk badly.** Loudness, scene changes and Twitch chat bursts, scored against the video's own average, are what the open highlight finders use. Twitch chat replay is not an official API and sits behind a switch. Speech arrives in Sprint 13. See [`06-highlight-signals.md`](../sprint-12/research/06-highlight-signals.md).
7. **Imported videos need private storage, and production needs S3.** Today every stored file is public to anyone with its address. Imported videos go to a private space and are played through short-lived signed addresses. Only an exported clip becomes a public `Media` file. Production uses an S3-compatible bucket pair (a public media bucket and a private clips bucket; Cloudflare R2 or AWS S3, the code speaks only the S3 API); local development keeps MinIO or the local folder (decision D12-05).
8. **Video work gets its own queues.** The worker has one queue for publishing. Import and analysis go to `postgear-media`, exports and previews to `postgear-render` one at a time, so a scheduled post never waits behind a render. The worker also gains storage access, which it does not have today.
9. **The render host is plain Debian with FFmpeg, and it is much cheaper than a browser render.** The worker image is Debian slim with a GPL FFmpeg static build run as a separate program (the image stays private), yt-dlp, Deno and the fonts. There is no Chrome, no browser libraries and no render licence. Measured on a busy laptop at `veryfast` (one run each, a noisy synthetic source, so real footage may be faster): 720p30 about 1.0 times real time, 1080p30 about 0.7, 1080p60 about 0.4, and Preview Export about 2.4. **Planning figure until the Module 05 benchmark on the real host: 1.5 to 3 times the clip's length at 1080p30.**
10. **The FFmpeg facts the compiler is built on** (all verified on 2026-11-17 with FFmpeg 9.0.2; the cookbook has the evidence):
    - The graph is passed as `-/filter_complex graph.txt` (the older `-filter_complex_script` was removed in 9.0.2, and `-vsync` is now `-fps_mode`). Names are relative to the job's scratch folder.
    - A constant crop is a plain `crop`. A moving crop goes through `sendcmd` with **one linear expression per interval** and a constant last line (exact at 600 keyframes); a single expression, flat or nested, fails to parse near 100 keyframes, and splitting into sub-segments misaligns. Crop keyframes stay in source time.
    - Zoom uses the `perspective` filter, evaluated per frame and enabled only inside the zoom's window. `scale` with `eval=frame` then `crop`, per-frame `crop` sizes and `zoompan` were tested and rejected.
    - Stickers are normalised at ingest to APNG (full alpha, fixed frame rate); GIF and animated WebP are accepted as ingest inputs only.
    - Text (and, in Sprint 13, captions) is ASS drawn by libass with HarfBuzz shaping, using TTF and OTF twins of the 52 Studio fonts plus Noto Sans Tamil and Devanagari (libass cannot read WOFF2). A build step, `npm run clips:fonts:build`, writes the twins and a font manifest; a missing font fails the render with `font_missing` instead of falling back silently. Colour emoji are not drawn by libass, so they are placed as sticker images.
    - Overlays use `format=yuv420` (an overlay on `format=auto` doubles the render time); progress is read from `-progress pipe:1` with a running maximum of `out_time_us`; output goes to `render.mp4.part` and is renamed only after a clean finish.
11. **Plans are data, and AI is metered in minutes.** Limits stop being fields on `Plan`. A registry of entitlement keys lives in a new pure package `packages/entitlements`; per-plan values, per-workspace overrides (with an end date), a change log and a usage ledger are database tables; an operator screen edits them. AI work is paid for in **AI Minutes** on a ledger with idempotent charges and reversals. See [`12-plans-entitlements-and-usage.md`](../sprint-12/research/12-plans-entitlements-and-usage.md).
12. **The sound and sticker libraries are open and licence-guarded.** `ClipSound` and `ClipSticker` catalogues hold only CC0, public-domain and (for stickers only) credited CC BY items, each with its licence evidence, searchable by name, tag and category, with favourites and workspace uploads. They launch from PostGear's own art and sounds, Kenney's CC0 packs, Noto animated emoji and a few hand-picked sources; Openverse and Freesound wait for written permission. The catalogue is smaller than Giphy's and has no film or meme clips, and the UI says so. See [`10-open-source-sound-and-sticker-libraries.md`](../sprint-12/research/10-open-source-sound-and-sticker-libraries.md).
13. **My Channels lists a channel's streams without a login.** A person adds a Twitch, YouTube or Kick channel by name; PostGear lists its public streams and clips (Twitch Helix and the YouTube Data API, yt-dlp's flat listing as the fallback and for Kick) and **Import** hands the choice to the normal link flow, so the rights tick and every other check still apply. See [`11-channel-browser.md`](../sprint-12/research/11-channel-browser.md).
14. **Rights are recorded, and the risk is Arvind's call.** Each import stores who confirmed the right to use the video and when. Platform terms restrict downloading; the reference products do it anyway. The sharpest term is YouTube's API Developer Policies (III.E.1.a), because PostGear also publishes through that API; YouTube import is on in development and staging and switched on in production only after a legal read, by one value (`CLIPS_PLATFORMS`, decision D12-15). The mitigations (private storage, short retention, a takedown path at `copyright@rkay.in`, no public downloader page, a switch per platform) are in [`07-legal-limits-cost-and-risks.md`](../sprint-12/research/07-legal-limits-cost-and-risks.md).

## Names And Placement

| Thing | Name |
|---|---|
| Rail label | Clips |
| Top bar page name | Clips |
| Routes | `/[orgId]/clips` (the page; `?tab=create\|streams\|videos\|clips\|downloads`), `/[orgId]/clips/video/[videoId]` (the video page), `/[orgId]/clips/edit/[clipId]` (the editor, full window), `/operator` (the operator screen, full window, operators only), `/credits/clips` (the library credits, public) |
| Rail position | after Studio |
| Primary actions | Import Video, Find Clips, Create Clip, Edit Whole Video, Preview Export, Export Clip, Send To Composer |
| UI words | video (the long one), clip (the short one), layout, sticker, sound, look, export, AI minutes. Never "source", "proxy", "segment", "asset", "job", "render", "ingest", "transcode", "entitlement" |
| Packages | `@postgear/video-engine` (pure; gains `src/render/` and `src/pricing.ts`), `@postgear/video-preview` (web only: the editor's preview), `@postgear/storage` (moved from the API), `@postgear/media-tools` (Node only: yt-dlp, FFmpeg, the executor), `@postgear/entitlements` (new, pure: the registry, validation, resolution, cycle and message templates) |
| API modules | `apps/api/src/modules/clips`, `apps/api/src/modules/entitlements`, `apps/api/src/modules/admin` (the operator routes) |
| Worker | `apps/worker/src/clips/` (activities), `apps/worker/src/workflows/clip-*.workflow.ts`, `apps/worker/src/render/`, `apps/worker/src/scripts/` (the library ingest) |
| Contract | `packages/scheduling/src/clips.ts` |
| Web | `apps/web/src/app/(dashboard)/[orgId]/clips/`, `apps/web/src/app/(operator)/operator/`, `apps/web/src/components/clips/`, `apps/web/src/lib/clips-api.ts`, `apps/web/src/types/clips.ts` |
| Models | Clips: `ClipVideo`, `ClipAsset`, `Clip`, `ClipHighlightRun`, `ClipJob`, `ClipPost`, `ClipLayoutPreset`. Library: `ClipSound`, `ClipSticker`, `ClipLibrarySource`, `ClipFavourite`, `ClipLibraryRun`, `ClipLibraryDeny`, `ClipLibraryMiss`. Channels: `ClipChannel`, `ClipChannelHidden`. Plans and usage: `PlanEntitlement`, `OrgEntitlementOverride`, `EntitlementChange`, `UsageEntry`. Three new columns on `Media` |
| Queues | `postgear-media`, `postgear-render`; `postgear-media-py` is reserved for Sprint 13 |
| Env | `CLIPS_SIMULATION`, `CLIPS_PLATFORMS`, `WORKER_ROLES`, `YTDLP_PATH`, `YTDLP_JS_RUNTIME`, `YTDLP_PROXY`, `YTDLP_COOKIES_FILE`, `FFMPEG_PATH`, `FFPROBE_PATH`, `CLIPS_SCRATCH_DIR`, `CLIPS_PRIVATE_BUCKET`, `CLIPS_URL_SECRET`, `CLIPS_TWITCH_CHAT`, `OPERATOR_EMAILS`, `ENTITLEMENTS_SOURCE`, `CLIPS_LIBRARY_INGEST`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `CLIPS_YOUTUBE_API_KEY`. Removed from the first plan: `CLIPS_GIF_SEARCH`, `KLIPY_API_KEY`, `REMOTION_LICENSE_KEY`. The full list with defaults is in the module index |
| Scripts | `clips:doctor`, `clips:samples`, `clips:benchmark`, `clips:stills`, `clips:remove`, `clips:fonts:build`, `clips:library:ingest`, `clips:library:publish`, `clips:library:remove`, `operator:grant`, `operator:revoke` |
| Meter | AI Minutes (`clips.ai_minutes_per_month`); no new AI credit type. Existing AI credits stay for text and image AI |
| Story prefix | `CL-` |

## Screens

The wireframes, states and exact copy are in [`../sprint-12/clips-implementation-docs/00-ux-blueprint.md`](../sprint-12/clips-implementation-docs/00-ux-blueprint.md). In short:

### Clips Page

- `PageActions`: the storage meter ("12.4 GB of 30 GB") and the AI minutes chip ("38 of 300 AI minutes left") on the right. `Tabs`: **Create**, **Streams**, **Videos**, **Clips**, **Downloads**, kept in `?tab=`.
- **Create**: one field ("Enter your YouTube, Twitch or Kick link"), **Find Video**, **Upload A Video**, **Try A Sample**, and the entries **Browse Twitch**, **Browse YouTube**, **Browse Kick**; then a **Coming Up** panel (posts of the next 14 days that use a clip, with **View Calendar**) and recent videos and clips. A found link shows the **link card**: picture, title, channel, length, platform badge, the rights tick box, **Import Video** and **Download**.
- **Streams** (My Channels): channel chips, an **Add A Channel** dialog (the handle field says "Enter your channel name"), and a list of the channel's streams and clips with title, date, length, views, **Import** and a hide icon, **Sort**, **Show Hidden**, **Refresh**. **Import** opens the link card with the video filled in.
- **Videos**: cards with live progress and "about N minutes left" while a video comes in, then **Open**. **Clips**: a filter row (**All**, **New**, **Drafts**, **Exported**, **Scheduled**, **Hidden**), a **Source** filter, **Sort**, a list or grid switch, and clip cards. **Downloads**: prepared files with **Save File** and their expiry.

### Video Page

- A player with our own controls, the time, and a timeline with the filmstrip, the waveform, the marked range and the highlight marks.
- On the right: **Find Clips** (violet, with the price in AI minutes) and the list of this video's clips, AI ones with a score and reasons. **I** and **O** mark a range; **Create Clip** makes a clip from it; **Edit Whole Video** makes one clip over the whole video (up to 30 minutes) and opens the editor.

### Editor (Full Window)

- Top bar: back, the clip's name, the saved state, **Undo**, **Redo**, **Export**. A tab rail on the left: **Layouts**, **Elements**, **Text**, **Effects**, **Audio**, **Export**. The open tab's panel beside it, the clip in the middle (the `video-preview` engine), a timeline dock under it.
- First open asks **Vertical**, **Horizontal** or **Square**.
- **Layouts** shows the layout tiles (**Fullscreen**, **Blurred** with its **Crop Ratio**, **Split**, **Three**, **Four**, **Gameplay**, **Screen Share**, saved layouts) and, beside the clip, the full video with one crop box per area.
- **Elements** has **Stickers**, **GIFs**, **Favourites** and **Uploaded**, each with a search field and category chips; **Audio** has **Sound Effects**, **Music**, **Favourites** and **Uploaded** with search, categories and a star on every row.
- **Effects** has **Zoom**, **Speed Control** and **Looks** (the colour looks, **Fade In**, **Fade Out** and a vignette).
- **Export** has the qualities (720p, 720p 60 fps, 1080p, 1080p 60 fps; 4K is reserved and parked), **Preview Export** and **Export Clip**. The panel says "The editor is a fast preview. Preview Export shows the real result."

### Dialogs

- Preview Export (progress "Making the preview", then the clip plays), Export progress, Send To Composer (channels and caption), Add A Channel, the plan lock, the confirm dialogs for deleting.

### The Operator Screen

Not part of the Clips UX blueprint. It is a separate full-window screen at `/operator`, for operators only, with four tabs (**Plans**, **Workspace Overrides**, **Usage**, **Change Log**) and a **Library** area for the sound and sticker catalogues. It is designed in [`../sprint-12/research/12-plans-entitlements-and-usage.md`](../sprint-12/research/12-plans-entitlements-and-usage.md) (section 8) and built in Module 19.

### Small Screens

- Below 1366 px the whole module shows one sentence. There is no phone layout.

## The Clip Document

One versioned document per clip, validated by `clipDocumentSchema` in `@postgear/video-engine` (Zod, every object `.strict()`, `schemaVersion` with an `upgrade()` chain, as `design-engine` does). All times are whole milliseconds; frames are worked out from `canvas.fps` when drawing.

```ts
interface ClipDocument {
  schemaVersion: 1;
  canvas: { ratio: '9:16' | '16:9' | '1:1' | '4:5'; width: number; height: number; fps: 30 | 60; background: string };
  sources: Array<{ id: string; videoId: string }>;          // Sprint 12 writes exactly one; montage (Sprint 13) adds more
  segments: Array<{                                          // the video part of the clip, in play order
    id: string; source: string;                              // sources[].id
    sourceIn: number; sourceOut: number;                     // ms in the video's own time
    speed: 0.25 | 0.5 | 1 | 1.5 | 2 | 4;
    volume: number;                                          // 0 to 2
  }>;
  layout: {
    kind: 'fullscreen' | 'blurred' | 'split' | 'three' | 'four' | 'gameplay' | 'screen_share' | 'custom';   // data presets
    fitCrop?: 'original' | '4:3' | '1:1';                    // the Fit (Blurred) crop ratio
    areas: Array<{
      id: string; name: string;                              // "Camera", "Content"
      frame: Rect;                                           // where it sits on the canvas, 0 to 1
      crop: Array<{ at: number; rect: Rect }>;               // SOURCE time keyframes, 0 to 1 of the video; Sprint 12 writes one
      fit: 'cover' | 'contain';
      radius?: number;                                       // rounded camera box, in canvas pixels
    }>;
  };
  zooms: Array<{ id: string; source: string; from: number; to: number; scale: number; focus: Point; ease: number }>;   // SOURCE time
  looks: { colour: 'none' | 'warm' | 'cool' | 'vivid' | 'black_white' | 'sepia' | 'vintage' | 'cinematic'; strength: number; vignette: number };   // the whole clip; strength and vignette 0 to 1
  fades: { inMs: number; outMs: number };                    // picture, text and sound together; 0 means off
  tracks: Array<                                             // OUTPUT time: start and duration in the clip
    | { id: string; kind: 'overlay'; items: Array<TextItem | StickerItem> }
    | { id: string; kind: 'audio'; items: AudioItem[] }
    | { id: string; kind: 'captions'; transcriptAssetId: string; style: unknown }   // reserved: written by Sprint 13 only
  >;
}
```

The layout presets (Fullscreen, Blurred, Split, Three, Four, Gameplay, Screen Share) are data in `video-engine`, not code paths: each is a list of areas for a canvas shape. A `StickerItem` or `AudioItem` points to `{ library: 'sticker' | 'sound', id }` or `{ asset: id }` (a workspace upload), never both.

Every `TextItem`, `StickerItem` and `AudioItem` carries `anchor: 'moment' | 'clip'`. `moment` (the default for stickers, text and sound effects) means the item belongs to a moment of the video; `clip` (the default for music, and for anything set to show for the whole clip) means it belongs to the clip itself.

The engine owns the **time map**: `outputDuration(doc)`, `toOutput(doc, sourceId, sourceMs)` (null when that moment is cut out) and `toSource(doc, outputMs)`. A split replaces one segment with two; deleting a part removes a segment; a speed change scales one segment's length. Crops and zooms never move, because they are in the video's time. After every edit that moves video (a trim, a deleted part, a speed change), the engine re-places each `moment` item: it finds the video moment the item started on before the edit and puts the item's start back on that moment (or at the cut, when the moment was removed); its length is kept. `clip` items do not move. An item that would end past the clip's new end is shortened, never deleted.

**`frameState(doc, outputMs)` defines the frame.** It is one pure function: for a moment of the clip it returns, per layout area, the crop and frame rectangles; the zoom scale and focus; the looks; each overlay item's position, size, rotation and opacity; and which sounds play and how loud. The browser preview draws from it, the compiler writes its numbers into filter text, and the parity tests compare rendered pixels with it, so the three cannot quietly disagree. It follows the rules in cookbook section 12 (for example, a crop is read at the source frame actually shown, and a rotation is clockwise-positive). The old `compositionProps` function no longer exists.

## Providers

Every heavy or outside job sits behind an interface with a real binding and a simulated one, bound in one factory per process (the `createDiscoverEngine` pattern).

```ts
interface Downloader {                       // real: yt-dlp + FFmpeg; simulated: fixtures and the sample videos
  probe(url: string, signal: AbortSignal): Promise<LinkInfo>;
  fetchProxy(input: { link: LinkRef; maxHeight: 720 | 480; outFile: string }, on: Progress, signal: AbortSignal): Promise<FetchedFile>;
  fetchRange(input: { link: LinkRef; fromMs: number; toMs: number; maxHeight: number; outFile: string }, on: Progress, signal: AbortSignal): Promise<FetchedFile>;
  fetchFormat(input: { link: LinkRef; formatId: string; outFile: string }, on: Progress, signal: AbortSignal): Promise<FetchedFile>;
}
interface SignalProducer { readonly track: TrackName; produce(input: AnalysisInput, signal: AbortSignal): Promise<SignalTrack | null>; }   // loudness, scene, chat
interface ChannelLister {                    // real: Twitch Helix, YouTube Data API, yt-dlp flat; simulated: fixtures
  platform: ClipPlatform;
  resolve(handle: string): Promise<ChannelRef>;
  list(ch: ChannelRef, q: { kind: ListKind; cursor?: string; limit: number; sort?: 'newest' | 'views' }): Promise<{ items: ListedItem[]; nextCursor?: string }>;
}
interface StickerProvider { search(request: { orgId, q, kind, category, favouritesOnly, page, pageSize }, signal?: AbortSignal): Promise<{ items: LibraryStickerView[]; total: number }>; resolve(orgId: string, ids: string[]): Promise<ResolvedSticker[]>; }   // catalogue-backed (Module 12: CatalogueStickerProvider)
interface SoundProvider { search(request: SoundSearchRequest): Promise<SoundSearchResult>; resolve(orgId: string, ids: string[]): Promise<{ sounds: ResolvedSound[]; removed: string[] }>; }   // catalogue-backed (Module 14: CatalogueSoundProvider)
interface Renderer { render(input: RenderInput, on: Progress, signal: AbortSignal): Promise<RenderedFile>; }   // FFmpeg; RenderInput carries proof: boolean
// Reserved for Sprint 13: Transcriber, FaceTracker
```

`LinkInfo` is one shape for all platforms: `{ platform, kind, externalId, canonicalUrl, title, channelName, durationMs, live, thumbnailUrl, formats: [{ id, label, height, fps, ext, bytes?, audioOnly }] }`. The pure scorer in `video-engine` takes `SignalTrack[]` with weights and returns ranges with a score and reasons; it works with any subset of tracks.

- **`StickerProvider` is catalogue-backed.** The one real binding reads `ClipSticker` (and the same pattern serves sounds from `ClipSound`). The interface stays as a swap point so a commercial provider can be added later (Module 21) without touching the editor.
- **`ChannelLister`** has four bindings: `TwitchHelixLister` and `YouTubeDataLister` (in the API, to fixed hosts), `YtDlpFlatLister` (a worker activity; Kick always, the others as the fallback) and a simulated one. A selector tries the official route first and falls back on a coded failure. The lister never returns an address: the web builds the canonical link from the id and posts it to the probe.
- **`Renderer`** is the FFmpeg executor. `buildRenderPlan` and `compileFfmpeg` are pure and live in `video-engine`; `media-tools` runs the result (`runTool`, an argument array, progress read from `-progress pipe:1`, cancel by killing the process). A render is `{ plan, quality, proof }`.

## Jobs And Queues

Every long task is a `ClipJob` row and a Temporal workflow whose id is `clip-job:<jobId>`. The API writes the row and starts the workflow; the worker updates `stage` and `progress` (and the "about N minutes left" estimate); the maintenance workflow starts any job whose workflow never started. Activities pass storage keys, never file paths, and work in a scratch folder that is removed afterwards.

| Job | Queue | Stages (what the user reads) | Result |
|---|---|---|---|
| (probe, no row) | `postgear-media` | none; the API waits up to 25 s | `LinkInfo`, cached 10 minutes |
| (channel list, no row) | `postgear-media` | none; the API waits up to 25 s (only the yt-dlp lister uses it) | `ListedItem[]`, cached 10 minutes |
| `IMPORT` | `postgear-media` | "Getting the video", "Preparing the preview" | Proxy, analysis audio, filmstrip, waveform, poster; `ClipVideo` READY |
| `SEGMENT` | `postgear-media` | "Getting the sharp video" | The sharp range with handles; or `hdAvailable = false` |
| `HIGHLIGHTS` | `postgear-media` | "Listening for loud moments", "Looking for scene changes", "Reading the chat", "Picking the best moments" | Signal file, `Clip` rows with status NEW |
| `RENDER` | `postgear-render` (one at a time) | "Getting the sharp video", "Rendering", "Finishing" | An MP4 and a poster in the public media space, a `Media` row |
| `RENDER` with `proof: true` (Preview Export) | `postgear-render`, lower priority than real exports | "Making the preview" | A small MP4 in the private space, kept 24 hours, no `Media` row, no meter charge |
| `DOWNLOAD` | `postgear-media` | "Getting your file" | A file kept 24 hours behind a signed address |

One worker entry point serves the queues named in `WORKER_ROLES` (`publishing,media,render` locally; one role per container in production). A job's queue priority (`clips.queue_priority`) is copied into the job when it is made.

## Storage

Covered in [`../sprint-12/research/08-approach-on-postgear.md`](../sprint-12/research/08-approach-on-postgear.md) section 4. In short: the storage code moves to `packages/storage` and gains a private space (`clips/<orgId>/...`), signed addresses that expire, download to a file, multipart upload and delete by prefix; every stored file has a `ClipAsset` row with its size.

- **Production requires an S3-compatible bucket pair** (decision D12-05): a public media bucket (exported clips and the library) and a private clips bucket (videos, proxies, working files, previews). Cloudflare R2 or AWS S3; the code uses only the S3 API. Development keeps MinIO (a bucket and CORS step in `docker-compose.yml`) or the local folder.
- **The library lives in the public bucket** under `library/sounds/<2 hex>/<sha256>.m4a`, `library/stickers/<2 hex>/<sha256>.apng` or `.png` and `library/previews/<2 hex>/<sha256>.webp`. The key is the content hash, so files are immutable and cached for a year.
- **Preview Export files** sit in the private bucket under `clips/<orgId>/proofs/<jobId>/` and are removed after 24 hours.
- **Fonts** are not in storage: the worker image holds the TTF and OTF twins and the font manifest (`clips:fonts:build`).

## Database

Use the `prisma-change` skill. Module 01 adds everything below in a small number of migrations (the entitlements and usage tables in `20261117120000_entitlements_and_usage`, then the Clips, library and channel tables); later modules do not change the schema except where they say. `Plan` gets nothing: there is no `Plan.clips`.

**Tables Module 01 adds:**

| Group | Tables | Defined in |
|---|---|---|
| Clips | `ClipVideo`, `ClipAsset`, `Clip` (including `lastExportedFingerprint`), `ClipHighlightRun`, `ClipJob`, `ClipPost`, `ClipLayoutPreset`; three columns on `Media` | below |
| Plans and usage | `PlanEntitlement`, `OrgEntitlementOverride`, `EntitlementChange` (append only), `UsageEntry` (the ledger, `@@unique([organizationId, idempotencyKey])`), and the enums `EntitlementChangeAction` and `UsageKind`; the seed of 13 keys for five tiers | [`12-plans-entitlements-and-usage.md`](../sprint-12/research/12-plans-entitlements-and-usage.md) section 4 and 9 |
| Library | `ClipLibrarySource`, `ClipSound`, `ClipSticker`, `ClipFavourite`, `ClipLibraryRun`, `ClipLibraryDeny`, `ClipLibraryMiss`, the enums `ClipSoundKind`, `ClipStickerKind`, `ClipLibraryStatus`, and the generated `tsvector` columns with their indexes (raw SQL in the migration) | [`10-open-source-sound-and-sticker-libraries.md`](../sprint-12/research/10-open-source-sound-and-sticker-libraries.md) section 6 and 7 |
| Channels | `ClipChannel`, `ClipChannelHidden` | [`11-channel-browser.md`](../sprint-12/research/11-channel-browser.md) section 6 |

```prisma
enum ClipPlatform     { YOUTUBE TWITCH KICK UPLOAD }
enum ClipVideoKind    { VIDEO PAST_STREAM CLIP SHORT UPLOAD }
enum ClipVideoStatus  { IMPORTING READY FAILED REMOVED }
enum ClipStatus       { NEW DRAFT HIDDEN }
enum ClipOrigin       { MANUAL AI_SIGNALS }                    // AI_TRANSCRIPT arrives in Sprint 13
enum ClipAssetKind    { ORIGINAL PROXY ANALYSIS_AUDIO FILMSTRIP WAVEFORM POSTER SIGNALS SEGMENT STICKER AUDIO DOWNLOAD PROOF }   // TRANSCRIPT, FACE_TRACKS in Sprint 13
enum ClipJobKind      { IMPORT SEGMENT HIGHLIGHTS RENDER DOWNLOAD }
enum ClipJobStatus    { QUEUED RUNNING DONE FAILED CANCELLED }

model ClipVideo {
  id                 String          @id @default(uuid())
  organizationId     String
  platform           ClipPlatform
  kind               ClipVideoKind
  externalId         String?                                   // the platform's id; null for uploads
  canonicalUrl       String?
  title              String
  channelName        String?
  durationMs         Int?
  width              Int?
  height             Int?
  fps                Float?
  hasAudio           Boolean         @default(true)
  status             ClipVideoStatus @default(IMPORTING)
  error              Json?                                     // { code, message }, one sentence, never a tool's output
  hdAvailable        Boolean         @default(true)            // false once a sharp fetch finds the platform copy gone
  rightsConfirmedAt   DateTime?
  rightsConfirmedById String?
  rightsTextVersion   Int?
  lastUsedAt         DateTime        @default(now())
  expiresAt          DateTime?
  removedReason      String?                                   // 'expired' | 'deleted' | 'rights_request'
  createdById        String?
  deletedAt          DateTime?                                 // files are deleted; the row and its rights record stay
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt
  organization       Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId, deletedAt])
  @@index([organizationId, platform, externalId])              // dedup is checked in a serializable transaction
  @@index([expiresAt])
}

model ClipAsset {
  id             String        @id @default(uuid())
  organizationId String
  videoId        String?
  clipId         String?
  kind           ClipAssetKind
  key            String        @unique                         // a storage key in the private space
  bytes          BigInt
  mimeType       String?
  meta           Json?                                         // per kind: { height, fromMs, toMs }, { tileSeconds, columns }, { name, tags } for uploads
  createdAt      DateTime      @default(now())
  @@index([organizationId])
  @@index([videoId, kind])
  @@index([clipId, kind])
}

model Clip {
  id                    String     @id @default(uuid())
  organizationId        String
  videoId               String
  title                 String
  status                ClipStatus @default(DRAFT)
  origin                ClipOrigin @default(MANUAL)
  score                 Int?                                    // 0 to 100, AI clips only
  reasons               String[]   @default([])
  highlightRunId        String?
  document              Json                                    // ClipDocument
  revision              Int        @default(1)                  // optimistic lock, as Design
  ratio                 String                                  // copied from the document for lists
  durationMs            Int                                     // output length, copied from the document
  lastExportedRevision  Int?
  lastExportedFingerprint String?                               // a hash of what the export drew, so a rename does not make it look out of date
  exportedMediaId       String?
  brandKitId            String?                                 // reserved for Sprint 13
  presetId              String?                                 // reserved for Sprint 13
  createdById           String?
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt
  @@index([organizationId, status])
  @@index([videoId])
}

model ClipHighlightRun {
  id              String        @id @default(uuid())
  organizationId  String
  videoId         String
  status          ClipJobStatus @default(QUEUED)
  engineVersion   Int
  tracks          String[]      @default([])                    // which signal tracks were used
  params          Json
  aiMinutesCharged Int          @default(0)                     // whole AI minutes, from the usage ledger
  usageEntryId    String?                                       // the UsageEntry, so a failure can reverse it
  found           Int           @default(0)
  createdById     String?
  createdAt       DateTime      @default(now())
  finishedAt      DateTime?
  @@index([videoId, createdAt])
}

model ClipJob {
  id             String        @id @default(uuid())
  organizationId String
  kind           ClipJobKind
  status         ClipJobStatus @default(QUEUED)
  stage          String?
  progress       Int           @default(0)                     // 0 to 100
  videoId        String?
  clipId         String?
  highlightRunId String?
  input          Json                                          // typed per kind; a RENDER holds a frozen copy of the document, the quality, the watermark and proof
  output         Json?
  error          Json?
  createdById    String?
  createdAt      DateTime      @default(now())
  startedAt      DateTime?
  finishedAt     DateTime?
  expiresAt      DateTime?                                     // downloads and previews
  @@index([organizationId, kind, status])
  @@index([status, createdAt])
}

model ClipPost {                                               // written by Send To Composer and the media picker; "Scheduled" is read through it
  id        String   @id @default(uuid())
  clipId    String
  postGroup String
  mediaId   String
  createdAt DateTime @default(now())
  @@index([clipId])
  @@index([postGroup])
}

model ClipLayoutPreset {
  id             String   @id @default(uuid())
  organizationId String
  name           String
  ratio          String
  layout         Json
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([organizationId])
}
```

`Media` gains `durationMs Int?`, `fps Float?` and `origin String?` (`'upload' | 'ai' | 'studio' | 'clip'`); exported clips also fill the existing `thumbnail`, `width` and `height`, which are empty for video today. "Exported" and "Scheduled" are never stored on a clip: they are read from the last export's record and `ClipPost`. Later modules add small things with their own migration: `ClipJob.priority` (Module 02, copied from `clips.queue_priority`), and `ClipVideo.expiryNoticeAt` and the `ClipBlockedVideo` table (Module 19). `SCHEMA_NOTES.md` gets a "Sprint 12 additions" entry.

## API Routes

All under `apps/api/src/modules/clips` (and the two noted modules), authenticated, `@Roles(Role.ADMIN, Role.USER)` unless noted, Zod `.strict()` schemas through `ZodBody` and `ZodQuery`, tenancy through `@CurrentOrg()`. Another workspace's id always answers 404.

| Route | Answers |
|---|---|
| `GET /entitlements/me` (entitlements module) | `{ tier, status, trialEndsAt, values, meters }` for the active workspace: every plan value and every meter with `used`, `limit`, `remaining`, `cycleStart`, `cycleEnd`. The browser uses it to lock tiles and write chips; the server re-checks everything. `Cache-Control: private, max-age=15` |
| `GET /clips/status` | `{ status: { simulation, platforms: { youtube, twitch, kick }, usage: { storageBytes } } }` (limits and meters come from `GET /entitlements/me`) |
| `POST /clips/links/probe` | `{ url }`; `{ link: LinkInfo }`; 422 `link_unsupported`, `link_not_a_video`, `link_private`, `link_live`, `link_not_found`; 402 `clips_video_too_long`, `clips_not_in_plan`; 503 `platform_resting`, `platform_paused`; 429 `probe_throttled` (10 a minute per workspace) |
| `GET /clips/channels`, `POST /clips/channels`, `DELETE /clips/channels/:id`, `POST /clips/channels/:id/refresh` | The workspace's channels; add by `{ platform, handle }` (422 `channel_not_found`; 402 `channel_limit`); remove; drop the cache (one every 30 seconds) |
| `GET /clips/channels/:id/items?kind&cursor&sort&period&showHidden` | One page of 50 `ListedItem`s; 503 `channel_listing_failed` |
| `PUT /clips/channels/:id/hidden/:externalId`, `DELETE /clips/channels/:id/hidden/:externalId` | Hide and unhide a listed item |
| `POST /clips/videos` | `{ url, rightsConfirmed: true }`; 201 `{ video, job }`, or 200 `{ video, existing: true }`; 422 `rights_required`; 402 `clips_minutes_used`, `clips_storage_full`, `clips_video_too_long` |
| `POST /clips/videos/sample` | Adds the PostGear sample video; `{ video }` |
| `POST /clips/videos/uploads`, `POST /clips/videos/uploads/:uploadId/parts`, `POST /clips/videos/uploads/:uploadId/complete` | Multipart upload in parts: `{ name, bytes, mimeType }` to start, part addresses, then `{ video, job }`; 422 `upload_not_video`; 402 `clips_upload_too_big` |
| `GET /clips/videos?page&sort` | `{ videos, page, total }` |
| `GET /clips/videos/:videoId` | `{ video, playback: { url, expiresAt }, filmstrip, waveformUrl, job, clips }` |
| `POST /clips/videos/:videoId/retry`, `POST /clips/videos/:videoId/cancel`, `DELETE /clips/videos/:videoId` | `{ video, job }`, `{ message }`, `{ message }` |
| `GET /clips/jobs/:jobId`, `GET /clips/jobs/:jobId/events` (SSE) | `{ job }`; events `progress`, `done`, `failed` |
| `POST /clips/videos/:videoId/highlights` | 202 `{ run, job, aiMinutes }`; 402 `clips_ai_minutes_used`; 409 `highlights_running` |
| `GET /clips?status&videoId&source&page&sort` | `{ clips, counts: { all, new, drafts, exported, scheduled, hidden }, page, total }` |
| `POST /clips` | `{ videoId, fromMs, toMs }` (3 seconds to 30 minutes); 201 `{ clip }`; 422 `clip_range_invalid` |
| `GET /clips/:clipId` | `{ clip, video, playback, sharp: 'ready' \| 'fetching' \| 'gone' }` |
| `PATCH /clips/:clipId` | `{ revision, document?, title?, status? }`; `{ clip }`; 409 `clip_changed_elsewhere`; 422 when the document fails the schema |
| `POST /clips/:clipId/duplicate`, `DELETE /clips/:clipId` | `{ clip }`, `{ message }` |
| `POST /clips/:clipId/more-video` | `{ fromMs, toMs }`; 202 `{ job }` (a wider sharp range) |
| `POST /clips/:clipId/exports` | `{ quality: '720p' \| '720p60' \| '1080p' \| '1080p60', proof?: boolean }`; 202 `{ job }`; 402 `clips_quality_requires_plan` (a proof never needs a quality); 409 `export_running` |
| `POST /clips/:clipId/send` | `{ channelIds, caption }`; `{ group }`; 409 `clip_not_exported` |
| `GET /clips/exported?sort&page`, `GET /clips/coming-up` | The exported clips for the media picker's **Clips** tab; the posts of the next 14 days that use a clip |
| `POST /clips/downloads` | `{ url, formatId, rightsConfirmed: true }`; 202 `{ job }`; 402 `clips_downloads_today` |
| `GET /clips/downloads`, `GET /clips/downloads/:jobId/file`, `POST /clips/downloads/:jobId/save-to-media` | `{ downloads }`; a redirect to a signed address; `{ media }` |
| `GET /clips/library/sounds`, `GET /clips/library/stickers` | `q`, `kind`, `category`, `favourites`, `page`, `pageSize`; `{ items, page, pageSize, total, hasMore }` (only `ACTIVE` items); 60 requests a minute per workspace |
| `GET /clips/library/categories`, `PUT /clips/library/favourites`, `DELETE /clips/library/favourites/:type/:itemId` | The chips with counts; star and unstar for the workspace |
| `GET /clips/library/credits` (public) | The grouped credits behind `/credits/clips` |
| `POST /clips/sounds/uploads`, `POST /clips/stickers/uploads` | The workspace's own sounds (up to 20 MB) and pictures (up to 8 MB); `{ asset }`; never enter the library |
| `GET /clips/layouts`, `POST /clips/layouts`, `PATCH /clips/layouts/:id`, `DELETE /clips/layouts/:id` | Saved layouts |
| `POST /internal/clips/exports/finish` (worker only, `InternalTokenGuard`) | `{ jobId, key, posterKey, facts }`; creates the `Media` row and the notification. A `proof` job finishes through the same route and stores only the file key |
| `GET /operator/entitlements/plans`, `PUT /operator/entitlements/plans`, `GET /operator/workspaces?q`, `GET /operator/workspaces/:orgId/entitlements`, `PUT` and `DELETE /operator/workspaces/:orgId/overrides/:key`, `GET /operator/workspaces/:orgId/usage`, `POST /operator/workspaces/:orgId/usage/adjust`, `GET /operator/changes` | The operator screen's API (admin module). Operators only (`PlatformAdminGuard`, and in production the address must be in `OPERATOR_EMAILS`); the workspace id is a path parameter and the org cookie is ignored; every write needs a `reason`. The library routes (runs, items, hide, remove, searches that found nothing) sit beside them |
| `DELETE /admin/clips/videos/:videoId` (operators) | Removes a video after a rights request |

Messages live in `clips.messages.ts` and `entitlements.messages.ts` in plain words ("This stream is still live. Come back when it has ended."). `GET /billing/plans` gains the Clips lines of each plan from the same values, so the plan cards never disagree with Clips.

## Plans, Entitlements And AI Minutes

Limits are not in `plans.ts`. `plans.ts` keeps price, channels, AI credits, members and copy, exactly as today. Everything Clips limits lives in the entitlement system designed in [`../sprint-12/research/12-plans-entitlements-and-usage.md`](../sprint-12/research/12-plans-entitlements-and-usage.md), built by Module 01 (the registry, tables, resolver, usage service and seed) and Module 19 (the operator screens).

**The pieces.** A code **registry** (`packages/entitlements`) declares each key once: type (boolean, number, enum or meter), unit, default (the safest value, the Free one), limits and a refusal code. Values per plan are rows in `PlanEntitlement`; a workspace deal is a row in `OrgEntitlementOverride` with an end date (required, at most 366 days ahead) and a reason; every edit adds a row to the append-only `EntitlementChange`. **Resolution order**: an override that has not ended, then the plan's stored value, then the registry default. The tier comes from the existing `resolveEntitlement` (a trial is `PRO`). Values are cached in process for 15 seconds and a Redis stamp makes an edit show within about a second. `EntitlementResolver` (`get`, `assert`, `meter`, `previewTier`, `snapshot`) is the only way Clips reads a limit: never `plans.ts`, never a constant. `ENTITLEMENTS_SOURCE=seed` answers from the seed in an emergency.

**The defaults** (placeholders the operator edits; the registry declares the keys and the seed holds these values):

| Key | FREE | STANDARD | PRO | TEAM | ULTIMATE |
|---|---|---|---|---|---|
| `clips.enabled` | true | true | true | true | true |
| `clips.max_video_minutes` | 60 | 180 | 360 | 360 | 360 |
| `clips.import_minutes_per_month` (meter) | 180 | 900 | 2400 | 7200 | 18000 |
| `clips.storage_gb` | 3 | 15 | 50 | 150 | 400 |
| `clips.retention_days` | 7 | 14 | 30 | 30 | 60 |
| `clips.export_max_quality` | 720p | 1080p | 1080p60 | 1080p60 | 1080p60 |
| `clips.export_watermark` | true | false | false | false | false |
| `clips.ai_minutes_per_month` (meter) | 30 | 300 | 900 | 3000 | 10000 |
| `clips.concurrent_imports` | 1 | 2 | 2 | 3 | 4 |
| `clips.upload_max_gb` | 2 | 2 | 2 | 2 | 2 |
| `clips.downloads_per_day` (daily meter) | 5 | 20 | 20 | 50 | 100 |
| `clips.queue_priority` | low | normal | normal | high | high |
| `clips.browse_channels` | 1 | 3 | 5 | 10 | 20 |

`clips.export_max_quality` is ordered 720p, 720p60, 1080p, 1080p60, with 4k listed and reserved (the plan editor refuses to store it). Storage and concurrency are gauges: the module that owns the rows measures them and the resolver only supplies the limit.

**What reads what** (the full table with sentences is research 12 section 13):

| Check | Key | Enforced in | Refusal code |
|---|---|---|---|
| Whole feature | `clips.enabled` | one guard on the Clips routes (Module 01) | `clips_not_in_plan` |
| Video length | `clips.max_video_minutes` | probe and import (Module 04) | `clips_video_too_long` |
| Import minutes | `clips.import_minutes_per_month` | import, one charge per job (Module 04) | `clips_minutes_used` |
| Video space | `clips.storage_gb` | import, upload start, wider ranges, uploads of stickers and sounds (Modules 04, 12, 14, 19) | `clips_storage_full` |
| Upload size | `clips.upload_max_gb` | upload start and complete (Module 04) | `clips_upload_too_big` |
| Retention | `clips.retention_days` | when the expiry date is set (Modules 04 and 19) | none |
| Export quality and mark | `clips.export_max_quality`, `clips.export_watermark` | the export route; copied into the job so a plan change cannot alter a running render (Module 15) | `clips_quality_requires_plan` |
| AI minutes | `clips.ai_minutes_per_month` | Find Clips (Module 16); Sprint 13 steps | `clips_ai_minutes_used` |
| Downloads a day | `clips.downloads_per_day` | the download route (Module 18) | `clips_downloads_today` |
| Imports at once, queue priority | `clips.concurrent_imports`, `clips.queue_priority` | the job scheduler (Module 02); extra jobs wait, they are not refused | none |
| Channels to browse | `clips.browse_channels` | adding a channel (Module 03 server, Module 06 UI) | `channel_limit` |

Every refusal is a 402 with a snake_case `code` and whole-number `details`; the web shows the sentence and **See Plans** (the same pattern as the Studio premium lock). A downgrade never deletes anything: over-limit workspaces are refused new work until they are under the limit.

**The AI Minutes meter.** The old plan gave Clips a credit type (`clip_highlights`); that is gone. One AI minute is one minute of video that an AI step works on. Prices are constants in `packages/video-engine/src/pricing.ts`, `aiMinutesCost(kind, ms)`; the price is `ceil(minutes x rate)`, never less than 1:

| Step | Rate | Used by |
|---|---|---|
| `signals` | 0.25 per video minute | Sprint 12 **Find Clips** (loudness, scenes, chat). A run that also listens, in Sprint 13, includes this free |
| `listen` | 1.0 per video minute, minimum 2 | Sprint 13 speech to text |
| `read` | 0.25 per video minute | Sprint 13, the model picking moments from the transcript |
| `action` | 0.5 per video minute | Sprint 13 Look For Action |
| `translate` | 0.25 per clip minute | Sprint 13 |
| `voice` | 1 per 1,000 characters | Sprint 13 text to speech |

Following the speaker and finding the camera are free, and a stretch is charged once per step. A 60 minute video costs 15 AI minutes to search; the label reads "Find Clips (15 AI Minutes)" and the chip "38 of 300 AI minutes left". Each charge goes through `UsageService.consume` with an idempotency key made from the job id (`clips.ai:signals:<jobId>`), so a double press or a replayed activity charges once; a failure reverses the entry (`reverse`), and the cycle comes from the same `cycleFor` the AI credits use. The sentence at the limit is "This workspace has used all its AI minutes for this month. They reset on 1 December." Import minutes work the same way (key `clips.import:<jobId>`, charged at the probed length).

**Who edits what.** Only an operator edits plan values, overrides and usage, through `/operator`; every write needs a reason and appears in the Change Log. A workspace admin sees values and meters but changes none. Existing AI credits (text and image AI) are untouched this sprint.

## Simulation

`CLIPS_SIMULATION=true` (new, in the API and the worker, refused when `NODE_ENV=production`, documented in `.env.example`) binds the downloader to a fixture resolver that knows made-up links for each platform and answers with two generated sample videos; the signal producers to recorded tracks, so the same clips are found each time; the channel lister to fixtures (the channel `acme` on Twitch and Kick and `@acme` on YouTube, about 30 items each, including one live, one still processing and one near expiry); the sticker and sound library to a small fixture set (about 30 stickers and 20 sounds made by FFmpeg and the repo's own art, with real licence rows) so search, categories, favourites and credits all work offline. **The render is real**: the compiler and FFmpeg run on the sample, so Preview Export, the export and the parity tests are all genuine. yt-dlp and the network are not needed; FFmpeg is. The library ingest command never runs in simulation and needs `CLIPS_LIBRARY_INGEST=true` by hand. Plan changes in the real-test pass run through `BILLING_SIMULATION`. Every screen, the e2e suite and the hand checks run on it. Unit tests always inject fakes.

## Task Breakdown

Ordered checklist; each phase ends with `verify-change`. The phases are the modules in [`../sprint-12/clips-implementation-docs/README.md`](../sprint-12/clips-implementation-docs/README.md).

1. **Contracts and data** (Module 01, L): the branch, `packages/video-engine` with the document schema and the time map, `packages/entitlements` (the registry, validation, resolution, cycle, messages), the resolver and usage service, `GET /entitlements/me`, all the tables above (Clips, entitlements and usage, library, channels) with the seed, queue names in `packages/scheduling`, env flags, the rail entry and an empty page.
2. **Media runtime** (Module 02, L): `packages/storage` with the private space and signed addresses, `packages/media-tools` with the safe process runner and the doctor, worker roles and queues, the job row, its priority and its events stream, the reconcile, simulation wiring, MinIO setup.
3. **Link engine** (Module 03, L): link recognition, probe to `LinkInfo`, the `Downloader` with its per-platform range strategy, the `ChannelLister` with its Twitch Helix, YouTube Data API, yt-dlp flat and simulated bindings, fixtures, the error list, a real-network spike report.
4. **Import pipeline** (Module 04, L): the import routes and workflow, the proxy, analysis audio, filmstrip, waveform and poster, own-file upload in parts, dedup, cancel and retry, the import minutes meter and its reversal, the notification types.
5. **Thin slice** (Module 05, L, Demo 1): the FFmpeg render path (`frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`, the executor), a fullscreen render, the sharp range fetch, the exact cut, the font build and manifest, the render workflow to a `Media` row, `/dev/clips`, the host benchmark.
6. **Clips home and videos** (Module 06, L): the page and five tabs, the link card with the rights tick, My Channels and the Streams tab, Try A Sample, the Videos tab with live progress and time left, the storage meter and the AI minutes chip.
7. **Manual clipping and the clips library** (Module 07, L, Demo 2): the video page with our player and timeline, mark in and out, Create Clip, Edit Whole Video, the Clips tab with its filters, the Source filter and the list or grid view.
8. **Editor shell** (Module 08, L): the full-window route, the `video-preview` engine, the store with undo and redo, autosave with the revision lock, the leave guard, the shape dialog.
9. **Timeline** (Module 09, L): tracks, the filmstrip and waveform, trim, split, delete, snapping, more video past the handles, shortcuts and the shortcuts sheet.
10. **Layouts and crops** (Module 10, L, Demo 3): the seven layout presets and the Fit crop ratio, crop boxes with snapping, saved layouts.
11. **Canvas handles and text** (Module 11, L): move, resize and turn on the clip, text with the Studio fonts drawn through ASS, the colour picker.
12. **Stickers and GIFs** (Module 12, L): the sticker catalogue (the ingest, the licence guard, search, categories, favourites, uploads), the follow badge, the credits page.
13. **Effects** (Module 13, M): zoom, speed, Looks, fades and the vignette.
14. **Sound** (Module 14, L): the sound catalogue (the ingest, search, categories, favourites, uploads), volumes, fades, the loudness pass on export.
15. **Export** (Module 15, M, Demo 4): qualities including 720p 60, plan locks from the resolver, the mark, Preview Export, progress, notifications, the out-of-date notice.
16. **AI highlights** (Module 16, L, Demo 5): the signal producers, the pure scorer, the run, the AI minutes charge and reversal, the Find Clips flow.
17. **Send to composer** (Module 17, M): the dialog, video rules per platform in `social-core`, the draft post, `ClipPost`, the **Clips** tab in the media picker, the **Coming Up** panel.
18. **Download in any format** (Module 18, M): the format list, the download job, the Downloads tab, Save To Media, downloads a day.
19. **Retention, quotas, safety and the operator screens** (Module 19, XL): expiry and cleanup, the limits everywhere through the resolver, abuse limits, the operator removal route, poster and length for older videos in Media, `PlatformAdminGuard`, `OPERATOR_EMAILS`, the Plans, Workspace Overrides, Usage, Change Log and Library screens, the daily override expiry and reconcile report.
20. **Hardening, e2e, worker image, closeout** (Module 20, L): security sweep including the entitlement abuse cases, edge cases from the stories' section 5, `e2e/clips.spec.ts` and `e2e/operator.spec.ts`, the worker image (Debian slim, FFmpeg, yt-dlp, Deno, fonts, no Chrome), the local testing guide, the screenshot coverage re-check, the completion checklist via `sprint-closeout`.
21. **P2** (Module 21, S, only when Arvind decides): smooth speed ramps, 4K, a commercial sticker provider, reverse and freeze, transitions, auto-import from a connected channel, a browser-side render, Safari.

## Definition Of Done

Evidence for each line goes in the completion checklist when the sprint closes.

- [x] Clips opens from the rail with the five tabs; below 1366 px it shows its one sentence. **Verified in simulation** (Module 06; the sentence pinned in `clips-edge-cases.test.tsx`).
- [x] A YouTube, a Twitch and a Kick link each show the link card within about 10 seconds; private, live, missing, unsupported and too-long links each show their sentence; nothing is fetched while typing. **Built and verified in simulation**: no real platform link was ever fetched.
- [x] My Channels: a Twitch and a YouTube channel can be added by name, their streams are listed, **Import** hands the choice to the link card with the rights tick, a live stream cannot be imported, a hidden row stays hidden, and a missing channel, an empty channel and a used-up listing allowance each show their sentence. **Built and verified in simulation** (Module 06 pass, forcing channels from Module 20).
- [x] Import needs the rights tick, stores who ticked it and when, shows progress in words without a reload, survives a closed browser, can be cancelled and retried, and never imports the same video twice. **Verified in simulation** (Modules 04 and 06; the worker image ran one too).
- [ ] An uploaded file up to the plan's upload size (2 GB by default) comes in through a resumable upload and is checked as a real video before any tool reads it. **Partly**: a 3 minute file came in live through the resumable upload and the probe; the 2 GB cap is tested, but no 2 GB file was ever sent.
- [ ] Imported videos live in private storage and play only through signed addresses that expire; another workspace's ids answer 404; production runs on S3-compatible buckets. **Partly**: private storage, expiring signed addresses and the 404s are verified on the local disk; the S3 binding is tested against a fake and has never run against a real bucket.
- [x] The video page plays with our controls and a timeline with pictures and the sound's shape; I and O mark a range, Create Clip makes a clip, and Edit Whole Video opens a clip over the whole video. **Verified in simulation** (Module 07 browser pass).
- [x] Find Clips charges AI minutes before the run (price in the label), shows its steps, and returns scored clips with reasons from loudness, scene changes and (when it can be read) Twitch chat; a failed run gives the minutes back; a repeated press charges once; the scorer works with any subset of tracks. **Verified in simulation** (Module 16); Twitch chat only from the recorded file.
- [x] The editor opens full window; vertical, horizontal and square work; trim, split, delete, undo, redo, autosave with the revision lock and the leave guard all work; the shortcuts sheet lists every shortcut. **Verified in simulation** (Modules 08 and 09).
- [x] Fullscreen, Blurred (with its crop ratio), Split, Three, Four, Gameplay and Screen Share layouts work with draggable crop boxes; a layout can be saved for the workspace. **Verified in simulation** (Module 10, exported and compared).
- [x] Text (Studio fonts), library stickers and GIFs, and uploaded pictures can be placed, moved, resized, turned and timed; sticker and sound search finds items by name, tag and category, favourites are kept per workspace, every library item shows its licence evidence, and the credits page lists every source. **Verified in simulation** (Modules 11 and 12); the catalogue is our own 193 stickers until the outside packs are fetched.
- [x] Zoom, speed, Looks and fades work in the editor and in the export; a sticker, a text or a sound effect stays on its moment of the video when the clip is trimmed, cut or sped up, and music stays where it is. **Verified in simulation** (Module 13, compared with `clips:stills`); the sound at other speeds not listened to.
- [x] Sound effects, music and own sounds can be added with volume and fades; exports are evened to the loudness target. **Verified in simulation** (Module 14, -14.0 LUFS); our own 92 sounds.
- [x] **Preview Export** renders the whole clip through the same compiler at a small size, plays it in a dialog, uses no meter and no `Media` row, and the checked frames of its output match what `frameState` predicts; the parity tests render real frames and compare them with `frameState`. **Verified** (Module 15); the 35 parity tests pass locally and skip in CI (no pinned FFmpeg there).
- [x] Export runs on its own queue one at a time, shows its steps and the time left, survives a closed browser, puts an MP4 with a poster and its length in Media, and sends the notification; the exported sample matches the editor closely on the checked frames and Preview Export shows it exactly. **Verified in simulation** (Modules 05 and 15, and through the worker image on 2026-11-19).
- [x] Locked qualities show the plan dialog; the Free plan's mark is added by the server; every limit refuses with its sentence. **Verified** (Module 15 on the Free workspace; `limits-audit.spec.ts`).
- [x] An operator can change a plan value in `/operator` and the next check by a workspace on that plan obeys it within seconds; an override with an end date is obeyed and then ignored when it ends; every change is in the Change Log; a non-operator gets a plain "not found". **Verified** (Module 19 browser pass, `plan-change.spec.ts`).
- [x] The AI minutes and import minutes ledgers are idempotent (the same key charges once), failures and cancels are reversed, the used minutes equal the work done, and the daily reconcile finds no charge without a job. **Verified** (usage specs, the backstop, and the real-Postgres load test: 3 charged, 17 refused, run locally).
- [x] Send To Composer creates a draft with the clip, refuses channels the clip does not fit with a reason, and the clip then shows as Scheduled; the media picker's **Clips** tab attaches an exported clip; **Coming Up** lists the next 14 days. **Verified in simulation** (Module 17, posted to the stand-in).
- [x] A linked video can be downloaded in a chosen quality or as audio, within the day's download limit; the file is kept 24 hours behind a signed address. **Verified in simulation** (Module 18).
- [x] Videos are removed after the plan's period with a notice three days before; an operator can remove one after a rights request; a platform can be paused by one setting; a hidden or removed library item never changes a clip silently. **Verified** (Module 19 browser pass; `library-hidden.edge.test.ts`).
- [x] No outside program is ever started with a shell string; yt-dlp runs with an extractor allowlist and size and length limits; uploads are probed before FFmpeg opens them; the graph is passed as `-/filter_complex graph.txt`; a missing font fails with `font_missing`. **Verified** (the Module 20 security sweep, a test per rule).
- [x] The screenshot coverage audit ([`../sprint-12/research/13-screenshot-coverage.md`](../sprint-12/research/13-screenshot-coverage.md)) is re-read against the finished build and every screen is still Covered, Existing, Parked or Not Planned. **Done** 2026-11-19: re-read, no row moved.
- [x] `CLIPS_SIMULATION=true` runs every screen with no network; `e2e/clips.spec.ts` and `e2e/operator.spec.ts` pass under it; unit tests cover the engine, the compiler, the entitlements, the tools with fakes and the API; `npm run validate` is green. **Verified in simulation** 2026-11-19: `clips.spec.ts` 19 of 19, `operator.spec.ts` 3 of 3 and `clips-limits.spec.ts` 3 of 3 (three app bugs found and fixed first); `npm run validate` 71 of 71 tasks, 12,740 tests passed, 31 skipped. CI runs no e2e spec yet.
- [x] Light, dark and Lilac checked at 1366 px and 1920 px; the title-case test is green; no em dash and no middle dot anywhere. **Verified** (the Module 20 look pass; the title-case test is green; no banned character in the project's files).

## Deviations

Changes to the first plan of 2026-11-14 (FFmpeg only, entitlements, the open libraries, AI minutes, My Channels, S3) are decisions, not deviations: they are in the Decision Ledger and the module index's Decision Log, which holds every choice made while building (about 320 rows). These are the places where the finished build differs from this document or from a module doc, with the reason:

- **The clip document keeps Module 01's shapes.** A text item has `style.font` (a family name), `outline` or `background`, and fades on the item, not the module doc's `fontId` and `backing`; a sticker's `ref` is `{ library, id }`, `{ asset }` or `{ badge, name }`, not `art: { source, ... }`. The schema, the validator and the compiler already read these shapes (Modules 11 and 12).
- **Own handle layer, no react-moveable.** The move, resize and turn handles are a small pure model (`transform-model.ts`) with a thin layer on top. It works in the stage's scale and the document's rotation directly and is fully unit tested (Module 11).
- **One Temporal activity per heavy job.** `clipImport` and `clipRender` run their steps (fetch, proxy, poster, filmstrip, waveform; prepare, render, finish) inside one scratch folder, rather than one activity per step, so a retry always starts clean (Modules 04 and 05).
- **`not_original` became `needs_review`** in the library: an item that is not proven own work waits for a person instead of being refused (Module 14).
- **Select A Clip reads `withExport=true`**, not `status=exported`, so a scheduled or changed clip that still has a file can be posted (Module 17).
- **yt-dlp is pinned in the worker image** (2026.10.26, by checksum), and the update path is the `YTDLP_SELF_UPDATE` switch, off by default. The Risks below ask for "a minimum version and an update path, not a fixed pin": the pin makes the image reproducible, the switch lets an operator take platform fixes between builds (Module 20).
- **Row 19 of the edge cases keeps the Module 07 sentence** ("Edit Whole Video works for videos up to 30 minutes. Mark a range to make a clip.") over the story's wording; a test pins it (Module 20).
- **The operator menu item shows for every superadmin.** In production a superadmin outside `OPERATOR_EMAILS` sees it and gets the plain 404, because only the API holds the allow-list (Module 19).
- **The overrides ending in 7 days are worked out when the Plans tab is read**, not stored by the daily sweep (Module 19).
- **Some checks run only on a machine that has the tools, not in CI:** the render parity tests (CI has no pinned FFmpeg with libass; they skip with a warning), the ledger load test (CI has no Postgres; it shows as skipped and runs with `CLIPS_LEDGER_DB_TEST=1`) and the worker image proof (`docker compose --profile worker-image`). All three passed locally on 2026-11-19 (Module 20).

**Changed later by Sprint 13** (each in [Sprint 13's Deviations](sprint-13-clips-ai.md#deviations) and its Decision Log): version 1 clips gain 15 ms sound fades at real cuts (the regression set still passes); every Clips job is started by one scheduler with slots per class, and the worker's `WORKER_MEDIA_CONCURRENCY` default is 6; channel connect needs a workspace role, so a request with no workspace answers 403; "This job was not found." became the shared "We could not find this. It may have been removed." in the Sprint 13 services that still said it.

## Risks

See [`../sprint-12/research/07-legal-limits-cost-and-risks.md`](../sprint-12/research/07-legal-limits-cost-and-risks.md) for the register. The ones that shape the build:

- **Platforms can refuse our server at any time**: a switch per platform, a proxy and cookies setting, the upload path always offered. yt-dlp must be kept current (a minimum version and an update path, not a fixed pin).
- **Preview parity**: the editor's preview is a second implementation of the look, so it can drift from the export (a different crop, wrapped text, a look that is a shade off). Guards: `frameState` as the one set of numbers, compiler and parity tests that render real frames, Preview Export, and the softened promise ("matches closely").
- **Render speed on the real host**: the laptop figures (1080p30 about 0.7 times real time) are not the host's. Module 05 benchmarks the real host before limits are set; until then plan for 1.5 to 3 times the clip's length.
- **Library licence drift**: a CC0 item can turn out to be someone else's work, and a source can change its terms. Guards: the licence guard and evidence per item, nothing from open sources published without a reviewed sample, hide within the hour, remove and deny list, and Openverse and Freesound only after written permission.
- **Entitlement misedit**: a wrong plan edit can lock paying workspaces out. Guards: validation, a review dialog with a reason, the append-only Change Log, **Reset To Seed**, `ENTITLEMENTS_SOURCE=seed`, and the production operator list.
- **Meter drift**: a charge with no matching work. Guards: idempotency keys from job ids, a reversal in `finally`, an hourly backstop and a daily reconcile report.
- **Twitch and YouTube listing quotas and terms**: a Twitch application brings the developer agreement (24 hour cache limit), YouTube's key has a daily quota that Discover shares, and Kick has no official route. Guards: a dedicated Twitch app and a separate Google project, caches of at most 24 hours, a cap on Clips' share of the YouTube quota, yt-dlp flat listing as the fallback, Kick off until its spike passes.
- **Holding other people's video is a legal exposure Arvind has accepted**: rights record, private storage, short retention, a takedown path, and YouTube import off in production until the legal read.
