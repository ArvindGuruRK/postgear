# 📋 User Stories: Clips (Turn Any Long Video Into Short Clips)

> **Module**: Clips, paste a link or upload a video, cut the best moments by hand or with AI, edit them, export, and send them to the composer
> **Build spec**: [`../sprint-documents/sprint-12-clips.md`](../sprint-documents/sprint-12-clips.md)
> **Research**: [`../sprint-12/README.md`](../sprint-12/README.md)
> **Last Updated**: 2026-11-17 (revised after the Decision Ledger: AI Minutes instead of credits, one FFmpeg render with a Preview Export, an open sound and sticker library, My Channels, plans the operator edits)
> **Format**: `As a [persona], I want [action], so that [benefit]`, then acceptance criteria, priority and story points, the same format as [`../../user_stories.md`](../../user_stories.md)
> **Size**: 13 epics, 57 stories (34 P0, 19 P1, 4 P2). Twelve of them were added on 2026-11-17: CL-1.7, 1.8, 2.5, 3.4, 7.5, 8.3, 9.4, 10.4, 11.2, 11.3, 13.6 and 13.7.

How to use this document:
- **Section 2** shows how real people will use Clips, start to finish (journeys A to F). Read it first.
- **Section 3** is the story list. Each acceptance criterion is something you can see or click.
- **Section 4** is the UX rulebook for this module. Clips handles other people's platforms, big files and long waits, so most of these rules are about honesty and never losing work.
- **Section 5** lists what happens when things go wrong.
- **Section 6** is the final checklist for sprint close-out.

Sprint 13 (captions, smarter AI, Auto-Reframe and more) has its own stories in [`user-stories-clips-ai.md`](user-stories-clips-ai.md). Nothing here needs speech to text.

---

## 1. Personas

| ID | Persona | Who they are | What they want from Clips |
|---|---|---|---|
| 👤 ST | **Streamer** | Vikram streams games on Twitch and Kick from Chennai, four hours a night. | The five best moments of last night's stream as vertical clips, on TikTok, Shorts and Reels before lunch. |
| 👤 SC | **Solo Creator** | Priya runs a small yoga studio and records one hour classes for YouTube. | Three short clips from each class, cut exactly where she wants, with her studio's name on them. |
| 👤 MM | **Marketing Manager** | Karthik markets a B2B SaaS product and records webinars on his laptop. | To upload a recording, cut the two good answers, and schedule them on LinkedIn and X. |
| 👤 AO | **Agency Owner** | Meera's agency clips for six streamers and brands. | Her team making clips in each client's workspace, inside each plan's limits, with nothing lost. |
| 👤 TM | **Team Member** | Arun, on Meera's team, edits clips all day. | A fast editor with keyboard shortcuts, and no surprises when he presses Export. |
| 👤 AD | **Workspace Admin** | Meera, as admin. | To see how much video the workspace stores and to delete what is no longer needed. |
| 👤 OP | **Operator** | Nadia works for PostGear itself, not for any customer. | To change what each plan allows, give one workspace a custom deal, and look after the sound and sticker library, all without a release. |

---

## 2. Real User Journeys

### Journey A: Vikram clips last night's stream with AI 🎮

1. Vikram clicks **Clips** in the rail. The **Create** tab shows one field: "Enter your YouTube, Twitch or Kick link".
2. He pastes his Twitch link and presses Enter. In a few seconds a card shows the stream's picture, its title, his channel name, "3 h 42 min" and a **Twitch** badge.
3. Under the card is a tick box: "This video is mine, or I have permission to use it." He ticks it and presses **Import Video**.
4. The **Videos** tab opens. His stream is first, with a bar: "Getting the video, 34%". He goes to make coffee. When he comes back the bell says "Your video is ready" and the card shows the picture and **Open**.
5. He opens it. The video plays on the left. He presses **Find Clips (56 AI Minutes)**; the chip beside it says "300 of 300 AI minutes left". A bar says "Listening for loud moments", then "Reading the chat", then "Picking the best moments".
6. Twelve clips appear on the right, best first. The top one says 92 with two reasons: "Chat exploded" and "Loud reaction". Marks on the timeline show where each one is. He plays three of them and hides two.
7. He opens the best one. The editor takes the whole window and asks **Vertical** or **Horizontal**; he picks Vertical. He chooses the **Gameplay** layout (the game large, his face camera in a small box), and drags one box over the game and one over his face camera.
8. He searches the sticker library for "gg", adds a sticker for two seconds and stars it as a favourite, types "HE REALLY DID THAT" in a bold font at the top, gives the clip the **Cinematic** look, and adds a zoom on the last three seconds.
9. In the **Export** tab he presses **Preview Export**. A dialog says "Making the preview", and half a minute later it plays the clip the way the real export will draw it. He is happy, so he picks **1080p** and presses **Export Clip**, and watches "Rendering, 61%". When it is done he presses **Send To Composer**, ticks TikTok, YouTube and Instagram, and the composer opens with the clip attached.

### Journey B: Priya cuts a class by hand ✂️

1. Priya pastes the YouTube link of last week's class. The card says "58 min". She ticks the box and imports it.
2. On the video page she plays to the part she likes and presses **I**. She plays on and presses **O**. The timeline shows the range and "0:42". She presses **Create Clip**.
3. She does the same twice more. The right side now lists three clips under **Drafts**.
4. She opens the first. She picks **Horizontal** for YouTube, keeps the **Fullscreen** layout, and adds her studio's name as text in the corner for the whole clip.
5. The first two seconds are quiet, so she drags the left edge of the clip on the timeline until it starts on her first word.
6. She adds soft music from **Audio**, turns it down to 20%, and exports at 720p. The clip appears in **Media** with a picture and "0:40".
7. Next day she opens the same clip, picks **Vertical** this time, moves the crop box over herself, and exports again for Reels.

### Journey C: Karthik uploads a webinar and saves a copy 💼

1. Karthik presses **Upload A Video** and picks a 1.4 GB recording. A bar shows "Uploading, 48%". His Wi-Fi drops; when it returns the upload carries on from where it stopped.
2. On the video page he marks two answers and creates two clips. He splits the second clip in the middle and deletes a cough.
3. He speeds a slow part up to 1.5x from **Effects**. The clip gets shorter and his text is still on the sentence he put it on.
4. He exports both and sends them to the composer for LinkedIn and X.
5. Later he pastes a YouTube link from his company's channel, and on the card he presses **Download** instead. He picks **720p** and the file is saved to his laptop. The video is not kept in Clips.

### Journey D: Something goes wrong, and it's easy to fix 🛟

- Vikram pastes a link to a stream that is still live. The card says "This stream is still live. Come back when it has ended." and there is no Import button.
- Priya pastes a link from a site we do not read. The message says "We can only read YouTube, Twitch and Kick links for now. You can upload the file instead." with **Upload A Video** beside it.
- YouTube refuses our server for an hour. The message says "YouTube is not answering us right now. Try again in a little while, or upload the file instead." Twitch and Kick links still work.
- Arun closes the browser while an export is at 40%. The export carries on. When he comes back, the clip says **Exported** and the bell has "Your clip is ready".
- Vikram's Twitch stream is deleted by Twitch before he exports an old AI clip he never opened. The editor says "The sharp video is no longer online. This clip will export at 720p from the copy we kept." and Export still works.
- Arun and Meera open the same clip. Meera saves first. Arun's editor says "Someone else changed this clip. Reload to see their version." and nothing of Meera's is overwritten.
- Priya is on the Free plan and picks 1080p. A lock dialog says "1080p export needs a higher plan." with **See Plans**. 720p still works.
- The workspace is at its storage limit. Import says "Your video space is full (15 GB). Delete a video you no longer need, or upgrade the plan." and the **Videos** tab shows what is taking the room.
- Meera's workspace has used all its AI minutes. The **Find Clips** button is off and the note says "This workspace has used all its AI minutes for this month. They reset on 1 December." with **See Plans**. Nothing was charged.
- Arun presses **Preview Export** and the render fails. The dialog says "We could not make the preview. Try again." The editor and the clip are untouched.

### Journey E: Vikram browses his own channel 📺

1. Vikram opens **Streams**. It is empty: "Add the name of a Twitch, YouTube or Kick channel. We list its public videos and clips so you can import one with a click." He presses **Add A Channel**, picks Twitch, types his channel name in "Enter your channel name" and presses **Check**. His picture and display name appear. He presses **Add Channel**.
2. His last eight streams are listed, newest first: picture, title, date, length, views, and an **Import** button. One has a "Live Now" badge and no button.
3. He hides two old tests with the hide icon. They go away; **Show Hidden** brings them back.
4. He presses **Import** on last night's stream. The link card opens with the stream filled in and the rights tick waiting for him. He ticks it, imports, and carries on as in Journey A.
5. A week later he opens **Streams** again. The imported stream shows **Open** instead of **Import**. The **Create** tab has a **Coming Up** panel: two clips are scheduled for the next fortnight, with **View Calendar**.

