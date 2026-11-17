# 00: UX Blueprint, The Clips Experience

> **Sprint 12, Clips** | Reference only, nothing to build here | Read before Modules 06 to 18.
> **Decides**: how Clips looks and behaves. The user stories decide what it must do; the sprint doc decides how it is built.
> **References** (local only, gitignored): `docs/screenshots/streamladder/` (01 to 39), `docs/screenshots/opusclip/` (01 to 08), `docs/screenshots/vidssave/`. We take their placement and flow and draw it in PostGear's own look. We never copy their art, colours or wording.

## 1. The Feeling

Clips is a workshop. The page is calm and says plainly what is happening to a video; the editor is dense, fast and keyboard friendly. It is PostGear's look (black borders, small hard shadows, Sora, the theme's colours) applied to a video tool, not a dark purple gamer app. There is no hero, no title, no tagline. Waits always have words. The only violet on any screen is **Find Clips**, because it is the only AI action. Nothing pulses or glows; the things that move are the video, the playhead, progress bars and animated icons on hover.

## 2. Clips Page Anatomy (1366 px And Up)

```
Top bar: Clips                                                                    search
+---------------------------------------------------------------------------------------------+
|                                        [ 12.4 GB of 50 GB ====-- ]  [ 38 of 300 AI minutes left ] |
+---------------------------------------------------------------------------------------------+
| Create   Streams   Videos   Clips   Downloads                                   (Simulated)  |
+---------------------------------------------------------------------------------------------+
| +-----------------------------------------------------------------------------------------+ |
| | [ (link) Enter your YouTube, Twitch or Kick link                    ] [ Find Video ]    | |
| | [ Browse Twitch ] [ Browse YouTube ] [ Browse Kick ]                                    | |
| |                                                                                         | |
| | [ (upload) Upload A Video ]  [ Try A Sample ]   MP4, MOV, MKV or WebM, up to 2 GB       | |
| +-----------------------------------------------------------------------------------------+ |
|                                                                                             |
| +-----------------------------------------------------------------------------------------+ |
| | Coming Up                                                              View Calendar    | |
| |  [clip picture] Thu 21 Nov, 6:30 pm   TikTok, Shorts      [clip picture] Fri 22 Nov ...  | |
| +-----------------------------------------------------------------------------------------+ |
|                                                                                             |
| +-----------------------------------------------------------------------------------------+ |
| | Recent Videos                                                              All Videos   | |
| |  +-----------+  +-----------+  +-----------+  +-----------+                             | |
| |  | picture   |  | picture   |  | 34% ===-- |  |           |                             | |
| |  | Title     |  | Title     |  | Getting   |  |           |                             | |
| |  | Twitch 3h |  | YouTube   |  | the video |  |           |                             | |
| |  +-----------+  +-----------+  +-----------+  +-----------+                             | |
| +-----------------------------------------------------------------------------------------+ |
| +-----------------------------------------------------------------------------------------+ |
| | Recent Clips                                                                All Clips   | |
| |  [9:16] [9:16] [16:9] [9:16] [9:16] [1:1]                                               | |
| +-----------------------------------------------------------------------------------------+ |
+---------------------------------------------------------------------------------------------+
```

- The actions row is a `PageActions` with `className="justify-end"`: the storage meter (`UsageMeter`, small) and the AI minutes chip, which reads "38 of 300 AI minutes left" and is built like `CreditsChip` but reads the `clips.ai_minutes_per_month` meter from `GET /entitlements/me`. It turns to the warning colour past 80% used, and its tooltip says when the minutes come back ("They reset on 1 December."). The Simulated sticker (same as Workflows and Discover) shows at the far right of the tab row when `CLIPS_SIMULATION` is on.
- The tab row is the design-system `Tabs` (no shadow). The open tab lives in `?tab=` (`create`, `streams`, `videos`, `clips`, `downloads`).
- The paste box is one card (`bg-chrome`): an `Input` with a leading link icon, the primary **Find Video** button, and under it a row of three secondary buttons, **Browse Twitch**, **Browse YouTube** and **Browse Kick** (only the platforms switched on), each opening My Channels (section 3). Under that, a secondary **Upload A Video** and a secondary **Try A Sample** with one line of `type-muted` help. **Try A Sample** adds a short video made by PostGear, ready at once, so a new user can try the editor with nothing of their own. This is a form field for a link, not a search box; the page has no search of its own.
- **Coming Up** is an `AnalyticsPanel` between the paste box and Recent Videos: the posts of the next 14 days that use a clip, each with the clip's small picture, the day and time and the channels, and **View Calendar** as the `ActionLink`. Empty: "Nothing is scheduled in the next 14 days. Send a clip to the composer to schedule one." It is hidden while the workspace has no exported clip yet.
- Groups are `AnalyticsPanel` cards with `PanelHeader` (Title Case name, an `ActionLink` on the right). Video cards sit four across; clip cards six across, tall for 9:16.

