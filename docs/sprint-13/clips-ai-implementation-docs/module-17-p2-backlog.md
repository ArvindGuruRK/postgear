# Module 17: P2 Backlog (Only When You Decide)

> **Sprint 13, Clips AI** | Status: In progress (items 3, 9, 10, 18, 25, 26 picked 2026-11-28) | Size: as picked
> **Depends on**: [Module 16](module-16-hardening-e2e-closeout.md)
> **Stories**: none yet (each picked item brings its own)
> **Rule**: nothing here starts without Arvind's word.

## How To Use This Module

Pick items by number in a session: "We are doing Module 17, items 2 and 9." The session reads this page, both READMEs' rules, and the module named in the Notes column, then follows the usual kickstart steps. Each picked item gets its own short "Done When" in the session's plan, a Hand Check, a tick here and a Decision Log row. Sprint 12's own parked items are in [its Module 21](../../sprint-12/clips-implementation-docs/module-21-p2-backlog.md).

Where research 01 judged a reference product's feature to be a product of its own, it is listed under "Not Planned" with the reason, so nobody builds it by accident.

**Built since the first plan, so no longer on this list**: Editor roles, the Emote Maker and the Stream Schedule Maker (all Module 14, decision D13-15), captions from a file (Upload SRT, Module 03), different posting times per weekday (posting slots, Module 13). Caption and title templates with colours are built only if Module 13 chose to; if its Decision Log says so, strike item 12 below.

## The Backlog

