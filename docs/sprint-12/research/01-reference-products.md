# Sprint 12 Research: Reference Products

> **Written**: 2026-11-14. Screens are described from the local reference captures in `docs/screenshots/` (gitignored, on this machine only). Prices marked **verified** were read on the vendor's own page that day; **reported** means the vendor page could not be opened and the figure comes from a secondary source.
> **How the screens were read**: 24 of the 48 captures were opened for this file (StreamLadder 01 to 04, 06 to 11, 13, 16, 23 to 25, 38, 39; OpusClip 01 to 03, 05, 07, 08; VidsSave). The rest are described from their file names, which were written when they were captured.
> **Rule for this sprint**: we copy flow and placement, never code, art, sounds or wording. PostGear draws every screen in its own design system.

## 1. The Short List

| Product | Best at | Price today | Link sources | Verdict for us |
|---|---|---|---|---|
| StreamLadder | The whole streamer loop: paste a clip or stream link, edit to vertical in a six-tab editor, schedule it | Free; Starter ₹1,455, Creator ₹2,619, Pro ₹3,783 a month, as shown to a visitor in India, "2 months free" on yearly (app.streamladder.com/upgrade, verified 2026-11-14; USD prices not shown) | Twitch, Kick, Trovo, YouTube for the editor; Twitch and Kick only for ClipGPT; upload 200 MB free, 2 GB paid, 10 GB for ClipGPT | **Primary Reference** (flow and screens) |
| OpusClip | AI clipping of long talking videos: one setup screen, credits, recipes, brand kit | Free; Starter $15 a month; Pro $29 a month; Business custom (opus.pro/pricing, verified 2026-11-14) | Free: upload and YouTube. Starter adds Google Drive, Vimeo, Zoom, Rumble, StreamYard. Pro adds Twitch, Facebook, Instagram, TikTok, LinkedIn, X, Loom, Riverside, Dropbox and a public MP4 link | **Primary Reference** (AI features, Sprint 13) |
| VidsSave | A one-box downloader with a format row | Free, says ad-free (vidssave.com, verified 2026-11-14) | YouTube, TikTok, Instagram, Facebook, Pinterest, Reddit, Threads, Dailymotion | **Secondary Reference** (the Download flow only) |
| Eklipse | Automatic gaming highlights from streams | Premium $24.99 a month, $179.99 a year; the free plan became a preview with no export in 2026-06 (reported: eklipse.gg answered 403; figures from its help centre through search) | Twitch, YouTube, Kick, Facebook (reported) | **Feature Ideas** (game-aware highlights) |
| Klap | Link in, a batch of captioned shorts out | Basic $29, Pro $79, Pro+ $189 a month; half that billed yearly; 100, 300 and 1,000 clips a month; source up to 3 hours (klap.app/pricing, verified 2026-11-14) | Not listed on the pricing page | **Feature Ideas** (pricing by clips, not minutes) |
| Vizard | Long video to clips, with a team workspace | Free 60 credits; Creator and Business 600 to 6,200 credits; the price figures did not render (vizard.ai/pricing, verified 2026-11-14 for limits; prices reported as unknown) | Not listed on the pricing page | **Feature Ideas** (free limits: 1 GB, 60 minutes, 720p, 3-day storage) |
| Submagic | Caption styles, B-roll and zooms on short videos | Starter ₹666, Pro ₹1,666, Business ₹4,999 a member a month, billed yearly (submagic.co/pricing, verified 2026-11-14) | Upload first; "Magic Clips" takes a link (reported) | **Feature Ideas** (caption styles, Sprint 13) |
| CapCut (web) | A full general editor with templates | The pricing page showed no figures from this location (capcut.com/pricing, opened 2026-11-14); prices reported as unknown | Upload only | **Out Of Scope** (a general editor, not a clipper) |
| Descript | Editing video by editing its transcript | Free; Hobbyist $16 or $24; Creator $24 or $35; Business $50 or $65 a person a month (descript.com/pricing, verified 2026-11-14; the lower figure is likely annual billing) | Upload and recording | **Secondary Reference** (transcript editing, Sprint 13) |

Three things stand out in that table:

- Everyone gates on the same four levers: export quality, watermark, storage days and AI minutes or credits.
- Link import is treated as a paid feature. OpusClip gives YouTube to everyone and keeps Twitch and the social sites for Pro. StreamLadder keeps ClipGPT for its second paid tier.
- Free storage is short. OpusClip and Vizard both expire free media after 3 days (verified on their pricing pages). This supports a short retention default in `07-legal-limits-cost-and-risks.md`.

## 2. StreamLadder, Screen By Screen

### 2.1 Home

[`02-home-full-page-tools-connect-account-scheduled-posts.png`](../../screenshots/streamladder/02-home-full-page-tools-connect-account-scheduled-posts.png), [`01-home-paste-url-error-twitch-youtube-kick.png`](../../screenshots/streamladder/01-home-paste-url-error-twitch-youtube-kick.png)

- Three platform chips (Twitch, YouTube, Kick) sit above one question: "What will you create today?".
- One card holds everything: a link field whose placeholder rotates ("Paste a Kick clip URL..."), a filled **Find clips from stream** button, a dashed **Upload your own video** button, then **Browse Twitch** and **Browse Kick**.
- An empty or wrong link turns the field red and prints one line under it: "Paste a clip or stream URL from Twitch, YouTube or Kick".
- Below: a row of eight tool cards (ClipGPT, Clip Editor, Video Editor, Scheduler, Montage Maker, Schedule Maker, Clip Downloader, Emote Maker), a "Connect your Twitch or Kick account" card, then "Scheduled posts" for the next 14 days with an empty state and one button.
- The left rail: Create new, Home, Streams, Clips (with Draft and Exported under it), Schedule & Post, Social connections, Editors.

### 2.2 The Fork After A Link

[`03-edit-clips-choose-vertical-or-horizontal.png`](../../screenshots/streamladder/03-edit-clips-choose-vertical-or-horizontal.png), [`04-edit-clips-upload-media-200mb-mp4-mov.png`](../../screenshots/streamladder/04-edit-clips-upload-media-200mb-mp4-mov.png)

- "What do you want to do?" offers two large tiles with a tiny sample picture each: **Edit to vertical** (9:16 for TikTok, Shorts and Reels) and **Edit to horizontal** (16:9 for YouTube). Cancel and Continue under them.
- Upload is a dialog with one dashed drop zone: up to 10 videos, 200 MB a file on the free plan, `.mp4` and `.mov` only.

### 2.3 Streams

[`38-streams-empty-connect-twitch-or-kick.png`](../../screenshots/streamladder/38-streams-empty-connect-twitch-or-kick.png), [`39-clipgpt-find-clips-paste-twitch-vod-url.png`](../../screenshots/streamladder/39-clipgpt-find-clips-paste-twitch-vod-url.png)

- A plain list page: Sort, Show hidden, a count ("0 streams") and **Find clips from stream** top right.
- Find clips opens a dialog that repeats the home card, but with Twitch and Kick chips only and "Paste a Twitch VOD URL...". ClipGPT does not take YouTube.

### 2.4 Clips Library

[`25-clips-library-status-tabs-connect-account.png`](../../screenshots/streamladder/25-clips-library-status-tabs-connect-account.png)

- Status tabs with a coloured dot and a count each: **All, New, Draft, Exported, Scheduled, Hidden**. AI finds land in New; nothing is a separate "AI results" screen.
- Sort and Source filters on the left; a clip count and a list or grid switch on the right; **Create new clip** top right.

### 2.5 The Clip Editor

The editor is a full window. A narrow icon rail on the left holds six tabs in working order: **Layouts, Elements, Effects, Audio, Captions, Export**. The open tab's panel sits beside the rail and can be collapsed. Back and next buttons at the bottom right ("<- Layouts", "Effects ->") walk the tabs in order, so a new person is led through the whole edit.