## 3. The Link Card

After **Find Video**, the paste box grows a card under the field. Nothing else on the page moves.

```
+-----------------------------------------------------------------------------------------+
| [ picture 16:9 ]   Ranked grind until I hit Diamond                                     |
|                    vikram_plays   (Twitch)   Past stream   3 h 42 min                   |
|                                                                                         |
|                    [x] This video is mine, or I have permission to use it.              |
|                                                                                         |
|                    [ Import Video ]   [ Download v ]                                    |
+-----------------------------------------------------------------------------------------+
```

| State | What shows |
|---|---|
| Looking | The card's footprint as a `Skeleton`, "Reading the link" under the field; the button is disabled |
| Found | Picture, title, channel, platform `Badge`, the kind in words, the length; the tick box; **Import Video** (primary) and **Download** (secondary, a dropdown of qualities) both disabled until ticked |
| Already here | The same card with "You already have this video." and **Open Video** instead of Import |
| Cannot be read | An `Alert variant="warning"` under the field with the sentence from the stories' section 5 and, where it helps, **Upload A Video** inside the alert |
| Over a limit | An `Alert variant="warning"` with the sentence and **See Plans** |

- The tick box is a design-system `Checkbox` with its label; it is never pre-ticked and resets for each new link.
- The picture is fetched through our server, lazy, hidden on error (a shorter card, never a grey box).
- **Download** opens a `DropdownMenu` (no shadow): "1080p (412 MB)", "720p (190 MB)", "360p (64 MB)", "Audio Only". Picking one switches to the **Downloads** tab.
- A Twitch past stream adds one line of `type-muted` text to the card: "Twitch may have muted parts of this stream. Clips from muted parts will be silent." (the channel list cannot see muted parts in advance).
- A video longer than the plan allows shows an `Alert variant="warning"`: "This video is longer than your plan allows (60 minutes). Upgrade the plan to bring in longer videos." with **See Plans**, and no Import button.

### My Channels And The Streams Tab

A person adds a channel by its name, with no login, and picks a stream from a list instead of hunting for a link. The same list appears in two places: **Browse Twitch**, **Browse YouTube** and **Browse Kick** under the link box open it in a dialog (**My Channels**), and the **Streams** tab shows it full width. Only public videos are listed, and nothing is downloaded until the person presses **Import**.

```
+--------------------------------------------------------------------------------------------+
| My Channels                                                                          [ x ] |
|  (o) vikram_plays [Twitch]   (o) @vikramplays [YouTube]   ( + Add A Channel )               |
|  [ Streams ]  [ Clips ]                      Sort: Newest v   [ Show Hidden ]  [ Refresh ]   |
|  Updated 4 minutes ago, 38 streams                                                           |
|--------------------------------------------------------------------------------------------|
| [pic 16:9]  Ranked grind until I hit Diamond           21 Nov, 3 h 42 min, 12,408 views     |
|             Expires in about 3 days                                  [ Import ]  [hide]      |
|--------------------------------------------------------------------------------------------|
| [pic 16:9]  Chill stream, new game                      20 Nov, 2 h 05 min, 3,114 views      |
|             (Live Now)                                     no button, tooltip: Come back... |
|--------------------------------------------------------------------------------------------|
| [pic 16:9]  Subathon day 2                              18 Nov, 5 h 10 min, 9,872 views      |
|                                                                        [ Open ]  [hide]      |
+--------------------------------------------------------------------------------------------+
```

| Part | Detail |
|---|---|
| Channel chips | Picture, name, a small platform mark; a menu to remove. **Add A Channel** is a secondary button |
| **Add A Channel** dialog | `ChoiceTiles` for the platform (Twitch, YouTube, Kick); an `Input` with the placeholder "Enter your channel name" (a channel link is accepted and cut down to its name); **Check** shows the picture and display name; **Add Channel** (primary). Under it, `type-muted`: "Only public videos are listed. Nothing is downloaded until you import one." |
| Lists | Twitch and Kick: **Streams** and **Clips**. YouTube: **Videos**, **Streams** and **Shorts**. A `Tabs` row |
| Toolbar | **Sort** (Newest, Most Viewed; off for YouTube with the hint "YouTube lists newest first"), **Show Hidden**, **Refresh**, "Updated 4 minutes ago", the item count |
| Row | Picture, title (two lines at most), date, length, "12,408 views", an expiry line for Twitch archives, **Import** (secondary, small) and a ghost hide icon with the tooltip "Hide From List". A video already in the workspace shows **Open** instead. A hidden row (with **Show Hidden** on) shows **Unhide** |
| **Import** | Closes the dialog (or stays on the tab), fills the link card on the **Create** tab with that video and moves focus to the rights tick. Nothing imports without the tick |
| Live and processing | A "Live Now" or "Still Processing" `Badge` and no Import; tooltip "Come back when the stream has ended." |
| Paging | 50 rows a page with **Show More**; after 1,000: "Showing the newest 1,000. Paste a link for older videos." |

