# Module 21: P2 Backlog (Only When You Decide)

> **Sprint 12, Clips** | Status: Parked | Size: as picked
> **Depends on**: [Module 20](module-20-hardening-e2e-worker-image-closeout.md)
> **Stories**: none (extras no numbered story covers yet)
> **Rule**: nothing here starts without Arvind's word. Sprint 13 comes first unless he says otherwise.

## How To Use This Module

Pick items by number in a session: "We are doing Module 21, items 3 and 7." Each item is small enough for part of a session. The session reads this page, the README's rules, and the module named in the Notes column, then follows the usual kickstart steps. Tick the item here when it is done and write a Decision Log row.

Things that belong to Sprint 13 (captions, transcripts, smarter AI, Auto-Reframe, bleeping, hook titles, recipes, montage, batch export, more link sites, posting slots, creator tools) are not listed here; see [`../../sprint-documents/sprint-13-clips-ai.md`](../../sprint-documents/sprint-13-clips-ai.md). Things that were here and are now built in Sprint 12 itself: more layouts (Three, Four, Gameplay, Screen Share and the Fit crop ratio, Module 10), Looks and fades (Module 13), channel browsing (Modules 03 and 06), the open sound and sticker libraries with uploads and favourites (Modules 12 and 14), and rendering by FFmpeg only (decision D12-04, so there is no browser renderer to add).

## The Backlog

| # | Item | What it adds | Notes |
|---|---|---|---|
| 1 | **Smooth Speed Ramps** | A part that eases from one speed to another | Feasible with FFmpeg `setpts` expressions (and `atempo` steps for the sound), so it is a compiler change plus a curve control; the preview then needs the same curve in `frameState`. Parity is guarded by the compiler tests and Preview Export. Module 13 |
| 2 | **4K Export** | A fourth quality for the top plans | `4k` is already in the `clips.export_max_quality` enum as reserved. Only if the Module 05 benchmark and the real test show the render host can do it; Instagram and Threads refuse widths over 1920, so the send dialog must say so. Modules 15, 17 |
| 3 | **Reverse And Freeze Frame** | Play a part backwards; hold one frame for a moment | FFmpeg's `reverse` and `areverse` hold the whole part in memory, so limit reverse to short parts; freeze is a held frame or a still image item over the video. Confirm the recipe in the FFmpeg cookbook first. Module 13 |
| 4 | **Transitions Between Parts** | A fade or a slide where two parts meet | FFmpeg `xfade` and `acrossfade`; overlaps two segments, so the time map needs an overlap rule and the preview needs the same blend. Modules 01, 09 |
| 5 | **Multi-Select And Align** | Select several items; move, delete and align them together | The selection becomes a set; the handle layer draws a group box. Modules 09, 11 |
| 6 | **Reorder Parts** | Drag a part of the video to another place in the clip | The segment list already allows any order; this is a timeline gesture and its undo. Module 09 |
| 7 | **Text Animations** | Ready ways for text to come in and go out (pop, slide, type on) | Presets as data on `TextItem`; drawn as ASS tags (fade, move, transform) by the compiler and the same in the preview. Module 11 |
| 8 | **A Licensed Music Catalogue** | More and better music than the CC0 pack | A commercial provider with a SaaS licence that allows redistribution inside a product; needs a contract and Arvind's choice, and a new licence code (`COMMERCIAL`) added to the allow-list on purpose. It enters through the same `ClipSound` table. Module 14 |
| 9 | **Lower Music Under Speech** | Music that drops by itself when someone talks | Needs the speech track from Sprint 13; a volume curve on the sound item. Module 14 |
| 10 | **Twitch Seek-Bar Pictures At Probe** | A filmstrip before the video is even imported | yt-dlp returns Twitch's own storyboards (research 03). Shown on the link card and the channel list. Modules 03, 06 |
| 11 | **Auto-Import From A Channel** | New streams from a channel in My Channels appear in Videos by themselves | Builds on the channel lister of Module 03, run on a schedule; only the import is automatic, not the rights tick, which becomes a one-time agreement per channel. Needs Arvind's decision on that wording and an allowance per plan |
| 12 | **Twitch's Official Clip Routes For Owners** | For a connected Twitch channel, cut and download clips through Twitch's own API instead of yt-dlp | Research 04 lists the routes (Create Clip From VOD, Get Clips Download); they need the owner's login. A second `Downloader` binding chosen when the channel is connected |
| 13 | **Safari** | Clips working in Safari | Check the video tag's fallback rules, the preview's `requestVideoFrameCallback` use, APNG stickers and the upload path there. Research 05 |
| 14 | **Re-Encode To Fit A Platform** | A clip over a platform's size cap is made smaller for that platform when sent | `fitsBitrate` already knows the number (Module 15); a second, smaller export attached to that channel only. Module 17 |
| 15 | **Share A Clip By Link** | A view-only address for a client to approve a clip | Like Studio's shares (`DesignShare`): a token, an expiry, a public player page |
| 16 | **A Home Card For Clips** | Recent clips and "bring in a video" on the Home page | One card, following Home's rules |
| 17 | **Clips In The Global Search** | Videos and clips found from the top bar | A new source in the search module |
| 18 | **Usage Emails** | A weekly note: clips made, space used, AI minutes left, videos about to be removed | The email package; an opt-in in notification settings |
| 19 | **A Commercial GIF And Sticker Provider** | Film, TV and meme GIFs that the open catalogue cannot have | Behind the `StickerProvider` interface, optional and off by default. Needs a provider whose terms allow showing and keeping results inside a paid product (Klipy, Giphy and Tenor were each rejected in research 10); written terms and Arvind's choice first. Module 12 |
| 20 | **Openverse And Freesound Ingest (After Written Permission)** | The second tier of the sound and sticker catalogue (about 350 more sounds, a handful of GIFs) | The adapters exist behind `CLIPS_INGEST_OPENVERSE_OK` and its Freesound twin; they stay off until Openverse and Freesound answer in writing about commercial use and limits. Run as operator ingests, reviewed in the Library screen. Modules 12, 14, 19 |
| 21 | **Storage Add-Ons Billing** | A workspace buys extra video space (or import minutes) on top of its plan | A per-workspace override on `clips.storage_gb` created by a Stripe purchase instead of by an operator; needs prices and a webhook branch. The entitlement model already supports the override. Modules 01, 19 |
| 22 | **A Public Clips API** | `POST /v1/clips` style routes for customers' own tools (import, find clips, export, send) | Like the public `/v1` API that exists: API keys, scopes and the same entitlements and meters as the app, so a key can never do more than the plan. Needs a security review first |

## Done When

Each picked item has its own short "Done When" written in the session's plan before building, is checked by hand, and is recorded in the Progress table as "21 (item N)".