### Journey F: Nadia changes what Free allows, then gives one workspace a deal 🛠️

1. Nadia is an operator. The account menu shows **Operator**; for everyone else the address is a plain "not found" page.
2. In **Plans** she finds the group "Clips". She clicks the Free cell of Clips Video Length (60), types 90, and the cell is marked. The action row says "1 change waiting". She presses **Review Changes**, reads "Clips Video Length, Free: 60 minutes to 90 minutes", types her reason and presses **Save Changes**. The toast says "Saved 1 change. It is live now."
3. A Free workspace pastes an 80 minute video. A moment ago it was refused; now the link card has **Import Video**. A 100 minute video is still refused with "This video is longer than your plan allows (90 minutes). Upgrade the plan to bring in longer videos."
4. Meera's agency has a custom deal. In **Workspace Overrides** Nadia finds the workspace, presses **Add Override**, sets Clips AI Minutes to 2,000, picks an end date in 90 days and writes a reason. The workspace's chip now says "1,950 of 2,000 AI minutes left".
5. Ninety days later the override ends by itself. The workspace goes back to its plan's value, and the **Change Log** has a line for the end as well as for the start.

---

## 3. User Stories

### Epic CL-1: Bring In A Video

#### CL-1.1: Open Clips From The Rail

> **As a** creator,
> **I want** a Clips item in the rail,
> **So that** I can turn long videos into short ones without leaving PostGear.

**Acceptance Criteria:**
- [ ] The rail shows **Clips** with an animated icon; the top bar names the page "Clips".
- [ ] The page opens with a `PageActions` row and the tabs **Create**, **Streams**, **Videos**, **Clips**, **Downloads**. No in-page title. The open tab is kept in the address.
- [ ] A workspace whose plan does not include Clips sees "Clips is not part of this workspace's plan." with **See Plans**.
- [ ] Below 1366 px wide, the page shows one sentence, "Clips is made for a bigger screen. Open it on a laptop or desktop.", and nothing else.

**Priority**: P0 | **Story Points**: 2

#### CL-1.2: Paste A Link And See The Video

> **As a** streamer,
> **I want** to paste a link and see which video it is,
> **So that** I know it is the right one before anything is fetched.

**Acceptance Criteria:**
- [ ] The **Create** tab has one field with the placeholder "Enter your YouTube, Twitch or Kick link" and a **Find Video** button; Enter does the same.
- [ ] Nothing is requested while typing.
- [ ] Within about 10 seconds a card shows the picture, title, channel name, length ("3 h 42 min") and a platform badge.
- [ ] The card names what kind of link it is in plain words: "Past stream", "Clip", "Video" or "Short".
- [ ] A link we cannot read, a private video, a live stream and a missing video each show their own sentence (section 5) and no Import button.
- [ ] A video longer than the plan allows shows "This video is longer than your plan allows (60 minutes). Upgrade the plan to bring in longer videos." with **See Plans**, and no Import button.

**Priority**: P0 | **Story Points**: 5

#### CL-1.3: Confirm I May Use The Video

> **As a** workspace owner,
> **I want** Clips to ask once per video that I have the right to use it,
> **So that** the workspace only holds videos its people may use.

**Acceptance Criteria:**
- [ ] Under the card is a tick box: "This video is mine, or I have permission to use it."
- [ ] **Import Video** and **Download** stay disabled until it is ticked.
- [ ] The tick is remembered for that video only, with who ticked it and when; it is never pre-ticked.

**Priority**: P0 | **Story Points**: 2

#### CL-1.4: Import With Honest Progress

> **As a** streamer,
> **I want** to see what is happening while a long video comes in,
> **So that** I can walk away and trust it.

**Acceptance Criteria:**
- [ ] **Import Video** opens the **Videos** tab with the new video first.
- [ ] The card shows a bar and the step in words: "Reading the link", "Getting the video, 34%", "Preparing the preview", then the picture and **Open**. Once it can tell, it adds how long is left: "About 7 minutes left".
- [ ] Progress keeps moving without a page reload, and is right again after a reload.
- [ ] When it is ready the bell gets "Your video is ready" with the title; a failure gets "Your video could not be imported" with the reason in one sentence.
- [ ] Closing the browser does not stop the import.
- [ ] The video's length counts against the month's import minutes when the import starts; an import that fails or is cancelled gives them back.
- [ ] When the month's import minutes are used up, **Import Video** says "You have used all 900 import minutes for this month. They come back on 1 December, or you can upgrade the plan." with **See Plans**.

**Priority**: P0 | **Story Points**: 5

#### CL-1.5: Upload My Own Video

> **As a** marketing manager,
> **I want** to upload a recording from my computer,
> **So that** I can clip videos that are not on any platform.