| Tab | What the panel holds | Screenshot |
|---|---|---|
| Layouts | Two layout tiles, **Fullscreen** and **Blurred**. The stage shows the source on the left with a named crop box ("Gameplay") and the result under "Preview" on the right. **+ Add crop** and an **Enable snapping** switch under the source | [`06`](../../screenshots/streamladder/06-clip-editor-layouts-fullscreen-blurred-add-crop.png) |
| Elements | Reactions, then **Animated Stickers** and **Gifs**, each marked "Powered by KLIPY" with View all. A three-column grid. Text and social stickers ("Follow me", "Thanks for 100K Subscribers") sit on the canvas | [`07`](../../screenshots/streamladder/07-clip-editor-elements-stickers-gifs.png) |
| Effects | A list of rows, each an icon, a name and one line: Zoom, Speed Control, Effects (New), AI Word censoring, Text to speech, AI Remove silences, AI Hook intro title, Add a hook clip (New) | [`08`](../../screenshots/streamladder/08-clip-editor-effects-zoom-speed-censor-silences-hook.png) |
| Audio | Two tabs, **Sound Effects** and **Music**. A search field, category chips (All, Uploaded, Favorites, Alerts & Notifications, Ambient Sounds), an upload box (5 MB; mp4, mp3, wav, aac), then rows with a play button, a name and a length | [`09`](../../screenshots/streamladder/09-clip-editor-audio-sound-effects-music.png) |
| Captions | Spoken language (Automatically detect), Custom styles with **Create a style**, then style tiles grouped as All styles, Popular, Cozy, each drawn in its own lettering | [`10`](../../screenshots/streamladder/10-clip-editor-ai-captions-styles-language.png) |
| Export | Four radio rows and one **Export clip** button | [`11`](../../screenshots/streamladder/11-clip-editor-export-quality-720p-to-4k.png) |

**Timeline controls** (visible in every editor capture, clearest in [`06`](../../screenshots/streamladder/06-clip-editor-layouts-fullscreen-blurred-add-crop.png)):

- Undo and Redo sit top left of the stage, not in a menu.
- Under the stage: the time read-out ("0:00.0 / 18:02.1"), then rewind, play, forward in the centre, and on the right volume, fullscreen, a zoom slider with minus and plus, and two view icons.
- A slim tool row above the ruler: **split** (scissors), **trim start to playhead**, **trim end to playhead**, **delete** (red).
- A ruler with minute marks, a white playhead, and the clip as one solid bar. Adding an element adds a thin second track above it.

**Export quality tiers** ([`11`](../../screenshots/streamladder/11-clip-editor-export-quality-720p-to-4k.png)), matched to the plans table (app.streamladder.com/upgrade, verified 2026-11-14):

| Row | Label | Free plan | Plan that unlocks it |
|---|---|---|---|
| 720p, 30 fps | Standard 720p, "Content creation starts here" | open, selected | Free |
| 720p, 60 fps | 720p High Frame Rate | locked (green gem) | Starter |
| 1080p, 60 fps | Full HD 1080p, "Best for creators" | locked (green gem) | Starter |
| 4K, 60 fps | Ultra HD 4K | locked (diamond) | Pro |

The same green gem marks every paid item on the free plan: stickers, GIFs, each effect row, the audio upload and the Captions tab. A banner across the top ("Try everything for free") is always there.

### 2.6 The Publisher

| Screen | What it shows | Screenshot |
|---|---|---|
| New post | Left: **Share to** (channel avatars with a tick, a plus to add), **Caption** ("Written once, posted everywhere", 0 / 1250, Save or select template, Mention someone), then one collapsible block per platform ("Facebook Reels: Title, description and AI disclosure") with its own required fields and inline errors. Right: the clip, or "No clip selected" with **Select clip** and **Upload file**. Footer: More, a When menu, the date and time, **Schedule post** | [`13`](../../screenshots/streamladder/13-publisher-new-post-share-to-caption-facebook-reels.png), [`14`](../../screenshots/streamladder/14-publisher-new-post-ai-content-disclosure.png) |
| When menu | Next available, Now, Schedule | [`15`](../../screenshots/streamladder/15-publisher-when-menu-next-available-now-schedule.png), [`17`](../../screenshots/streamladder/17-publisher-post-now-mode.png) |
| Schedule post | A month calendar, "Scheduled on this day" with the day's slots, **Choose a time**, and **Pick a random time**: Morning, Noon, Afternoon, Evening. One sentence confirms the date, time and time zone | [`16`](../../screenshots/streamladder/16-publisher-schedule-date-time-random-time-of-day.png) |
| Select clip | A picker over the clips library with Newest and Oldest sorting | [`19`](../../screenshots/streamladder/19-publisher-select-clip-empty.png), [`20`](../../screenshots/streamladder/20-publisher-select-clip-sort-newest-oldest.png) |
| Title templates | Save a title as a template with a colour, a name and the text | [`21`](../../screenshots/streamladder/21-publisher-save-title-template-popover.png), [`22`](../../screenshots/streamladder/22-publisher-create-template-colour-name-text.png) |
| Posting slots, generated | A slider ("21x a week"), "Your week, generated" as seven columns of times, **Shuffle times**, and a note: each post goes out at a natural minute inside the window, never on the hour, never two at once | [`23`](../../screenshots/streamladder/23-publisher-posting-slots-21-a-week-generated.png) |
| Posting slots, exact | One card per time with a "plus or minus 15 min" window and seven day chips; **Add another time**; **Back to suggested times** | [`24`](../../screenshots/streamladder/24-publisher-posting-slots-exact-times-plus-minus-window.png) |
| Upload in the publisher | A progress state, then the clip preview with the file name pre-filled as the caption | [`30`](../../screenshots/streamladder/30-publisher-upload-video-progress.png), [`31`](../../screenshots/streamladder/31-publisher-uploaded-clip-preview-filename-as-caption.png) |

