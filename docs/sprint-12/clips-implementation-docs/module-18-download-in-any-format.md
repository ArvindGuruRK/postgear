# Module 18: Download In Any Format

> **Sprint 12, Clips** | Status: Done with gaps (2026-11-19) | Size: M (one session)
> **Depends on**: [Module 03](module-03-link-engine.md), [Module 06](module-06-clips-home-and-videos.md)
> **Stories**: CL-12.1, CL-12.2
> **Next**: [Module 19](module-19-retention-quotas-and-safety.md)

## Goal

After this module the link card's **Download** works: it lists the qualities the link offers (1080p, 720p, 360p, Audio Only), prepares the chosen file on the server with progress, and offers it for 24 hours in the **Downloads** tab with **Save File** and **Save To Media**. Uploaded videos get **Download Original**. This lives inside the signed-in app only; there is no public downloader page.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 3 (the Download menu), 4 (the download row), 11.
- User stories: CL-12.1, CL-12.2; Journey C step 5; section 5 (a quality that is gone).
- Sprint doc: API Routes (downloads); Jobs And Queues (DOWNLOAD).
- Research: [`04-link-import-and-fetch.md`](../research/04-link-import-and-fetch.md), the format section (which YouTube heights come as one file and which as separate picture and sound that must be joined; format ids are not stable for long, so they are re-read at download time); [`01-reference-products.md`](../research/01-reference-products.md), the VidsSave flow (what we take: the card and the quality row; what we leave: a public page, ads); [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md), "What We Never Do" and the rights record on downloads.
- Code: Module 03's `Downloader.fetchFormat` and `LinkInfo.formats`; Module 02's `PrivateStorage.signedUrl` (with `downloadName`), `ClipJobsService`, `use-clip-job.ts`; Module 04's `ClipLimitsGuard` and Module 01's `EntitlementResolver` and `UsageService`; Module 05's `saveRendered` and the internal finish route; Module 06's `LinkCard` and tabs; `apps/web/src/lib/api.ts` (`downloadFile`).

## Design

### 1. What Can Be Downloaded

- From a link: the entries of `LinkInfo.formats` (Module 03 already reduces them to at most one per height, H.264 with AAC preferred, plus one audio entry). Labels: "1080p", "720p", "360p", each with its size when the platform gives it, and "Audio Only". Video is delivered as MP4; audio as MP3 (converted with FFmpeg).
- From the workspace: an uploaded video's ORIGINAL (**Download Original**), and exported clips (already done in Module 15 through Media).
- Not offered: an imported link's light copy (it is a working file, not a product), and anything above 1080p in this sprint.

### 2. Rules

