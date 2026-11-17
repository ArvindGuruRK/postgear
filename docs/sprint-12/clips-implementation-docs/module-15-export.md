# Module 15: Export

> **Sprint 12, Clips** | Status: Not started | Size: M (one session; the compiler and executor are Module 05's, this module builds the policy and the panel around them)
> **Depends on**: [Module 05](module-05-thin-slice-render.md), [Module 08](module-08-editor-shell.md)
> **Stories**: CL-10.1, CL-10.2, CL-10.3, CL-10.4
> **Next**: [Module 17](module-17-send-to-composer.md) (Send To Composer), [Module 19](module-19-retention-quotas-and-safety.md)

## Goal

**Demo 4.** The Export tab is finished: four qualities with plan locks, a summary, **Export Clip** with progress in words that survives a closed browser, **Preview Export** (a small, fast render of the whole clip through the exact same compiler, which is the truth check for everything the editor only approximates), the result with Download, an out-of-date notice when the clip changed after its last export, the small mark on Free plan exports, and the bell telling the user when it is done or failed. Module 05 built the render; this module builds everything around it.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names, error codes).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 8 (Export), 10 (the progress dialog, the plan lock), 11.
- User stories: CL-10.1, CL-10.2, CL-10.3, CL-10.4; Journey D (closed browser, the sharp video gone, the Free plan).
- Sprint doc: Plans, Entitlements And AI Minutes; API Routes (exports); Jobs And Queues (RENDER).
- Research: [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), section 9 (encoding for social platforms, measured speeds), section 10 (Proof Preview), section 11 (progress and cancel); [`05-editor-and-render.md`](../research/05-editor-and-render.md), sections 3, 5 and 7 (the preview's gaps, the executor, Proof Preview); [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), sections 6 and 13 (the resolver, the refusal codes, what Clips reads where); [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md), the per-platform export settings (one file that fits every platform: H.264 High, 4:2:0, a closed 2 second GOP, the index first, AAC at 48 kHz; Instagram's 300 MB cap) and the watermark options table; [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), the lesson on a fingerprint of the frozen document for a stale export.
- Code: Module 05's `POST /clips/:clipId/exports`, `clipRenderWorkflow`, `renderClip`, the internal finish route, `saveRendered`; Module 01's entitlements package and `EntitlementResolver`; Module 02's `use-clip-job.ts` and the job service (`ClipJob.priority`); `apps/web/src/components/studio/export-dialog.tsx` and `premium-lock.tsx`; `apps/api/src/modules/studio/studio.premium.ts` (a 402 with a code); `apps/api/src/modules/notifications/notifications.types.ts`; `apps/web/src/lib/api.ts` (`downloadFile`); `apps/web/public/email` and `apps/web/scripts/generate-email-brand.mjs` (how the repo already makes brand PNGs).

## Design

### 1. Qualities As Data (`packages/video-engine/src/export.ts`, pure)

`EXPORT_QUALITIES` has four entries; each has a short side, a frame rate, a `maxrate` and a help line. The canvas keeps its shape, so Vertical is 9:16 at the short side, Horizontal 16:9, Square 1:1 and 4:5 as chosen:

| Quality | Short side | Frame rate | `maxrate` | Help line |
|---|---|---|---|---|
| `720p` | 720 | 30 | 5 Mbps | Smaller file, quick |
| `720p60` | 720 | 60 | 8 Mbps | Smoother motion (the rate is our choice between the two verified ones) |
| `1080p` | 1080 | 30 | 8 Mbps | Sharper picture |
| `1080p60` | 1080 | 60 | 12 Mbps | Sharpest and smoothest |