Side tools, for the record: Montage Maker is locked on the free plan ([`26`](../../screenshots/streamladder/26-montage-maker-locked-upgrade.png)), Schedule Maker asks for a Twitch name first ([`27`](../../screenshots/streamladder/27-schedule-maker-twitch-username-gate.png)), Clip Downloader takes a Twitch or Kick clip link ([`28`](../../screenshots/streamladder/28-clip-downloader-paste-twitch-or-kick-clip-url.png)), Emote Maker turns a Twitch clip into an emote ([`29`](../../screenshots/streamladder/29-emote-maker-twitch-clip-to-emote.png)).

## 3. OpusClip, Screen By Screen

| Screen | What it shows | Screenshot |
|---|---|---|
| Landing | One field ("Drop a video link or upload a file") with **Get free clips**, or **Auto-edit**. A tooltip lists the sources: "For Pro plan, we support videos from: YouTube, Google Drive, Vimeo, Zoom, Rumble, Twitch, Facebook, LinkedIn, Twitter, Loom, Riverside, StreamYard and more", and the languages (English, German, Spanish, French, Portuguese and 20 more) | [`01`](../../screenshots/opusclip/01-landing-paste-link-supported-sources-tooltip.png) |
| Home | Three tabs on one card: **Clip long video**, **Auto-edit footage**, **Open editor**. A link field ("Drop a YouTube link") with **Get clips in 1 click**; under it Upload, Google Drive, Try a sample project. A row of recipe chips: Clean up recording, Auto-edit talking videos, Captions, Reframe, Upscale, Social edits, AI B-roll, Translate & dub, See all Recipes. Demo projects below. Credits and **Add credits** top right | [`02`](../../screenshots/opusclip/02-home-clip-long-video-youtube-link-recipe-chips.png) |
| Home, later | The placeholder rotates ("Drop a Rumble link"). A recent project card shows live progress on its picture ("21% (ETA 7m)"). An **Auto-import: Off** chip | [`05`](../../screenshots/opusclip/05-home-rotating-link-placeholder-recent-project-eta.png), [`06`](../../screenshots/opusclip/06-home-youtube-link-pasted-getting-clips.png) |
| Clip setup | Top: the video picture with a "1080p" badge, **Adjust range** (a filmstrip with start and end), speech language, genre, layout summary ("9:16, 7 layouts"), Upload SRT. Then **Recipe** and **Brand kit** selects, and the recipe's settings in named groups: Clipping (AI picks, clip length 30s to 59s, "Moments to include" prompt), Essentials (Captions with style tiles, Auto hook, Motion graphics, AI Emojis, Auto B-roll), Sound sharp, Look good, Translate. Right: a **Summary** that prices every line in credits, a total, **Create**, and the sentence "By continuing, you confirm you have rights to use this video." A shortfall prints "Not enough credits. You need 10 more." with Add credits | [`07`](../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png) |
| Ratio and layouts | **Select ratio**: 9:16, 16:9, 1:1, 4:5. **Layouts AI can use** as ticked picture tiles: Fill, Fit, Split, Three, Four, ScreenShare, Gameplay. **Fit Layout: Crop Ratio**: Original, 4:3, 1:1 | [`08`](../../screenshots/opusclip/08-clip-setup-ratio-and-ai-layouts-picker.png) |
| Editor | Top bar: back, project name, undo, redo, Save, Export, credits. Left: the transcript pane with **Speech cleanup**, search, filter and download. Centre: the preview with three chips, "9:16", "Layout: Fill", "Track: ON" (face tracking). Upload progress is drawn over the picture with Cancel. Right: the **AI enhance** panel, a list of one-click rows and switches (Remove filler words, Remove pauses, Remove bad takes, Auto censor, Speech enhancement, Eye contact correction, Auto color correction, Auto viral hook, Auto B-roll, Video dubbing, voiceover hook, AI emoji, AI keywords highlighter, Auto transitions, Auto sound effects). Far right: a tool rail (AI enhance, Captions, My library, Brand kit, B-roll, Hook, Transitions, Text, Graphics, Audio). Bottom: Hide timeline, split, delete, volume, transport, time codes, zoom | [`03`](../../screenshots/opusclip/03-editor-uploading-9x16-ai-enhance-panel.png), [`04`](../../screenshots/opusclip/04-editor-processing-16x9-ai-enhance-panel.png) |

