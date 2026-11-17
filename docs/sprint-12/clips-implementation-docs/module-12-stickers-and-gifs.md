# Module 12: Stickers And GIFs

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session, may need a second: the catalogue and its ingest are half the work)
> **Depends on**: [Module 01](module-01-contracts-and-data.md) (the library tables), [Module 11](module-11-canvas-handles-and-text.md)
> **Stories**: CL-7.2, CL-7.3, CL-7.4, CL-7.5
> **Next**: [Module 13](module-13-effects-zoom-and-speed.md), [Module 14](module-14-sound.md), [Module 15](module-15-export.md)

## Goal

After this module the Elements tab works as a real library: PostGear's own **open-source sticker catalogue** (about 1,600 items, still and moving, in five categories) with search, favourites and the workspace's own uploads, plus the Follow Badge. Stickers are placed, moved, resized, turned and timed like text, and move in the export exactly as the compiler's numbers say. The catalogue is filled by an operator-run, licence-guarded ingest, never by users and never by an outside service (decision D12-10). It is smaller than Giphy's and has no film or meme clips, and the screen says so.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 8 (Elements), 9, 15.
- User stories: CL-7.2, CL-7.3, CL-7.4, CL-7.5; section 5 (library search with no result).
- Sprint doc: Providers (`StickerProvider`); Database (the library tables and `ClipAsset` kind STICKER); API Routes (library).
- Research: [`10-open-source-sound-and-sticker-libraries.md`](../research/10-open-source-sound-and-sticker-libraries.md), sections 4 to 13 (sources and verdicts, the licence allow-list, the data model, search, the ingest and its guard, categories, the credits page, launch volume, takedown, the search API); [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), section 5 (stickers, animated stickers and the ingest command, all run on FFmpeg 9.0.2) and section 12; [`05-editor-and-render.md`](../research/05-editor-and-render.md), sections 2 and 3 (`ImageDecoder`, the `<img>` fallback).
- Code: Module 11's `items.ts`, the handle layer, `addItem`, `buildAss`; Module 01's library models and the `library/` key builders from Module 02; `apps/api/src/common/search-terms.ts`; `packages/seo-engine/src/crawler/safe-fetch.ts` (`fetchBinarySafely`); Module 02's `PrivateStorage` and the signed upload calls; `packages/discover-engine/src/simulation.ts` (recorded answers as a provider); `apps/web/src/components/studio/font-licences-dialog.tsx` (a credits dialog, for its pattern).

## Design

### 1. The Sticker Item (engine)

`StickerItem` is `{ id, kind: 'sticker', start, duration, anchor, transform, art, loop }` with `art` one of:

- `{ source: 'library', stickerId }`: a row of the catalogue (`ClipSticker`).
- `{ source: 'upload', assetId }`: a workspace upload (a `ClipAsset` of kind STICKER).
- `{ source: 'badge', platform, name }`: the Follow Badge, drawn from data (section 8).

The file's format is `png` (still) or `apng` (moving); it comes from the row, not the item. `loop` (default `true`) is for moving stickers: loop for the item's length, or play once and hold the last frame until the item ends. `defaultStickerItem(doc, atMs, art)`: centred, 3 seconds, `anchor: 'moment'`, a quarter of the canvas wide. A sticker removed from the library keeps its row (status `REMOVED`); the item shows "This sticker was removed from the library." and Module 15's export asks before leaving it out.

### 2. The Catalogue

The tables are Module 01's: `ClipLibrarySource` (one row per collection that shares a credit), `ClipSticker`, `ClipFavourite` (per workspace), `ClipLibraryRun`, `ClipLibraryDeny`, `ClipLibraryMiss`. A sticker row carries its licence evidence (licence code, licence address, author, origin, origin id, source address, retrieved date, checksum) and a status: `STAGED` (just ingested, invisible), `ACTIVE`, `HIDDEN` (not listed, clips that use it keep working), `REMOVED` (files deleted).