- The `maxrate` figures for 720p30, 1080p30 and 1080p60 are YouTube's suggested ones (cookbook section 9); 720p60 sits between them. **4K is reserved**: `4k` is a member of the `clips.export_max_quality` enum in the registry (Module 01) so plans can name it later, but it has no entry here and no tile; it is parked in Module 21.
- The encode is the cookbook's: libx264 High, `yuv420p`, `veryfast`, CRF 21, `-maxrate` with `-bufsize` twice it, a closed GOP of two seconds (`-g`, `-keyint_min`, `-sc_threshold 0`), `-movflags +faststart`, AAC 128k at 48 kHz stereo, constant frame rate. Verified: H.264 High at level 4.0 (30 fps) or 4.2 (60 fps), keyframes every 2 s, `moov` before `mdat`.
- `PROOF_QUALITY` is not a public tile: 360 pixels on the short side (so a Vertical clip is 360 wide), 30 fps, `ultrafast`, CRF 28, `-maxrate 2M`, audio unchanged.
- `exportPlan(doc, quality)` returns the width, height, frame rate and bitrate for a document, rounded to even sizes. `estimateBytes(quality, durationMs)` for the summary uses 60 percent of the `maxrate` (a planning guess; smooth footage came far below it in the cookbook's tests, busy footage comes near it, and no real 8 Mbps file has been produced). `fitsBitrate(durationMs, maxBytes)` lowers the bitrate when a long clip would pass a platform's size cap (used by Module 17's notes, not enforced here). `allowedQualities(value)` returns the tiles at or below the plan's `clips.export_max_quality`, comparing by the enum's order.
- A 60 fps export only helps when the video itself has 50 or 60 frames a second; when it does not, the tile shows "This video is 30 fps, so 60 fps will not look smoother." and stays selectable.
- **Planning figures**: until Module 05's benchmark has run on the real host, allow 1.5 to 3 times the clip length for 1080p30 and 2.5 to 5 times for 1080p60 on a shared 4 to 6 core machine; the "about N minutes left" line uses FFmpeg's own `speed`, not these. This module re-runs `clips:benchmark` on a **typical clip** (a game area with a rounded camera box, two stickers, two texts, a three-source mix, 20 seconds) at every quality and the Proof Preview shape, and puts the table in the Progress notes for the plan limits and the production worker box.

### 2. The Route, Finished

`POST /clips/:clipId/exports` `{ quality, revision, document? }` now also:

- Reads the plan through the entitlement resolver, never `plans.ts`: `EntitlementResolver.getMany(orgId, ['clips.export_max_quality', 'clips.export_watermark', 'clips.queue_priority'])` (decision D12-07). A quality above `clips.export_max_quality` is refused with `EntitlementRefusedException`, 402, code `clips_quality_requires_plan`, and the sentence "{quality} export needs a higher plan." (the tile is locked in the UI anyway from `GET /entitlements/me`; the server is the authority).
- Decides the mark: `watermark = values['clips.export_watermark']` goes into the job's input. It is never part of the clip document and never something the browser sends. The queue priority from `clips.queue_priority` is copied into `ClipJob.priority` the same way, and the worker never resolves anything, so a plan change during a render changes nothing about it.
- Saves the latest document first if the request carries one, so "Export" always renders what is on screen; a revision conflict answers 409 `clip_changed_elsewhere`.
- Stores a fingerprint of the frozen document (a hash of its canonical JSON) and the quality in the job's input.
- Refuses when the clip is longer than `CLIP_MAX_MS` or has an invalid document; 409 `export_running` while one runs (Module 05).

`GET /clips/:clipId/exports` lists this clip's last five RENDER jobs (previews excluded) with their state, quality, time, and the `Media` id when done.

### 3. The Mark

When the job input says `watermark`, the compiler adds the brand mark as a **PNG overlay**: the plan's `ctx` names a file (`watermark.png`, a light "Made with PostGear" wordmark with a soft dark outline built into the image so it reads on any picture, made like the brand PNGs the repo already makes for email, never typed text; the worker image carries it). The chain is `-loop 1 -framerate FPS -i watermark.png`, `scale` to about 18 percent of the canvas width, `format=rgba,colorchannelmixer=aa=0.7`, then `overlay=x=W-w-M:y=H-h-M:format=yuv420:shortest=1` with a margin `M` of about 4 percent of the canvas, in the lower right and inside the margins, so it stays out of the usual caption area. It goes after the `ass` text and before the fades, so a fade takes it with the picture. The compiler never decides whether to draw it; the server's input does.

The editor shows the same mark (a small image at the same fractions) when `GET /entitlements/me` says the plan has it, with the help line "Exports on this plan carry a small PostGear mark." The Free plan carries it by the seed values (decision D12-08); changing the value in the plan editor changes it with no deploy.

### 4. Preview Export (CL-10.4)

The editor is a fast approximation (text may wrap on another word, a look may differ in tone, sound is not evened out, an animated sticker may restart when scrubbed). Preview Export is the exact check.

- **`POST /clips/:clipId/previews`** creates a RENDER job with `proof: true` in its input (Module 05 already carries the flag). The worker runs the **same** `buildRenderPlan` and `compileFfmpeg` with `PROOF_QUALITY`: every pixel number in the plan is scaled by one factor (text, outlines and stickers included; the ASS `PlayRes` stays the document canvas so libass scales the text itself), and the sharp range stays the input unless the benchmark says the proxy is close enough. Looks, zoom interpolation `linear`, the full sound mix and **both loudness passes** all run, so what plays is the exact mix. It differs from the export only in size, bitrate and preset.
- **Measured**: 8.4 s for 20 s of video, 2.4 times real time, 3.2 MB, on a busy laptop, about 3.2 s of it decoding the 1080p source (cookbook section 10). On the real host Module 05's benchmark gives the figure.
- It uses **no AI minutes** and no plan lock (a Free workspace can preview), carries the mark when the plan says so, **does not go to Media** and is not in the exports history. The finished file is a private asset with `expiresAt` 24 hours ahead (add a `PREVIEW` kind to the asset list if Module 01's has none), removed by Module 19's sweep.
- **It waits behind real exports.** The job takes the lowest `ClipJob.priority`, so the render queue picks any real export first, and its FFmpeg process runs at a lower operating system priority (a `runTool` option from Module 02; add it there if missing). It never slows a real one down.
- One preview per clip at a time: pressing the button while one runs returns that job and shows its progress instead of starting another. The clip stays editable meanwhile; the preview's frozen fingerprint is kept, and a later change shows "You changed this clip after the last preview."
- The step in words is "Making the preview" with a bar. When done, a dialog plays the file (`<video controls>` on a signed address) with the line "This preview is a smaller copy. Your export will be sharper." and **Export Clip** and **Close**. Failed: "We could not make the preview. Try again." and the clip is untouched.
- The panel carries the line "The editor is a fast preview. Preview Export shows the real result." beside the button.

### 5. Out Of Date

- A clip is exported when `lastExportedRevision === revision`. After any saved change it is out of date.
- More exactly: a rename bumps `revision` but does not change the picture. So compare fingerprints, not revisions: `Clip.lastExportedFingerprint` (a new nullable column, added by this module with `prisma-change`) against the current document's hash, computed by the engine's `documentFingerprint(doc)`. The "exported" state everywhere (Module 07's list) switches to this rule. The same function marks a preview stale.
- The Export panel shows an `Alert variant="warning"`, "You changed this clip after the last export.", with **Export Again**. **Send To Composer** (Module 17) asks the same question.

### 6. The Worker's Part

- `renderClip` already writes `.part` and renames on success (Module 05). This module adds: the quality record from `EXPORT_QUALITIES`; the low-priority option for previews; the watermark input; the progress mapped to the job (percent from the running maximum of `out_time_us`, "about N minutes left" from `(clipSeconds - outTime) / speed`, shown on the job card as Module 02's progress stream carries it); the loudness passes (Module 14).
- **`verifyOutput(probe, plan)`** after every render, with `ffprobe`: the duration is within one frame of the plan, the width, height and frame rate match the quality, the codec is H.264 High with `yuv420p`, there is a keyframe about every two seconds, and `moov` comes first. A failure ends the job with `render_output_invalid` and stores nothing.
- The job's `output` records `{ durationMs, fps, width, height, bytes, loudness }`, so the real-test plan can read the file's facts.

### 7. The Export Tab (`components/clips/panels/export-panel.tsx`)

- The four qualities as `ChoiceTiles` with the help lines; locked ones (above `clips.export_max_quality` from `GET /entitlements/me`) carry `PremiumLockMark` and open `PremiumLockDialog` with "{quality} export needs a higher plan." and **See Plans** instead of selecting. The best allowed one is preselected.
- A `SummaryBox`: "Vertical 9:16, 0:42, 1080p, about 40 MB" (size from `estimateBytes`).
- Notes, each only when true: the mark line; the 60 fps line; "The sharp video is no longer online. This clip will export at 720p from the copy we kept." (and the higher qualities are then locked with that reason); "Exports are sharper than the preview." when the clip has a zoom; a **Credits** link to `/credits/clips`.
- **Export Clip** (primary) and **Preview Export** (secondary) side by side, with the line from section 4 under them. While a job runs, the panel shows the step in words ("Getting the sharp video", "Rendering, 61%", "Finishing", "Making the preview") with a `Progress` and "about 3 minutes left", "You can close this. We will tell you when it is ready." (for exports), and **Cancel Export** (secondary). The top bar's **Export** button shows a small progress ring while a job runs. Opening the editor on a clip with a running job picks the job up (from `GET /clips/:clipId/exports` and the preview route).
- Done: a result card with the poster, the quality and size, **Download** (`downloadFile` on the `Media` file with the clip's name), **Send To Composer** (primary; disabled with a tooltip until Module 17), and **Open In Media**. The loudness line ("Evened out to about -14 LUFS") comes from the job's output.
- Failed: an `Alert variant="danger"`, "We could not export this clip. Nothing was charged. Try again.", with **Try Again**.
- A small history under the card lists the last five exports with their date and quality and a Download each.

### 8. Notifications And The Clips Tab

- `clip_export_ready` ("Your clip is ready", linking to the clip's Export tab) and `clip_export_failed` ("Your clip could not be exported") in the catalogue, in-app only. Module 05 already writes them; make the links right. Previews write no notification (the dialog is the answer).
- Clip cards show a running export as a small ring on the poster, and **Download** in their menu when exported.

### 9. Tests

- Engine: `exportPlan` for every quality and ratio (including 4:5), `allowedQualities` by enum order, `estimateBytes`, `documentFingerprint` (stable across key order, changes with any picture change, does not change on a rename).
- Compiler: the mark's chain as a snapshot (position, order before the fades, `shortest=1`, `format=yuv420`), absent when the input says no; every quality's output arguments; the proof shape's scaled numbers; a parity render of one frame at proof size against `frameState` scaled.
- API: the quality lock through the resolver (a plan at 720p refused 1080p with the code), the mark and priority copied from the entitlement values, save-then-freeze with the conflict, the fingerprint stored, the history route, the preview route (no lock, no AI minutes, idempotent while running, 24 hour expiry), tenancy.
- Worker: `verifyOutput` on a good and a bad file; the low priority option reaches the process; the mark reaches the plan; the output size and frame rate match the quality.
- Web: the panel (locks open the dialog, the summary, each note, the running, done and failed states, picking up a running job on open, the out-of-date alert, the preview dialog and its stale line), the top bar ring, the card ring and menu.

## Scope

**In**: qualities as data (four, with 4K reserved), the finished export route with plan locks from the entitlements, the mark as a PNG overlay decided by the server, Preview Export, output verification, fingerprints and the out-of-date rule, the Export tab, the history, notifications' links, card states, the typical-clip benchmark.
**Out**: 4K and other qualities (Module 21), exporting many clips at once and montage (Sprint 13), per-platform presets and checks (17), cleanup of old exports and expired previews (19).

## Tasks

- [ ] `export.ts` (`EXPORT_QUALITIES`, `PROOF_QUALITY`, `exportPlan`, `estimateBytes`, `allowedQualities`), `documentFingerprint`, with tests.
- [ ] `lastExportedFingerprint` on `Clip` (`prisma-change`); the exported rule switched everywhere.
- [ ] The export route: resolver reads, quality lock, mark, priority, save-then-freeze, fingerprint; the history route.
- [ ] The mark overlay in the compiler; the editor's mark.
- [ ] `POST /clips/:clipId/previews`, the lowest priority, the low-priority process option, the 24 hour asset, the dialog.
- [ ] `verifyOutput` and the job's recorded facts.
- [ ] The Export panel with every state and note; the top bar ring; picking up a running job.
- [ ] Notification links; card ring and Download.
- [ ] The typical-clip benchmark at every quality; the table in the Progress notes.
- [ ] Title-case test green.
- [ ] Playwright once under simulation: export at 720p, close the tab, reopen and see it done; press Preview Export and watch it play; change the clip and see the out-of-date alert; on the Free workspace click 1080p. Screenshots in `screenshots/`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js export render
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/worker/jest.config.js render
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels
npm run clips:benchmark
```

## Done When

- Each quality exports a file of the right size and frame rate for the clip's shape, and `verifyOutput` passes on all four.
- On the Free plan, 1080p shows the lock dialog, the API refuses it too with `clips_quality_requires_plan`, and a 720p export carries the small mark; on a paid plan there is no mark. Changing the plan's values in the operator screen changes both with no deploy.
- Export keeps going with the browser closed; the bell says when it is ready; reopening the editor shows the result.
- Preview Export plays a small copy of the whole clip in a dialog within seconds, with text, stickers, looks, zoom, speed and the exact sound mix as the export will have; it uses no AI minutes, is not in Media, and is gone after 24 hours.
- A preview started while a real export runs waits for it; two previews of one clip never run together.
- Changing a text after exporting shows the out-of-date alert and moves the clip from Exported to Drafts; renaming it does not. A change after a preview shows the stale line.
- Cancel Export stops the job within a few seconds and leaves no file.
- A failed export says so in the panel and in the bell.
- The typical-clip benchmark table is in the Progress notes with the host it was run on.

## Hand Check

With `CLIPS_SIMULATION=true`, the demo admin on a paid plan, then a Free workspace:

1. Export tab: 1080p is preselected; the summary reads the shape, length and quality; four tiles are there (no 4K).
2. Press Preview Export: "Making the preview", then a dialog plays the clip. Compare text, stickers and the look with the editor.
3. Export Clip: the steps in words, a number while rendering. Close the tab. Wait. The bell says "Your clip is ready". Reopen the clip: the result card is there.
4. Download: the file plays and is 1080 by 1920.
5. Move a sticker: "You changed this clip after the last export." The Clips tab shows it under Drafts. Rename it instead (undo the move first): still Exported.
6. On the Free workspace: click 1080p: the lock dialog. Export at 720p: the small mark is in the corner.
7. Start an export and press Cancel Export: it stops.

## Handoff

Module 17 enables Send To Composer on the result card and uses the out-of-date rule and `fitsBitrate`. Module 19 removes old exports' working files and expired previews, and shows the operator the plan values this module reads. Module 20 includes the watermark PNG and the typical-clip benchmark in the worker image check. Sprint 13's Export All calls this route once per clip.