## 4. VidsSave: Paste, Preview, Format Row

[`vidssave-youtube-downloader-full-page.png`](../../screenshots/vidssave/vidssave-youtube-downloader-full-page.png)

1. **Paste**: one wide field ("Paste YouTube video link") with a **Download** button inside it.
2. **Preview**: the page "scans the video" and shows a card for what it found.
3. **Format row**: each choice is one row with the quality, the container and the size ("1080P, MP4, 12MB") and its own Download button. MP4 or MP3; 144p up to 1080p and above when the source has it (vidssave.com, verified 2026-11-14).
4. The rest of the page is search-engine landing content: a tile per platform, a five-step "How to Use", a FAQ.

What matters for us is step 3: the person sees the real size before they choose. The page is public and open to anyone; ours is not (see `07-legal-limits-cost-and-risks.md`, section 4).

## 5. Feature Matrix

"Yes" means seen in the screenshots or on the vendor's plans page today. "Paid" means locked on the free plan. "Not seen" means we did not find it, not that it is absent.

| Feature | StreamLadder | OpusClip | PostGear Sprint 12 | PostGear Sprint 13 | PostGear Later |
|---|---|---|---|---|---|
| Paste link | Yes: Twitch, Kick, Trovo, YouTube | Yes: YouTube free, more on paid | Yes: YouTube, Twitch, Kick (Module 03) | More sites, Google Drive (Module 12) | |
| Upload | Yes: 200 MB free, 2 GB paid | Yes: 10 GB, 30 GB on Pro | Yes: 2 GB, multipart (Module 04) | | Larger caps if storage allows |
| Manual clipping | Yes | Yes (editor) | Yes: mark in and out (Module 07) | | |
| AI clip finding | Paid: ClipGPT, Twitch and Kick | Yes: transcript and prompt | Signals only: loudness, scene changes, Twitch chat (Module 16) | Transcript plus LLM scoring, visual moments (Modules 05, 06) | |
| Layouts | Yes: Fullscreen, Blurred, custom crops | Yes: Fill, Fit, Split, Three, Four, ScreenShare, Gameplay | Fullscreen, Blurred, Split, crop boxes, saved layouts (Module 10) | AI picks the layout (Module 05) | Three and Four layouts |
| Facecam split | Yes: crops; auto detect in ClipGPT | Yes: Split and Gameplay layouts | By hand: Split with two crops (Module 10) | Facecam detect (Module 07) | |
| Stickers and GIFs | Paid: Klipy, reactions, Twitch emotes | Graphics, AI emoji | An open-source catalogue of stickers and animated emoji, no GIF search (Module 12, research 10) | | Twitch emotes |
| Text | Yes | Yes | Yes, with the Studio fonts (Module 11) | | |
| Zoom | Paid | Yes: Auto Zoom | Yes (Module 13) | Auto zoom rides on face tracking (Module 08) | |
| Speed | Paid: Speed Control | Not seen | Constant speed per segment (Module 13) | | Smooth ramps (parked) |
| Sound effects | Paid | Yes: Auto SFX | Yes (Module 14) | | Auto placement |
| Music | Paid | Yes: Audio | Yes (Module 14) | | |
| Captions | Paid | Yes | No (no transcription in 12) | Yes: word by word, styles, translation (Module 03) | |
| Hook title | Paid: AI Hook intro title | Yes: Auto hook | No | Yes (Module 09) | |
| Word censor | Paid | Yes: Auto censor | No | Yes (Module 09) | |
| Silence removal | Paid | Yes: Remove pauses | No | Yes (Module 04) | |
| Auto reframe | In ClipGPT | Yes: "Track: ON" | No | Yes (Modules 07, 08) | |
| Transcript editing | Not seen (transcript search only) | Yes | No | Yes (Module 04) | |
| Montage | Paid: Montage Maker | Not seen | No (`sources[]` reserved) | Yes (Module 11) | |
| Brand kit | Not seen (caption styles, title templates) | Yes | No (`brandKitId` reserved) | Yes (Module 10) | |
| Recipes | Not seen | Yes | No (`presetId` reserved) | Yes (Module 10) | |
| Scheduler | Paid | Paid: Pro | Yes: Send To Composer, the existing scheduler (Module 17) | | |
| Posting slots | Yes: natural-minute window | Not seen | No | Yes (Module 13) | |
| Downloader | Yes: Twitch and Kick clips | No | Yes: YouTube, Twitch, Kick, any format (Module 18) | More platforms (Module 12) | |
| Emote maker | Yes | No | No | No | P2 backlog (Sprint 13 Module 16) |

