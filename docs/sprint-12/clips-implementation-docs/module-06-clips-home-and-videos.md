# Module 06: Clips Home And Videos

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 04](module-04-import-pipeline.md) (and the channel routes of [Module 03](module-03-link-engine.md))
> **Stories**: CL-1.1 to CL-1.6, CL-2.1, CL-2.3, CL-2.4; CL-1.7 (Add A Channel And Browse Its Streams), CL-1.8 (Hide Streams I Do Not Want), CL-2.5 (Try A Sample Video)
> **Next**: [Module 07](module-07-manual-clipping-and-clips-library.md) (Manual Clipping And The Clips Library)

## Goal

After this module a user can do the first half of the job on the real page: paste a link, see the link card, tick the rights box, import, watch honest progress, upload a file with a resumable upload, and manage the Videos tab (open, cancel, retry, delete), with the storage meter and the AI minutes chip in the actions row and an "about N minutes left" on every busy card. They can also **add a channel by name** (Twitch, YouTube or Kick), browse its past streams and clips in a **Streams** tab or in a **Browse** dialog from the link box, hide the ones they do not want, and import one with a click; and press **Try A Sample** to see the whole thing without a link of their own. Opening a video leads to a placeholder until Module 07.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 2, 3, 4, 11, 12, 14, 15.
- User stories: Journey A steps 1 to 4, Journey C step 1, Journey D; CL-1.x, CL-2.1, CL-2.3, CL-2.4, CL-2.5; section 5, the link, limit and upload rows.
- Sprint doc: Screens (Clips Page), API Routes.
- Research: [`11-channel-browser.md`](../research/11-channel-browser.md), sections 2, 6.4, 7, 8 and 9 (the screens, the states and the error sentences); [`13-screenshot-coverage.md`](../research/13-screenshot-coverage.md), screens 01, 02, 38 and OpusClip 02 and 05; [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), section 6.3 (`/entitlements/me`); [`02-libraries.md`](../research/02-libraries.md), the upload rows (Uppy core with its S3 plugin, headless); [`01-reference-products.md`](../research/01-reference-products.md), the StreamLadder home and the VidsSave card (what we take).
- Code: `apps/web/AGENTS.md`; `apps/web/src/components/clips/` from Modules 01 and 02 (`clips-view.tsx`, `use-clip-job.ts`); `apps/web/src/lib/clips-api.ts`; `apps/web/src/components/discover/discover-view.tsx` (a page of tabs and panels) and `place-popover.tsx` (a field that only asks on Enter); `apps/web/src/components/media/media-uploader.tsx` and `media-limits.ts` (upload rows and preflight); `apps/web/src/components/ai/credits-meter.tsx` and `use-credits.ts` (a pattern for a chip; Clips does not use AI credits); `apps/web/src/lib/entitlements.ts` from Module 01; `apps/web/src/components/studio/studio-landing.tsx` (a card grid with pagination); `packages/ui` (`UsageMeter`, `Progress`, `Checkbox`, `Alert`, `AlertDialog`, `DropdownMenu`, `EmptyState`, `Skeleton`); `apps/web/src/lib/title-case.test.ts`; `.claude/skills/new-page/SKILL.md`.

## Design

### 1. Client And Types

`lib/clips-api.ts` gains `probeLink`, `importVideo`, `importSample`, `startUpload`, `signParts`, `completeUpload`, `listVideos`, `getVideo`, `retryVideo`, `cancelVideo`, `deleteVideo`, and the channel calls `listChannels`, `addChannel`, `removeChannel`, `listStreams`, `hideStream`, `unhideStream`, `refreshChannel`, each typed. `types/clips.ts` mirrors `VideoView`, `JobView` (with `etaSeconds`), `ClipsStatus`, `ChannelView`, `ListedItem`, `LinkInfo` (re-exported from the engine). `ApiError.code` is mapped to nothing here: the message from the API is already the sentence to show.

### 2. The Actions Row And The Tabs

`ClipsView` (from Module 01) now renders, in `PageActions` (`justify-end`): `StorageMeter` (a small `UsageMeter` from `status.usage.storageBytes` and the resolved `status.limits.storageBytes`, so an operator edit changes it; warning colour past 80%; a `TooltipHint`: "Videos you bring in count here. Exported clips are in Media." plus a second line, "Import minutes this month: 120 of 900 left.", read from the import minutes meter) and the `AiMinutesChip`: "38 of 300 AI minutes left", read from `GET /entitlements/me` (`clips.ai_minutes_per_month`), warning colour when under 10 percent is left, a `TooltipHint` "AI minutes are used when Clips looks through a video for you. They reset on 1 December." with the real reset date, and, when none are left, the chip reads "No AI minutes left", its tooltip says "This workspace has used all its AI minutes for this month. They reset on 1 December." and **See Plans** is offered. It replaces any credits chip: Clips never shows AI credits. The Simulated sticker shows when `status.simulation`. If `status.tools.ok` is false, an `Alert variant="warning"` above the tabs says "Video tools are not running right now. You can look at your videos, but nothing new can be brought in." and the Create tab's buttons are disabled.

