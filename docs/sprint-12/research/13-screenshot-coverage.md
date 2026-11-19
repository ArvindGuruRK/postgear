# Sprint 12 Research: Screenshot Coverage Audit

> **Written**: 2026-11-17. Arvind asked whether every screen in the reference screenshots is covered by the Sprint 12 and Sprint 13 documents. This page answers it screen by screen, for all 48 captures (StreamLadder 39, OpusClip 8, VidsSave 1; local only, gitignored). The first pass on 2026-11-15 covered the editing flow well but missed seven things; they were found by this audit and are now in the modules named below. Statuses: **Covered** (a module builds it), **Added** (not in the first pass, now in a module), **Existing** (PostGear already has it), **Parked** (deliberately later, in a P2 module), **Not Planned** (a reason is given).

## 1. The Answer In One Table

| Reference | Screens | Covered | Added by this audit | Existing | Parked | Not planned |
|---|---|---|---|---|---|---|
| StreamLadder | 39 | 22 | 8 | 3 | 1 | 5 (support chat widget, 32 to 36) |
| OpusClip | 8 | 5 | 3 | 0 | 0 | 0 |
| VidsSave | 1 | 1 | 0 | 0 | 0 | 0 |

Anything that was a feature of a reference product but not a screen of its own (for example OpusClip's AI B-roll list) is in section 5.

## 2. StreamLadder, Screen By Screen

| # | Screen | What it shows | Status | Where |
|---|---|---|---|---|
| 01 | Home, paste box with an error | Link box for Twitch, YouTube and Kick; **Find clips from stream**; **Upload your own video**; **Browse Twitch**; **Browse Kick** | Covered, and **Browse** Added | Sprint 12 Modules 03, 04, 06 (the link box and upload); channel browser in 03 and 06 |
| 02 | Home, full page | Tools grid; connect your Twitch or Kick account; **Scheduled posts, next 14 days** with **View calendar** | Covered, and Added | Tools are the Create tab's actions; connect account is My Channels (03, 06); the scheduled panel is **Coming Up** in Module 17 |
| 03 | Choose vertical or horizontal | A dialog asking 9:16 or 16:9 | Covered | Module 08 (the shape dialog, with Square added) |
| 04 | Upload media | Drop box, 200 MB, MP4 and MOV, up to 10 videos | Covered, better | Module 04 and 06 (2 GB, MP4, MOV, MKV, WebM, resumable) |
| 05 | Loading video | Progress while the editor opens | Covered | Module 08 |
| 06 | Layouts | **Fullscreen**, **Blurred**; **Add crop**; **Enable snapping**; a "Gameplay" box label | Covered, and Added | Module 10 (more presets: Three, Four, Gameplay, Screen Share) |
| 07 | Elements | **Reactions**; **Animated Stickers**; **Gifs** from an outside library | Covered | Module 12 (an open-source catalogue instead of the outside library) |
| 08 | Effects | **Zoom**; **Speed Control**; **Effects** (special effects, New); **AI Word Censoring**; **Text To Speech**; **AI Remove Silences**; **AI Hook Intro Title**; **Add A Hook Clip** | Covered, and special effects Added | Zoom, Speed and **Looks** in Module 13; censoring, text to speech, silences, hook title and hook clip in Sprint 13 Modules 04 and 09 |
| 09 | Audio | **Sound Effects** and **Music** tabs; search; **All, Uploaded, Favorites**; categories **Alerts And Notifications**, **Ambient Sounds**; upload up to 5 MB | Covered, bigger | Module 14 (open-source catalogue, categories, favourites, uploads) |
| 10 | Captions | Spoken language; **Create a style**; all styles; popular styles | Covered | Sprint 13 Module 03 |
| 11 | Export | 720p 30 fps, 720p 60 fps, 1080p 60 fps, 4K 60 fps locked; **Export clip** | Covered, 4K parked | Module 15 (720p, 720p60, 1080p, 1080p60; 4K reserved in the plan value and parked in Module 21) |
| 12 | Connection success | A channel connected pop-up | Existing | PostGear's Channels already connect accounts |
| 13 | New post | **Share to**; one caption for all platforms (1,250 characters); a Facebook Reels title and description | Existing | The composer |
| 14 | New post, AI disclosure | **AI Generated Content Disclosure** Yes or No | Covered | Sprint 13 Module 13 (**Made With AI**) |
| 15 | When menu | **Next available**, **Now**, **Schedule**; **Manage posting schedule** | Covered | Sprint 13 Module 13 |
| 16 | Schedule dialog | Calendar, the times already scheduled that day, a time field, **Pick a random time**: Morning, Noon, Afternoon, Evening | Added | Sprint 13 Module 13 (random time of day picker) |
| 17, 18 | Post now | **Post now** with **Enter** | Existing | The composer's Post Now |
| 19, 20 | Select a clip | A modal listing exported clips; **Sort** Newest and Oldest; list and grid view; **Upload file** | Added | Module 17 (a **Clips** tab in the media picker) |
| 21, 22 | Templates | **Save or select template**; create a template with a colour, a name, text | Existing | PostGear's Signatures and Tags cover saved text; a colour label on a saved text adds nothing for posting, so no new work |
| 23 | Posting slots, generated | "21 a week" slider; **Your week, generated**; **Shuffle times**; the same times each day | Covered | Sprint 13 Module 13 |
| 24 | Posting slots, exact | Each time with **plus or minus 15 min** and chosen weekdays; **Add another time**; "Each post goes out at a natural minute within the window" | Added | Sprint 13 Module 13 (per-time window and per-weekday slots) |
| 25 | Clips library | Tabs **All, New, Draft, Exported, Scheduled, Hidden** with counts; **Sort**; **Source** filter; list and grid view; **Create new clip** | Covered, and Added | Module 07 (adds the **Source** filter and list or grid) |
| 26 | Montage Maker | Pick 2 to 10 clips; **Create montage** | Covered | Sprint 13 Module 11 |
| 27 | Schedule Maker | Twitch username; five themes (Clean Blue, Light Blue, Cool, Dark, Red); **Edit schedule**; **Download schedule** | Added | Sprint 13 Module 14 (**Creator Tools And Editor Seats**) |
| 28 | Clip Downloader | Paste a Twitch or Kick clip link; **Get clip** | Covered | Module 18 (and Sprint 13 Module 12 for more sites) |
| 29 | Emote Maker | A clip, a square crop, a trim bar, **Emote preview**, **Twitch chat preview**, exports for Twitch, 7TV and BTTV | Added | Sprint 13 Module 14 |
| 30, 31 | Upload progress, uploaded clip preview | Progress ring; the file name used as the first caption | Covered | Module 04 and 17 (the draft caption starts from the clip's name) |
| 32 to 36 | Support widget | A chat widget: messages, a help-centre list, updates | Not Planned | A support chat is a company-level decision, not a Clips feature; PostGear's help links cover it |
| 37 | Ready to post | A filled title and description | Existing | The composer |
| 38 | Streams, empty | **Connect your Twitch or Kick account**; **Show hidden**; **Sort**; "0 streams" | Added | Module 03 and 06 (**My Channels** and the **Streams** list) |
| 39 | ClipGPT modal | "Paste a stream URL"; **Find clips from stream**; **Upload your own video**; **Browse Twitch**, **Browse Kick** | Covered, and Added | Sprint 13 Module 05 (Clip Setup) and the channel browser |
| Nav | **Editors (New)** | Invite an editor to help | Added | Sprint 13 Module 14 (**Editor Seats**) |

## 3. OpusClip, Screen By Screen

| # | Screen | What it shows | Status | Where |
|---|---|---|---|---|
| 01 | Landing, sources tooltip | "Drop a video link or upload a file"; supported: YouTube, Google Drive, Vimeo, Zoom, Rumble, Twitch, Facebook, LinkedIn, X, Loom, Riverside, StreamYard; 20+ languages | Covered | Sprint 13 Module 12 (the site table, Google Drive; Riverside and StreamYard stay upload only) |
| 02 | Home | Tabs **Clip long video**, **Auto-edit footage**, **Open editor**; link, **Upload**, **Google Drive**, **Try a sample project**; recipe chips (**Clean up recording**, **Auto-edit talking videos**, **Captions**, **Reframe**, **Upscale**, **Social edits**, **AI B-roll**, **Translate and dub**); demo projects | Covered, and Added | Clip long video is Sprint 12; **Edit Whole Video** (Open editor) in Module 07; **Auto-Edit Video** and the starter recipes (Auto-edit and the chips) in Sprint 13 Module 10; a sample project is the simulation sample under a **Try A Sample** button in the Create tab (Module 06) |
| 03, 04 | Editor | Transcript on the left with **Speech cleanup**, search, filter, download; **9:16**, **Layout: Fill**, **Track: ON**; the **AI enhance** list; the right rail **AI enhance, Captions, My library, Brand kit, B-roll, Hook, Transitions, Text, Graphics, Audio**; hide timeline | Covered, partly | Transcript pane and cleanup in Sprint 13 Module 04; Track in Module 08 of Sprint 13; the right rail is our left tab rail (Layouts, Elements, Text, Effects, Audio, Captions, Export); **My library** is the Uploaded and Favourites views in Modules 12 and 14; **Transitions** is parked (Module 21 item 4); **B-roll** Not Planned |
| 05, 06 | Home, rotating link placeholder, recent projects with an ETA | "Drop a Rumble link"; a card at 21% with "ETA 7m"; **Auto-import: Off** | Covered, and Added | Module 06 (job cards show "about N minutes left"); auto-import is parked (Module 21 item 11) |
| 07 | Clip setup | **Adjust range** with **Credit saver**; speech language; genre; layout; **Upload SRT**; **Recipe**; **Brand kit**; **Clipping** with AI picks, clip length, moments to include; **Captions** styles; **Auto hook** (Editorial, Statement, Classic); motion graphics; AI emojis; auto B-roll; speech cleanup; enhance audio; auto SFX; auto zoom; auto transitions; auto colour correction; voice dubbing; caption translation; the **Summary** with credits; "you confirm you have rights" | Covered, and Added | Sprint 13 Module 05 (the setup page) with **Genre** Added; **Upload SRT** Added in Module 03; the rest as listed in section 5 |
| 08 | Ratio and layouts | 9:16, 16:9, 1:1, 4:5; layouts AI can use: Fill, Fit, Split, Three, Four, Screen Share, Gameplay; **Fit layout: crop ratio** Original, 4:3, 1:1 | Covered, and Added | Module 10 (all seven layouts and the crop ratio as data presets; 4:5 added as a shape) |

OpusClip sidebar (screens 02 to 06): **Home, My projects, Brand kit, Asset library, Calendar, Analytics, Social accounts**: Existing or Covered (Videos and Clips tabs, Sprint 13 Module 10's brand kit, Media, Calendar, Analytics and Channels already in PostGear). **Opus Labs**, **API access**, **Learning center**, **Help center**: **API access** is parked (a public Clips API in Module 21); the others are Not Planned.

## 4. VidsSave

| Screen | What it shows | Status | Where |
|---|---|---|---|
| Full page | Paste a link, format list (1080p, 720p, 360p, MP4, audio), many platforms (YouTube, Facebook, TikTok, Instagram, Pinterest, Reddit, Threads, Dailymotion), guides and FAQ | Covered | Sprint 12 Module 18 (the format list, audio only, Save File); sites in Sprint 13 Module 12 (Reddit, Pinterest and Threads added to the table; TikTok and Instagram built but off) |

## 5. Features Seen In The References That Are Not In Any Screen List

| Feature | Seen in | Status | Where |
|---|---|---|---|
| Auto viral hook, headline styles | OpusClip 07 | Covered | Sprint 13 Module 09 (three hook looks) |
| AI emoji, keyword highlighter | OpusClip 07, 03 | Parked | Sprint 13 Module 17 (P2) items 4 and 5 |
| Auto zoom, auto transitions, auto sound effects | OpusClip 07 | Parked | Sprint 13 Module 17 (P2) items 6 and 7 |
| Enhance audio, speech enhancement | OpusClip 07, 03 | Parked | Sprint 13 Module 17 (P2) item 8 |
| Voice dubbing | OpusClip 07, 03 | Parked | Sprint 13 Module 17 (P2) item 17 |
| Remove filler words, pauses | OpusClip 03 | Covered | Sprint 13 Module 04 |
| Remove bad takes | OpusClip 03 | Parked | Sprint 13 Module 17 (P2) item 3 |
| Eye contact correction | OpusClip 03 | Not Planned | Changes a person's face; high risk |
| Auto colour correction | OpusClip 07, 03 | Added as **Looks** | Module 13 (manual looks; no AI) |
| Motion graphics, AI B-roll, upscale | OpusClip 07, 02 | Not Planned | Each is a product of its own (research 01 of Sprint 13) |
| Virality score | OpusClip | Not Planned | Our score gives reasons instead |
| 4K export | StreamLadder 11 | Parked | Module 21 item 2 |
| Auto-import from a channel | OpusClip 05 | Parked | Module 21 item 11 |
| Share by link, Home card, global search | (PostGear ideas) | Parked | Module 21 |

## 6. What Changed In The Documents Because Of This Audit

1. **Module 03 and 06 (Sprint 12)**: My Channels. Add a Twitch, YouTube or Kick channel by handle and browse its streams and clips. Research: [`11-channel-browser.md`](11-channel-browser.md).
2. **Module 07 (Sprint 12)**: Edit Whole Video; a **Source** filter and a list or grid switch in the Clips tab.
3. **Module 10 (Sprint 12)**: Three, Four, Gameplay and Screen Share layouts and the Fit crop ratio, as data presets.
4. **Module 13 (Sprint 12)**: Looks and fades, beside Zoom and Speed Control.
5. **Module 14 (Sprint 12)**: the sound library gets categories, search, favourites and uploads, as the Audio screen shows.
6. **Module 15 (Sprint 12)**: 720p 60 fps.
7. **Module 17 (Sprint 12)**: the Clips tab in the media picker and the **Coming Up** panel.
8. **Sprint 13 Modules 03, 05, 10, 12, 13**: Upload SRT, Genre, starter recipes and Auto-Edit Video, Reddit, Pinterest and Threads, per-time windows and per-weekday posting slots and the random time picker.
9. **Sprint 13 Module 14 (new)**: Emote Maker, Schedule Maker and Editor Seats. Research: [`../../sprint-13/research/10-creator-tools-and-editor-seats.md`](../../sprint-13/research/10-creator-tools-and-editor-seats.md).

**The three things PostGear deliberately does differently**: a bigger upload limit and more formats than StreamLadder's 200 MB, an open-source sound and sticker catalogue instead of an outside GIF provider, and posts with a built-in rights record.

## Re-Read Against The Finished Build (2026-11-19)

Re-read at the Sprint 12 close-out (Module 20). Every row that points at a Sprint 12 module is built: the link box, upload, Browse and My Channels (Modules 03, 04, 06), the shape dialog and loading (08), the layouts with Gameplay and Screen Share (10), Elements on our own catalogue (12), Zoom, Speed Control and Looks (13), Audio with the bigger shelf structure (14), the four export qualities 720p, 720p60, 1080p and 1080p60 with 4K reserved (15), the Clips library tabs with counts, Platform filter and views (07), Select A Clip in the media picker and the caption from the clip's name (17), the Clip Downloader (18), Coming Up for 14 days (17) and Try A Sample (06). Every row that points at Sprint 13 is still planned there, and the Existing, Parked and Not Planned rows are unchanged. No row moved status. The one known difference: Elements and Audio launch with our own 193 stickers and 92 sounds, not the open catalogues, until the outside packs are fetched with the owner's OK (Module 12 and 14 gaps).