## 6. What We Take

- **StreamLadder's shape**: one paste box on the Clips home, a videos list, a clips library with status tabs, and a full-window editor with a tab rail in working order.
- **AI finds are just clips**: they arrive in the library with status New, as StreamLadder's do. No second results screen.
- **The stage with source and preview side by side** for layouts, with named crop boxes.
- **The slim tool row** above the timeline (split, trim to playhead both ways, delete) and the transport under the stage.
- **Quality as radio rows** with the locked rows visible, so the upgrade is discovered at the moment it is wanted.
- **OpusClip's rights sentence** next to the action that starts the work, and its **priced summary** before credits are spent.
- **OpusClip's progress on the card** ("21% (ETA 7m)"), so nobody waits inside a blocked screen.
- **VidsSave's format row**: quality, container, size, one button.

## 7. What We Leave

- StreamLadder's always-on upgrade banner, the gem on every tile and the support bubble. One lock dialog (`PremiumLockDialog`) is enough.
- Its sound list. Names such as "Nintendo Switch Click" and "Windows 10 Notification" point at other companies' sounds. Our pack is checked file by file (`07-legal-limits-cost-and-risks.md`, section 8).
- Browse Twitch and Browse Kick, auto-import and the "connect your account" cards. Sprint 12 has no Twitch or Kick sign-in.
- Schedule Maker and Emote Maker: streamer tools, not part of a social media manager.
- OpusClip's long setup screen in Sprint 12. Without transcription most of its switches would be dead. It arrives with Sprint 13 Module 05.
- A second publisher. PostGear already has the Composer, the calendar and the Queue; clips go there.
- A public, logged-out downloader page with search-engine landing copy.
- Any colour, icon, lettering or copy from the three products.

## 8. How PostGear Is Different

1. **One place for the whole job.** Clip, edit, write the post, schedule it to every connected channel, and read the results. The reference tools stop at five or six video platforms; PostGear already posts to X, LinkedIn, Facebook, Instagram (two ways), Threads, YouTube, TikTok and Pinterest.
2. **Analytics close the loop.** A clip that became a post shows up in Analytics with the rest of the content.
3. **Discover feeds it.** A trend from Discover can become a clip brief; the reference tools have no view of what is trending in a place.
4. **Studio fonts.** Text on a clip uses the same 52 licensed fonts as Design Studio, so a brand looks the same in a carousel and in a short.
5. **One credit balance.** AI highlights spend the same credits as the Copilot and Studio, shown in the same chip.
6. **General purpose.** StreamLadder speaks to streamers, OpusClip to podcasters. Clips takes any video and any niche.
7. **Honest about rights.** A recorded confirmation on every import, private storage and a removal path are part of the product, not a footer link.

## 9. UX Patterns Worth Copying

