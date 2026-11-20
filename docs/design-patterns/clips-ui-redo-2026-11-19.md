# Clips UI Redo (2026-11-19)

The owner tested Clips and found it rough: tab bars everywhere, an editor rail that does not look like the app's rail, and no clear way in. This checklist measures what was wrong (Playwright, 1440 by 900, dark, demo workspace), and is ticked as each item is fixed and re-checked.

References: `docs/screenshots/streamladder/01`, `02`, `03`, `04`, `06` to `11`. We copy where things sit and how the flow goes, in PostGear's own neobrutalist look; never their frames or colours.

Re-checked live on 2026-11-19 (1440 by 900, dark, demo workspace, `CLIPS_SIMULATION`), unit tests in `link-box.test.tsx`, `clip-editor.test.tsx`, `audio-panel.test.tsx` and `elements-panel.test.tsx`, and `e2e/clips.spec.ts` updated to the new home. Light mode, Lilac and 1920 px are left for the owner's hand check.

## Clips home (`/[orgId]/clips`)

- [x] **H1. A five-tab bar is the first thing on the page** (Create, Streams, Videos, Clips, Downloads; 446 by 38 px at y 133). Four of the five are lists you reach after you have made something. Fix: no tab bar. The page opens on one entry card; Videos, Clips and Downloads open from their section's See All (a sub view with a Back button, still `?tab=` in the address so old links keep working); Streams opens from Browse Twitch, Browse Kick and Browse YouTube. *Done: `clips-view.tsx` renders one view at a time, the sub view has Back and its name; `?tab=streams` opens the Browse dialog for every platform.*
- [x] **H2. The way in is a thin row.** The link field and Find Video sit on one line, and Upload A Video is a small secondary button (124 by 34 px) beside a help line. Fix: the StreamLadder order in one centred card (max 672 px): which platforms work (logos), the link field, a full-width primary **Find Clips** button, a dashed full-width **Upload Your Own Video** drop area, then one **Browse** button per platform switched on, side by side. Try A Sample stays, as a quiet line under the card. *Done: `home/link-box.tsx`; a video dropped on the area uploads too.*
- [x] **H3. Find Video was off until something was typed**, so an empty press said nothing. Fix: the button is always on; an empty press says "Paste a video link from YouTube, Twitch or Kick." under the field (danger text, read out). *Done: `role="alert"`, `aria-invalid` and `aria-describedby` on the field; the sentence lists only the platforms switched on.*
- [x] **H4. Coming Up shows an empty card** (1296 by 150 px) with "Nothing scheduled yet". Fix: drawn only when a post is coming up. *Done: `hideWhenEmpty` on the home.*
- [x] **H5. Browse Channels opens on every platform at once**, with a second tab bar for the platform. Fix: Browse Twitch opens the browser on Twitch only (its own title, Add A Channel set to Twitch), no platform tabs. *Done: `only` on `BrowseChannelsDialog` and `ChannelBrowser`.*
- [x] **H6. Twitch and Kick have no logo** in `public/icon`. Fix: two tiles, `twitch.svg` and `kick.svg`, through `PlatformIcon`.
- [x] **H7. After an upload nothing happens**: the row says "It is in Videos now" and the user has to find it. Fix: once the video is ready, a clip of the whole video is made and the editor opens (a video over 30 minutes opens its video page, where a part is chosen). The row says what it is waiting for. *Done: `use-open-when-ready.ts` and `opening-row.tsx` (with Stay Here). Uploads, clips and shorts open the editor; videos and streams open their video page. Seen live: the uploaded sample opened the editor on its own.*
- [x] **H8. Simulated sticker** sat at the end of the tab bar. Fix: in the actions row, left side.

## Clip editor (`/[orgId]/clips/edit/{clipId}`)

- [x] **E1. Three framed bars stack up**: the top bar (1416 by 56 px, border and shadow across the whole window), the panel footer, and the timeline toolbar. Fix: the rail and the panel run the full height from the top; the clip's name, save state, Undo, Redo, Shortcuts and Export sit in an unframed row over the stage only. *Done; Shortcuts moved to the bottom of the rail.*
- [x] **E2. The tab rail is not the app's rail.** It differs in five ways: corner (`rounded-card` against `rounded-2xl`), shadow (`surfaceSm` against `surfaceMd`), no brand tile, the open tab has no shadow (the app's active tile has `shadow-brutalSm`), hover is `bg-secondary` against `bg-primary`, and the labels are 12 px against 10 px. Fix: the editor rail uses the app rail's tile and frame (shared from `sidebar.tsx`), with the PG tile on top and Shortcuts at the bottom. *Done: `TILE`, `ANIMATED_TILE_ICON`, `TILE_LABEL` and `RAIL_FRAME` are exported from `sidebar.tsx` and used by `tab-rail.tsx`.*
- [x] **E3. The panel names itself and stops**: no line saying what the tab is for (StreamLadder: "Choose your layout", one sentence). Fix: a one-sentence description under each panel's name, and a button to fold the panel away (the rail opens it again). *Done: `EDITOR_TAB_LINES`; Hide Panel in the panel head, Show Panel in the top row, and pressing the open tab on the rail folds it too.*
- [x] **E4. Back and Next do not say where they go.** Fix: they name the tab ("Layouts", "Effects") with an arrow; there is no Back on the first tab (it was a disabled button). *Done; on Export the button is Export Clip.*
- [x] **E5. Shape is a toggle bar** (Segmented 9:16, 16:9, 1:1, 4:5) at the top of Layouts. The shape is the point of that panel, so it is a choice of tiles: `ChoiceTiles` with a small drawing of each shape. *Done; Crop Ratio is `ChoiceTiles` too.*
- [x] **E6. Elements' tab bar does not fit**: Stickers, GIFs, Favourites and Uploaded in 288 px; "Uploaded" runs into the frame (its right edge at 404 px in a 406 px box). Audio has the same four-tab bar. Fix: `ChoiceTiles` with an icon each, in both panels. *Done as two by two, not four across: four tiles in 288 px would cut the names again.*
- [x] **E7. Two switches both say snapping**: "Enable snapping" under the Video pane and "Snapping" on the timeline. They do different things. Fix: the pane's switch reads "Snap crops to guides" (a form label, so sentence case); the timeline's keeps "Snapping".

## Left for later

- The Sort toggle bars on the Videos and Clips lists stay `Segmented` for now; they could become a dropdown in a later pass.
- `timeline-performance.test.tsx` is a timing test: it passes on its own (4 of 4) and can miss its 500 ms budget when the whole web suite runs at once.

## Decisions taken

- Streams is not a page of its own any more: everything it did (channels, their lists, Add A Channel) is in the Browse dialog.
- The upload-to-editor jump makes a **whole** clip, the same call as Edit Whole Video; nothing is charged for it (making a clip is free). When the clip is refused (too long, not ready), the video page opens instead.
- A pasted link that is imported stays on the home with an opening row, then opens its page once it is ready; it no longer jumps to the Videos list.
- Captions: the reference's rail has Captions; ours keeps **Text** until Sprint 13's captions land, because a tab with nothing in it would be the kind of filler this pass removes.