**Acceptance Criteria:**
- [ ] **Upload A Video** takes MP4, MOV, MKV and WebM up to the plan's upload size (2 GB by default).
- [ ] The bar shows "Uploading, 48%"; a dropped connection carries on from where it stopped.
- [ ] A file that is not a video, or is too big or too long, is refused before upload with its sentence.
- [ ] After upload the video goes through "Preparing the preview" like a linked one, and needs no rights tick (it is the user's own file; the same sentence is shown as a note).

**Priority**: P0 | **Story Points**: 5

#### CL-1.6: Stop Or Retry An Import

> **As a** team member,
> **I want** to cancel an import I started by mistake and retry one that failed,
> **So that** I am never stuck.

**Acceptance Criteria:**
- [ ] A video that is coming in has **Cancel**; it stops within a few seconds and the card is removed.
- [ ] A failed video shows its reason and **Try Again**; trying again does not ask for the rights tick a second time.
- [ ] A link that is already in the workspace opens the existing video and says "You already have this video."

**Priority**: P1 | **Story Points**: 3

#### CL-1.7: Add A Channel And Browse Its Streams

> **As a** streamer,
> **I want** to add my channel by its name and pick a stream from a list,
> **So that** I never have to hunt for a link.

**Acceptance Criteria:**
- [ ] Beside the link box, **Browse Twitch**, **Browse YouTube** and **Browse Kick** open **My Channels** in a dialog on that platform (the same list as the **Streams** tab, so a stream can be picked without leaving the **Create** tab). Only the platforms that are switched on are shown.
- [ ] With no channel yet, **Streams** says "Add the name of a Twitch, YouTube or Kick channel. We list its public videos and clips so you can import one with a click." with **Add A Channel**.
- [ ] **Add A Channel** opens a dialog: the platform as tiles, a field with the placeholder "Enter your channel name", **Check** (shows the picture and display name) and **Add Channel**. Under it: "Only public videos are listed. Nothing is downloaded until you import one."
- [ ] A name that does not exist says "We could not find that channel. Check the spelling." A channel link is accepted and cut down to its name; a video link says "That is a video link. Paste it in the link box on Clips."
- [ ] The tab shows a row of channel chips (picture, name, a small platform mark, a remove menu) and, for the open channel, its lists: Twitch and Kick **Streams** and **Clips**; YouTube **Videos**, **Streams** and **Shorts**.
- [ ] Each row shows the picture, title, date, length, views ("12,408 views") and **Import**. A Twitch past stream also says when it will go away ("Expires in about 3 days"). A video already in the workspace shows **Open** instead.
- [ ] **Import** opens the link card with that video filled in, so the rights tick and every other check still apply. Nothing is downloaded by browsing.
- [ ] A stream that is still running shows a "Live Now" badge and no Import, with the tooltip "Come back when the stream has ended."; one that is still being processed shows "Still Processing".
- [ ] The toolbar has **Sort** (Newest, Most Viewed), **Show Hidden**, **Refresh** and "Updated 4 minutes ago". For YouTube, which can only list newest first, **Sort** is off and says "YouTube lists newest first".
- [ ] The list loads 50 at a time with **Show More**. After 1,000 it says "Showing the newest 1,000. Paste a link for older videos."
- [ ] A channel with no public videos says "This channel has no public videos yet." and is not an error.
- [ ] When the day's allowance for YouTube lists is used up: "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link." If a list cannot be read at all: "This channel's list is not available right now. Try again in a few minutes."
- [ ] The plan limits how many channels a workspace can add. Beyond it: "Your plan allows 3 channels. Remove one to add another." with **See Plans**.
- [ ] Twitch does not tell us about muted parts in advance. Every Twitch past stream's link card says "Twitch may have muted parts of this stream. Clips from muted parts will be silent."

**Priority**: P1 | **Story Points**: 8

#### CL-1.8: Hide Streams I Do Not Want

> **As a** streamer,
> **I want** to hide old tests and streams I will never clip,
> **So that** the list shows only what matters.

**Acceptance Criteria:**
- [ ] Each row has a hide icon with the tooltip "Hide From List". The row leaves the list at once.
- [ ] **Show Hidden** brings hidden rows back, each with **Unhide**.
- [ ] Hiding changes only this list: it never deletes or removes anything on the platform, and an imported video is unaffected. Only the platform's id is remembered, not the title.

**Priority**: P2 | **Story Points**: 2

### Epic CL-2: Videos And Clips In One Place

#### CL-2.1: The Videos Tab

> **As a** creator,
> **I want** a list of every video I brought in,
> **So that** I can get back to any of them.

**Acceptance Criteria:**
- [ ] Each card shows the picture, title, platform badge, length, how many clips came from it, and when it will be removed ("Kept until 28 Nov").
- [ ] Cards can be sorted by **Newest** and **Oldest**.
- [ ] **Open** goes to the video page; the menu has **Delete Video**.
- [ ] An empty tab says "No videos yet. Paste a link or upload a video to start." with a button to the **Create** tab.

**Priority**: P0 | **Story Points**: 3

#### CL-2.2: The Clips Tab

> **As a** team member,
> **I want** all clips in one list with their state,
> **So that** I always know what is waiting for me.

**Acceptance Criteria:**
- [ ] A filter row shows **All**, **New**, **Drafts**, **Exported**, **Scheduled**, **Hidden**, each with its count.
- [ ] A clip card shows a moving preview on hover, the name, the length, the shape (9:16, 16:9 or 1:1), the score when AI found it, and the video it came from.
- [ ] **New** holds clips AI found that nobody has opened; opening one moves it to **Drafts**.
- [ ] A clip is **Exported** when its latest version has been exported, and **Scheduled** when a post that uses it is waiting to go out.
- [ ] The menu has **Rename**, **Duplicate**, **Hide** (or **Unhide**) and **Delete Clip**.
- [ ] A **Source** filter (**All**, **YouTube**, **Twitch**, **Kick**, **Upload**) narrows the list to clips from videos of that platform, and **Sort** offers **Newest** and **Oldest**.
- [ ] A switch changes the view between a list (one row per clip, with its facts) and a grid of cards; the choice is remembered on this browser.
- [ ] A clip card for an export in progress shows its step in words and "About 2 minutes left".

**Priority**: P0 | **Story Points**: 5

#### CL-2.3: Delete A Video And What Hangs On It

> **As a** workspace admin,
> **I want** deleting a video to say exactly what goes with it,
> **So that** nobody loses work by accident.

**Acceptance Criteria:**
- [ ] **Delete Video** opens a confirm dialog: "Delete this video and its 4 clips that were never exported? Exported clips stay in Media."
- [ ] The delete button is solid red.
- [ ] After deleting, the stored files are gone and the storage meter drops.

**Priority**: P0 | **Story Points**: 3

#### CL-2.4: See How Much Space Is Used

> **As a** workspace admin,
> **I want** to see how much video the workspace stores,
> **So that** I can make room before it is full.

**Acceptance Criteria:**
- [ ] The `PageActions` row shows "12.4 GB of 30 GB" with a small bar; it turns to the warning colour past 80%.
- [ ] Hovering it explains: "Videos you bring in count here. Exported clips are in Media."
- [ ] The limit shown is the plan's value for video space, so it changes when the plan or an operator override changes.

**Priority**: P1 | **Story Points**: 2

#### CL-2.5: Try A Sample Video

> **As a** new user,
> **I want** to try Clips without finding a video first,
> **So that** I can see how it works before I trust it with my own.

**Acceptance Criteria:**
- [ ] The **Create** tab (and the empty **Videos** tab) has **Try A Sample** beside **Upload A Video**.
- [ ] Pressing it adds a short sample video made by PostGear to **Videos**, marked "Sample", ready at once. It needs no link and no rights tick, because it is ours.
- [ ] It uses no import minutes. Find Clips on it costs AI minutes like any other video. It can be deleted like any video.
- [ ] **Find Clips**, manual clipping, the editor and export all work on it, so a new user can go from nothing to an exported clip in a few minutes.

**Priority**: P2 | **Story Points**: 2

### Epic CL-3: Make Clips By Hand

#### CL-3.1: Watch The Video With A Timeline

> **As a** solo creator,
> **I want** to play the video and jump around it quickly,
> **So that** I can find my moments.

**Acceptance Criteria:**
- [ ] The video page shows a player, the time ("12:04 / 58:10"), and a timeline with small pictures along it and the sound's shape under them.
- [ ] Clicking the timeline jumps there; the timeline can be zoomed and scrolled.
- [ ] **Space** plays and pauses; **J**, **K**, **L** go back, stop and forward; the left and right arrows step one second, with **Shift** five seconds.

**Priority**: P0 | **Story Points**: 5

#### CL-3.2: Mark A Range And Create A Clip

> **As a** solo creator,
> **I want** to mark a start and an end and make a clip from it,
> **So that** the clip is exactly what I chose.

**Acceptance Criteria:**
- [ ] **I** sets the start at the playhead and **O** the end; the range is drawn on the timeline with its length ("0:42"), and both ends can be dragged.
- [ ] **Create Clip** is enabled for ranges from 3 seconds to 30 minutes; outside that it says why ("A clip can be up to 30 minutes.").
- [ ] The new clip appears in the list on the right under **Drafts**, named after the video with a number.
- [ ] Several clips can be made from one video; their ranges are drawn on the timeline.

**Priority**: P0 | **Story Points**: 5

#### CL-3.3: Open A Clip From The Video Page

> **As a** team member,
> **I want** to go from a clip in the list straight into the editor,
> **So that** marking and editing feel like one flow.

**Acceptance Criteria:**
- [ ] Each clip in the list has **Play** (plays just that range in the player) and **Edit** (opens the editor).
- [ ] The editor's back button returns to this video page at the same place.

**Priority**: P0 | **Story Points**: 2

#### CL-3.4: Edit A Whole Video

> **As a** marketing manager,
> **I want** to open a whole recording in the editor without marking anything first,
> **So that** I can clean up a talk and post it as one piece.

**Acceptance Criteria:**
- [ ] The video page has **Edit Whole Video** beside **Create Clip**. It makes one clip from the first second to the last and opens the editor on it, named after the video with "(Whole Video)".
- [ ] A clip can be up to 30 minutes. For a longer video the button is off and its tooltip says "A clip can be up to 30 minutes. Mark the part you want, then press Create Clip."
- [ ] The clip is a normal draft in every way: trim, split, layouts, text, stickers, sound, export.
- [ ] The Export tab says how long the export may take for a long clip ("About 9 minutes left" once it runs), and the work carries on if the browser is closed.

**Priority**: P1 | **Story Points**: 3

### Epic CL-4: Find Clips With AI

#### CL-4.1: Find The Best Moments

> **As a** streamer,
> **I want** one button that finds the best moments of a long video,
> **So that** I do not have to watch four hours again.

**Acceptance Criteria:**
- [ ] The video page has **Find Clips** (violet), with the price in the label: "Find Clips (15 AI Minutes)" for a 60 minute video. The price is 0.25 AI minutes for each minute of video, rounded up, and never less than 1.
- [ ] While it works a bar shows the step in words: "Listening for loud moments", "Looking for scene changes", "Reading the chat" (Twitch only), "Picking the best moments".
- [ ] Up to 20 clips appear, best first, each between 15 and 60 seconds.
- [ ] A calm video with nothing to find says "We did not find any stand-out moments. You can still mark clips by hand."

**Priority**: P0 | **Story Points**: 8

#### CL-4.2: See Why Each Clip Was Picked

> **As a** streamer,
> **I want** a score and a reason on each AI clip,
> **So that** I can decide which to keep in seconds.

**Acceptance Criteria:**
- [ ] Each AI clip shows a score from 0 to 100 and up to three reasons: "Loud reaction", "Chat exploded", "Fast cuts", "Sudden silence then noise".
- [ ] Marks on the timeline show where each clip is; clicking a mark plays it.
- [ ] A small note under the list says "AI in this version listens and watches for action. It does not understand speech yet."

**Priority**: P0 | **Story Points**: 3

#### CL-4.3: Pay In AI Minutes Fairly

> **As a** workspace owner,
> **I want** to know the price before AI runs and to be charged only when it works,
> **So that** AI minutes are never wasted.

**Acceptance Criteria:**
- [ ] The chip beside the button shows what is left: "38 of 300 AI minutes left". It is the plan's monthly allowance, so it changes when the plan or an operator override changes.
- [ ] With too few AI minutes the button is disabled and a warning says "This needs 56 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan." With none left it says "This workspace has used all its AI minutes for this month. They reset on 1 December." with **See Plans**.
- [ ] A run that fails gives the minutes back and says so; pressing the button twice, or a retry inside the system, never charges twice.
- [ ] Running it again on the same video asks first: "Find clips again? New clips you have not opened will be replaced. This costs 56 AI minutes."
- [ ] Following the speaker and finding where the camera is cost nothing. Existing AI credits are for text and image AI and are never used here.

**Priority**: P0 | **Story Points**: 3

#### CL-4.4: Keep, Hide Or Fix An AI Clip

> **As a** streamer,
> **I want** to hide the clips I do not want and adjust the ones I do,
> **So that** the list is only what I will post.

**Acceptance Criteria:**
- [ ] Each AI clip has **Edit**, **Hide** and a menu with **Delete Clip**.
- [ ] Hidden clips leave the list and are found under **Hidden** in the Clips tab.
- [ ] In the editor an AI clip can be trimmed longer or shorter like any other.

**Priority**: P1 | **Story Points**: 2

### Epic CL-5: The Editor

#### CL-5.1: A Full-Window Editor

> **As a** team member,
> **I want** the editor to take the whole window,
> **So that** I have room to work.

**Acceptance Criteria:**
- [ ] Opening a clip hides the rail and the top bar. The editor has its own bar: a back button, the clip's name (click to rename), the saved state, **Undo**, **Redo**, and **Export**.
- [ ] A rail of tabs on the left: **Layouts**, **Elements**, **Text**, **Effects**, **Audio**, **Export**; the open tab's panel sits beside it.
- [ ] The clip plays in the middle; a timeline dock sits under it and can be made taller or shorter.
- [ ] **Next** and **Back** buttons at the bottom of the panel walk through the tabs in order.

**Priority**: P0 | **Story Points**: 8

#### CL-5.2: Choose Vertical Or Horizontal

> **As a** creator,
> **I want** to choose the clip's shape when I first open it,
> **So that** it fits where I will post it.

**Acceptance Criteria:**
- [ ] The first time a clip opens, a dialog asks "What Do You Want To Make?" with **Vertical** ("9:16 for TikTok, Shorts and Reels"), **Horizontal** ("16:9 for YouTube") and **Square** ("1:1 for feeds").
- [ ] The shape can be changed later from **Layouts**; items keep their place as far as the new shape allows.

**Priority**: P0 | **Story Points**: 3

#### CL-5.3: Trim, Split And Delete On The Timeline

> **As a** team member,
> **I want** to cut the clip on a timeline,
> **So that** only the good part is left.

**Acceptance Criteria:**
- [ ] Dragging either end of the video bar trims it; the clip's length updates as I drag.
- [ ] **S** (or the scissors button) splits at the playhead; a part can be selected and removed with **Delete**, and the rest closes up.
- [ ] Dragging an end outward brings back video that was trimmed, up to 30 seconds past the original range; past that the editor says "Getting more of the video" and carries on when it has it.
- [ ] Edges snap to the playhead and to other edges; holding **Alt** turns snapping off.
- [ ] A sticker, a text or a sound effect stays on its moment of the video when the clip is trimmed or a part is deleted; music, and anything set to show for the whole clip, stays where it is.

**Priority**: P0 | **Story Points**: 8

#### CL-5.4: Undo, Redo And Never Lose Work

> **As a** team member,
> **I want** every change saved by itself and undoable,
> **So that** I can try things without fear.

**Acceptance Criteria:**
- [ ] **Ctrl+Z** and **Ctrl+Shift+Z** undo and redo at least 80 steps; dragging a slider counts as one step.
- [ ] The bar shows "Saving" then "Saved" within about two seconds of a change, and "Offline, will retry" when the connection is down.
- [ ] Leaving with unsaved changes asks first.
- [ ] If someone else saved the clip in the meantime, the editor says "Someone else changed this clip. Reload to see their version." and does not overwrite it.

**Priority**: P0 | **Story Points**: 5

#### CL-5.5: Keyboard Shortcuts

> **As a** team member,
> **I want** the shortcuts every video editor has,
> **So that** I can work fast.

**Acceptance Criteria:**
- [ ] **Space** play and pause; **S** split; **Delete** remove the selected thing; arrows step one frame, with **Shift** one second; **+** and **-** zoom the timeline; **Ctrl+D** duplicate the selected item.
- [ ] **?** opens a sheet that lists every shortcut.
- [ ] Shortcuts do nothing while typing in a field.

**Priority**: P1 | **Story Points**: 3

### Epic CL-6: Layouts And Crops

#### CL-6.1: Pick A Layout

> **As a** streamer,
> **I want** ready-made layouts,
> **So that** a wide stream looks right in a tall clip.

**Acceptance Criteria:**
- [ ] **Layouts** shows tiles with a small drawing of each: **Fullscreen** (the video fills the clip, cropped), **Blurred** (the whole video in the middle over a blurred copy of itself), **Split** (two parts of the video stacked, for a face camera and the game), **Three** (three parts), **Four** (four parts in a grid), **Gameplay** (the game fills the clip with a small rounded box for the face camera), **Screen Share** (the shared screen large with the speaker's camera in a smaller box).
- [ ] **Blurred** has a **Crop Ratio** choice for the part kept in the middle: **Original**, **4:3** and **1:1**.
- [ ] Picking a tile changes the clip at once; the picked tile is marked.
- [ ] Horizontal clips offer **Fullscreen** and **Blurred**; the other layouts are for Vertical and Square clips.
- [ ] Every layout is a ready-made setting, so a saved layout of the workspace (CL-6.3) sits beside them and works the same way.

**Priority**: P0 | **Story Points**: 5

#### CL-6.2: Choose What Part Of The Video Shows

> **As a** streamer,
> **I want** to drag a box over the part of the video I want in each area,
> **So that** my face camera and the game both fit.

**Acceptance Criteria:**
- [ ] Beside the clip, the full video is shown with one crop box per area of the layout, each with a name tag ("Camera", "Content").
- [ ] A box can be moved and resized; it keeps the shape of its area; the clip updates as I drag.
- [ ] **Add Crop** adds another area (up to four); **Enable Snapping** makes boxes snap to the edges and the middle.
- [ ] Boxes can never leave the video.

**Priority**: P0 | **Story Points**: 8

#### CL-6.3: Save A Layout For Next Time

> **As a** streamer,
> **I want** to save my crop boxes as my own layout,
> **So that** tomorrow's clips need one click.

**Acceptance Criteria:**
- [ ] **Save Layout** asks for a name and adds a tile under **My Layouts** for the whole workspace.
- [ ] A saved layout can be renamed and deleted (the delete button is solid red).
- [ ] Applying a saved layout to a video of a different size keeps the boxes in the same relative place.

**Priority**: P1 | **Story Points**: 3

### Epic CL-7: Text, Stickers And GIFs

#### CL-7.1: Add Text

> **As a** creator,
> **I want** to put words on the clip,
> **So that** people know what it is about with the sound off.

**Acceptance Criteria:**
- [ ] **Text** has **Add Text** and a few ready styles (bold with an outline, on a box, plain).
- [ ] Text is typed straight on the clip; font (the Studio fonts), size, colour, outline, box and alignment are set in the panel.
- [ ] Text can be moved, resized and turned on the clip with handles; it snaps to the middle and the edges.
- [ ] Each text has a bar on the timeline; dragging the bar or its ends sets when it shows.

**Priority**: P0 | **Story Points**: 8

#### CL-7.2: Add Stickers From The Library

> **As a** streamer,
> **I want** stickers I can drop on a moment,
> **So that** the clip is more fun.

**Acceptance Criteria:**
- [ ] **Elements** shows the PostGear sticker library in categories (**Reactions**, **Arrows And Shapes**, **Social**, **Gaming**, **Animated Emoji**), as chips above the tiles.
- [ ] Clicking a sticker puts it in the middle of the clip at the playhead for 3 seconds; it can be moved, resized, turned, and timed on the timeline.
- [ ] Animated stickers move in the editor and in the export; **Preview Export** shows exactly how they will look.
- [ ] A line under the tiles says what the library is: "Our library is free-to-use art, so it has no film or meme clips." A **Credits** link opens the page that names every source.
- [ ] A sticker that needs a credit (the animated emoji) shows a small "i" with its credit line.

**Priority**: P0 | **Story Points**: 5

#### CL-7.3: Search The Sticker And GIF Library

> **As a** streamer,
> **I want** to search the library by name and tag,
> **So that** I can find the reaction I want fast.

**Acceptance Criteria:**
- [ ] **Elements** has the tabs **Stickers** (still pictures), **GIFs** (moving pictures), **Favourites** and **Uploaded**.
- [ ] Each of **Stickers** and **GIFs** has a field (placeholder "Enter your search") that finds items by name and tag as you type a word, and category chips that narrow the list. The tiles load 24 at a time.
- [ ] A search with no match says "Nothing found for "wow". Try another word or pick a category." and offers the nearest categories.
- [ ] The library is our own catalogue, always on; there is no outside service and no switch. Nothing is searched anywhere else.
- [ ] A sticker that the operator hides after it is used keeps working in clips that already use it. One that is removed after a rights request shows "This sticker was removed from the library." on its item, and **Export Clip** asks before leaving it out.
- [ ] **Uploaded** holds the workspace's own pictures (PNG, WebP and GIF up to 8 MB); a file that is not a picture, or is too big, is refused with a sentence. Uploads stay in the workspace and never enter the library.

**Priority**: P1 | **Story Points**: 5

#### CL-7.4: A Social Name Badge

> **As a** streamer,
> **I want** a "Follow Me" badge with my channel name,
> **So that** viewers know where to find me.

**Acceptance Criteria:**
- [ ] **Elements** has a **Follow Badge** with a platform picker (Twitch, YouTube, Kick, TikTok, Instagram) and a name field (placeholder "Enter your channel name").
- [ ] The badge is a sticker like any other: move, resize, time it.

**Priority**: P2 | **Story Points**: 2

#### CL-7.5: Favourite A Sticker

> **As a** streamer,
> **I want** to star the stickers I use all the time,
> **So that** they are one click away.

**Acceptance Criteria:**
- [ ] Every sticker tile has a star with the tooltip "Add To Favourites" (and "Remove From Favourites" once starred).
- [ ] **Favourites** lists the starred stickers and GIFs together, newest first, and has its own search field.
- [ ] Favourites belong to the workspace: every member sees the same ones.
- [ ] A starred sticker that is removed from the library leaves the list with no error.
- [ ] An empty **Favourites** says "No favourites yet. Star a sticker to keep it here."

**Priority**: P1 | **Story Points**: 2

### Epic CL-8: Effects

#### CL-8.1: Zoom In On A Moment

> **As a** streamer,
> **I want** to zoom in on the important second,
> **So that** the viewer sees what I saw.

**Acceptance Criteria:**
- [ ] **Effects** has **Zoom**: **Add Zoom** puts a zoom on the timeline at the playhead for 2 seconds.
- [ ] The amount (1.1x to 3x) and the point it zooms toward are set in the panel or by dragging a dot on the clip; it eases in and out.
- [ ] A zoom stays on the same moment of the video when the clip is trimmed.

**Priority**: P0 | **Story Points**: 5

#### CL-8.2: Speed A Part Up Or Slow It Down

> **As a** marketing manager,
> **I want** to change the speed of a part,
> **So that** slow parts go by and big moments last.

**Acceptance Criteria:**
- [ ] With a part of the video selected, **Speed Control** offers 0.25x, 0.5x, 1x, 1.5x, 2x and 4x.
- [ ] The clip's length changes to match and the part shows its speed on the timeline ("2x").
- [ ] The sound's pitch stays natural at every speed.
- [ ] To change only a few seconds, split the clip first; the panel says so.

**Priority**: P0 | **Story Points**: 5

#### CL-8.3: Give The Clip A Look

> **As a** creator,
> **I want** one-click colour looks and fades,
> **So that** my clips feel finished and match each other.

**Acceptance Criteria:**
- [ ] **Effects** has a **Looks** card beside **Zoom** and **Speed Control**. It shows tiles for **None**, **Warm**, **Cool**, **Vivid**, **Black And White**, **Sepia**, **Vintage** and **Cinematic**, each on a small sample picture.
- [ ] A **Strength** slider (0% to 100%) sets how much of the look is used; a **Vignette** slider darkens the corners.
- [ ] **Fade In** and **Fade Out** are switches with a length (0.5, 1 or 2 seconds); they fade the picture, the text and the sound together, from and to black and silence.
- [ ] A look covers the whole clip. It never changes the clip's length or what is on the timeline.
- [ ] The panel says "The editor shows a close match. The export may look slightly different." Pressing **Preview Export** shows the real result.

**Priority**: P1 | **Story Points**: 3

### Epic CL-9: Sound

#### CL-9.1: Add Sound Effects And Music

> **As a** creator,
> **I want** a real library of sounds and music I can search,
> **So that** my clips are not silent or flat.

**Acceptance Criteria:**
- [ ] **Audio** has the tabs **Sound Effects**, **Music**, **Favourites** and **Uploaded**. Each list shows a play button, a name, a length and a small picture of the sound's shape.
- [ ] A search field (placeholder "Enter your search") finds sounds by name and tag. Category chips narrow the list: for sound effects **Alerts And Notifications**, **Ambient Sounds**, **Reactions**, **Transitions**, **Gaming**, **Comedy**, **Impacts**, **Whooshes**; for music **Calm**, **Upbeat**, **Tense**, **Cinematic**, **Lo-Fi**, **Epic**.
- [ ] A search with no match says "Nothing found for "zap". Try another word or pick a category."
- [ ] Clicking **Add** puts the sound on the timeline at the playhead, on its own row under the video.
- [ ] A sound can be moved, trimmed, and removed; music can be set to fade in and out.
- [ ] Every sound in the library is free to use in posts; its source, author and licence are shown in a details line, and **Credits** names every source.
- [ ] A line under the music list is honest about it: "The music shelf is small: loops and short tracks, not songs."

**Priority**: P0 | **Story Points**: 5

#### CL-9.2: Use My Own Sound

> **As a** creator,
> **I want** to upload my own sound,
> **So that** I can use my jingle.

**Acceptance Criteria:**
- [ ] **Upload A Sound** takes MP3, WAV, M4A and AAC up to 20 MB and adds it under **Uploaded** for the workspace.
- [ ] A file that is not a sound is refused with a sentence.
- [ ] An uploaded sound stays in the workspace; it never enters the shared library.

**Priority**: P1 | **Story Points**: 2

#### CL-9.3: Set The Volume

> **As a** team member,
> **I want** to set how loud the video and each sound are,
> **So that** music never drowns the voice.

**Acceptance Criteria:**
- [ ] The video has a volume slider from 0% to 200% and a mute button; every sound has its own.
- [ ] The export is evened out so it is not too quiet or distorted, and what I hear in the editor matches what I get. Very slow or very fast parts may sound rough, and **Preview Export** plays the exact mix.

**Priority**: P0 | **Story Points**: 3

#### CL-9.4: Favourite A Sound

> **As a** creator,
> **I want** to star the sounds I use again and again,
> **So that** my jingle, my airhorn and my favourite loop are one click away.

**Acceptance Criteria:**
- [ ] Every sound row has a star with the tooltip "Add To Favourites" (and "Remove From Favourites" once starred).
- [ ] **Favourites** lists starred sound effects and music together, with a search field and a play button on each.
- [ ] Favourites belong to the workspace: every member sees the same ones.
- [ ] A starred sound that leaves the library drops off the list with no error.
- [ ] An empty **Favourites** says "No favourites yet. Star a sound to keep it here."

**Priority**: P1 | **Story Points**: 2

### Epic CL-10: Export

#### CL-10.1: Export A Clip

> **As a** team member,
> **I want** to pick a quality and export,
> **So that** I get a file ready for the platforms.

**Acceptance Criteria:**
- [ ] **Export** lists the qualities: **720p**, **720p 60 fps**, **1080p**, **1080p 60 fps**, each with one line of help; the ones my plan does not include show a lock. (4K is not offered yet.)
- [ ] **Export Clip** shows the step in words: "Getting the sharp video", "Rendering, 61%", "Finishing".
- [ ] I can keep editing other clips or close the browser while it runs; the bell tells me when it is done.
- [ ] The finished clip is in **Media** with a picture and its length, and the panel shows **Download** and **Send To Composer**.
- [ ] The exported clip matches what the editor showed closely, and **Preview Export** (CL-10.4) shows it exactly. The panel says "The editor is a fast preview. Preview Export shows the real result."
- [ ] While it runs the panel and the clip card say how long is left ("About 4 minutes left").

**Priority**: P0 | **Story Points**: 8

#### CL-10.2: Know When An Export Is Out Of Date

> **As a** team member,
> **I want** to be told when I changed a clip after exporting it,
> **So that** I never post an old version.

**Acceptance Criteria:**
- [ ] After a change, the panel says "You changed this clip after the last export." and **Send To Composer** offers "Export again first".
- [ ] The Clips tab shows such a clip under **Drafts**, not **Exported**.

**Priority**: P1 | **Story Points**: 2

#### CL-10.3: Plan Limits Are Clear

> **As a** workspace owner,
> **I want** locked qualities to say what unlocks them,
> **So that** the limits feel fair.

**Acceptance Criteria:**
- [ ] Clicking a locked quality opens a dialog: "1080p export needs a higher plan." with **See Plans** and **Cancel**.
- [ ] On a plan that adds the mark (Free to start with), exports carry a small "Made with PostGear" mark in a corner, and the panel says "Exports on this plan carry a small PostGear mark." before exporting. Which plans get the mark, and which qualities are locked, are plan values the operator can change.
- [ ] A plan change while an export runs does not change that export; the next one follows the new plan.

**Priority**: P1 | **Story Points**: 3

#### CL-10.4: Preview Export

> **As a** team member,
> **I want** to see the real result before I spend a full export,
> **So that** I never find a surprise after the long wait.

**Acceptance Criteria:**
- [ ] The **Export** tab has **Preview Export** beside **Export Clip**, with the line "The editor is a fast preview. Preview Export shows the real result."
- [ ] It makes a small version of the whole clip (about 360 pixels wide) the same way the real export does, with the step "Making the preview" and a bar. When it is done the clip plays in a dialog with its sound.
- [ ] The dialog says "This preview is a smaller copy. Your export will be sharper." and offers **Export Clip** and **Close**.
- [ ] A preview uses no AI minutes, is not an export, and does not go to Media. It is kept for 24 hours and then removed.
- [ ] Previews wait behind real exports, so a preview never slows a real one down. The clip stays editable while it runs; a change made after the preview shows "You changed this clip after the last preview."
- [ ] If it fails: "We could not make the preview. Try again." The clip is untouched.
- [ ] Pressing it while a preview of this clip is running shows that preview's progress instead of starting another.

**Priority**: P0 | **Story Points**: 5

### Epic CL-11: Post It

#### CL-11.1: Send A Clip To The Composer

> **As a** streamer,
> **I want** to send an exported clip to the composer,
> **So that** I can schedule it on every channel at once.

**Acceptance Criteria:**
- [ ] **Send To Composer** opens a dialog with the channel picker and a caption field (placeholder "Enter your caption").
- [ ] Channels that cannot take this clip are shown with the reason: "LinkedIn does not take video here.", "This clip is 2 min 10 s. Shorts take up to 3 minutes." (shown only when it is over).
- [ ] Pressing **Open In Composer** creates a draft post with the clip attached and opens the composer on it.
- [ ] When the post is scheduled, the clip shows under **Scheduled** in the Clips tab; when it goes out, the clip links to the post.

**Priority**: P0 | **Story Points**: 5

#### CL-11.2: Pick An Exported Clip In The Composer

> **As a** streamer,
> **I want** to attach an exported clip while I am writing a post,
> **So that** I do not have to go back to Clips first.

**Acceptance Criteria:**
- [ ] The composer's media picker has a **Clips** tab. Its modal is titled "Select A Clip" and lists the workspace's exported clips with a picture, name, length and shape.
- [ ] **Sort** offers **Newest** and **Oldest**, and a switch changes between a list and a grid.
- [ ] Picking a clip attaches its exported file to the post, starts the caption from the clip's name, and the clip then shows under **Scheduled** like any other.
- [ ] Only exported clips are listed. With none: "No exported clips yet. Export a clip in Clips first." with a link to Clips.
- [ ] A clip changed after its last export shows "Changed since export" so nobody picks an old version without knowing.

**Priority**: P1 | **Story Points**: 3

#### CL-11.3: See What Is Coming Up

> **As a** streamer,
> **I want** to see which clips are about to go out,
> **So that** I know what is scheduled and what is missing.

**Acceptance Criteria:**
- [ ] The **Create** tab has a **Coming Up** panel with the posts of the next 14 days that use a clip: the clip's picture, the day and time, and the channels.
- [ ] **View Calendar** opens the calendar; a row opens its post.
- [ ] With nothing scheduled: "Nothing is scheduled in the next 14 days. Send a clip to the composer to schedule one."

**Priority**: P2 | **Story Points**: 2

### Epic CL-12: Download In Any Format

#### CL-12.1: Download A Linked Video

> **As a** marketing manager,
> **I want** to download a video from a link in the quality I choose,
> **So that** I have the file for other tools.

**Acceptance Criteria:**
- [ ] The link card has **Download** beside **Import Video**. It opens a list of choices read from the link: **1080p**, **720p**, **360p** (each with its size when known) and **Audio Only**.
- [ ] Picking one starts the download; the **Downloads** tab shows "Getting your file, 40%", then **Save File**.
- [ ] The plan limits downloads a day. At the limit: "You have reached today's limit of 5 downloads. It resets at midnight UTC." A download that fails is given back and does not count.
- [ ] A prepared file is kept for 24 hours, then removed; the row says "Expires in 23 hours".
- [ ] **Save To Media** keeps a video download in the Media library instead (only MP4, inside the Media size limit).

**Priority**: P0 | **Story Points**: 5

#### CL-12.2: Download A Clip Or A Video I Already Have

> **As a** team member,
> **I want** to save an exported clip to my computer,
> **So that** I can share it outside PostGear.

**Acceptance Criteria:**
- [ ] Every exported clip has **Download**, which saves the MP4 at once.
- [ ] An uploaded video has **Download Original** in its menu.

**Priority**: P1 | **Story Points**: 2

### Epic CL-13: Limits, Storage And Safety

#### CL-13.1: Limits Per Plan

> **As a** workspace owner,
> **I want** each plan to say how much video it handles,
> **So that** I know what I am paying for.

**Acceptance Criteria:**
- [ ] The plan sets: whether Clips is included, the longest video, the minutes of video brought in each month, the video space, how long videos are kept, the best export quality, whether the mark is added, the AI minutes each month, how many imports run at once, the biggest upload, downloads a day, how soon the queue serves the workspace, and how many channels can be browsed.
- [ ] Every one of these is a plan value that an operator can change (CL-13.6), so the numbers in these stories are only the starting ones.
- [ ] Reaching a limit says which one, in a sentence, with **See Plans**. For example: "Your video space is full (15 GB). Delete a video you no longer need, or upgrade the plan." and "Uploads can be up to 2 GB."
- [ ] The billing page lists these limits per plan, read from the same values, so it never disagrees with what Clips does.
- [ ] A workspace can be given its own value for a limited time (an override); it then sees that value everywhere, and goes back to its plan's value when the override ends.
- [ ] After a downgrade the workspace keeps what it already has. If its videos use more space than the new plan allows, it sees "Your videos use 22 GB, over your plan's 15 GB. Delete some, or upgrade, to bring in more." Nothing is deleted for it, and exports of existing clips still work.

**Priority**: P0 | **Story Points**: 5

#### CL-13.2: Videos Are Removed After A While

> **As a** workspace admin,
> **I want** old videos removed by themselves,
> **So that** the workspace does not fill up with things nobody uses.

**Acceptance Criteria:**
- [ ] Each video shows "Kept until {date}"; opening it or making a clip from it moves the date forward.
- [ ] Three days before removal the bell says "{Title} will be removed in 3 days. Open it to keep it longer."
- [ ] After removal the clips that were exported are still in Media; clips that were never exported are gone with the video.

**Priority**: P0 | **Story Points**: 5

#### CL-13.3: Videos Are Private

> **As a** workspace owner,
> **I want** the videos I bring in to be seen only by my workspace,
> **So that** nobody else can find them.

**Acceptance Criteria:**
- [ ] A video's address works only for a signed-in member of the workspace, and only for a short time.
- [ ] Another workspace's video, clip or download answers "not found", never "not allowed".

**Priority**: P0 | **Story Points**: 5

#### CL-13.4: A Platform Can Be Switched Off

> **As a** PostGear operator,
> **I want** to switch one platform off without a release,
> **So that** a problem with YouTube does not break Twitch and Kick.

**Acceptance Criteria:**
- [ ] With a platform switched off, its links get "YouTube links are paused for now. You can upload the file instead." and the placeholder names only the platforms that work.
- [ ] Videos already imported keep working.

**Priority**: P1 | **Story Points**: 2

#### CL-13.5: Someone Asks For A Video To Be Taken Down

> **As a** rights holder,
> **I want** a way to ask for my video to be removed,
> **So that** my work is not used without my leave.

**Acceptance Criteria:**
- [ ] The help page names an address for takedown requests and what to send.
- [ ] An operator can remove a video by its id; the workspace's admins get "A video was removed after a request from its owner." and its unexported clips go with it.

**Priority**: P1 | **Story Points**: 3

#### CL-13.6: The Operator Edits Plans And Limits

> **As a** PostGear operator,
> **I want** to change what each plan allows, and give one workspace a custom deal, without a release,
> **So that** we can adjust prices and allowances the day we decide to.

**Acceptance Criteria:**
- [ ] An **Operator** item shows in the account menu only for an operator. Anyone else who opens the address gets the ordinary "not found" page, so the screen does not announce itself. In production only people on the operator list can use it.
- [ ] The screen is full window and desktop only, with the tabs **Plans**, **Workspace Overrides**, **Usage** and **Change Log**.
- [ ] **Plans** lists each setting under a "Clips" heading with a column for Free, Standard, Pro, Team and Ultimate. Clicking a cell edits it with the right control (a switch, a number with its unit, or a choice). Edited cells are marked, and the action row says "3 changes waiting" beside **Review Changes**.
- [ ] A banner says "These values apply to every workspace on a plan, within a few seconds of saving. Edits to a plan never delete anything a workspace already has."
- [ ] **Review Changes** lists each change as a line ("Clips Storage, Pro: 50 GB to 60 GB") and asks for a reason (placeholder "Enter your reason", at least 10 characters, with the help "It goes in the Change Log."). **Save Changes** saves them all at once or none.
- [ ] After saving the toast says "Saved 3 changes. They are live now." and the next check by any workspace on that plan follows the new value.
- [ ] A bad value is refused where it is typed: "Enter a whole number from 1 to 1,440." or "4K is reserved and cannot be saved yet." If someone else changed the same values: "Someone else changed these values while you were editing. Reload to see them, then edit again."
- [ ] A warning appears when an override ends within 7 days ("2 overrides end within 7 days.") and when a higher plan is set below a lower one ("Pro now has less than Standard for Clips Storage. Check this is on purpose.").
- [ ] **Workspace Overrides** finds a workspace by name, id or admin email (placeholder "Enter your workspace name, id or admin email"), shows its plan and its overrides, and **Add Override** asks for the setting, the value, an end date (required, at most 366 days ahead) and a reason. **Remove Override** says "This workspace goes back to the value of its plan, now."
- [ ] An empty list says "This workspace has no overrides. It uses the values of its plan." An override whose end date has passed is ignored at once and is logged when it ends.
- [ ] **Usage** shows each meter for the workspace this cycle (used, allowed, left, reset date) and its last 50 entries. **Adjust Usage** adds or takes back minutes with a reason and warns "This writes a permanent ledger entry and a Change Log entry. It cannot be edited, only reversed with another adjustment."
- [ ] **Change Log** lists every change newest first (When, Who, What, Old, New, Reason), can be filtered, and cannot be edited or deleted. Empty: "Nothing has been changed yet."

**Priority**: P0 | **Story Points**: 8

#### CL-13.7: The Operator Looks After The Sound And Sticker Library

> **As a** PostGear operator,
> **I want** to grow the library safely, and hide or remove an item the moment there is a problem,
> **So that** every sound and sticker we offer is one we may offer.

**Acceptance Criteria:**
- [ ] New items come in only through a command that an operator runs on the media worker, never from a button a user can reach and never from an address a user types. Each run writes a report: how many items were accepted, how many were refused, and why.
- [ ] New items wait as "Staged" until an operator has read a sample of the report and published the run. Items from open sources that need judgement are never published automatically.
- [ ] Every item shows its licence evidence: the licence, the author, the page it came from and the date it was fetched. An item with no licence we can show is refused.
- [ ] The operator screen has a **Library** area (the Module 19 session adds it as one more tab) that lists runs and items by status, and finds an item by name. **Hide** takes an item out of search at once while clips that already use it keep working. **Remove** deletes its files and stops it from ever coming back.
- [ ] A clip that uses a removed item shows "This sound was removed from the library." (or "This sticker was removed from the library.") on that item, and **Export Clip** asks before leaving it out. A video never changes without the person being told.
- [ ] The screen lists searches that found nothing, so the operator knows what to add next.
- [ ] The credits page names every source and credits the ones that need it (the animated emoji). It is built from the library itself, so it cannot go out of date.

**Priority**: P1 | **Story Points**: 5

---

## 4. UX Best Practices For This Module

| # | Principle | What it means in Clips |
|---|---|---|
| 1 | **Say what is happening, in words** | Every wait has a step name ("Getting the video", "Rendering") and a number when we have one. No bare spinners. |
| 2 | **Work goes on without the browser** | Imports, AI runs and exports finish on the server. The bell says when. Coming back always shows the true state. |
| 3 | **The editor matches the export closely, and Preview Export shows it exactly** | The editor is a fast preview that uses the same numbers as the export. Fonts, stickers, timing and sound match closely. **Preview Export** renders the real result at a small size in seconds, so nobody has to guess. |
| 4 | **Nothing is fetched until asked** | No request while typing a link. Nothing is downloaded before the rights tick and a button press. |
| 5 | **Plain words, never tool words** | Video, clip, layout, sticker, export. Never source, proxy, segment, render job, ingest, transcode. |
| 6 | **Every failure has a next step** | Each sentence ends with what to do: try again, upload the file, pick another quality, see the plans. |
| 7 | **Never lose work** | Autosave, undo, a leave guard, and no silent overwrite when two people edit. |
| 8 | **Be honest about AI** | Scores come with reasons. The page says AI listens and watches for action and does not understand speech yet. |
| 9 | **Prices before presses** | AI minutes are in the button label ("Find Clips (15 AI Minutes)"). Locked things say what unlocks them before the click costs anything. |
| 10 | **Fast hands** | Space, I and O, S, Delete, J K L, undo. The shortcuts sheet lists them all. |
| 11 | **Say what the library is** | Sounds and stickers are free-to-use art and audio, with their sources named. The library is smaller than a GIF site's and has no film or meme clips; the panels say so rather than hide it. |
| 12 | **Plans are values, not code** | Every limit comes from a plan value an operator can change. Nothing in the screens or the messages hard-codes a number. |

---

## 5. Edge Cases And Expected Behaviour

| Situation | What the user sees |
|---|---|
| The link is not YouTube, Twitch or Kick | "We can only read YouTube, Twitch and Kick links for now. You can upload the file instead." |
| The link is a channel or a playlist, not one video | "This link is a channel or a list. Paste the link of one video." |
| The video is private, members-only, subscribers-only or age-restricted | "This video is private or needs a login, so we cannot read it." |
| The stream is still live | "This stream is still live. Come back when it has ended." |
| The video does not exist or was removed | "We could not find a video at this link." |
| The video is longer than the plan allows | "This video is longer than your plan allows (360 minutes). Upgrade the plan to bring in longer videos." with **See Plans** |
| The platform refuses or does not answer | "{Platform} is not answering us right now. Try again in a little while, or upload the file instead." |
| The platform is switched off | "{Platform} links are paused for now. You can upload the file instead." |
| The same video is already in the workspace | The existing video opens with "You already have this video." |
| The monthly import minutes are used up | "You have used all 900 import minutes for this month. They come back on 1 December, or you can upgrade the plan." with **See Plans** |
| The video space is full | "Your video space is full (15 GB). Delete a video you no longer need, or upgrade the plan." |
| The plan does not include Clips | "Clips is not part of this workspace's plan." with **See Plans** |
| A channel name is not found | "We could not find that channel. Check the spelling." |
| A channel has no public videos | "This channel has no public videos yet." (not an error) |
| The platform's list allowance for the day is used | "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link." |
| A channel list cannot be read | "This channel's list is not available right now. Try again in a few minutes." and the list shows its last answer for up to a day, marked "Updated 3 hours ago" |
| The plan's channel limit is reached | "Your plan allows 3 channels. Remove one to add another." with **See Plans** |
| A Twitch past stream has muted parts | The list cannot tell. The link card says "Twitch may have muted parts of this stream. Clips from muted parts will be silent." |
| Edit Whole Video on a video over 30 minutes | The button is off; its tooltip says "A clip can be up to 30 minutes. Mark the part you want, then press Create Clip." |
| The upload is not a video | "This file is not a video we can read. Use MP4, MOV, MKV or WebM." |
| The upload is over the size limit | "This file is 3.1 GB. Uploads can be up to 2 GB." |
| The connection drops during upload | The bar pauses with "Waiting for your connection" and carries on by itself |
| The import fails half way | The card shows the reason in one sentence and **Try Again** |
| The video has no sound | Import works. Find Clips says "This video has no sound, so we looked at the picture only." |
| Twitch chat cannot be read | Find Clips still works from sound and picture; no error is shown |
| Not enough AI minutes | "This needs 56 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan." |
| No AI minutes left | "This workspace has used all its AI minutes for this month. They reset on 1 December." with **See Plans** |
| Find Clips fails | "We could not finish looking for clips. Your AI minutes were given back." with **Try Again** |
| The sharp video cannot be fetched any more | "The sharp video is no longer online. This clip will export at 720p from the copy we kept." |
| The clip was trimmed past the video we have | "Getting more of the video" on the bar; Export waits for it |
| Two people edit one clip | "Someone else changed this clip. Reload to see their version." |
| The connection drops in the editor | "Offline, will retry" in the bar; edits are kept and saved when it returns |
| A locked quality is picked | "1080p export needs a higher plan." with **See Plans** |
| The export fails | "We could not export this clip. Nothing was charged. Try again." and the bell says the same |
| Preview Export fails | "We could not make the preview. Try again." The clip is untouched and nothing was used |
| The clip changed after the last preview | "You changed this clip after the last preview." with **Preview Export** again |
| A clip is too long or the wrong shape for a channel | The channel is listed with its reason and cannot be ticked |
| A sticker or sound search finds nothing | "Nothing found for "wow". Try another word or pick a category." with the nearest categories |
| A library item is hidden after I used it | The clip keeps working and exports as before; the item no longer shows in search |
| A library item is removed after I used it (a rights request) | "This sticker was removed from the library." (or "This sound ...") on the item; **Export Clip** asks before leaving it out, so the clip never changes silently |
| A download is asked for a format that is gone | "This quality is no longer offered for this video. Pick another." |
| The day's downloads are used up | "You have reached today's limit of 5 downloads. It resets at midnight UTC." |
| An operator's override for my workspace has ended | The workspace quietly uses its plan's value again; a sentence that needs the old value says so ("Uploads can be up to 2 GB.") |
| A plan value is lowered below what a workspace uses | Nothing is deleted. New work that needs the room is refused with its sentence until the workspace is under the limit or the cycle turns |
| A non-operator opens the operator address | The ordinary "not found" page |
| An operator saves a plan edit someone else changed first | "Someone else changed these values while you were editing. Reload to see them, then edit again." |
| The video was removed after a rights request | "This video was removed after a request from its owner." |
| The window is narrower than 1366 px | "Clips is made for a bigger screen. Open it on a laptop or desktop." |

---

## 6. Completion Checklist ✅

**Epic CL-1: Bring In A Video**
- [ ] CL-1.1 Open Clips From The Rail
- [ ] CL-1.2 Paste A Link And See The Video
- [ ] CL-1.3 Confirm I May Use The Video
- [ ] CL-1.4 Import With Honest Progress
- [ ] CL-1.5 Upload My Own Video
- [ ] CL-1.6 Stop Or Retry An Import (P1)
- [ ] CL-1.7 Add A Channel And Browse Its Streams (P1)
- [ ] CL-1.8 Hide Streams I Do Not Want (P2)

**Epic CL-2: Videos And Clips In One Place**
- [ ] CL-2.1 The Videos Tab
- [ ] CL-2.2 The Clips Tab
- [ ] CL-2.3 Delete A Video And What Hangs On It
- [ ] CL-2.4 See How Much Space Is Used (P1)
- [ ] CL-2.5 Try A Sample Video (P2)

**Epic CL-3: Make Clips By Hand**
- [ ] CL-3.1 Watch The Video With A Timeline
- [ ] CL-3.2 Mark A Range And Create A Clip
- [ ] CL-3.3 Open A Clip From The Video Page
- [ ] CL-3.4 Edit A Whole Video (P1)

**Epic CL-4: Find Clips With AI**
- [ ] CL-4.1 Find The Best Moments
- [ ] CL-4.2 See Why Each Clip Was Picked
- [ ] CL-4.3 Pay In AI Minutes Fairly
- [ ] CL-4.4 Keep, Hide Or Fix An AI Clip (P1)

**Epic CL-5: The Editor**
- [ ] CL-5.1 A Full-Window Editor
- [ ] CL-5.2 Choose Vertical Or Horizontal
- [ ] CL-5.3 Trim, Split And Delete On The Timeline
- [ ] CL-5.4 Undo, Redo And Never Lose Work
- [ ] CL-5.5 Keyboard Shortcuts (P1)

**Epic CL-6: Layouts And Crops**
- [ ] CL-6.1 Pick A Layout
- [ ] CL-6.2 Choose What Part Of The Video Shows
- [ ] CL-6.3 Save A Layout For Next Time (P1)

**Epic CL-7: Text, Stickers And GIFs**
- [ ] CL-7.1 Add Text
- [ ] CL-7.2 Add Stickers From The Library
- [ ] CL-7.3 Search The Sticker And GIF Library (P1)
- [ ] CL-7.4 A Social Name Badge (P2)
- [ ] CL-7.5 Favourite A Sticker (P1)

**Epic CL-8: Effects**
- [ ] CL-8.1 Zoom In On A Moment
- [ ] CL-8.2 Speed A Part Up Or Slow It Down
- [ ] CL-8.3 Give The Clip A Look (P1)

**Epic CL-9: Sound**
- [ ] CL-9.1 Add Sound Effects And Music
- [ ] CL-9.2 Use My Own Sound (P1)
- [ ] CL-9.3 Set The Volume
- [ ] CL-9.4 Favourite A Sound (P1)

**Epic CL-10: Export**
- [ ] CL-10.1 Export A Clip
- [ ] CL-10.2 Know When An Export Is Out Of Date (P1)
- [ ] CL-10.3 Plan Limits Are Clear (P1)
- [ ] CL-10.4 Preview Export

**Epic CL-11: Post It**
- [ ] CL-11.1 Send A Clip To The Composer
- [ ] CL-11.2 Pick An Exported Clip In The Composer (P1)
- [ ] CL-11.3 See What Is Coming Up (P2)

**Epic CL-12: Download In Any Format**
- [ ] CL-12.1 Download A Linked Video
- [ ] CL-12.2 Download A Clip Or A Video I Already Have (P1)

**Epic CL-13: Limits, Storage And Safety**
- [ ] CL-13.1 Limits Per Plan
- [ ] CL-13.2 Videos Are Removed After A While
- [ ] CL-13.3 Videos Are Private
- [ ] CL-13.4 A Platform Can Be Switched Off (P1)
- [ ] CL-13.5 Someone Asks For A Video To Be Taken Down (P1)
- [ ] CL-13.6 The Operator Edits Plans And Limits
- [ ] CL-13.7 The Operator Looks After The Sound And Sticker Library (P1)

**UX And Quality Gates**
- [ ] `CLIPS_SIMULATION=true` runs every screen with no network; `e2e/clips.spec.ts` passes under it; `npm run validate` is green.
- [ ] **Preview Export** of the sample clip matches the real export on the checked frames (layout, text, sticker, zoom, looks, speed) and its sound level is inside the target; the editor matches closely.
- [ ] An operator changed one plan value, and the next check by a workspace on that plan obeyed it within seconds; an override with an end date was added, obeyed and expired; both are in the Change Log.
- [ ] The AI minutes ledger is exact: the minutes used equal the work done, a double press charges once, and a failed run gives the minutes back.
- [ ] A library search finds sounds and stickers by name, tag and category; every active item shows its licence evidence; the credits page matches the library.
- [ ] My Channels lists a real Twitch and a real YouTube channel and imports from the list.
- [ ] The screenshot coverage audit ([`../sprint-12/research/13-screenshot-coverage.md`](../sprint-12/research/13-screenshot-coverage.md)) is re-read against the finished build: every row is still Covered, Existing, Parked or Not Planned.
- [ ] Light, dark and Lilac checked at 1366 px and 1920 px; the small-screen sentence shows below 1366 px.
- [ ] Copy rules hold: Title Case names, sentence case messages, "Enter your ..." placeholders, no em dash, no middle dot; the title-case test is green.
- [ ] Every row of section 5 has been seen once (in simulation where it can be forced).
- [ ] The real-test plan ([`../sprint-12/real-test-plan.md`](../sprint-12/real-test-plan.md)) has been run once with real links, with Arvind's OK.
- [ ] The completion checklist is written through `sprint-closeout`.

---

## 7. How We Know It Works (After Launch)

| Measure | Target |
|---|---|
| Links that turn into a ready video | 90% or more of supported links |
| Time from paste to the preview card | under 10 seconds |
| Time from Import to ready, for a one hour video | under 10 minutes |
| AI clips kept (opened or exported) out of AI clips found | 25% or more |
| Exports that succeed first time | 97% or more |
| Export time for a 45 second clip at 1080p | under 3 minutes (about 1.5 to 3 times the clip's length until the real host is measured) |
| Preview Export time for a 45 second clip | under 1 minute |
| Sound and sticker searches that show at least one result | 90% or more |
| A channel's first page of streams | under 3 seconds |
| A plan edit reaching the next check | under 15 seconds |
| AI minutes charged but not matched by work (found by the daily check) | 0 |
| Exported clips that are sent to the composer | 50% or more |
| Workspaces that export a second clip within a week of the first | 40% or more |