- A download needs the same rights tick as an import; it is recorded on the job (`input.rights { byUserId, at, textVersion }`), since a download does not create a `ClipVideo`.
- It counts against the plan like an import, so Download is never a way around the import limits. **Downloaded minutes count toward `clips.import_minutes_per_month`**: the video's length is charged to that meter with `UsageService.consume`, key `clips.import:<downloadJobId>` (the job id is made first, so a repeated request charges once), and `clips.max_video_minutes` applies to the length. `ClipLimitsGuard` gains `assertCanDownload`, which reads every number through the resolver (no constant in this module).
- **Downloads per day is a daily meter** (`clips.downloads_per_day`, window midnight UTC to midnight UTC). Each download job charges one unit with key `clips.download:<downloadJobId>`; past the allowance the route answers 402 `clips_downloads_today` with "You have reached today's limit of {n} downloads. It resets at midnight UTC." (`n` is the plan's number).
- At most three downloads being prepared at once per workspace (409 `downloads_busy`: "Three downloads are already being prepared. Wait for one to finish."). That is a fixed safety cap, not a plan value.
- Every refusal here is the typed 402 of Module 01 with its `code` and whole-number `details` (`clips_video_too_long`, `clips_minutes_used`, `clips_storage_full`, `clips_downloads_today`), and the web shows the sentence with **See Plans**.
- Prepared files are kept for 24 hours, count toward the workspace's video space while they exist, and are removed by Module 19's cleanup (this module removes them on expiry lazily too: a request for an expired file answers 410 with "This download has expired. Prepare it again.").
- The platform switch and the breaker from Module 03 apply.

### 3. Routes

- `POST /clips/downloads` `{ url, formatId, rightsConfirmed }`: recognise and probe on the server (cached), find the format by `formatId` (422 `format_gone`, "This quality is no longer offered for this video. Pick another.", when it is not in the fresh probe), run the rules, create a DOWNLOAD job with input `{ link, formatId, label, title, durationMs, rights }` and `expiresAt` 24 hours after it finishes, start it, answer 202 `{ job }`.
- `POST /clips/videos/:videoId/download-original`: for uploads only; answers `{ url }`, a signed address for the ORIGINAL with a download name. No job.
- `GET /clips/downloads`: this workspace's DOWNLOAD jobs from the last two days, newest first, as `DownloadView` (`title`, `label`, `state`, `progress`, `bytes`, `expiresAt`, `canSaveToMedia`).
- `GET /clips/downloads/:jobId/file`: checks the job is DONE and not expired, then redirects to a signed address valid for five minutes whose download name is the video's title made safe plus the right extension.
- `POST /clips/downloads/:jobId/save-to-media`: only MP4, only at or under the Media video limit (250 MB today): the worker's small `clipSaveDownloadWorkflow` copies the file to the public media space, makes a poster, and calls the internal finish route with `origin: 'upload'`; answers `{ job }` and the row shows "Saving to Media". Over the limit: 422 "This file is 412 MB. Media takes videos up to 250 MB."
- `DELETE /clips/downloads/:jobId`: removes the row and the file.

### 4. The Workflow (`clipDownloadWorkflow`, `postgear-media`)

| Step | Stage and progress | What it does |
|---|---|---|
| `downloadFetch` | `fetching`, 0 to 85 | `downloader.fetchFormat` to scratch, with the size watcher from Module 03. Separate picture and sound are joined to MP4 by yt-dlp and FFmpeg |
| `downloadFinish` | `fetching`, 85 to 100 | Audio: convert to MP3 (192 kbps). Video: make sure the index is first. `probeFile` to confirm it is what was asked. `putFile` to the private space as a DOWNLOAD asset; write `output { assetId, bytes, ext }`; set `expiresAt` |

Failure: the job FAILED with one sentence ("We could not prepare this file. Try again."); nothing is stored; **both charges are given back** with `UsageService.reverse` (the import minutes and the one download unit; reversal keys `rev:<entryId>`, through the internal route so the worker never holds the ledger). A cancelled or deleted-before-done download is reversed the same way; a finished download is not (no download and delete loop).

### 5. The UI

- `LinkCard`: **Download** (enabled now, still behind the rights tick) opens the `DropdownMenu` of formats. Picking one calls the route, switches to the **Downloads** tab and shows a toast: "Getting your file. We will keep it for 24 hours."
- `DownloadsTab` (`components/clips/home/downloads-tab.tsx`): rows per blueprint section 4, live through `useClipJob` while preparing: the title, the label ("720p", "Audio Only"), "Getting your file, 40%" with a `Progress`, then the size, **Save File** (primary, small; a plain link to the file route so the browser saves it), **Save To Media** (secondary, small, only when `canSaveToMedia`), "Expires in 23 hours" in `type-muted`, and a menu with **Delete Download** (red confirm). Expired rows show "Expired" and only Delete. A YouTube section fetch has no progress number (Module 03), so the row then says "Getting your file" with an indeterminate bar.
- Videos tab: an uploaded video's menu gains **Download Original**.
- Empty and error states per blueprint section 11.

### 6. Tests

- API: the rules through a fake resolver (rights, too long, the import minutes charged once for two identical requests, the daily meter charged once per job and refused past the plan's number with the right sentence, busy, platform paused), `format_gone`, the file route (not done, expired 410, another workspace 404, the download name is safe for odd titles), save to media limits, delete, download original only for uploads.
- Worker: the workflow with a fake downloader (video and audio paths, failure cleans up, both charges reversed once), the MP3 argument builder snapshot.
- Web: the menu lists the formats with sizes, the tab's row states, Save File's link, expiry text, the empty state.

## Scope

**In**: the format menu, the download job and its rules, the Downloads tab, Save File, Save To Media, Download Original.
**Out**: more sites than YouTube, Twitch and Kick (Sprint 13), qualities above 1080p, subtitles and thumbnails as downloads, a public downloader page (never), batch downloads.

## Tasks

- [x] `assertCanDownload` through the resolver; the import minutes charge and the daily downloads meter; the busy cap.
- [x] `POST /clips/downloads`, list, the file route, delete, download original.
- [x] `clipDownloadWorkflow` (video and audio), the reversal of both charges on failure.
- [x] Save To Media: the route, `clipSaveDownloadWorkflow`, the size rule.
- [x] `LinkCard` Download menu, `DownloadsTab`, Download Original in the Videos tab.
- [x] Title-case test green.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/worker/jest.config.js clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/home
```

## Done When

- On a simulation link, Download lists the qualities; picking 720p prepares a file with progress and Save File saves an MP4 that plays.
- Audio Only gives an MP3 that plays.
- The file route refuses another workspace (404) and an expired file (410).
- A download raises the month's import minutes and the day's downloads count in `GET /entitlements/me`; a failed one gives both back; the daily count refuses past the plan's number with its sentence.
- Save To Media puts an MP4 under 250 MB in the Media library with a poster, and refuses a bigger one with its sentence.
- An uploaded video's original downloads with its own name.
- There is no route or page that downloads without signing in.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin:

1. Create tab: paste the YouTube simulation link, tick the box, Download, 720p. The Downloads tab opens with "Getting your file" and a number, then Save File.
2. Save File: the file is named after the video and plays.
3. Download again as Audio Only: an MP3.
4. Save To Media on the 720p one: it appears in Media.
5. Start four downloads quickly: the fourth says three are already being prepared.
5b. On a Free workspace make six downloads over the day (finish each): the sixth says "You have reached today's limit of 5 downloads. It resets at midnight UTC." with See Plans. Raise `clips.downloads_per_day` for FREE in psql and wait a few seconds: the sixth now works.
6. Videos tab, on an uploaded video: Download Original.

## What Was Built (2026-11-19)

- **Engine** (`video-engine/downloads.ts`): `downloadableFormats` (tallest first up to 1080p, then Audio Only), `downloadMenuLabel`, `downloadFileName` (safe on Windows, 150 characters at most), `expiresInLine`, `isDownloadExpired`, `MAX_OPEN_DOWNLOADS = 3`, the `removed` stage; the sentence `download_too_big`.
- **API** (`modules/clips/downloads`): `POST /clips/downloads` (answers `{ job, download, existing }`; the same file asked again while it is being prepared or ready answers the existing row with no charge), `GET /clips/downloads` (48 hours, newest first, cancelled and deleted rows hidden), `GET :jobId/file` (302 to a five minute signed address, `Cache-Control: no-store`), `POST :jobId/save-to-media` (answers `{ download }`), `DELETE :jobId`, `POST /clips/videos/:videoId/download-original`, and the internal `finish-save-download`.
- **Worker**: `clipDownloadWorkflow` (fetch 0 to 85, MP3 at 192 kbps checked with `probeSound`, size checked against the space left, the DOWNLOAD asset with `videoId: null`), the DOWNLOAD case in `failJob` and `cancelJob` (files removed, both charges given back), `clipSaveDownloadWorkflow` (copy, poster, Media row with `origin: 'upload'`; on failure the public files go and the button comes back).
- **Web**: `DownloadMenu` on the link card (also under "You already have this video."), the Downloads tab (`downloads-tab.tsx`, `use-downloads.ts`), Download Original in an uploaded video's menu.

## Checked In The Browser (simulation, 1366 by 900, dark)

- The empty tab: "No downloads yet. Paste a link and choose Download."
- The talk link: the menu listed 1080p (57 MB), 720p (30 MB), 480p (16 MB), 360p and Audio Only. 720p opened the Downloads tab with the toast and "Getting your file" with a number, then the row with 69 MB, Save File, Save To Media and "Expires in 23 hours".
- Save File: `PostGear Sample A Three Minute Talk.mp4`, H.264 720p and AAC, 3:00, decoded by FFmpeg with no error. Audio Only: an MP3 at 192 kbps, 3:00, decoded with no error, and no Save To Media on its row.
- Save To Media: the row showed In Media; a Media row (1280 by 720, 180 s, `origin: upload`) and Video Space rose from 804 MB to 877 MB.
- Meters (`GET /entitlements/me`, read with no cache): downloads 0 to 1, import minutes 49 to 52 for the 3 minute video; later 8 and 94, matching the ledger row for row, every charge keyed `clips.download:<id>` and `clips.import:<id>`.
- Busy: a fourth file while three were being prepared gave 409 "Three downloads are already being prepared. Wait for one to finish." and charged nothing.
- Daily limit on the Free workspace: five went through, the sixth gave 402 `clips_downloads_today` "You have reached today's limit of 5 downloads. It resets at midnight UTC."
- A download deleted while being prepared: CANCELLED, both charges reversed (`rev:` keys), no file left.
- Another workspace: the list was empty and the file, save, delete and job addresses all answered 404.
- Expiry moved into the past in psql: the file route answered 410 "This download has expired. Prepare it again." and the stored file and its asset row were gone; the tab showed "Expired" with only the menu; Delete Download (red confirm) kept the job row as the rights record (stage `removed`) and gave nothing back.
- Download Original on an uploaded video: the browser saved `talk.mp4`.

Screenshots: `screenshots/m18-01` to `m18-10`.

## Gaps

- Simulation only: no real YouTube, Twitch or Kick file was fetched, and the simulated downloader serves the same sample file whatever the quality (so 360p and 1080p both show 69 MB). The platform's sizes in the menu are the fixture's.
- The MP3 needs `libmp3lame` in FFmpeg: the local FFmpeg has it and the tools check already warns without it; the Module 20 worker image must ship it.
- Save To Media over 250 MB (422 with the size sentence) and a Save To Media that fails were checked in tests only; no simulated file is that big.
- A failed download in the worker (both charges given back) was checked in tests; live, the same give-back was seen through a cancel.
- Save File is a plain link to the API: in the rare case the file expires between the page's clock and the click, the browser opens the API's 410 answer instead of a message on the row.
- Light and Lilac left to the hand check.

## Handoff

Module 19 removes expired downloads, counts them in storage and reads the same meters in its limits audit. Sprint 13's "More Sources And Platforms" module widens the link box and this menu to more sites behind their own switches.
