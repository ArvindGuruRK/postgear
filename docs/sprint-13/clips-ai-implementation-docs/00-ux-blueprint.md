# 00: UX Blueprint, The Clips AI Experience

> **Sprint 13, Clips AI** | Reference only, nothing to build here | Read before Modules 03 to 13.
> **Decides**: how the AI layer of Clips looks and behaves. The user stories decide what it must do; the sprint doc decides how it is built.
> **Revised**: 2026-11-17. AI is paid in AI minutes (Sprint 12's meter), the editor previews with HTML and the export is drawn by FFmpeg, and the module adds Creator Tools and Editor seats.
> **Builds on**: [`../../sprint-12/clips-implementation-docs/00-ux-blueprint.md`](../../sprint-12/clips-implementation-docs/00-ux-blueprint.md). Everything there still holds (the frame, the timeline, the handles, the copy rules, desktop only). This page only describes what is added.
> **References** (local only, gitignored): `docs/screenshots/opusclip/` (03 and 04 the editor with the transcript side and the AI panel, 07 the clip setup, 08 ratio and layouts) and `docs/screenshots/streamladder/` (08 effects, 10 captions, 14 the AI disclosure, 16 the schedule dialog, 23 and 24 posting slots, 25 and 38 the Editors rail group, 26 montage, 27 and 29 the Schedule Maker and Emote Maker). Placement and flow only, in PostGear's own look.

## 1. The Feeling

AI in Clips is a helpful assistant that shows its work. Every AI action says what it will cost before it runs, says what it is doing while it runs, and leaves a visible trace of what it changed: a struck-through sentence, an underlined word, a mark on the timeline. Every one can be undone in one step, and every switch restores what was there before. Violet (`Button variant="highlight"` and the `ai` progress tone) marks the actions that spend AI minutes; nothing else is violet. No sparkle confetti, no "magic" wording.

## 2. Clip Setup

A framed page (rail and top bar stay), reached from **Find Clips** on the video page.

```
Top bar: Clips                                                                    search
+---------------------------------------------------------------------------------------------+
| [ <- Video ]   Why I quit my job, episode 14                         58 min                  |
+---------------------------------------------------------------+-----------------------------+
| +-----------------------------------------------------------+ +-----------------------------+
| | [poster]   Spoken Language  [ Detect Automatically    v ] | | Summary                     |
| |            Upload SRT  [ Choose A File ]                  | |  58 min of video            |
| |            Genre        [ Auto                        v ] | |  Vertical, 30 to 60 seconds |
| |            Range                                          | |  Captions: Bold Pop         |
| |  [pictures along the video ...........................]   | |  Follow the speaker         |
| |  [=====|===============================|=========]        | | --------------------------- |
| |   0:00                                          58:10     | |  Listening            58    |
| |   Use less of the video to spend fewer AI minutes.        | |  Reading              15    |
| +-----------------------------------------------------------+ |  Sound and picture   free   |
| +-----------------------------------------------------------+ |  Total                73    |
| | Recipe  [ None                v ]   Brand Kit [ None    v ] | |  300 of 300 AI minutes left |
| | (Clean Up Recording) (Auto-Edit Talking Video) (Captions  | |                             |
| |  Only) (Reframe) (Social Edit)                            | | [ Find Clips ]              |
| | What Should We Look For?                                  | |                             |
| | [ Enter your idea                                       ] | |  AI listens to what is said |
| | Clip Length  [ Auto | Under 30 Seconds | 30 To 60 Seconds | |  and looks at sound and     |
| |               | 60 To 90 Seconds ]                        | |  chat. It can be wrong.     |
| | Shape        [ Vertical | Horizontal | Square ]           | +-----------------------------+
| | Layouts AI May Use  [x] Fullscreen [x] Blurred [x] Split  |
| +-----------------------------------------------------------+
| +-----------------------------------------------------------+
| | [on ] Captions                 [ Bold Pop v ]             |
| | [on ] Follow The Speaker                                  |
| | [off] Look For Action                  +29 AI Minutes     |
| | [off] Remove Silences                                     |
| | [on ] Hook Title                                          |
| +-----------------------------------------------------------+
+---------------------------------------------------------------+
```

- Three cards on the left (`bg-chrome`), the **Summary** card on the right, sticky. Choices are `Segmented` (clip length, shape), `Checkbox` tiles (layouts), `Toggle` rows (the switches, each with a one-line help in `type-muted` and its extra price when it has one), `Select` (language, genre, recipe, brand kit, caption style).
- The range strip is Sprint 12's filmstrip with two handles; the summary's minutes and prices change as it is dragged.
- **Upload SRT** is a quiet secondary button beside **Spoken Language**. It opens a file picker for an SRT or VTT file; once a file is read, the row shows "From your file: episode14.srt" with **Remove**, **Spoken Language** is disabled, and the summary drops the Listening line (no AI minutes). A file that cannot be read shows an `Alert variant="warning"`: "We could not read this captions file. Check that it is an SRT or VTT file."
- **Genre** is a `Select`: **Auto** (default), **Podcast**, **Gaming**, **Education**, **Interview**, **Vlog**. With Auto, the row reads "Auto: Podcast" once the first minutes have been read. It costs nothing and is saved in recipes.
- **Recipe** has the five starter recipes as chips under the picker (see section 8) next to the workspace's own.
- **What Should We Look For?** is a `Textarea` (two lines, "Enter your idea"), with three quiet example chips under it that fill it in when clicked ("Funny moments", "Strong opinions", "Tips people can use"). The chips are suggestions in a sentence-case line, not a placeholder.
- The **Summary** is a `SummaryBox` over a price list in AI minutes (one line per step: Listening, Reading, and Looking For Action when it is on; Sound And Picture shows as "free" because a run that listens includes it); the total is bold; the AI minutes chip is under it ("38 of 300 AI minutes left"). **Find Clips** is `Button variant="highlight"`, and its label carries the total when there is room: "Find Clips (73 AI Minutes)". With too few AI minutes it is disabled and an `Alert variant="warning"` in the card says "This needs 73 AI minutes and you have 38 left. They come back on 1 December, or you can upgrade the plan." with **See Plans**; with none left it says "This workspace has used all its AI minutes for this month. They reset on 1 December."
- Picking a recipe fills every control it covers; changed controls show a small dot, and **Save As Recipe** appears under the recipe picker.
- The honest line under the button is always there.
- After pressing, the page returns to the video page, where the run's progress and results show as in Sprint 12, with the new steps in words.

## 3. Results On The Video Page

- An AI clip now has a **title** (AI's, editable in place), the score chip, and reasons in plain words ("Strong opening line", "Complete thought", "Matches what you asked for", "Sudden movement on screen", "Chat exploded").
- A clip found by Look For Action carries one more line in `type-muted`: what AI saw ("A car flips over a ramp.").
- The note under the list reads "AI listened to what was said and watched for action." or, when only sound and picture were used, Sprint 12's line.
- A **Transcript** button in the `PageActions` row opens the video's transcript in a right-hand `Sheet` (when the video has one): the words in paragraphs with times in the margin, find with Ctrl+F inside the sheet, click a word to jump the player, select a stretch and **Create Clip** makes that clip.

## 4. The Captions Tab

Between **Audio** and **Export** in the tab rail.

| State | What shows |
|---|---|
| No captions yet | One line of help, **Spoken Language** (`Select`, "Detect Automatically" first), and **Add Captions** (`highlight`) with the price in its label when this stretch has not been listened to ("Add Captions (12 AI Minutes)"), or plain "Add Captions" when it has. Beside it a quiet **Upload SRT** takes a file instead of listening (free) |
| Listening | A `Progress` in the `ai` tone, "Listening to what is said", **Cancel** |
| No speech | An `Alert`: "We could not hear any speech in this video." |
| Captions on | Style tiles, then the controls below |

- **Style tiles**: a grid, each tile showing two words of the clip in that style on a dark chip, with the name under it: **Bold Pop**, **Marker**, **Karaoke**, **Clean**, **Boxed**, **Typewriter**; then **My Styles** and **Create A Style** (a tile with a plus). The picked one is marked. These six are our own designs; none copies a reference product's art or names.
- **Controls**: **Position** (`Segmented`: Top, Middle, Bottom; dragging the captions on the clip sets a custom place), **Size** (`Slider`), **Words At Once** (`Segmented`: 1, 2, 3, A Line), **Letter Case** (`Segmented`), **Marked Word Colour** (the colour picker), and a **Safe Area Guide** `Toggle` that draws where TikTok, Reels and Shorts put their own buttons while captions are selected.
- **Translate Captions**: a `Select` of languages and a secondary button with the price; when a translation exists, a `Segmented` switches between the original and the translation.
- **Remove Captions** (secondary) at the foot.
- **Preview note.** Under the captions controls, a `type-muted` line: "The editor is a fast preview. Preview Export shows the real result." Captions in the editor are drawn with the browser's own text, an approximation of the export, which draws them with FFmpeg (ASS subtitles). Letter shapes in Tamil and Hindi, line breaks, the marked-word colour and outline thickness can differ by a pixel or two; **Preview Export** in the Export tab renders a small copy through the real engine. For Tamil, Hindi and translated captions the marked word is a whole word or the whole page, because a colour change inside a letter cluster would draw wrongly.
- On the timeline a **Captions** row shows one bar per caption page; it is read-only (captions move with the speech), and clicking a bar selects that page for editing.
- On the clip, captions are selectable as one block (move and resize, not turn). Double-click a word to fix it in place. Unsure words carry a dotted underline in the editor only, never in the export.

## 5. The Transcript Pane

Opened by a **Transcript** button in the editor's top bar; a pane (`w-80`, `bg-chrome`) between the panel and the stage; it can be closed.

- The clip's words as flowing text, grouped in short paragraphs, each with its start time in the margin. The word being said is marked with the theme's primary colour as the clip plays; the pane scrolls to follow unless the user has scrolled it.
- Click a word: the playhead jumps there. Double-click: fix the word (a small field in place; Enter saves; **Replace Everywhere** appears when the same word occurs again in the video).
- Select words (drag, or Shift and arrows) and press **Delete**: the stretch is cut from the clip. Cut text stays in place, struck through and dimmed, with a small **Restore** on hover.
- Words that were trimmed away at the clip's ends show dimmed above and below with "Outside this clip"; they are context, not editable.
- At the foot: **Remove Silences** and **Remove Filler Words** (both secondary). Each opens a small popover first: what it found ("7 pauses, 4.2 seconds"; a tick list of filler words), a `Slider` for the shortest pause to remove, and **Remove**. One undo step each.
- Unsure words are underlined here too. A note at the top when some words were hard to hear: "Some words were hard to hear. Check the underlined ones."

## 6. Layouts: Camera And Speaker

In the Layouts tab, under the layout tiles:

- **Detect Camera** (secondary, with a small `ai` spinner while "Finding faces"): moves the Camera box. If it finds none: an `Alert variant="warning"`, "We could not find a face camera. Drag the box yourself."
- **Follow The Speaker**: a `Toggle` row. Turning it on runs "Finding faces" (a `Progress`), then the crop boxes in the Video pane are replaced by a moving frame that the user watches, not drags. Under it: **Show Both** (a `Toggle`, when two people were found) and, when there are many faces, a row of face thumbnails to pick who to follow.
- The timeline gains a thin **Speaker** strip under the Video row while it is on: coloured stretches per person, and hatched stretches where the speaker was lost. Selecting a hatched stretch shows "We lost the speaker for 3 seconds here." with **Fix By Hand**, which gives back a crop box for that stretch only.
- Turning the switch off restores the user's own boxes; a toast says "Your own layout is back."

## 7. Effects: The AI Rows

Four more rows in the Effects tab, in the same card style as Zoom and Speed Control:

- **Bleep Bad Words** ("Hide words platforms do not like"): a `Toggle`; on shows the words found, each with a tick, and **Bleep** or **Mute** (`Segmented`). **My Words** opens a small dialog to edit the workspace's own list ("Enter your word").
- **Add Hook Title** ("A line on the first seconds"): three suggestions as tiles and a field ("Enter your title"); picking one adds a text item at the start in one of three looks.
- **Add Hook Clip** ("Open with the best moment"): the clip's timeline in small with a 1 to 5 second range to drag; AI's suggestion is preselected; **Add**. On the main timeline the hook shows as a first part with a small "Hook" label.
- **Text To Speech** ("Turn words into a voice"), only when switched on: a `Textarea` ("Enter your words"), voices with a play button each, the price in AI minutes ("Make The Voice (1 AI Minute)"), **Make The Voice** (`highlight`).

## 8. Recipes And Brand Kit

- Editor top bar: an overflow menu gains **Save As Recipe** and **Apply A Recipe**.
- `/[orgId]/clips/kit`: a framed page reached from a **Recipes And Brand Kit** secondary button in the Clips page's `PageActions`. Two tabs: **Recipes** (cards: name, a line reading its settings back, **Rename**, **Delete**) and **Brand Kit** (the workspace's Studio brand kits, each with the clip fields: logo place, caption style, intro, outro).
- The Clip Setup and editor pickers list both.

### Starter Recipes And Auto-Edit Video

- **Starter recipes** are five chips on the Create tab and under the recipe picker on Clip Setup: **Clean Up Recording**, **Auto-Edit Talking Video**, **Captions Only**, **Reframe**, **Social Edit**. Each chip is a small tile with the name and a one-line help in `type-muted` ("Removes silences and filler words, adds captions"). Picking one fills Clip Setup and updates the summary's price. On the **Recipes** tab, starters are listed first with a **Starter** `Badge`, read-only; **Copy To My Recipes** makes an editable one.
- **Auto-Edit Video** is a menu item in the video page's overflow menu and a secondary button beside the chips. It opens a small dialog (not Clip Setup): the recipe (`Select`, default **Auto-Edit Talking Video**), the stretch (the whole video, up to 30 minutes, with the range strip when longer), the price ("Auto-Edit Video (28 AI Minutes)") and **Auto-Edit** (`highlight`). The run shows a `Progress` in the `ai` tone in words, and the one finished clip opens in the editor. A part the recipe could not run is listed in a toast and under the clip's title in `type-muted`: "Follow The Speaker was skipped: we could not find anyone to follow."

## 9. Many Clips At Once

- The Clips tab's cards get a tick box (top left, on hover and when any is ticked). With one or more ticked, the design-system `BulkActionBar` shows: "8 selected", **Export All** (primary), **Create Montage** (secondary, from two ticked), **Hide**, **Delete** (danger).
- **Export All** opens a dialog: the quality tiles (Sprint 12's), a list of the clips, **Export**. Then a list with a `Progress` per clip; it can be closed; the bell says "8 clips are ready" once.
- **Create Montage** opens a dialog: the clips as a sortable list (dnd-kit), **Between Clips** (`Segmented`: Cut, Fade), an optional title card ("Enter your title"), **Shape** when the clips differ, **Create**. The montage opens in the editor.

## 10. The Composer

- Beside the date: **Next Available** (secondary). It fills the next free posting time of the first chosen channel.
- **The schedule dialog** (opened from the date control) shows the calendar, the times already used that day as small chips, a time field, and a row **Pick A Random Time** with four `Button`s: **Morning**, **Noon**, **Afternoon**, **Evening**. Each fills the time field with a free time inside that part of the day, never on a round five minutes; pressing again gives another. A full part of the day shows "That part of the day is full. Try another." Under it: **Next Available** and **Manage Posting Slots** (opens the dialog below).

### Posting Slots Dialog

Opened from the channel's preferences (**Posting Slots**) and from the schedule dialog. A `Dialog`, `DataTable`-style list, no shadow on selects or chips.

```
Posting Slots: Client A Shorts (YouTube)                                [x]
+--------------------------------------------------------------------------+
| Time       Window                  Days (on = filled)                    |
| 7:50 AM    [ Within 15 Minutes v]  [M][T][W][T][F] (S)(S)       [ Del ] |
| 3:40 PM    [ Within 5 Minutes  v]  [M][T][W][T][F] (S)(S)       [ Del ] |
| 10:15 AM   [ Exact             v]  (M)(T)(W)(T)(F) [S][S]       [ Del ] |
| [ Add A Slot ]                                                           |
+--------------------------------------------------------------------------+
| [ Shuffle Times ]   Each post goes out at a slightly different minute    |
|                     inside its window, so your feed never looks          |
|                     automated.                                           |
|                                       [ Cancel ]   [ Save Slots ]        |
+--------------------------------------------------------------------------+
```

- Each row: a time field (12 hour with the workspace's clock setting), a window `Select` (**Exact**, **Within 5 Minutes**, **Within 15 Minutes**, **Within 30 Minutes**), seven weekday chips (a chip is on when the slot applies to that day; a day with no slot reads "No times" in the calendar), and a delete icon. **Add A Slot** adds a row with the next free sensible time. Rows are sorted by time and grouped visually by identical day sets.
- **Shuffle Times** (secondary) opens a small second dialog: "How often do you want to post?" (a `Slider`, 1 to 5 times a day, shown as "21 a week"), a preview of the week, **Shuffle Again** and **Use These Times**. Nothing is saved until **Save Slots**.
- A channel set up before this sprint opens with its old times on all seven days and no window.
- For a post with video: a **Made With AI** `Toggle` in the post's settings, with the help line "Captions and cuts do not need this. A made-up voice or picture does." Channels with no such label show "This platform has no label for AI. Say it in your caption if you need to."

## 11. Waiting, Empty And Error States

| Where | What |
|---|---|
| Any AI step queued behind others | The bar says "Waiting for our turn, about 4 minutes"; on the Free plan, a second line: "Paid plans go first." |
| The AI service is not running | An `Alert variant="warning"` in the tab or setup: "Captions are not available right now. Everything else still works." AI buttons are disabled; Sprint 12's tools are not |
| A failed AI step | One sentence and "Your AI minutes were given back." with **Try Again** |
| The month's AI minutes are used up | "This workspace has used all its AI minutes for this month. They reset on 1 December." AI buttons are disabled; Sprint 12's tools are not |
| A page an Editor cannot use | An `Alert`: "You do not have access to this page." with a **Back To Clips** button |
| Nothing matched the request | In the results: "Nothing matched what you asked for. Here are the best moments we found instead." |
| No recipes yet | `EmptyState`: "No recipes yet. Set a clip up the way you like and save it as a recipe." |
| A recipe with a missing style or kit | A toast naming the missing part and what was used instead |
| No one to follow | "We could not find anyone to follow in this clip." and the switch stays off |

## 12. Copy Rules (Additions)

- Names: **Clip Setup**, **Find Clips**, **Add Captions**, **Create A Style**, **Translate Captions**, **Remove Captions**, **Remove Silences**, **Remove Filler Words**, **Replace Everywhere**, **Restore**, **Detect Camera**, **Follow The Speaker**, **Show Both**, **Fix By Hand**, **Bleep Bad Words**, **Add Hook Title**, **Add Hook Clip**, **Text To Speech**, **Make The Voice**, **Save As Recipe**, **Apply A Recipe**, **Export All**, **Create Montage**, **Next Available**, **Shuffle Times**, **Made With AI**, **Auto-Edit Video**, **Upload SRT**, **Genre**, **Pick A Random Time**, **Morning**, **Noon**, **Afternoon**, **Evening**, **Manage Posting Slots**, **Add A Slot**, **Save Slots**, **Creator Tools**, **Emote Maker**, **Schedule Maker**, **Export For Twitch**, **Export For 7TV**, **Export For BTTV**, **Fill It In By Hand**, **Refresh From Twitch**, **Invite An Editor**, **Preview Export**.
- Words to use: captions, transcript, speaker, recipe, brand kit, montage, score, emote, editor, AI minutes. Never: ASR, diarization, inference, model, tokens, keyframes, VAD, virality, magic.
- Prices read "12 AI Minutes" ("1 AI Minute") in a button label and "15" in a price list; the chip reads "38 of 300 AI minutes left"; lengths as in Sprint 12. AI credits (Copilot, Create Post) are never mentioned on a Clips screen.
- Placeholders start with "Enter your": "Enter your Twitch name", "Enter your idea", "Enter your title", "Enter your word", "Enter your words", "Enter your video link".
- Reasons and AI's lines are sentences in sentence case. Titles AI writes are shown as it wrote them and are the user's to edit.

## 13. Design System Map (Additions)

| Piece | Use | Notes |
|---|---|---|
| Setup choices | `Segmented`, `Toggle`, `Checkbox`, `Select`, `Textarea`, `SummaryBox` | No new pieces |
| AI buttons and bars | `Button variant="highlight"`, `Progress tone="ai"`, the Clips `AiMinutesChip` ("38 of 300 AI minutes left"; its own chip, never the text and image `CreditsChip`, which counts AI credits) | The only violet |
| Transcript sheet and pane | `Sheet` (video page), a pane in the editor frame | The pane is part of the frame, not a floating panel |
| Bulk actions | `BulkActionBar` | Exists in `packages/ui`, first used here in Clips |
| Sortable montage list | dnd-kit, as `slides-rail.tsx` | |
| Notices | `Alert`, toasts | |
| Team page (members, editor seats) | `DataTable` with a role `Badge` per row, the seat line in `type-muted` | Exists; gains the **Editor** role and the seat line |
| Invite and slot dialogs | `Dialog` | Invite dialog gains **Editor** in its `ChoiceTiles`; the slots dialog is new |
| Role choice, schedule themes | `ChoiceTiles` | Role: Member, Admin, Editor. Themes: five cards in Schedule Maker |
| Emote Maker controls | `Slider` (trim), `Button` (export), a square crop box on the video | The crop box and trim bar are new pieces |
| Weekday chips | `ToggleGroup`-style chips, no shadow | Same flat look as the other toggles |
| Preview note | `type-muted` line | Captions in the editor are an approximation; Preview Export shows the real result |

**New pieces** (each on `/dev/components` first): `TranscriptText` (words that can be clicked, selected, struck through, underlined; Module 04), `CaptionStyleTile` (Module 03), `SpeakerStrip` (Module 08), `CropBox` and `TrimBar` (Module 14, Emote Maker), `ChatPreview` (Module 14), `WeekdayChips` (Module 13), `RowsEditor` (Module 14, the Schedule Maker's table editor in Design Studio).

**Open question for Arvind**: the Transcript pane makes the editor four columns wide (rail, panel, transcript, stage). At 1366 px the stage gets small. Recommendation: opening the Transcript pane collapses the panel to its rail (one click brings it back), so there are never more than three columns.

## 14. Creator Tools

A framed page at `/[orgId]/clips/tools`, reached from a **Creator Tools** secondary button in the Clips page's `PageActions`. Two large tiles (**Emote Maker**, **Schedule Maker**), each with one line under its name. No in-page title. Both tools cost no AI minutes; their downloads count toward the day's download limit, and a refusal says "You have reached today's limit of 20 downloads. It resets at midnight UTC."

### 14.1 Emote Maker

```
Top bar: Clips                                                                    search
+---------------------------------------------------------------+-----------------------------+
| [ <- Creator Tools ]   Emote Maker                                                            |
+---------------------------------------------------------------+-----------------------------+
| Clip  [ Pick A Clip  v ]  or  [ Enter your video link ] [Get Video]                           |
| +-----------------------------------------------+   +---------------------------------------+
| |                                               |   | Preview                               |
| |        +-----------+                          |   |  [112]   [56]   [28]    loops         |
| |        |  crop box |  (stays square)          |   |  Looks soft under 112 source pixels   |
| |        +-----------+                          |   +---------------------------------------+
| |                                               |   | Chat Preview              (sun | moon) |
| |  [ play ]   0:07                              |   |  maya:  that was wild                 |
| +-----------------------------------------------+   |  kai:   [emote]                       |
| Trim   [|||||||[=========]|||||||||||||||]  2.4 s    |  noor:  no way [emote][emote][emote]  |
|        (3.0 seconds at most)                          |  Enter your own chat line [        ] |
| Background  [ Keep It ]  [ Remove A Colour ] (eyedropper, Similarity slider)                  |
| [ Export For Twitch ]  [ Export For 7TV ]  [ Export For BTTV ]                                |
| Use clips of your own stream. Twitch reviews emotes before they go live.                      |
+-----------------------------------------------------------------------------------------------+
```

- **Source**: a `Select` of the workspace's clips and videos, or a pasted link through the existing probe and import. A Twitch clip is at most 60 seconds, so it comes in whole.
- **Crop box**: a dashed square drawn over the poster or the playing video; drag to move, corner handles to resize, always square. Under 112 source pixels a `type-muted` line says "This will look soft."
- **Trim bar**: a waveform with one draggable window and a time marker; it will not stretch past **3.0 seconds** and moves in tenths of a second. The length shows beside it.
- **Preview**: the emote loops at 112, 56 and 28 pixels on `bg-inset` squares. **Chat Preview** is a card with four lines of chat in the style of a stream chat (names in different colours, one line with five emotes in a row), a sun and moon `Segmented` switch for light and dark grounds, and a text field ("Enter your own chat line") whose text is never saved. No Twitch logo or wordmark is used.
- **Background**: **Keep It** (default) or **Remove A Colour**: an eyedropper on the video picks the colour and a **Similarity** `Slider` sets how much goes. A `type-muted` line says edges are rougher in GIF files than in 7TV files.
- **Export**: three secondary buttons, each downloading a zip. A result card then lists each file with its size and a tick or a reason: "112 px, 311 KB, under the limit", "56 px, 118 KB, under the limit". When the ladder had to lower the frame rate or colours, a line says so ("Made at 15 frames a second to fit"). When nothing fits, an `Alert variant="warning"`: "This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop."
- A `type-muted` line: "Check each site's current rules before you upload." The tool states limits as data it keeps current, not as promises.

### 14.2 Schedule Maker

```
+-----------------------------------------------------------------------------------------------+
| [ <- Creator Tools ]   Schedule Maker                                                         |
+-----------------------------------------------------------------------------------------------+
| [ From Twitch ] [ Fill It In By Hand ]                                                        |
| Twitch name  [ Enter your Twitch name        ]   Time zone [ Asia/Kolkata v ]  [ Get Schedule]|
|                                                                                               |
| Theme  (Clean Blue) (Light Blue) (Cool) (Dark) (Red)          Shape [ Portrait | Landscape ] |
|                                                                                               |
| +--------------------------------------------+   Week of 16 Nov 2026                          |
| | Catch Me Live            All times IST     |   Mon  7 PM   Minecraft                        |
| | Mon  7 PM   Minecraft                      |   Tue  Off                                     |
| | Tue  Off                                   |   Wed  8 PM   Just Chatting     (rows are       |
| | ...                                        |   ...                            editable)     |
| +--------------------------------------------+                                                |
| [ Open In Design Studio ]                                                                     |
+-----------------------------------------------------------------------------------------------+
```

- **Step 1, the name**: two tabs, **From Twitch** and **Fill It In By Hand**. The name field's placeholder is "Enter your Twitch name". The time zone `Select` defaults to the browser's zone and can be changed; the picture prints "All times Asia/Kolkata".
- **Step 2, the week**: **Get Schedule** reads the public schedule. The page shows the seven rows as an editable list (day, time, title, an **Off** switch), a vacation line ("On a break until Mon 23 Nov") when Twitch reports one, and warnings for a day with a third show ("+1 more"; it will not fit). No schedule: seven rows marked Off and "This channel has no Twitch schedule. Fill it in by hand." Unknown name: "We could not find that Twitch channel."
- **Step 3, the theme and shape**: five `ChoiceTiles` cards with a small live preview each (**Clean Blue**, **Light Blue**, **Cool**, **Dark**, **Red**) and a `Segmented` for **Portrait** (1080 by 1350) and **Landscape** (1920 by 1080).
- **Step 4, open**: **Open In Design Studio** creates a normal design from the chosen preset with the rows filled in (Design Studio schema version 3) and opens it in the Studio editor, immersive as Studio always is. Editing a word, the font, the colours or the brand kit is the Studio's own panel; the schedule rows have a small table editor in the right panel (day, time, title, Off). Export and **Send To Composer** are the Studio's.
- **Refresh From Twitch** (a menu item in the editor) asks first: "Replace your edits with Twitch's schedule?" with **Replace** and **Keep My Edits**.
- Desktop only, like Studio: designed at 1366 px and up.

## 15. Editor Seats

### 15.1 Invite Dialog

The Team page's invite `Dialog` gains **Editor** as a third `ChoiceTiles` choice beside **Member** and **Admin**.

```
Invite A Person                                                            [x]
+----------------------------------------------------------------------------+
| Address    [ Enter your colleague's email address          ]   (required   |
|                                                              for Editors)  |
| Role       ( Member )  ( Admin )  (*Editor*)                               |
|            Editors can make clips and designs and save post drafts. They   |
|            cannot connect channels, schedule or publish, see billing or    |
|            analytics, or invite people.                                    |
|            2 of 3 editor seats used                                        |
|                                              [ Cancel ]  [ Send Invite ]   |
+----------------------------------------------------------------------------+
```

- The help under **Editor** is sentence case in `type-muted`; the seat line sits under it. With no seat left, the **Editor** tile stays but the seat line turns to an `Alert variant="warning"`: "No editor seats left. Remove an editor or change your plan." with **See Plans**, and **Send Invite** is disabled for that role.
- The address is required for an Editor and optional for the others. The placeholder reads "Enter your colleague's email address".
- The email says "invited you to join {workspace} as an editor"; the accept page says "You have been invited to join {workspace} as an editor." and sends the Editor to Clips Home.

### 15.2 What An Editor Sees

The reduced rail has only: **Home**, **Clips**, **Design Studio**, **Media**, **Composer**, **Calendar**, **AI Copilot**. Everything else is simply absent from the rail, with no greyed-out items and no padlocks: Channels, Analytics, SEO, Discover, Workflows, Billing, API Keys, Webhooks, and the Team and Settings entries for people and plans. The top bar's global search shows results from those areas an Editor can use only.

- **Home** hides the analytics tiles. **Clips**, **Design Studio** and **Media** are the same as for anyone, including Creator Tools.
- **Composer**: **Save Draft** is the primary action. **Schedule**, **Publish Now** and **Next Available** are not drawn. If one is reached another way (an old tab, a typed address, a direct call), the answer is a toast: "Editors cannot do this. Ask an admin." and nothing changes.
- A page typed by address that an Editor cannot use shows an `Alert`: "You do not have access to this page." with a **Back To Clips** button. It never shows a broken page.
- Channel pickers in the Composer show the workspace's channels by name and picture only, never a token, and have no **Connect** or **Refresh** button.

### 15.3 The Team Page For An Admin

- Members are a `DataTable` with a role `Badge` (**Admin**, **Member**, **Editor**). The Editor's badge is quiet like the others; there is no other colour.
- Above the table, a seat line in `type-muted`: "2 of 3 editor seats used". After a plan is lowered below the number of Editors, an `Alert variant="warning"`: "You have 5 editors and your plan allows 3. Remove 2 to add more." Existing Editors keep working.
- The row menu offers **Change Role** (Member, Admin, Editor; the seat cap is checked) and **Remove**. The last admin cannot be demoted or removed, as today.
- An Editor's work carries their name (clips, designs, drafts), so an admin can see who made what.