- **Categories** (slugs in brackets): **Reactions** (`reactions`), **Arrows And Shapes** (`arrows-shapes`), **Social** (`social`), **Gaming** (`gaming`), **Animated Emoji** (`animated-emoji`). A `taxonomy.ts` table maps source words to a category; Noto's own categories map to `animated-emoji` and stay as tags.
- **Launch volume** (research 10 section 11): about 1,600 in all, with no outside permission needed. About 1,000 moving: Noto Emoji Animation's 881 plus our own simple animated pops. About 600 still: Kenney's Emotes Pack (480; the pack page does not say whether any animate, so the first run decides), Open Peeps (about 93, CC0), and our own arrows, shapes and reaction words (about 120). Our own art is drawn for this sprint in PostGear's look (black outline, flat fill, small hard shadow) and must not copy any reference product's stickers; if it is not ready, the catalogue ships without the own Reactions group and the Progress notes say so.
- **The honest gap**: no film, TV, meme or pop-culture GIFs, because those are other people's clips and no open source holds them. The Elements panel says "Our library is free-to-use art, so it has no film or meme clips." Giphy and Klipy are far bigger; we do not use them (Klipy's terms on keeping copies are unclear, Giphy forbids copies (reported), Tenor is shut down (reported): research 10 section 4).
- **Credits**: Noto's animated emoji are CC BY 4.0, so the credits page carries "Animated emoji: Noto Emoji Animation by Google, CC BY 4.0 (link), resized and converted to APNG." Kenney's and Open Peeps' CC0 art get a courtesy line. Sticker items from a source with `requiresCredit` show a small "i" with the line.
- **The `StickerProvider` interface stays as the swap point**: `search({ q, kind, category, favouritesOnly, page, pageSize, orgId }, signal)` returns a page of results and `resolve(id)` returns the stored file. The one binding built now is the catalogue (`CatalogueStickerProvider`, reading `ClipSticker`). A commercial provider, if users ask for a bigger library, implements the same interface and must copy the items it uses into our storage; that is a Module 21 item with its own legal read. Update the interface line in the sprint doc when this module lands.

### 3. The Ingest (operator only, `apps/worker/src/scripts/`)

```
npm run clips:library:ingest -- --kind sticker --source noto|kenney|openpeeps|own
        [--path <folder>] [--limit 200] [--category <slug>] [--dry-run] [--auto-publish]
npm run clips:library:publish -- --run <runId>        # STAGED to ACTIVE after review
npm run clips:library:remove  -- --id <id> --reason "..."
```

It lives in the worker app because the worker image holds FFmpeg, runs on the media worker box with the production database and bucket, and **refuses to start unless `CLIPS_LIBRARY_INGEST=true` is set in that shell**. No API route accepts a source address and users can never trigger it. Sound sources are Module 14's; the engine of the ingest (fetch, guard, dedupe, store, report) is shared and built here.

Adapters return candidates as `{ name, tags, creator, creatorUrl, licenceRaw, licenceUrl, sourceUrl, originId, downloadUrl or path, mature }`: `own` (a repo folder plus a `licences.json`), `kenney` (an unzipped pack the operator downloads by hand; the adapter reads the pack's own `License.txt` and refuses the pack if it does not say CC0), `openpeeps` (the CC0 download), `noto` (the collection's `api.json` index of 881 emoji with codepoints, categories and tags, and the CDN pattern `https://fonts.gstatic.com/s/e/notoemoji/latest/<codepoint>/512.webp`). The Openverse and OpenGameArt adapters are not built for stickers (the yield for CC0 GIFs was 2 for "emoji" and 9 for "reaction"; research 10 section 4.4).

The steps, in order (research 10 section 8.2):