### 3. The Create Tab (`components/clips/home/`)

- `LinkBox`: the card from blueprint section 2. `Input` with a leading link icon (placeholder "Enter your YouTube, Twitch or Kick link"; when a platform is paused, only the working ones are named), **Find Video** (primary), **Browse Channels** (secondary, opens the Browse dialog of section 6) and **Upload A Video** (secondary) with its help line. Enter and the button call `probeLink`; typing calls nothing. A new probe cancels the one before (an `AbortController` and a sequence guard).
- **Try A Sample** (story CL-2.5, a small text button under the box): imports a ready-made sample video so a new user can see the whole flow without a link or a file. Under simulation it is the 3 minute "talk" sample made by `npm run clips:samples`. In production it is **hidden** unless an operator has set `CLIPS_SAMPLE_LINK` (a canonical link to a video the operator owns, in the API env); `GET /clips/status` carries `sample.available`. It calls `importSample`, a `{ sample: true }` form of `POST /clips/videos` that this module adds to Module 04's route: the server resolves the sample link itself (never from the browser), skips the rights tick because the sample is ours, still runs every limit and charges the import minutes like any import, and answers `existing: true` the second time ("You already have the sample video."). The sample never counts toward Browse channels.
- `LinkCard`: the states in blueprint section 3. The rights `Checkbox` resets on every new link. **Import Video** calls `importVideo`, then switches to the Videos tab; an `existing` answer opens that video with a toast "You already have this video." **Download** is rendered disabled with the tooltip "Arrives in a later step of this sprint." until Module 18.
- Refusals show as an `Alert variant="warning"` under the field with the API's sentence; `clips_*` limit codes add **See Plans** (a link to `/[orgId]/settings/billing`); `link_unsupported` and `platform_resting` add **Upload A Video** inside the alert.
- `RecentVideos` and `RecentClips`: `AnalyticsPanel` groups, drawn only when there is something to show. Recent clips is empty until Module 07 and simply does not render.

### 4. Uploading (`components/clips/home/use-video-upload.ts`)

- Preflight in the browser first: the type list (MP4, MOV, MKV, WebM), the size against `status.limits.uploadMaxBytes`, and the length read with Mediabunny when the browser can (a refusal here is free and instant). The sentences are the stories' ("This file is 3.1 GB. Uploads can be up to 2 GB.").
- Then Uppy core with its S3 multipart plugin, headless (no Uppy UI, no Uppy CSS): `createMultipartUpload`, `signPart` and `completeMultipartUpload` are bound to our three routes; the part size comes from the API; four parts at a time; a failed part retries with back-off, and an offline browser pauses and resumes by itself ("Waiting for your connection").
- The row is drawn with the same pieces as the Media uploader: the file name, a `Progress`, "Uploading, 48%", **Cancel**. When it completes the video appears in the Videos tab in its "Preparing the preview" state.
- If Uppy proves heavier than it is worth, a small own uploader over the same three routes is allowed; say which in the Decision Log.

### 5. The Videos Tab (`components/clips/home/videos-tab.tsx`)

- `useVideos(orgId, initial)`: the list from the server page, then client paging and `sort`; a video that is IMPORTING gets a `useClipJob` subscription so its card moves without a reload.
- `VideoCard` per blueprint section 4: READY (poster, title, meta, "Kept until 28 Nov", **Open**, the menu), IMPORTING (`Progress`, the step in words from a `stageLabel(kind, stage, progress)` helper in `components/clips/job-labels.ts`, and **"about 4 minutes left"** from `etaSeconds` through `etaLabel(seconds)`: rounded up to whole minutes, "less than a minute left" under 90 seconds, nothing when `etaSeconds` is null; **Cancel**), a job that is waiting for a slot ("Waiting for its turn"), FAILED (an `Alert variant="danger"` with the sentence and **Try Again**).
- **Delete Video**: an `AlertDialog` whose sentence counts what goes: "Delete this video and its 4 clips that were never exported? Exported clips stay in Media." (the count comes from `getVideo`). The action is solid red. After it, the storage meter refreshes.
- **Open** goes to `/[orgId]/clips/video/[videoId]`, which this module creates as a route that shows the title and an `EmptyState` ("Arrives in the next step of this sprint.") inside `ClipsDesktopOnly`.
- Empty and loading states per blueprint section 11.