| # | Item | What it adds | Notes |
|---|---|---|---|
| 1 | **A Speaker Model** | Choosing who is talking with a model made for it, in place of Module 08's heuristic | The heuristic is isolated in `reframe/speaker.ts`. Research 06 names two candidates whose code is permissive but whose trained files have unclear terms; settle that first |
| 2 | **Who Said What** | Names on speakers in the transcript ("Host", "Guest") and captions coloured per speaker | Needs voice grouping, which pulls in the heavy library research 04 advised against. Revisit when a light option exists |
| 3 | **Remove Bad Takes** | Find repeated starts of the same sentence and keep the last | A transcript pass (repeated word runs) plus Module 04's cuts; show them first, as silences are shown |
| 4 | **Keyword Highlighter** | AI picks the two or three words in each caption page to colour | A small model call per clip; a `highlight` flag in the captions track's `edits`. Highlight whole words only for Tamil and Hindi (research 09) |
| 5 | **AI Emoji** | An emoji beside a caption page where it fits | Stickers through `addItem`, placed from a model's picks; colour emoji are sticker overlays, never text (libass draws emoji in one colour); must be easy to switch off |
| 6 | **Auto Zoom** | Gentle zooms on emphasis, placed by AI | Zooms from Sprint 12 Module 13, placed from loudness and sentence starts; one undo step |
| 7 | **Auto Sound Effects And Transitions** | A whoosh on a cut, a pop on a sticker | Sound items from the catalogue; depends on Sprint 12 Module 21's transitions for the picture side |
| 8 | **Enhance Sound** | Cleaner voice: less noise and room echo | A separate sound model on the Python side; a new AUDIO asset the clip can switch to |
| 9 | **Lower Music Under Speech** | Music drops when someone talks | The `speech` track drives a volume curve on the sound item |
| 10 | **Export The Transcript** | Download the text or an SRT of a clip or a video | **Done 2026-11-28** (Decision Log, 17 (item 10)). A route that writes from the transcript through the time map |
| 11 | **Templates For Titles And Captions** | Saved post titles and captions with a colour label, as StreamLadder's publisher has | PostGear's Signatures are the nearest thing today; this would extend them. Composer work, not Clips |
| 12 | **Best Times From Analytics** | Suggest posting times from when past posts did well | Needs enough analytics history per channel; feeds Module 13's posting slots |
| 13 | **Auto-Import And Auto-Clip** | New videos from a connected channel are brought in and clipped with a chosen recipe, ready for review | Builds on Sprint 12 Module 21's auto-import; adds a recipe and a run per new video (the Auto-Edit planner of Module 10 does the clipping); must respect the plan's meters (import minutes and AI Minutes), refuse when they run out, and never post by itself |
| 14 | **Weekly Montage** | A "best of the week" montage made from the top clips | Module 11's montage from a saved rule |
| 15 | **Share Recipes Between Workspaces** | An agency copies a recipe from one client to another | Export and import of the validated settings |
| 16 | **A Rented Graphics Card Lane** | Listening and face finding on a card rented by the second | Module 15 documents it; this builds the provider and its switch |
| 17 | **Voice Dubbing** | The clip's speech in another language with a made-up voice | Translation exists (Module 03); this adds a voice per sentence fitted to the timing. Needs the text-to-speech decision of Module 09 and the AI label always on |
| 18 | **Blur A Face Or A Region** | Hide a bystander or a screen area for the whole clip | Face boxes from Module 07, or a hand-placed box, drawn by the render plan as a blurred region (the cheap downscaled blur path of Sprint 12 Module 10) |
| 19 | **Editors Can Schedule, With Approval** | A workspace switch that lets Editors schedule, or a **Request Approval** state on drafts that an admin approves before anything is queued | Module 14 settled that Editors cannot schedule in v1 (D13-15). This adds either an entitlement-style boolean per workspace set by the admin, or a draft state plus an approval inbox. Needs `assertEditorMayWrite` to learn the new state and the route matrix to list it |
| 20 | **Editor Activity And Per-Editor Caps** | A Team page tab showing who changed what, and a monthly AI Minutes cap per Editor | An `AuditEntry` table beyond Module 14's four security log events; the usage ledger already carries `meta.by` |
| 21 | **Model-Based Background Removal For Emotes** | Remove a busy background from an emote without a green screen | A person-segmentation model on the Python side over about 60 frames; the licence of the model weights must be read first, as for every asset. Module 14 ships the colour key only |
| 22 | **Emote Extras** | Animated emotes with effects, a flash check that warns about Twitch's rule of 3 flashes a second, sets for a whole emote pack | Small additions on Module 14's `emotes/` profiles |
| 23 | **A Public Clips API** | `/v1/clips`: create clips, start exports and read their status with an API key | Follows the existing `/v1` API-key routes and the SDK package. Needs per-key meters and the route matrix to list the routes as API-key only. OpusClip has API access |
| 24 | **An Optional Commercial GIF Provider** | Search a larger GIF and sticker library behind a workspace switch | Added behind Sprint 12 Module 12's `StickerProvider` interface; needs terms that allow storing and re-serving, which is why Klipy was dropped. Off by default, named in the privacy text |
| 25 | **Metering Schedule Pictures** | Count a schedule picture export against `clips.downloads_per_day` or a Design Studio limit | **Done 2026-11-28** (Decision Log, 17 (item 25)). One `consume` call in Studio's export route; Module 14 left Studio's export alone |
| 26 | **Per-Workspace Privacy Switch For The Hosted Lane** | A workspace can force listening to stay on our own machine | **Done 2026-11-28** (Decision Log, 17 (item 26)). Decision D13-03's "reopen if"; a setting plus a check in the transcriber choice |

## Not Planned

| Feature seen in a reference product | Why not |
|---|---|
| AI B-roll (stock or generated footage laid over speech) | Needs a licensed footage library or a video-generating model, with rights and cost questions of its own |
| Eye contact correction | Changes a person's face; high risk, heavy models, little demand for our users |
| Upscaling to a higher resolution | Heavy graphics-card work for little gain on phone screens |
| Motion graphics packs and auto colour correction | Each is a large design or imaging feature of its own (manual Looks exist in Sprint 12) |
| Cloned voices | Rights and misuse risk; not without a clear legal read and consent flow |
| A "virality score" | Nobody can promise it; our score says why a moment was picked instead (D13-14) |
| A public downloader page | Decided in Sprint 12: the downloader stays inside the signed-in app |
| A support chat widget (StreamLadder screens 32 to 36) | A company-level decision with its own staffing and tooling, not a Clips feature; PostGear's help links cover it |
| Opus Labs (OpusClip's experimental area) | A reference product's own lab of unfinished ideas; nothing in it is a feature we have decided to offer. Real requests come back as items here |
| A learning center | Articles, courses and video lessons are a content and support project, not an app feature. The in-app help sentences and the docs cover what is needed |

## Done When

Each picked item has its own "Done When" in the session's plan, is checked by hand, and is recorded in the Progress table as "17 (item N)".