| State | What shows |
|---|---|
| Nothing added yet (the "Connect" empty state) | `EmptyState`: "Add the name of a Twitch, YouTube or Kick channel. We list its public videos and clips so you can import one with a click." with **Add A Channel** |
| Loading | `Skeleton` rows, never a spinner over old rows |
| Empty channel | "This channel has no public videos yet." in `type-muted` (not an error) |
| Cannot be read | `Alert variant="warning"` with the sentence ("This channel's list is not available right now. Try again in a few minutes.") and **Try Again**; the last answer stays visible for up to a day, marked "Updated 3 hours ago" |
| YouTube allowance used | `Alert variant="warning"`: "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link." |
| Name not found | Inline under the field: "We could not find that channel. Check the spelling." |
| Over the plan's channel count | `Alert variant="warning"`: "Your plan allows 3 channels. Remove one to add another." with **See Plans** |
| A platform switched off | Its Browse button, its chip and its list are not drawn |

## 4. Cards

**Video card** (Videos tab, Recent Videos): the poster (16:9), the title in `type-heading text-base` (two lines at most), a meta line in `type-muted` ("Twitch, 3 h 42 min, 12 clips"), "Kept until 28 Nov" in `type-muted`, **Open** (primary, small) and an overflow menu (**Delete Video**, in red). While it comes in, the poster area is `bg-inset` with a `Progress` bar, the step in words and, once it can tell, "About 7 minutes left" in `type-muted`, and the action is **Cancel** (secondary). Failed: an `Alert variant="danger"` inside the card with the reason and **Try Again**.

**Clip card** (Clips tab, Recent Clips, the video page list): the poster in the clip's own shape; on hover the clip plays muted from the proxy (no sound, no controls); the name; a meta line ("0:42, 9:16"); for AI clips a score chip ("92") and the first reason. Actions: **Edit** (primary, small) and an overflow menu (**Rename**, **Duplicate**, **Hide**, **Delete Clip**). The state shows as a `Badge`: **New** (primary), **Draft** (outline), **Exported** (success), **Scheduled** (secondary), **Hidden** (outline). A clip whose export is running shows the step in words with a `Progress` bar and "About 2 minutes left".

The Clips tab's toolbar has the status tabs with counts, a **Source** `Select` (**All**, **YouTube**, **Twitch**, **Kick**, **Upload**), **Sort** (**Newest**, **Oldest**) and a two-button `Segmented` for **List** and **Grid** (an icon each, with `TooltipHint`). The list view is one `DataTable` row per clip (picture, name, shape, length, score, video, state, **Edit**); the grid view is the cards above. The choice is remembered on this browser.

**Download row** (Downloads tab): the title, the quality, "Getting your file, 40%" with a `Progress`, then **Save File** (primary, small), **Save To Media** (secondary, small, MP4 only) and "Expires in 23 hours" in `type-muted`.

A card that only holds buttons does not move on hover; its buttons do.

## 5. The Video Page

A normal framed page (rail and top bar stay), built for 1366 px and up.

```
Top bar: Clips                                                                    search
+---------------------------------------------------------------------------------------------+
| [ <- Videos ]   Ranked grind until I hit Diamond              (Twitch)   3 h 42 min          |
+-------------------------------------------------------------+-------------------------------+
|                                                             | [ Find Clips (56 AI Minutes) ]|
|                    the video (16:9)                         | 38 of 300 AI minutes left     |
|                                                             |-------------------------------|
|                                                             | Clips From This Video   12    |
|                                                             |  +---+ 92  Chat exploded      |
|-------------------------------------------------------------|  |   | 0:38   [Play] [Edit]   |
| [<<] [ > ] [>>]   12:04 / 3:42:10      [ I ] [ O ] 0:42     |  +---+                [Hide]  |
|        [ Edit Whole Video ]       [ Create Clip ]           |  +---+ 88  Loud reaction      |
|-------------------------------------------------------------|  |   | 0:45   [Play] [Edit]   |
| 0:00      30:00      1:00:00     1:30:00     2:00:00   ...  |  +---+                        |
| [pictures along the video ................................] |  ...                          |
| [the sound's shape ......................................]  |  AI in this version listens   |
|      ^ mark   ^ mark  [== marked range ==]    ^ mark        |  and watches for action. It   |
|                                         [-] zoom [+]        |  does not understand speech   |
+-------------------------------------------------------------+  yet.                         |
                                                              +-------------------------------+
```