1. **A rotating placeholder teaches the supported links** without a help page. PostGear's own rule wins on wording ("Enter your YouTube, Twitch or Kick link"), so the platform chips above the field do the teaching instead. [`streamladder/02`](../../screenshots/streamladder/02-home-full-page-tools-connect-account-scheduled-posts.png), [`opusclip/05`](../../screenshots/opusclip/05-home-rotating-link-placeholder-recent-project-eta.png)
2. **The error names the fix.** One red line under the field says which links work. [`streamladder/01`](../../screenshots/streamladder/01-home-paste-url-error-twitch-youtube-kick.png)
3. **Ask the shape first.** Vertical or horizontal as two picture tiles, before the editor opens. This is a `ChoiceTiles` case. [`streamladder/03`](../../screenshots/streamladder/03-edit-clips-choose-vertical-or-horizontal.png)
4. **Tabs in working order with a next button.** The rail is the map; the button bottom right is the path. [`streamladder/06`](../../screenshots/streamladder/06-clip-editor-layouts-fullscreen-blurred-add-crop.png)
5. **Source and result side by side** while cropping, with the crop box named for what it holds. [`streamladder/06`](../../screenshots/streamladder/06-clip-editor-layouts-fullscreen-blurred-add-crop.png)
6. **Undo and Redo always in sight**, top left of the stage. [`streamladder/07`](../../screenshots/streamladder/07-clip-editor-elements-stickers-gifs.png)
7. **Effects as a plain list**: icon, name, one line. Easy to scan, easy to extend in Sprint 13. [`streamladder/08`](../../screenshots/streamladder/08-clip-editor-effects-zoom-speed-censor-silences-hook.png)
8. **Audio rows with an instant play button and the length**, grouped under category chips, with the person's own uploads as a chip. [`streamladder/09`](../../screenshots/streamladder/09-clip-editor-audio-sound-effects-music.png)
9. **Style tiles drawn in the style itself**, so nobody reads a name to choose a look. [`streamladder/10`](../../screenshots/streamladder/10-clip-editor-ai-captions-styles-language.png), [`opusclip/07`](../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png)
10. **Locked quality rows stay visible** with the frame rate beside the resolution. [`streamladder/11`](../../screenshots/streamladder/11-clip-editor-export-quality-720p-to-4k.png)
11. **Status tabs with counts** as the library's only navigation. [`streamladder/25`](../../screenshots/streamladder/25-clips-library-status-tabs-connect-account.png)
12. **The rights sentence sits under the button that spends credits**, in quiet text, every time. Ours is a tick box, because we store the answer. [`opusclip/07`](../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png)
13. **A priced summary before the work starts**: each line, its cost, a total, and the shortfall in words. [`opusclip/07`](../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png)
14. **Adjust range before processing**, on a filmstrip, to save credits on a long video. [`opusclip/07`](../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png)
15. **Progress lives on the card**, with a percentage and a time left, and the page stays usable. [`opusclip/05`](../../screenshots/opusclip/05-home-rotating-link-placeholder-recent-project-eta.png)
16. **State chips over the preview** ("9:16", "Layout: Fill", "Track: ON") say what the canvas is doing without opening a panel. [`opusclip/03`](../../screenshots/opusclip/03-editor-uploading-9x16-ai-enhance-panel.png)
17. **Layouts as ticked picture tiles**: the picture is the explanation. [`opusclip/08`](../../screenshots/opusclip/08-clip-setup-ratio-and-ai-layouts-picker.png)
18. **A natural-minute window on posting slots**, explained in one sentence. Sprint 13 Module 13. [`streamladder/23`](../../screenshots/streamladder/23-publisher-posting-slots-21-a-week-generated.png), [`streamladder/24`](../../screenshots/streamladder/24-publisher-posting-slots-exact-times-plus-minus-window.png)
19. **A format row that shows the size** before the download starts. [`vidssave`](../../screenshots/vidssave/vidssave-youtube-downloader-full-page.png)

## 10. Open Points From This File

- **Open question for Arvind**: StreamLadder gives ClipGPT only to Twitch and Kick, not YouTube. Do AI highlights in Sprint 12 run on YouTube videos too? Recommendation: yes. Loudness and scene changes work on any video; only the chat signal is Twitch-only.
- **Open question for Arvind**: the plan says the source length default is 6 hours "as StreamLadder". That figure was not on StreamLadder's plans page today; Klap publishes 3 hours and Vizard 10 hours on paid plans (both verified). Recommendation: keep 6 hours on paid plans and 1 hour on Free, and let the Module 05 benchmark confirm it.
- **Open question for Arvind**: the reference tools keep link import or AI clipping for paid plans. Is link import on PostGear's Free plan? Recommendation: yes, with a small monthly hours allowance, because the paste box is the first screen and a locked first screen loses people.