1. **Fetch** through `fetchBinarySafely`: size cap 6 MB, timeout, no private addresses, one request at a time, a generic User-Agent. Sniff the real type, then `ffprobe` to confirm it decodes.
2. **Licence guard** (before any conversion, so a refused item costs nothing). Allowed for stickers: `OWN`, `CC0-1.0`, `PDM-1.0`, `CC-BY-4.0`, `MIT`, `Apache-2.0`. Refused with a recorded reason: `licence_not_allowed` (anything NC, ND, SA, GPL, unknown, "free for personal use", "royalty free" without a stated licence), `licence_url_mismatch`, `missing_metadata`, `mature`, `brand_name` (a block list of company, product, game, film and show names the operator extends), `derivative_signal`, `no_category`.
3. **Dedupe** by the sha256 of the bytes (`sourceChecksum`, unique) and the `(origin, originId)` pair; anything on `ClipLibraryDeny` is skipped.
4. **Normalise** (one function, `normaliseSticker`, also used by user uploads): a still image becomes PNG, longest side at most 512 px, at most 300 KB. A moving image (animated WebP, GIF or APNG) becomes an APNG with full alpha and a constant frame rate: `ffmpeg -hide_banner -nostdin -y -i in -vf "fps=<min(source,20)>,scale=...,format=rgba" -plays 0 -f apng out.apng` (verified on 9.0.2 for all three input types, alpha kept; a GIF's 1-bit alpha is why Noto comes in as WebP). Emoji-like items are scaled to 256 px, others to a 512 px ceiling; at most 6 seconds and 120 frames, at most 2 MB; if over, step down once to 192 px and 15 fps, then reject with `too_large`. The size and frame caps are advised, not run (cookbook section 5). A 128 px animated WebP is made for the grid preview. Metadata is stripped.
5. **Store** in the public media bucket: `library/stickers/<first 2 hex>/<sha256>.apng` or `.png`, `library/previews/<first 2 hex>/<sha256>.webp`. The key is the content hash, so files never change and are cached for a year.
6. **Write** the row `STAGED` with the full evidence and the run id.
7. **Report**: a JSON and Markdown licence report in the private bucket with one line per accepted item and the count of each rejection reason. The operator reads a sample (at least 20 items or 10 percent) and runs `clips:library:publish`. The `own`, `kenney` and `noto` adapters may use `--auto-publish`; nothing from an open aggregator ever may.

**Seed at install**: the seed runs `own`, `kenney` and `noto` from a release bundle with `--auto-publish`, so a fresh environment has the whole launch set. Growth afterwards is one source and one category at a time, driven by `ClipLibraryMiss` (the searches that found nothing). Nothing a user uploads enters the shared catalogue. The operator's Library screen (hide, remove, list runs, the miss list) is Module 19; this module builds the service methods it calls.

### 4. Search And Favourites (API, `apps/api/src/modules/clips/library/`)

All routes sit behind the default `JwtAuthGuard` except credits; the workspace comes from `@CurrentOrg()`; query strings use strict Zod schemas; throttle 60 requests a minute per workspace.

| Route | Query or body | Answer |
|---|---|---|
| `GET /clips/library/stickers` | `q`, `kind=static\|animated`, `category`, `favourites=true`, `page` (default 1), `pageSize` (default 24, max 60) | `{ items, page, pageSize, total, hasMore }` |
| `GET /clips/library/categories` | `type=sound\|sticker`, `kind` | `[{ slug, name, count }]` for the chips |
| `PUT /clips/library/favourites` | `{ type, itemId }` | `{ favourite: true }` |
| `DELETE /clips/library/favourites/:type/:itemId` | none | `204` |
| `GET /clips/library/credits` | none, `@Public()` | the grouped credits |

- A sticker item in the answer: `{ id, name, kind, category, tags, width, height, durationMs, previewUrl, fileUrl, isFavourite, credit }`, `credit` set only for items that need one.
- Search uses the generated `tsvector` column and the `simple` configuration (tags and non-English names are not stemmed away): `apps/api/src/common/search-terms.ts` cleans the words, then `websearch_to_tsquery('simple', q)` with a prefix match on the last word so "woo" finds "whoosh". Order: `ts_rank_cd` descending, then `featured` descending, then `name`. With no `q` the list is `featured desc, name`. The query always adds `status = 'ACTIVE'`; `favourites=true` joins `ClipFavourite` for the caller's workspace, newest first.
- No match returns an empty list plus a `suggest` array of the nearest categories, and writes a `ClipLibraryMiss`.
- The categories, favourites and credits routes and the search plumbing are shared with Module 14, which adds the sound routes beside them.

### 5. Own Uploads

- **Upload A Sticker**: PNG, GIF or WebP, **at most 8 MB** (checked by real bytes, not the file name). A single upload, `POST /clips/stickers/uploads`; the storage gauge is checked through `EntitlementResolver.assert` for `clips.storage_gb` before the file is taken (Module 01).
- The file lands in the private space under the workspace's `library/` prefix as a `ClipAsset` of kind STICKER with `meta.status: 'checking'`, and `clipStickerCheckWorkflow` (`postgear-media`) runs `ffprobe` and `normaliseSticker` (a still becomes a PNG; a moving file becomes an APNG, under the same caps as the ingest), makes the grid preview, and marks the asset ready, or removes it with a sentence ("This file is not a picture we can use."). Uploads stay in the workspace and never enter the catalogue.
- `GET /clips/stickers/uploads` lists the workspace's ready stickers; `DELETE /clips/stickers/uploads/:assetId` removes one that no clip uses (409 with the count when some do).

### 6. The Compiler: Sticker Overlays (`render/stickers.ts`, pure)

Written from cookbook section 5, each recipe run on FFmpeg 9.0.2. One filter chain per item, placed after the layout, zoom and look and before the text:

- Inputs: a still is `-loop 1 -framerate FPS -i sticker.png`; a moving sticker that loops is `-stream_loop -1 -i sticker.apng`; one that plays once is a plain `-i`. (`-stream_loop -1` works on an APNG although `ffprobe` reports its duration as N/A, and the file's own loop count is ignored by default.)
- The chain: `format=rgba,scale=IW:IH:flags=bicubic,rotate=a=ANG*PI/180:c=none:ow='2*ceil(hypot(iw,ih)/2)':oh='2*ceil(hypot(iw,ih)/2)',colorchannelmixer=aa=OP`. The enlarged, even output box keeps the corners transparent after turning (`c=none`); **a positive angle is clockwise**, like CSS `rotate()`. A moving sticker adds `setpts=PTS-STARTPTS+A/TB` so its animation starts at the item's start (without the shift it started at its middle).
- The overlay: `overlay=x='CXP-w/2':y='CYP-h/2':enable='between(t,A,B)':shortest=1:format=yuv420`, with `B = end - 0.001`. For play-once, `B` is the animation's end or earlier and the default `eof_action` stays, so the last frame holds until the window closes (`eof_action=pass` lost the last frame). `IW` and `IH` are even and the centre is the item's centre, so the measured centre error stays under 1 pixel.
- A window that starts before 0 or ends after the clip is clipped by the compiler. Sticker count and file sizes are capped by the plan check (`MAX_ITEMS`, and the 2 MB and 120 frame ceilings the ingest already enforces).
- **Parity cases** (added to `render-parity.test.ts`): a sticker with a marker at 12 o'clock on a plain source; centre within 1.5 px, rotation within 1 degree, a 50 percent blend at opacity 0.5, corners untouched; an APNG whose colour cycles, sampled at three times against the expected phase; a play-once item's last frame still on screen just before its end and gone just after.

### 7. The Preview And The Timeline

- `PreviewEngine`'s overlay layer draws a still sticker as an `<img>` and a moving one on a `<canvas>` with `ImageDecoder`: frame `k = floor((outputMs - startMs) / frameMs)`, modulo the frame count when looping, held on the last frame when playing once, so the sticker follows scrubbing exactly like the export. If `ImageDecoder.isTypeSupported('image/apng')` is false (older Firefox, Safari before 27.3), an `<img>` is created again when the playhead enters the item; scrubbing inside the item then shows the animation from its start, a documented preview difference.
- Rotation is CSS `rotate()` (clockwise), opacity is CSS `opacity`, both from `frameState`.
- The Overlay row shows sticker bars with a tiny picture as the label.

### 8. The Follow Badge

Data only (`{ platform, name }`, platform one of Twitch, YouTube, Kick, TikTok, Instagram). The export draws it with ASS and one small image: a rounded dark label drawn as an ASS vector shape (`\p1`) on a lower layer, the text "Follow Me" over the name on the next, and the platform's glyph as a sticker overlay from the Social group of the own pack. ASS drawing commands were not run in the cookbook (not verified); the first task is a spike that draws the rounded label and checks it at 1080 and 720. If it misbehaves, the fallback is a rounded label made once with the camera box's `geq` mask recipe. The preview draws the same badge as a rounded `div`. The badge is placed, turned and timed like any sticker.

### 9. The Elements Tab (`components/clips/panels/elements-panel.tsx`)

- `Tabs`: **Stickers** (still pictures), **GIFs** (moving pictures), **Favourites** and **Uploaded**.
- **Stickers** and **GIFs**: a field ("Enter your search") that searches as you type (debounced), category chips above the tiles (only the categories that have items of that kind, with counts), square tiles on a checker background loaded 24 at a time, moving ones playing on hover only (the 128 px preview). Clicking a tile adds the sticker at the playhead and selects it. Every tile has a star ("Add To Favourites", "Remove From Favourites") and, where the source needs a credit, a small "i" with its line.
- The **Follow Badge** tile sits in the Social category; it opens a small form: platform (`IconSelect`) and the name ("Enter your channel name"), then adds it.
- **Favourites**: starred stickers and GIFs together, newest first, with its own search field; empty: "No favourites yet. Star a sticker to keep it here."
- **Uploaded**: **Upload A Sticker** (secondary), rows with a "Checking" state, a menu with **Delete Sticker** (red confirm); a file that is not a picture or is over 5 MB is refused with a sentence.
- No match: "Nothing found for "wow". Try another word or pick a category." with the nearest categories as chips.
- At the foot: the line "Our library is free-to-use art, so it has no film or meme clips." and a **Credits** link to `/credits/clips`.
- **The credits page** (`/credits/clips`, public, built here): generated from `GET /clips/library/credits`, which reads `ClipLibrarySource` joined with a count of `ACTIVE` items, in four groups (Attribution Required, Notices, Public Domain And CC0, PostGear's Own). A source with no active items is left off. Module 14 adds the sound sources to the same page. It is linked from the Elements and Audio panels, the app footer and the Export tab. Whether a credit must travel inside each exported video is a legal read the real test queues (research 10 section 10); until then Send To Composer (Module 17) may offer a caption line for a CC BY sticker.

### 10. Tests

- Engine: the sticker item schema, `defaultStickerItem`, the loop rule, a removed sticker's notice.
- Compiler: sticker chain snapshots (still, looping, play-once, rotated, translucent), the `shortest=1` and `format=yuv420` rules, window clipping, the parity cases of section 6.
- Ingest: the guard on recorded candidates (every rejection reason, CC BY allowed for stickers, CC BY refused for sounds' lists in Module 14), dedupe, `--dry-run` writes nothing, the refusal without `CLIPS_LIBRARY_INGEST`, `normaliseSticker` with fake FFmpeg arguments as snapshots and one real run guarded by `ffmpeg` being present.
- API: search (prefix, ranking, no match with `suggest` and a miss row, status filter, tenancy), favourites (workspace-wide, a removed item drops off), upload (type by bytes, 8 MB cap, storage gauge), delete in use, credits grouping.
- Web: the panel (tabs, chips, add at the playhead, star, the "i", badge form, no match, uploaded states, delete confirm), the preview's moving-sticker frame choice.

## Scope

**In**: the sticker item, the catalogue's search and favourites API, the shared ingest engine and its sticker adapters, the licence guard, `normaliseSticker`, own uploads and their check, the compiler's sticker overlays, the preview's sticker layer, the Follow Badge, the Elements tab, the credits page.
**Out**: any outside GIF or sticker service (a commercial provider is Module 21), the operator Library screen (Module 19), sounds (Module 14), sticker animations of our own (bounce in, shake), emoji typed as text, Twemoji and Fluent Emoji (later, research 10).

## Tasks

- [ ] `StickerItem`, `defaultStickerItem`, the `loop` rule, tests.
- [ ] The ingest engine: adapters `own`, `kenney`, `openpeeps`, `noto`; the licence guard; `normaliseSticker`; store, report, publish and remove; the `CLIPS_LIBRARY_INGEST` guard; the seed bundle.
- [ ] Our own sticker art (or the note that it is not ready).
- [ ] The library module: search, categories, favourites, credits; the `StickerProvider` interface and `CatalogueStickerProvider`.
- [ ] Uploads: the route, `clipStickerCheckWorkflow`, list and delete.
- [ ] The compiler's sticker overlays and the parity cases.
- [ ] The preview's sticker layer with `ImageDecoder` and the `<img>` fallback.
- [ ] The Follow Badge spike and build.
- [ ] The Elements panel and sticker bars; the credits page.
- [ ] Title-case test green.
- [ ] Playwright once under simulation: search, add a still and a moving sticker, star one, upload one, export. Screenshots in `screenshots/`.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js stickers render
npx jest --config apps/worker/jest.config.js clips library
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels
npm run clips:library:ingest -- --kind sticker --source own --dry-run
npm run clips:stills
```

## Done When

- A sticker from each category can be found by search or chip, added, moved, resized, turned and timed, and shows in Preview Export.
- A moving sticker moves in the editor and in the export, on the same frame at the stills check; looping and play-once both behave.
- Starring a sticker puts it in Favourites for every member of the workspace; a removed item drops off the list with no error.
- An uploaded PNG, GIF or WebP up to 8 MB becomes usable after its check; a text file renamed `.png` is refused with a sentence; an upload never appears in the shared catalogue.
- The ingest refuses an NC, ND, SA or unknown licence, a branded name and a duplicate, writes a report, and leaves new items `STAGED` until published; it will not start without `CLIPS_LIBRARY_INGEST=true`.
- A fresh environment seeded from the release bundle shows the launch set in all five categories.
- A hidden sticker keeps working in clips that use it; a removed one shows the notice and the export asks first.
- The Follow Badge shows the chosen platform and name in the editor and in the export.
- `/credits/clips` lists every source with its licence, and the Noto line names Google and CC BY 4.0.
- No `KLIPY_API_KEY`, no GIF-search switch and no outside request exist anywhere in the code.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin (the seed has run):

1. Elements, Stickers: pick the Reactions chip, add one. Search "wow" and add another. Move, resize and turn them; set their times on the timeline.
2. GIFs: add an Animated Emoji; watch it move in the editor; hover another tile to see it move there.
3. Star two stickers. Open Favourites: both are there. Sign in as another member: the same two.
4. Search for something that is not there: the sentence and the nearest categories appear.
5. Uploaded: upload a small PNG and a small GIF; each shows "Checking", then is ready. Try a text file named `.png`: refused.
6. Social: add a Follow Badge for Twitch with a name.
7. Export at 720p, then press Preview Export (once Module 15 is in): every sticker is there and the moving ones move.
8. Credits: the page opens and names Noto, Kenney and the rest.

## Handoff

Module 15 exports clips with stickers through the same compiler and asks before dropping a removed one. Module 19 builds the operator's Library screen on the service methods built here and counts uploaded stickers in the workspace's storage. Module 21 holds a commercial provider behind `StickerProvider`, Twemoji and Fluent Emoji, and sticker animations. Sprint 13's AI emoji idea (parked) would add items through `addItem`.