- The `PageActions` row holds a back link (secondary, small, with the left-arrow `MotionIcon`), the title as plain text (`type-heading text-lg`, not a page title: it names the thing being worked on), and the facts on the right.
- The player has our own controls on a bar under the picture: back 5 seconds, play, forward 5 seconds, the time, the **I** and **O** buttons with the range's length, **Edit Whole Video** (secondary; off for a video over 30 minutes, with the tooltip "A clip can be up to 30 minutes. Mark the part you want, then press Create Clip.") and **Create Clip** (primary). Icon-only controls on this bar are `Button variant="ghost"` with `TooltipHint` and the shortcut.
- The timeline shows a ruler, the filmstrip, the waveform, the marked range (a bordered band with two handles), every clip's range as a thin line, and AI marks as small flags. It scrolls sideways and zooms with the buttons, **+** and **-**, or Ctrl and the wheel.
- The right column is a card with **Find Clips** (`Button variant="highlight"`, the price in the label), the AI minutes chip, and the list. While AI runs, the button turns into a `Progress` with the step in words, "About 3 minutes left" and **Cancel**. With too few AI minutes the button is off and an `Alert variant="warning"` says "This needs 56 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan."; with none, "This workspace has used all its AI minutes for this month. They reset on 1 December." and **See Plans**.
- The note about what AI does is `type-muted` text at the bottom of the list, always visible when the list has AI clips.

## 6. The Editor Frame

The whole window (`immersion()` in `DashboardShell`, `fixed`). No rail, no top bar; the editor has its own.

```
+--------------------------------------------------------------------------------------------+
| [<-]  Clip name (click to rename)      Saved        [undo] [redo]   [?]     [ Export ]      |
+------+---------------------------+---------------------------------------------------------+
| Lay- | Layouts                   |                                                         |
| outs | Fullscreen  Blurred  Split|            +------------------+                         |
|------| My Layouts                |            |                  |                         |
| Ele- |  ...                      |            |   the clip       |                         |
| ments|                           |            |   (9:16)         |                         |
|------|                           |            |                  |                         |
| Text |                           |            +------------------+                         |
|------|                           |                                                         |
| Eff- |                           |   [<<] [ > ] [>>]   0:12.4 / 0:42.0     [-] zoom [+]    |
| ects |                           +---------------------------------------------------------+
|------|                           | [scissors] [delete]                        snapping [on]|
| Audio|                           | 0:00     0:10      0:20      0:30      0:40             |
|------|                           | Video   [=== part 1 ===][== part 2  2x ==]              |
| Exp- |                           | Overlay      [ W sticker ]   [ HE REALLY DID THAT ]     |
| ort  | [ Back ]         [ Next ] | Zoom                                     [ zoom 1.5x ]  |
|      |                           | Sound   [ ~~~ soft music ~~~~~~~~~~~~~~~~~~~~~~~~ ]     |
+------+---------------------------+---------------------------------------------------------+
```