### 6. My Channels: The Streams Tab And The Browse Dialog (CL-1.7, CL-1.8)

Module 01 built four tabs; this module adds a fifth, **Streams**, between Videos and Clips (`?tab=streams`). The server side is Module 03's `ChannelLister` and `ClipChannel` routes; this is only the screens. Both homes, the tab and the dialog, are the same component, `ChannelBrowser` (`components/clips/channels/`), so they never drift. "Browse" talks to the channel routes, **never to the probe**; only **Import** posts to the probe.

- **No channel yet**: a card with **Add A Channel** and the sentence "Add the name of a Twitch, YouTube or Kick channel. We list its public videos and clips so you can import one with a click." and three platform chips. Only platforms in `CLIPS_PLATFORMS` are drawn; if YouTube is off in production its tile and tab are absent.
- **Add dialog**: `ChoiceTiles` for the platform (Twitch, YouTube, Kick); an `Input` with the placeholder "Enter your channel name" (a pasted channel link is cut down to its name); **Check** shows the avatar and display name; then **Add Channel**. Under it: "Only public videos are listed. Nothing is downloaded until you import one." A video link pasted here answers "That is a video link. Paste it in the link box on Clips." Over the plan's limit: the `clips_channel_limit` sentence with **See Plans**.
- **The list**: channel chips on top (avatar, name, a small platform mark, a menu with **Remove Channel**; a red confirm). Inside the chosen channel, a small `Tabs` per platform: Twitch and Kick **Streams** and **Clips**; YouTube **Videos**, **Streams** and **Shorts**. Toolbar: **Sort** (Newest, Most Viewed; disabled for YouTube with the hint "YouTube lists newest first"), **Period** (Twitch clips only), **Show Hidden**, **Refresh**, "Updated 4 minutes ago", and the item count.
- **A row**: thumbnail (the platform's own address), title, date, length, "12,408 views", an expiry line for a Twitch past stream ("Expires in about 3 days"), **Import** (primary, small) and a hide icon. An already imported row shows **Open** instead. A live stream shows a "Live Now" badge and no Import (tooltip "Come back when the stream has ended"); one still being processed shows "Still Processing". Names are Title Case, sentences stay sentences.
- **Hide** (CL-1.8): the hide icon calls `hideStream`; the row leaves the list with an "Undo" toast; **Show Hidden** brings hidden rows back in a muted style with **Show Again**. Hidden ids only; nothing else is kept.
- **Import** on a row: the row says "Checking" while the canonical link goes to `probeLink`; then the same `LinkCard` opens in a dialog with the rights tick and **Import Video**. Every refusal of the link box applies (private, members only, too long, platform resting), so a channel list never offers a way around a check.
- **Paging and loading**: **Show More** and scroll load, 50 a page; after 20 pages "Showing the newest 1,000. Paste a link for older videos." Skeleton rows while loading, never a spinner over old rows. A stale list says "Updated 3 hours ago".
- **Errors** (an `Alert variant="warning"` with **Try Again**): the sentences of Module 03 (`channel_not_found`, `list_unavailable`, `quota_exhausted`, `platform_changed`).
- **Browse dialog**: **Browse Channels** on the link box opens `ChannelBrowser` in a `Dialog` with platform tabs (Twitch, YouTube, Kick), the saved channel chips and **Add A Channel**; picking **Import** closes it and continues in the link card.

### 7. Playground And Tests

- `/dev/components`: a "Clips" section with `LinkCard` in each state, `VideoCard` in each state (including one with "about 4 minutes left"), `StorageMeter` at 20%, 85% and 100%, `AiMinutesChip` at plenty, low and none, and `ChannelBrowser` with fixture rows (ready, live, processing, imported, hidden).
- Web tests: `LinkBox` (nothing requested while typing, Enter probes, a newer probe wins, each refusal renders its alert and extras), `LinkCard` (buttons disabled until ticked, the tick resets on a new link, `existing` opens the video), `use-video-upload` with a fake uploader (preflight refusals, progress, cancel), `VideosTab` (states, delete sentence and count, retry), `stageLabel` and `etaLabel`, `AiMinutesChip` (the sentence, the warning, the empty state), `Try A Sample` (shown under simulation, hidden when `sample.available` is false, `existing` toast), `ChannelBrowser` (each state in section 6, Browse never calls the probe, Import posts the canonical link to the probe, hide and undo, show hidden, the limit sentence, YouTube sort disabled).
- `title-case.test.ts` green.

## Scope

**In**: the actions row (storage meter, AI minutes chip), the Create tab with the link box, link card, Try A Sample and upload, the Videos tab with live cards and their ETA, cancel, retry and delete, My Channels (the Streams tab and the Browse dialog), the video route as a placeholder, playground demos, tests.
**Out**: the video page itself and the Clips tab (07), Download and the Downloads tab (18), expiry notices (19), the channel lister itself (03).

## Tasks

- [ ] Client functions and mirrored types.
- [ ] `StorageMeter` (reads the resolved limit), `AiMinutesChip`, the tools warning.
- [ ] `LinkBox` and `LinkCard` with every state and refusal; **Try A Sample** and the `{ sample: true }` form of the import route.
- [ ] `use-video-upload` (preflight, parts, resume) and its row.
- [ ] `VideosTab`, `VideoCard`, `stageLabel`, `etaLabel`, the delete dialog, the placeholder video route.
- [ ] `ChannelBrowser`, the Streams tab (the fifth tab), the Add dialog, hide and show hidden, Import through the probe, the Browse dialog on the link box.
- [ ] Playground section; title-case test green.
- [ ] Playwright once under simulation: paste the Twitch simulation link, tick, import, watch it become ready; press Try A Sample; add the `simstreamer` channel, hide one stream, import another; upload the 3 minute sample file; delete a video. Screenshots in `screenshots/` (light, dark, Lilac).
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config apps/web/jest.config.js apps/web/src/components/clips apps/web/src/lib/clips-api
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
```

## Done When

- Pasting a simulation link and pressing Enter shows the link card; nothing is requested while typing.
- Import is impossible without the tick, and the tick is clear again for the next link.
- An imported video moves through its steps in words on the Videos tab with no reload and ends with its poster and Open.
- A file upload shows its percentage, survives the network being switched off and on, and ends as a ready video.
- Cancel, Try Again and Delete Video each do what the stories say; the delete sentence names the right count.
- The storage meter changes after an import and after a delete, and shows the plan's current limit (change it in the database and it follows).
- The AI minutes chip reads "N of M AI minutes left" from the entitlement snapshot and shows no mention of credits.
- A busy card says "about N minutes left" once the job has an estimate and nothing before.
- Try A Sample imports the sample under simulation with no link and no tick, and is absent in a production-mode run with no `CLIPS_SAMPLE_LINK`.
- Under simulation, adding `simstreamer` lists streams; hide removes a row and Show Hidden brings it back; Import goes through the probe and the link card; the Browse dialog and the Streams tab show the same list; a plan at its channel limit gets the sentence and **See Plans**.
- Light, dark and Lilac look right at 1366 px and 1920 px.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin:

1. Clips, Create: paste the Twitch simulation link, press Enter. The card shows the title, "Past stream", "10 min".
2. Import Video is disabled. Tick the box, press it. The Videos tab opens; the card says "Getting the video" with a number, then "Preparing the preview", then shows the picture.
3. Paste the same link again and import: the toast says "You already have this video."
4. Paste the private, the live and a Vimeo link: one sentence each, the last with Upload A Video inside it.
5. Upload the 3 minute sample (`npm run clips:samples` made it). In the browser's network tools go offline for ten seconds mid-upload: it waits and carries on.
6. Delete a video: the sentence, the red button, the meter drops.
7. Create tab: press Try A Sample. The Videos tab opens with a busy card; once it has a few percent it says "about 1 minute left". Press it again: "You already have the sample video."
8. Streams tab: Add A Channel, Twitch, type `simstreamer`, Check, Add Channel. A list appears. Hide one row, press Show Hidden, press Show Again. Press Import on another: the link card opens in a dialog; tick and import.
9. Create tab: Browse Channels shows the same channel and list. On a Free workspace add a second channel: the limit sentence and See Plans.
10. The chip in the actions row says "30 of 30 AI minutes left" on a Free workspace.

## Handoff

Module 07 replaces the placeholder video route and fills Recent Clips and the Clips tab. Module 18 enables Download on the link card and builds the Downloads tab. Module 19 adds "Kept until" changes and the expiry notice. Module 16 puts its price in AI minutes on the video page and reuses the `AiMinutesChip`. The new fifth tab means the e2e suite of Module 20 checks five tabs, not four.