- **Top bar** (copied in structure from Studio's `EditorTopBar`): the back button (secondary, small, icon only with `TooltipHint` "Back To Video"), the name as a rename-in-place field, the `SaveIndicator`, Undo and Redo with `Kbd` hints, the shortcuts button, and **Export** (primary), which opens the Export tab.
- **Tab rail** (the `Tool` button pattern from the workflow builder's rail): six ghost buttons, each an animated icon over a label. The open one is marked with `aria-pressed` and the pressed look. No shadow.
- **Panel** (`w-80`, `bg-chrome`): the open tab's controls, built from `PanelSection` and `GroupLabel`. At its foot, **Back** (secondary) and **Next** (primary) walk the tabs in order, as StreamLadder does; on Export the Next button is **Export Clip**.
- **Stage**: the clip in its own shape, centred, on the page's background, with a thin border. Selected items show handles (section 9). The stage never scrolls; it scales to fit. It is drawn by the browser preview (`video-preview`) from the small light copy, so it is a fast approximation of the export: it matches closely, and the **Preview Export** button in the Export tab shows the real result. The stage may be a little soft at high zoom, and very slow or fast sound may be muted by the browser; the export does neither.
- **Transport**: back one frame, play, forward one frame, the time with tenths, and the timeline zoom on the right. All ghost buttons with tooltips and shortcuts.
- **Timeline dock**: a `ResizeHandle` on its top edge (taller or shorter, arrow keys work), the tools row, the ruler and the rows (section 7).
- Layouts tab only: the stage splits in two, the full video on the left with its crop boxes ("Video") and the clip on the right ("Clip"), as StreamLadder's Fullscreen and Preview panes do.

## 7. The Timeline

| Row | What is on it | What you can do |
|---|---|---|
| Video | One bar per part, with the filmstrip inside and the speed when it is not 1x ("2x") | Drag an end to trim, press **S** to split at the playhead, select and press **Delete**, pick a speed in Effects |
| Overlay | One bar per text or sticker; a second overlay row appears when two overlap | Drag to move, drag an end to change how long it shows, **Ctrl+D** to duplicate, **Delete** |
| Zoom | One bar per zoom | Drag, resize, delete |
| Sound | One bar per sound with its shape; the video's own sound is the waveform under the video row | Drag, trim, delete; volume and fades in the Audio panel |

- The playhead is a 2 px line with a small grip on the ruler; clicking the ruler jumps, dragging the grip scrubs (the picture follows as fast as it can, without sound).
- Snapping: edges snap to the playhead, to other edges and to the clip's start and end within 8 px; a thin guide line shows what it snapped to; **Alt** turns it off while held. The **Enable Snapping** toggle in the tools row turns it off for good.
- Selection: one thing at a time in Sprint 12. The selected bar gets a 2 px ring in the row's colour; the panel switches to its tab.
- Rows are `bg-inset`; bars are their own layer with a border and no shadow (they are dragged, not pressed).
- Trimming past the video we hold: the bar stops at the handle's end with a hatched tail and "Getting more of the video"; when it arrives the tail fills in.
- Ruler ticks: one fixed ladder (single frames when zoomed right in, then 1 s, 2 s, 5 s, 10 s, 30 s, 1 min, 5 min, 10 min, 30 min, 1 h), and the first step whose labels are at least 64 px apart is used, so labels never touch on a 20 second clip or a 6 hour video. Only the visible range is drawn.
- Zooming keeps the playhead where it is on screen; the smallest zoom fits the whole clip (or video) in the dock.

## 8. Panels

**Layouts**: a `ChoiceTiles` grid of the layout presets, each tile a small drawing: **Fullscreen** (the video fills the clip), **Blurred** (the whole video in the middle over a blurred copy), **Split** (two parts stacked), **Three**, **Four**, **Gameplay** (the game large, with a small rounded box for the face camera) and **Screen Share** (the shared screen large, the speaker's camera in a smaller box). Horizontal clips show only **Fullscreen** and **Blurred**. When **Blurred** is picked, a **Crop Ratio** `Segmented` (**Original**, **4:3**, **1:1**) sets the shape of the part kept in the middle. **My Layouts** under the presets with saved tiles and **Save Layout** (secondary). Under the Video pane: **Add Crop** (secondary; up to four areas) and the **Enable Snapping** `Toggle`. Crop boxes have a name tag on their top edge ("Camera", "Content", "Game") in the area's colour, eight handles, and keep their area's shape; the camera box of **Gameplay** and **Screen Share** also shows its rounded corner. The shape picker (**Vertical**, **Horizontal**, **Square**) is a `Segmented` at the top of the panel.

**Elements**: a `Tabs` row inside the panel: **Stickers** (still pictures), **GIFs** (moving pictures), **Favourites** and **Uploaded**. Both **Stickers** and **GIFs** have one field ("Enter your search", searches as you type a word, by name and tag) and a row of category chips (**Reactions**, **Arrows And Shapes**, **Social**, **Gaming**, **Animated Emoji**), then the tiles, 24 at a time with **Show More**. Tiles are squares on a checker background so see-through art reads; each has a star (`Button variant="ghost"`, tooltip "Add To Favourites") in its corner and, for a sticker that needs a credit, a small "i" with the credit line. **Favourites** lists the starred ones with its own search. **Uploaded** holds the workspace's own pictures with **Upload A Sticker** (secondary; PNG, WebP or GIF up to 8 MB). A `type-muted` line sits under the tiles: "Our library is free-to-use art, so it has no film or meme clips." with a **Credits** link to `/credits/clips`. A search with no match says "Nothing found for "wow". Try another word or pick a category." and shows the nearest category chips. The library is our own, so there is no outside service name to show. The **Follow Badge** (platform picker and "Enter your channel name") stays under **Stickers**.

**Text**: **Add Text** (primary), a row of ready styles as tiles, then for the selected text: the words (`Textarea`), font (`FontSelect`), size (`Slider`), colour, outline and box (the new colour picker), alignment (`Segmented`), and when it shows ("From 0:04.0 for 3.0 s").

**Effects**: three rows, each a card with an icon, a name and a sentence: **Zoom** ("Zoom in on a moment"), **Speed Control** ("Slow down or speed up a part") and **Looks** ("Give the whole clip a colour look"). Opening one shows its controls. Zoom: **Add Zoom**, amount (`Slider`, 1.1x to 3x), the focus point (drag the dot on the clip). Speed: a `Segmented` (0.25x, 0.5x, 1x, 1.5x, 2x, 4x) for the selected part, with the hint "To change a few seconds only, split the clip first." and, under it, "Very slow or fast sound may sound rough." **Looks**: `ChoiceTiles` of small sample pictures (**None**, **Warm**, **Cool**, **Vivid**, **Black And White**, **Sepia**, **Vintage**, **Cinematic**), a **Strength** `Slider` (0% to 100%), a **Vignette** `Slider`, and **Fade In** and **Fade Out** `Toggle`s each with a length `Segmented` (0.5 s, 1 s, 2 s). A `type-muted` line says "The editor shows a close match. The export may look slightly different." The preview draws a look with a CSS filter, the export with FFmpeg's, so the colours differ a little by design; **Preview Export** shows the real result.

**Audio**: a `Tabs` row: **Sound Effects**, **Music**, **Favourites**, **Uploaded**. Above each list: a search field ("Enter your search", by name and tag) and category chips (sound effects: **Alerts And Notifications**, **Ambient Sounds**, **Reactions**, **Transitions**, **Gaming**, **Comedy**, **Impacts**, **Whooshes**; music: **Calm**, **Upbeat**, **Tense**, **Cinematic**, **Lo-Fi**, **Epic**). Each sound is a row: a play button (ghost), the name, the length, a small picture of its shape, a star (ghost, tooltip "Add To Favourites") and **Add** (secondary, small). **Favourites** lists the starred sounds of both kinds with its own search. **Uploaded** holds the workspace's own sounds with **Upload A Sound** (secondary; MP3, WAV, M4A or AAC up to 20 MB). Under the music list, `type-muted`: "The music shelf is small: loops and short tracks, not songs." A details line on the selected row names the source, author and licence, and **Credits** links to `/credits/clips`. A search with no match says "Nothing found for "zap". Try another word or pick a category." For the selected sound: volume (`Slider`), **Fade In** and **Fade Out** (`Toggle`). At the top of the panel, always: **Video Volume** (`Slider`) with a mute button.

**Export**: the qualities as `ChoiceTiles` (one choice, the point of this form): **720p** ("Good for every platform"), **720p 60 fps** ("Smoother motion at the same size"), **1080p** ("Sharper, best for most clips"), **1080p 60 fps** ("Smoothest, for fast games"); locked ones carry the `PremiumLockMark`, and 4K is not offered yet. A `SummaryBox` reads the choices back ("Vertical 9:16, 0:42, 1080p"). On a plan that adds the mark, a `type-muted` line says "Exports on this plan carry a small PostGear mark." Below the summary, two buttons side by side: **Preview Export** (secondary) and **Export Clip** (primary), with one line of `type-muted` under them: "The editor is a fast preview. Preview Export shows the real result." A running export shows the step in words, a `Progress` bar and "About 4 minutes left". After an export: the result card with the poster, **Download**, **Send To Composer** (primary) and, when the clip changed since, an `Alert variant="warning"`: "You changed this clip after the last export."

**Preview Export** opens a dialog (section 10). It makes a small copy of the whole clip (about 360 pixels wide) through the same compiler as the real export, so it shows the real crop, text, stickers, looks, zoom, speed and sound mix. It uses no AI minutes, does not go to Media, waits behind real exports, and is kept for 24 hours. If the clip changes afterwards, the panel says "You changed this clip after the last preview."

## 9. Handles On The Clip

- A selected text or sticker shows a 2 px border in the theme's primary colour, eight square handles (corners resize keeping the shape; sides resize text boxes only), and a round handle above for turning. Turning snaps at 0, 90, 180 and 270 degrees.
- While dragging, guide lines show the middle of the clip and the edges; the item snaps to them within 6 px.
- Arrow keys nudge by 1 px, with Shift by 10 px. **Delete** removes it. Double-click a text to type in place.
- Items cannot be dragged fully off the clip: at least a quarter stays inside.
- The focus dot of a zoom is a small ring with a cross, shown only while a zoom is selected.

## 10. Dialogs

| Dialog | Content |
|---|---|
| **What Do You Want To Make?** (first open of a clip) | `ChoiceTiles`: **Vertical** ("9:16 for TikTok, Shorts and Reels"), **Horizontal** ("16:9 for YouTube"), **Square** ("1:1 for feeds"), each with a small drawing; **Continue** (primary); no Cancel, the back button leaves |
| **Export Clip** progress (when Export is pressed from the top bar while on another tab) | The step in words, a `Progress`, "About 4 minutes left", "You can close this. We will tell you when it is ready." and **Close** |
| **Preview Export** | While it runs: "Making the preview", a `Progress`, **Cancel**. When it is done: the small clip plays in the dialog with its sound and a plain player bar; the line "This preview is a smaller copy. Your export will be sharper."; **Export Clip** (primary) and **Close**. If it fails: an `Alert variant="danger"` "We could not make the preview. Try again." with **Try Again** |
| **My Channels** (from **Browse Twitch**, **Browse YouTube** or **Browse Kick**) | The channel chips, the lists and the rows of section 3; **Add A Channel** opens the **Add A Channel** dialog; **Import** closes it and fills the link card |
| **Add A Channel** | `ChoiceTiles` for the platform, the field "Enter your channel name", **Check**, **Add Channel** (primary), **Cancel** |
| **Send To Composer** | The channel picker (the one Studio uses), each unfit channel greyed with its reason; **Caption** (`Textarea`, "Enter your caption"); **Open In Composer** (primary), **Cancel** |
| **Plan lock** | `PremiumLockDialog` with the sentence for what was clicked and **See Plans** |
| **Delete Video**, **Delete Clip**, **Find Clips Again** | `AlertDialog` with the exact sentence from the stories; the delete action is solid red |
| **Keyboard Shortcuts** | The `ShortcutsSheet` from Workflows with the Clips list |

## 11. Empty, Loading And Error States

| Where | What |
|---|---|
| Create tab, nothing yet | Only the paste box; the Recent groups are not drawn |
| Videos tab, empty | `EmptyState`: "No videos yet. Paste a link or upload a video to start." with **Create** |
| Clips tab, empty | `EmptyState`: "No clips yet. Open a video and mark a clip, or let AI find some." |
| Clips tab, a filter with nothing | "Nothing here yet." in `type-muted`, no button |
| Downloads tab, empty | `EmptyState`: "No downloads yet. Paste a link and choose Download." |
| Streams tab, nothing added | `EmptyState`: "Add the name of a Twitch, YouTube or Kick channel. We list its public videos and clips so you can import one with a click." with **Add A Channel** |
| Coming Up, nothing scheduled | "Nothing is scheduled in the next 14 days. Send a clip to the composer to schedule one." |
| Elements or Audio, a search with no match | "Nothing found for "wow". Try another word or pick a category." with the nearest category chips |
| Favourites, empty | "No favourites yet. Star a sticker to keep it here." (sounds: "Star a sound to keep it here.") |
| Uploaded, empty | "Nothing uploaded yet." in `type-muted`, with the upload button |
| A library item used in a clip was removed | On the timeline bar and in its panel: "This sticker was removed from the library." (or "This sound ..."); **Export Clip** asks before leaving it out |
| Video page, AI found nothing | In the list: "We did not find any stand-out moments. You can still mark clips by hand." |
| Any list loading | A `Skeleton` with the footprint of four cards, `aria-busy` |
| The API is down | `ErrorState` with **Try Again** |
| Editor, the video cannot play | In the stage: "This video cannot be played right now." with **Try Again**; the timeline stays usable |
| Editor, offline | The save indicator says "Offline, will retry"; no dialog |
| Any tool or platform failure | One sentence from `clips.messages.ts`; never a tool's own output |

## 12. Small Screens

Clips is desktop only, like Workflows and Studio. Below 1366 px every Clips route shows one centred sentence in an `EmptyState`: "Clips is made for a bigger screen. Open it on a laptop or desktop." There is no phone layout, no tab-bar entry and no small-screen testing. Check at 1366 px and 1920 px.

## 13. Motion And Accessibility

- Animated icons (`MotionIcon`) on every clickable icon; decorative and state icons stay lucide. No entrance animation except `animate-fadeIn` on cards that arrive.
- Progress bars use the design-system `Progress` stripe. Nothing else loops.
- Every icon-only button has a `TooltipHint` whose label equals its `aria-label`, in Title Case, with the shortcut shown.
- The timeline is keyboard reachable: Tab moves between bars, arrows move a selected bar by one frame (Shift: one second), Enter opens its panel. Screen readers hear "Text, HE REALLY DID THAT, from 4 seconds, 3 seconds long".
- The player's buttons, sliders and the rights tick box are real controls with labels. Focus is the plain 2 px blue line.
- Colour is never the only signal: states have words, scores have numbers, locked tiles have the lock mark.
- Reduced motion: hover previews on clip cards do not autoplay; they play on click.

## 14. Copy Rules

- Names are Title Case, every word: **Import Video**, **Find Clips**, **Create Clip**, **Edit Whole Video**, **Export Clip**, **Preview Export**, **Send To Composer**, **Upload A Video**, **Try A Sample**, **Add A Channel**, **Show Hidden**, **Add Crop**, **Save Layout**, **Add Text**, **Add Zoom**, **Speed Control**, **Looks**, **Upload A Sound**, **Upload A Sticker**, **Add To Favourites**, **Save File**, **Save To Media**, **Try Again**, **See Plans**. Tabs, tiles, menu items, badges and dialog titles too.
- Sentences stay sentence case: help lines, alerts, toasts, empty states, the rights line, progress steps ("Getting the video").
- Placeholders read "Enter your ...": "Enter your YouTube, Twitch or Kick link", "Enter your caption", "Enter your search", "Enter your channel name". Never a sample link.
- Words to use: video, clip, layout, sticker, sound, look, export, quality, AI minutes, plan. Never: source, proxy, segment, asset, job, render, ingest, transcode, VOD, pipeline, entitlement, credits (for Clips), compile.
- AI cost reads "Find Clips (15 AI Minutes)" in the button and "38 of 300 AI minutes left" in the chip. "AI credits" are only for text and image AI elsewhere in PostGear.
- Limit sentences come from plan values and never carry a hard-coded number; see the stories' section 5.
- Lengths read "3 h 42 min" for videos and "0:42" for clips; sizes "412 MB", "1.4 GB"; dates "28 Nov".
- No em dash, no middle dot, no all-caps text (sticker art is art, not text).
- `Segmented`, `ChoiceTiles` and `SelectItem` labels are not checked by the title-case test, so write them in Title Case by hand.

## 15. Design System Map

Clips builds no new look. Checked against `/dev/components` and the Studio and Workflows editors on 2026-11-14 and extended on 2026-11-17 for My Channels, the library panels, Looks and Preview Export.

**Page**

| Piece | Use | Notes |
|---|---|---|
| Actions row | `PageActions` | No title above it |
| Tabs | `Tabs` | The one toggle bar; no shadow |
| Groups | `AnalyticsPanel`, `PanelHeader` | As Discover and Analytics |
| Storage meter | `UsageMeter` | Warning colour past 80% |
| AI minutes | An `AiMinutesChip` built like `CreditsChip`, reading the meter from `useEntitlements` (`GET /entitlements/me`) | New this sprint (Module 06); `CreditsChip` itself is unchanged and stays for text and image AI |
| Tab and view switches | `Tabs` for the page; `Segmented` for list or grid, sort and crop ratio | No hand-made bars |
| Notices | `Alert` variants | Never a hand-made tint |
| Empty and error | `EmptyState`, `ErrorState`, `Skeleton` | |

**Buttons**

| Piece | Use | Notes |
|---|---|---|
| Main action of an area | `Button variant="primary"` | One per area: Find Video, Import Video, Create Clip, Export Clip, Open In Composer |
| Other actions | `Button variant="secondary"` | Yellow hover fill, small shadow |
| AI action | `Button variant="highlight"` | Find Clips only |
| Deleting | `Button variant="danger"` | Solid red, every delete |
| Icon-only on a bar or panel | `Button variant="ghost"` with `TooltipHint` | Player bar, transport, timeline tools, tab rail |

**Editor**

| Piece | Use | Notes |
|---|---|---|
| Full window | `immersion()` in `DashboardShell` | Add `clips/edit/<id>` |
| Top bar | Studio's `EditorTopBar` structure | Back, rename, save state, undo, redo |
| Tab rail | The `Tool` button from the workflow tool rail | Icon over label, `aria-pressed` |
| Panel pieces | `PanelSection`, `GroupLabel`, `PercentSlider`, `SwatchPicker` | From Studio's `panel-ui.tsx` |
| Choices | `ChoiceTiles` (layouts, shape, quality), `Segmented` (speed, alignment, filters) | |
| Sliders | `Slider` | Volume, size, zoom amount |
| Fonts | `FontSelect`, `StudioFonts` | The 52 Studio families |
| Dock resize | `ResizeHandle` | From the workflow Logs dock |
| Zoom buttons | Studio's `ZoomControls` pattern | For the timeline |
| Locks | `PremiumLockMark`, `PremiumLockDialog` | |
| Shortcuts | `ShortcutsSheet`, `ShortcutKeys`, `Kbd` | |

**New Pieces This Sprint Adds To The Design System** (each shown on `/dev/components` before it is used)

| Piece | Module | Notes |
|---|---|---|
| `VideoPlayerBar` (our transport controls) | 07 | Ghost buttons, time text, no shadow |
| `Timeline`, `TimelineRow`, `TimelineBar`, `Playhead`, `TimeRuler` | 07 (read-only), 09 (editing) | Rows `bg-inset`, bars bordered, no shadow |
| `Waveform`, `Filmstrip` | 07 | Drawn on a canvas from the stored data |
| `TransformBox` (handles on the clip) | 11 | 2 px primary border, square handles |
| `ColorPicker` | 11 | A popover with a swatch grid, a hue and shade area and a hex field; replaces Studio's native swatch later |
| `TimeField` (a time-code field) | 09 | "0:04.0", arrow keys step by a frame |
| `AiMinutesChip` | 06 | Reads the meter; warning colour past 80% |
| `ChannelChip`, `ChannelRow` (the stream row) | 06 | Picture, text, **Import**, hide icon; `bg-inset` for the list |
| `StarButton` | 12, 14 | A ghost icon button with `aria-pressed`, used on sticker tiles and sound rows |
| `LibraryTile` (a sticker tile with star and credit mark), `SoundRow` | 12, 14 | Checker background for see-through art; the row's small waveform from stored peaks |
| `LookTile` (a sample picture with a name) | 13 | A `ChoiceTiles` item |
| `ProofDialog` (the Preview Export player) | 15 | A dialog with a plain player bar |

**Icons**: clickable ones from `@animateicons/react` per file (clapperboard for the rail, link, upload, scissors, play, pause, undo, redo, download, send, sparkles for Find Clips); state and decorative ones from lucide.

**Decided (2026-11-17)**: the Stickers, GIFs, Favourites and Audio lists each have a search field that searches our own catalogue by name and tag. The rule is one search, the top bar's. The editor has no top bar, and these fields are the inputs of a picker, like the city field in Discover's place popover, so they stay. They are labelled "Enter your search", and no other field of this kind is added. The operator screen (plans, overrides, usage, change log, library) is not part of this blueprint; it is designed in [`../research/12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md) section 8.
