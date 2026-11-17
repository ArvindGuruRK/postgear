# 📋 User Stories: Clips AI (Captions, Smarter AI And Auto-Reframe)

> **Module**: Clips AI, the second half of Clips: speech to text, captions, AI that understands what is said, Auto-Reframe, editing by transcript, AI effects, recipes and Auto-Edit, montage, more sources, publisher upgrades, and creator tools with Editor seats
> **Build spec**: [`../sprint-documents/sprint-13-clips-ai.md`](../sprint-documents/sprint-13-clips-ai.md)
> **Research**: [`../sprint-13/README.md`](../sprint-13/README.md)
> **Last Updated**: 2026-11-17 (every open decision settled; AI is paid in AI Minutes)
> **Format**: `As a [persona], I want [action], so that [benefit]`, then acceptance criteria, priority and story points, the same format as [`../../user_stories.md`](../../user_stories.md)

How to use this document:
- **Section 2** shows how real people will use Clips AI, start to finish. Read it first.
- **Section 3** is the story list. Each acceptance criterion is something you can see or click.
- **Section 4** is the UX rulebook for this module. AI here changes what people said and how they look on screen, so most of these rules are about showing what AI did and letting people undo it.
- **Section 5** lists what happens when things go wrong.
- **Section 6** is the final checklist for sprint close-out.

This document has **11 epics and 38 stories** (5 added on 2026-11-17: CA-1.7, CA-3.4, CA-6.3, CA-6.4, CA-9.3; 4 in the new Epic CA-11). Every AI step is paid in **AI Minutes**, the meter built in Sprint 12 (one minute of video an AI step works on). The AI credits of Copilot and Create Post are separate and are not used here.

Everything in [`user-stories-clips.md`](user-stories-clips.md) (Sprint 12) is already built and tested when this sprint starts. These stories add to those screens; they do not replace them.

---

## 1. Personas

| ID | Persona | Who they are | What they want from Clips AI |
|---|---|---|---|
| 👤 PC | **Podcaster** | Anjali records a weekly two-person podcast on video, in English and Tamil. | Vertical clips where the frame follows whoever is talking, with captions she can fix in seconds. |
| 👤 ST | **Streamer** | Vikram streams games on Twitch and Kick. | AI that finds the funny fails and the big plays, not just the loud parts, hides swear words for TikTok, and gives him an emote and a weekly schedule picture for his channel. |
| 👤 SC | **Solo Creator** | Priya records yoga classes for YouTube. | Captions in Tamil and English and a title on the first second that makes people stop scrolling. |
| 👤 MM | **Marketing Manager** | Karthik clips webinars. | To cut a clip by deleting sentences from the text, and to remove every "um". |
| 👤 AO | **Agency Owner** | Meera's agency clips for six clients. | Each client's look saved once, twenty clips exported in one go, a freelancer who can cut but cannot publish, and posts that go out at natural times. |
| 👤 TM | **Team Member** | Divya, a full member of Meera's team. | The same result every time from a saved recipe, without setting twelve switches again. |
| 👤 ED | **Editor** | Arun, a freelance video editor Meera invites to one client's workspace. | To cut, caption and export clips and save drafts, without any way to touch the client's channels, billing or schedule. |

---

## 2. Real User Journeys

### Journey A: Anjali turns a podcast into captioned vertical clips 🎙️

1. Anjali opens last week's episode (58 minutes, two people side by side) and presses **Find Clips**. This time a **Clip Setup** screen opens first.
2. She leaves the range on the whole episode, types "the part about quitting my job" under **What Should We Look For?**, picks **30 To 60 Seconds**, **Vertical**, and ticks **Follow The Speaker**. Captions are on, in the **Bold Pop** style. The summary says "58 min, 73 AI minutes" and shows how many she has left this month. She presses **Find Clips**.
3. The bar says "Listening to what is said", then "Reading for the best moments". Eight clips appear, each with a title AI wrote ("Why I quit at 29"), a score and reasons ("Strong opening line", "Complete thought").
4. She opens the first. The frame is already on whoever is speaking, and it moves smoothly when the other person answers. Captions show word by word, with the word being said in yellow.
5. The captions wrote "Arvindh" for "Aravind". She clicks the word in the **Transcript** pane, fixes it once, and it is fixed everywhere in the clip.
6. One sentence rambles. She selects it in the transcript and presses **Delete**. The video cuts with it, and the captions close up.
7. She presses **Remove Silences**; three pauses go and the clip is four seconds shorter. She exports and sends it to the composer.

### Journey B: Vikram asks for fails and gets them 🎮

1. Vikram presses **Find Clips** on a three hour stream, types "funny fails and clutch plays", and ticks **Look For Action** as well as speech.
2. The clips that come back have reasons like "Sudden crash on screen", "Laughing right after" and "Chat exploded". The top one is a jump that goes wrong.
3. He opens it. He presses **Detect Camera** and the Split layout's top box lands on his face camera by itself.
4. He turns on **Bleep Bad Words**. Two words in the transcript get a mark, the sound bleeps there, and the captions show stars.
5. He presses **Add Hook Title**; AI offers three: "He Really Tried This", "The Worst Jump Ever", "Chat Called It". He picks one; it shows for the first three seconds.
6. He presses **Add Hook Clip**, picks the two seconds of the crash, and the clip now opens with them before the build-up.

### Journey C: Meera sets the agency up once 🧰

1. In a client's workspace Meera opens **Brand Kit** in Clips and picks the logo, the caption style, an intro sting and an outro card.
2. She sets a clip up the way the client likes (Vertical, Blurred layout, Marker captions, hook title on, silences removed) and presses **Save As Recipe**: "Client A Shorts".
3. She needs help for the month, so she opens **Team**, presses **Invite**, picks **Editor**, types the address of Arun, a freelance editor, and sends it. The dialog says "Editors can make clips and designs and save post drafts. They cannot connect channels, schedule or publish, see billing or analytics, or invite people." and "1 of 3 editor seats used".
4. Arun accepts and lands on Clips. His rail has Clips, Studio, Media, Composer, Calendar, AI Copilot and Home; Channels, Analytics, Billing and the rest are not there. He opens a new video for that client, picks the recipe on the Clip Setup screen, and presses **Find Clips**. Ten clips come back already styled.
5. He ticks eight and presses **Export All**. A list shows each one's progress. He goes for lunch.
6. He ticks five of them and presses **Create Montage**; they are stitched in order with a short cut between them into one horizontal video for YouTube.
7. In the composer he saves the clips as drafts. He presses **Schedule** to finish the job and sees "Editors cannot do this. Ask an admin." Nothing is lost: the drafts wait for Meera.
8. Meera opens the drafts and presses **Next Available** for each clip. Posts land at "around 7:50 AM", "around 3:40 PM" and "around 7:55 PM", each at a slightly different minute, so the feed never looks automated.
9. For the clips with an AI voice she turns on **Made With AI**; the platforms that have a label for it get it.
10. The month ends. Meera removes Arun from the Team page; his seat comes back.

### Journey D: Something goes wrong, and it's easy to fix 🛟

- A video is music only. Captions says "We could not hear any speech in this video." and nothing is charged.
- The speech is in two languages. Captions come out mostly right; the words AI was unsure of are underlined so Anjali can check them first.
- Auto-Reframe loses a face when someone leans out of the picture. The frame holds still instead of jumping, and a note says "We lost the speaker for 3 seconds here." with **Fix By Hand**.
- Priya turns Auto-Reframe off. Her own crop boxes come back exactly as she left them.
- The AI service is busy. The bar says "Waiting for our turn, about 4 minutes" instead of standing still.
- Vikram runs out of AI minutes half way through a month. Clip Setup shows what a run costs before he presses anything, the button is off, and the page says "This workspace has used all its AI minutes for this month. They reset on 1 December." The manual tools from Sprint 12 all still work.
- A paid step fails half way. The bar says "Your AI minutes were given back." and the chip goes back to what it was.
- A recipe uses a caption style that was deleted. The clip falls back to **Clean** and says so.
- Arun deletes a sentence by mistake. **Ctrl+Z** brings back the sentence, the video and the captions together.

### Journey E: Vikram makes an emote and a schedule picture 🎭

1. Vikram opens **Creator Tools** from the Clips page and picks **Emote Maker**. He chooses the clip where his face goes wide at the crash.
2. A dashed square sits on the picture; he drags it over his face and drags the trim bar to a 2.4 second stretch (it will not go past 3 seconds). The emote plays at 28, 56 and 112 pixels beside a chat preview, where it sits in four lines of fake chat.
3. He presses **Export For Twitch**. Three small files come back, each with its size ("112 px, 311 KB, under the limit"). A line says "Use clips of your own stream. Twitch reviews emotes before they go live."
4. He opens **Schedule Maker**, types his Twitch name, and picks the **Dark** theme and **Portrait**. The week is filled from his Twitch schedule in his own time zone, with Thursday off.
5. The picture opens in Design Studio. He changes one game title by hand and presses **Download**. It is a normal picture file.
6. Neither tool used any AI minutes.

---

## 3. User Stories

### Epic CA-1: Captions

#### CA-1.1: Add Captions To A Clip

> **As a** creator,
> **I want** captions made from what is said,
> **So that** people follow my clip with the sound off.

**Acceptance Criteria:**
- [ ] The editor has a **Captions** tab between **Audio** and **Export**.
- [ ] **Add Captions** (violet) shows its price ("Add Captions (12 AI Minutes)") when the video has not been listened to yet, and is free once it has. The price is 1 AI minute for each minute listened to, at least 2.
- [ ] A bar shows the step in words: "Listening to what is said", then the captions appear on the clip and as a row on the timeline.
- [ ] **Spoken Language** offers **Detect Automatically** (the default) and a list of languages.
- [ ] A video with no speech says "We could not hear any speech in this video." and charges nothing.
- [ ] With too few AI minutes the button is off and the line says "This needs 12 AI minutes and you have 4 left. They come back on 1 December, or you can upgrade the plan."

**Priority**: P0 | **Story Points**: 8

#### CA-1.2: Choose A Caption Style

> **As a** creator,
> **I want** ready caption styles,
> **So that** my clips look like the ones that do well.

**Acceptance Criteria:**
- [ ] The tab shows style tiles, each previewing itself with real words: **Bold Pop**, **Marker**, **Karaoke**, **Clean**, **Boxed**, **Typewriter**.
- [ ] Picking a tile restyles the captions at once; the word being said is marked the way that style does it.
- [ ] Position (top, middle, bottom, or dragged), size and how many words show at once can be changed.
- [ ] Captions keep clear of the areas where TikTok, Reels and Shorts draw their own buttons; a guide shows those areas while dragging.

**Priority**: P0 | **Story Points**: 5

#### CA-1.3: Fix A Word

> **As a** podcaster,
> **I want** to fix words the AI got wrong,
> **So that** names and brands are spelled right.

**Acceptance Criteria:**
- [ ] Clicking a caption on the clip or a word in the transcript lets me retype it; the timing stays.
- [ ] **Replace Everywhere** changes every use of that word in the video's text.
- [ ] Words the AI was unsure of are underlined until they are checked.
- [ ] A fix made in one clip is kept for other clips cut from the same video.

**Priority**: P0 | **Story Points**: 5

#### CA-1.4: Make My Own Style

> **As an** agency owner,
> **I want** to save a caption style of my own,
> **So that** every clip for a client looks the same.

**Acceptance Criteria:**
- [ ] **Create A Style** opens the controls: font (the Studio fonts), size, colours, outline, box, the marked-word colour, the animation, letter case.
- [ ] A saved style appears under **My Styles** for the whole workspace and can be renamed and deleted.

**Priority**: P1 | **Story Points**: 5

#### CA-1.5: Captions In Another Language

> **As a** solo creator,
> **I want** captions translated,
> **So that** people who speak another language can follow.

**Acceptance Criteria:**
- [ ] **Translate Captions** offers a language list and shows the price in AI minutes before it runs ("Translate Captions (1 AI Minute)"; the price is 0.25 for each clip minute, rounded up).
- [ ] The translated captions replace the shown ones; the original stays and can be switched back.
- [ ] Translated lines can be edited like any other.

**Priority**: P1 | **Story Points**: 5

#### CA-1.6: Captions Follow Every Edit

> **As a** team member,
> **I want** captions to stay right when I trim, split or speed up the clip,
> **So that** I never have to redo them.

**Acceptance Criteria:**
- [ ] Trimming, splitting, deleting a part and changing speed all leave the captions in step with the speech.
- [ ] Bringing back trimmed video brings its captions back with it.
- [ ] The editor shows captions as a close preview. A note under the preview says "The editor is a fast preview. Preview Export shows the real result."

**Priority**: P0 | **Story Points**: 3

#### CA-1.7: Captions From A File

> **As a** podcaster,
> **I want** to give PostGear the captions file I already have,
> **So that** I do not wait for, or pay for, listening to a video I have already written out.

**Acceptance Criteria:**
- [ ] **Upload SRT** sits in the Captions tab and on Clip Setup, beside **Spoken Language**. It takes an SRT or a VTT file.
- [ ] The file's lines become the video's transcript with their times, marked "From your file". It costs nothing and no AI minutes are used.
- [ ] Captions can then be added, styled, fixed and cut by transcript like any others; the words are as good as the file.
- [ ] A file that cannot be read says "We could not read this captions file. Check that it is an SRT or VTT file." and changes nothing.
- [ ] A file whose times fall outside the clip says "This file does not match this video's length." and asks whether to use it anyway.
- [ ] Picking **Detect Automatically** later and listening to the video replaces the file's words only after a question ("Replace the words from your file?").

**Priority**: P1 | **Story Points**: 3

### Epic CA-2: Edit By Transcript

#### CA-2.1: See The Words Beside The Clip

> **As a** marketing manager,
> **I want** the transcript beside the clip,
> **So that** I can read instead of scrub.

**Acceptance Criteria:**
- [ ] A **Transcript** pane can be opened on the left of the clip; the word being said is marked as the clip plays.
- [ ] Clicking a word jumps the playhead to it.
- [ ] On the video page, the transcript can be searched with **Ctrl+F**, and selecting a stretch of text and pressing **Create Clip** makes a clip of exactly that stretch.

**Priority**: P0 | **Story Points**: 5

#### CA-2.2: Delete Words To Cut The Video

> **As a** marketing manager,
> **I want** to delete a sentence from the text and have the video cut with it,
> **So that** editing speech is as easy as editing a document.

**Acceptance Criteria:**
- [ ] Selecting words and pressing **Delete** removes that stretch from the clip; the removed text shows struck through and can be restored with a click.
- [ ] The cut lands between words, never in the middle of one, with a tiny fade so it does not click.
- [ ] **Ctrl+Z** restores the text, the video and the captions together.

**Priority**: P0 | **Story Points**: 8

#### CA-2.3: Remove Silences And Filler Words

> **As a** podcaster,
> **I want** one button each for pauses and for "um",
> **So that** the clip is tight.

**Acceptance Criteria:**
- [ ] **Remove Silences** shows how many pauses and how many seconds it will remove before it does; a slider sets how long a pause must be (0.5 to 2 seconds).
- [ ] **Remove Filler Words** lists the words it found ("um", "uh", "you know") with a tick each.
- [ ] Both are one undo step, and both show what they removed in the transcript.

**Priority**: P1 | **Story Points**: 5

### Epic CA-3: Clip Setup And Smarter AI

#### CA-3.1: Set The Run Up Before It Costs Anything

> **As a** streamer,
> **I want** to tell AI what I want before it runs,
> **So that** I get the clips I am after and know the price.

**Acceptance Criteria:**
- [ ] **Find Clips** opens **Clip Setup** with: **Range** (a strip of the video with two handles; "Use less of the video to spend fewer AI minutes"), **Spoken Language** and **Upload SRT**, **Genre** (CA-3.4), **What Should We Look For?** (a field, placeholder "Enter your idea"), **Clip Length** (**Auto**, **Under 30 Seconds**, **30 To 60 Seconds**, **60 To 90 Seconds**), **Shape**, **Layouts AI May Use**, **Captions** (on or off, and the style), **Recipe** and **Brand Kit**.
- [ ] A **Summary** on the right reads the choices back with the price ("58 min, 73 AI minutes") and the AI minutes left ("38 of 300 AI minutes left").
- [ ] With too few AI minutes the button is disabled and the summary says how many are missing. When none are left it says "This workspace has used all its AI minutes for this month. They reset on 1 December."
- [ ] A sentence under the button says "By continuing, you confirm you may use this video." only when the video has no rights record yet (uploads).

**Priority**: P0 | **Story Points**: 8

#### CA-3.2: AI That Understands What Is Said

> **As a** podcaster,
> **I want** AI to pick moments that make sense on their own,
> **So that** clips do not start or end in the middle of a thought.

**Acceptance Criteria:**
- [ ] Clips start at the start of a sentence and end at the end of one.
- [ ] Each clip has a title AI wrote, a score, and reasons in plain words: "Strong opening line", "Complete thought", "Funny exchange", "Matches what you asked for".
- [ ] What I typed under **What Should We Look For?** changes what comes back, and clips that match it say so.
- [ ] Moments found from sound and chat (Sprint 12) and from speech are merged into one list with one score; the same moment is never listed twice.
- [ ] The note under the list now says "AI listened to what was said and watched for action."

**Priority**: P0 | **Story Points**: 8

#### CA-3.3: Look For Action

> **As a** streamer,
> **I want** AI to notice what happens on screen,
> **So that** fails and big plays are found even when nobody shouts.

**Acceptance Criteria:**
- [ ] Clip Setup has **Look For Action** (off by default, with its extra price shown, for example "Look For Action (+29 AI Minutes)").
- [ ] Clips found this way carry reasons like "Sudden movement on screen" or "Something unexpected happens", and a short line AI wrote about what it saw.
- [ ] The setup says plainly: "This finds sudden action. It does not know the rules of your game."

**Priority**: P1 | **Story Points**: 8

#### CA-3.4: Pick A Genre

> **As a** podcaster,
> **I want** to tell AI what kind of video this is,
> **So that** it looks for the moments that matter in that kind of video.

**Acceptance Criteria:**
- [ ] Clip Setup has **Genre** with **Auto** (the default), **Podcast**, **Gaming**, **Education**, **Interview** and **Vlog**.
- [ ] **Auto** reads the first minutes of speech and picks one; the choice is shown ("Auto: Podcast") and can be changed.
- [ ] The genre changes what counts as a good moment (a podcast favours complete thoughts and strong opinions; gaming favours reactions and plays), and the reasons on each clip use the same plain words.
- [ ] A genre costs nothing extra and does not change the price.
- [ ] The genre is saved in a recipe.

**Priority**: P2 | **Story Points**: 2

### Epic CA-4: Follow The Speaker

#### CA-4.1: Find My Face Camera

> **As a** streamer,
> **I want** one button that finds my face camera,
> **So that** I do not drag the box every time.

**Acceptance Criteria:**
- [ ] **Layouts** has **Detect Camera**; pressing it moves the Camera box onto the face camera within a few seconds.
- [ ] If no steady face is found it says "We could not find a face camera. Drag the box yourself." and changes nothing.
- [ ] The result is one undo step.

**Priority**: P0 | **Story Points**: 5

#### CA-4.2: Keep The Speaker In Frame

> **As a** podcaster,
> **I want** the frame to follow whoever is talking,
> **So that** a wide two-person shot works as a tall clip.

**Acceptance Criteria:**
- [ ] **Follow The Speaker** is a switch in **Layouts** (and in Clip Setup). Turning it on shows "Finding faces", then the frame follows the speaker for the whole clip.
- [ ] The frame moves smoothly, holds still for small movements, and cuts (not slides) when the speaker changes.
- [ ] With two people, **Show Both** stacks them instead of switching.
- [ ] Turning it off restores my own crop boxes exactly.
- [ ] Where the speaker was lost, a mark on the timeline says so and **Fix By Hand** lets me place the frame for that stretch.

**Priority**: P0 | **Story Points**: 13

### Epic CA-5: AI Effects

#### CA-5.1: Bleep Bad Words

> **As a** streamer,
> **I want** swear words bleeped,
> **So that** platforms do not hold my clip back.

**Acceptance Criteria:**
- [ ] **Effects** has **Bleep Bad Words**; turning it on lists the words found, each with a tick.
- [ ] Ticked words are bleeped (or muted, my choice) in the sound and shown as stars in the captions.
- [ ] I can add my own words to the list for the workspace.

**Priority**: P1 | **Story Points**: 5

#### CA-5.2: A Hook Title On The First Seconds

> **As a** solo creator,
> **I want** a title on the first seconds that makes people stop,
> **So that** more people watch.

**Acceptance Criteria:**
- [ ] **Add Hook Title** offers three titles AI wrote from the clip's words, and a field to write my own (placeholder "Enter your title").
- [ ] The title is a normal text item at the start of the clip (move it, restyle it, change how long it shows); three ready looks are offered.

**Priority**: P0 | **Story Points**: 3

#### CA-5.3: Open With The Best Two Seconds

> **As a** streamer,
> **I want** the punchline shown first, then the build-up,
> **So that** viewers know it is worth staying.

**Acceptance Criteria:**
- [ ] **Add Hook Clip** lets me pick 1 to 5 seconds of the clip; they play first, then the clip from its start.
- [ ] AI suggests the stretch with the highest score; I can change it.
- [ ] Removing the hook clip puts the clip back as it was.

**Priority**: P1 | **Story Points**: 5

#### CA-5.4: Turn Text Into A Voice

> **As a** solo creator,
> **I want** a line of text read out by a voice,
> **So that** I can add an intro without recording.

**Acceptance Criteria:**
- [ ] **Text To Speech** has a field (placeholder "Enter your words"), a voice picker with a play button for each voice, and its price in AI minutes ("Make The Voice (1 AI Minute)"; 1 for each 1000 characters).
- [ ] The result is a sound on the timeline like any other.
- [ ] Clips that use it are marked so the composer can label them (CA-9.2).

**Priority**: P2 | **Story Points**: 5

### Epic CA-6: Recipes And Brand Kit

#### CA-6.1: Save My Settings As A Recipe

> **As a** team member,
> **I want** to save how a clip is set up and use it again,
> **So that** every clip for a client starts the same.

**Acceptance Criteria:**
- [ ] **Save As Recipe** (in the editor and on Clip Setup) saves the shape, layout, caption style and position, hook title on or off, silence and filler settings, bleep, and export quality under a name.
- [ ] A recipe can be picked on Clip Setup and applied to an open clip; applying is one undo step.
- [ ] Recipes belong to the workspace and can be renamed and deleted.

**Priority**: P0 | **Story Points**: 5

#### CA-6.2: A Brand Kit For Clips

> **As an** agency owner,
> **I want** the client's logo, colours and intro kept in one place,
> **So that** every clip carries the brand.

**Acceptance Criteria:**
- [ ] Clips uses the workspace's brand kits from Studio and adds: a logo position for video, a default caption style, an intro clip and an outro card.
- [ ] Picking a brand kit on a clip adds the logo and, if set, the intro and outro; each can be switched off per clip.

**Priority**: P1 | **Story Points**: 5

#### CA-6.3: Starter Recipes

> **As a** team member,
> **I want** ready-made recipes for the common jobs,
> **So that** I can get a good result on my first try without setting switches.

**Acceptance Criteria:**
- [ ] Five starter recipes are on the Create tab as chips and in the recipe picker on Clip Setup: **Clean Up Recording**, **Auto-Edit Talking Video**, **Captions Only**, **Reframe** and **Social Edit**.
- [ ] A line under each chip says what it does in plain words ("Removes silences and filler words, adds captions").
- [ ] Picking one fills Clip Setup and shows its price in AI minutes before anything runs.
- [ ] Starter recipes are read-only, marked "Starter", and can be copied into the workspace's own recipes and changed there.
- [ ] A starter recipe never uses a feature the workspace's plan lacks; that part is left out and the summary says so.

**Priority**: P1 | **Story Points**: 3

#### CA-6.4: Auto-Edit A Whole Video

> **As a** marketing manager,
> **I want** one press that turns a whole recording into one edited video,
> **So that** a webinar or talk is cleaned up without clipping it.

**Acceptance Criteria:**
- [ ] **Auto-Edit Video** is on the video page's menu and as a button beside the starter recipe chips; it asks for a recipe (the default is **Auto-Edit Talking Video**) and shows the price in AI minutes ("Auto-Edit Video (28 AI Minutes)" for a 28 minute video that must be listened to).
- [ ] It makes one clip over the whole video, up to the 30 minute clip maximum, with the recipe applied (silences and filler words removed, captions on, the layout chosen). Longer videos say "Pick a stretch of up to 30 minutes."
- [ ] A bar shows the steps in words and the finished clip opens in the editor, where every change is one undo step.
- [ ] If a part of the recipe cannot run (no face found for Follow The Speaker, a deleted caption style), the clip still comes back and a note says which part was skipped and why.
- [ ] A failed run gives its AI minutes back and says "Your AI minutes were given back."

**Priority**: P1 | **Story Points**: 5

### Epic CA-7: Many Clips At Once

#### CA-7.1: Export All

> **As a** team member,
> **I want** to export many clips in one go,
> **So that** I do not press Export twenty times.

**Acceptance Criteria:**
- [ ] Ticking clips in the Clips tab shows a bar with **Export All**, **Hide** and **Delete**.
- [ ] A list shows each clip's progress; one failure does not stop the others.
- [ ] The bell says "8 clips are ready" once, not eight times.

**Priority**: P0 | **Story Points**: 5

#### CA-7.2: Stitch Clips Into One Video

> **As a** streamer,
> **I want** to stitch my best clips into one video,
> **So that** I have a weekly highlights video for YouTube.

**Acceptance Criteria:**
- [ ] **Create Montage** takes 2 to 15 clips, in an order I can drag, with a cut or a short fade between them and an optional title card.
- [ ] The montage opens in the editor as one clip made of many parts, and exports like any other.
- [ ] Clips from different videos can be mixed.

**Priority**: P1 | **Story Points**: 8

### Epic CA-8: More Places To Bring Video From

#### CA-8.1: More Sites In The Link Box

> **As a** marketing manager,
> **I want** to paste links from more sites,
> **So that** I am not limited to three platforms.

**Acceptance Criteria:**
- [ ] The link box also reads the sites listed in the sprint doc: Vimeo, Rumble, Dailymotion, Loom, X, Facebook, LinkedIn, **Reddit, Pinterest and Threads**; the placeholder says "Enter your video link" and a help line lists the sites that are on.
- [ ] **TikTok and Instagram** are built but off until the operator switches them on; pasting such a link says "We cannot bring in videos from this site yet."
- [ ] Each site can be switched off by itself.
- [ ] **Download** works for the same sites.

**Priority**: P1 | **Story Points**: 5

#### CA-8.2: Bring In A File From Google Drive

> **As a** marketing manager,
> **I want** to pick a recording from Google Drive,
> **So that** I do not download and upload it again.

**Acceptance Criteria:**
- [ ] **Google Drive** sits beside **Upload A Video**; it opens Google's own file picker after I connect my account.
- [ ] Only the file I pick is read; PostGear never lists my Drive itself.
- [ ] The file comes in like an upload.

**Priority**: P2 | **Story Points**: 5

### Epic CA-9: Posting

#### CA-9.1: Posting Times That Look Natural

> **As an** agency owner,
> **I want** clips to go out at set times with a little variation,
> **So that** the account does not look automated.

**Acceptance Criteria:**
- [ ] A channel has **posting slots**: each slot is a time of day with its own window ("within 15 minutes") and the weekdays it applies to (weekday chips, Monday to Sunday). A post then goes out at a different minute inside the window each time, never exactly on the hour and never two at once.
- [ ] Times can differ by weekday ("7:50 AM on weekdays, 10:15 AM on weekends"); the list shows them grouped by weekday.
- [ ] **Shuffle Times** suggests a week of slots from how often I want to post, and a button gives another set; nothing is saved until **Use These Times**.
- [ ] A channel set up before this sprint keeps its times: each old time becomes a slot on all seven weekdays with no window.
- [ ] The composer's **Next Available** uses these slots, and a post scheduled by hand at an exact time stays exact.
- [ ] A channel with no slots shows "Set posting times for this channel first." beside **Next Available**.

**Priority**: P1 | **Story Points**: 5

#### CA-9.2: Say When A Clip Was Made With AI

> **As a** creator,
> **I want** to mark a post as made with AI when it was,
> **So that** I follow each platform's rules.

**Acceptance Criteria:**
- [ ] The composer has **Made With AI** for a post with video; platforms that have a label for it receive it.
- [ ] It is suggested (not forced) when the clip uses an AI voice.
- [ ] A help line says what counts: "Captions and cuts do not need this. A made-up voice or picture does."

**Priority**: P1 | **Story Points**: 3

#### CA-9.3: Pick A Random Time Of Day

> **As an** agency owner,
> **I want** to ask for a time in the morning, at noon, in the afternoon or in the evening and get a free one,
> **So that** I do not have to choose a minute myself, and my posts do not all land on the hour.

**Acceptance Criteria:**
- [ ] The composer's schedule dialog shows the calendar, the times already used that day, a time field, and **Pick A Random Time** with four choices: **Morning**, **Noon**, **Afternoon** and **Evening**.
- [ ] Each choice fills the time field with a free time inside that part of the day (for example Morning 6:00 to 11:59, Noon 12:00 to 13:59, Afternoon 14:00 to 17:59, Evening 18:00 to 22:00, in the workspace's time zone), never on a round five minutes and never the same minute as another post on that channel.
- [ ] Pressing the same choice again gives another time; the time can still be changed by hand.
- [ ] If the part of the day is full, it says "That part of the day is full. Try another." and changes nothing.
- [ ] The dialog also offers **Next Available** and **Manage Posting Slots**, which opens the slot list from CA-9.1.

**Priority**: P2 | **Story Points**: 2

### Epic CA-10: Fair And Dependable

#### CA-10.1: Prices Before Presses

> **As a** workspace owner,
> **I want** every AI action to show its price first,
> **So that** AI minutes are never a surprise.

**Acceptance Criteria:**
- [ ] Captions, Find Clips, Look For Action, Auto-Edit Video, Translate Captions and Text To Speech each show their price in AI minutes in the button or the summary ("Find Clips (15 AI Minutes)"). Follow The Speaker, Detect Camera and Upload SRT say they are free.
- [ ] A chip near the top of Clips reads "38 of 300 AI minutes left" and the billing page shows it next to the AI credits, which are used only for text and pictures.
- [ ] A video is listened to once: after that, captions and transcript features cost nothing more for that video.
- [ ] A failed AI step, or one that finds no speech, gives its AI minutes back (a reversal, never a second refund) and says "Your AI minutes were given back."
- [ ] Pressing a button twice, or a step running twice after a hiccup, charges once.
- [ ] When the allowance is short the button is off and the page says "This needs 58 AI minutes and you have 38 left. They come back on 1 December, or you can upgrade the plan." with **See Plans**; when it is used up it says "This workspace has used all its AI minutes for this month. They reset on 1 December."

**Priority**: P0 | **Story Points**: 3

#### CA-10.2: Honest Waiting

> **As a** team member,
> **I want** to know when I am waiting for my turn,
> **So that** a quiet bar does not look broken.

**Acceptance Criteria:**
- [ ] When AI work is queued, the bar says "Waiting for our turn" with a rough time.
- [ ] Paid plans go ahead of Free in the queue; the Free plan's message says so.

**Priority**: P1 | **Story Points**: 3

#### CA-10.3: What AI Knows About People Is Deleted With The Video

> **As a** workspace owner,
> **I want** the text and the face positions AI made to go when the video goes,
> **So that** nothing about the people in it is left behind.

**Acceptance Criteria:**
- [ ] Deleting or expiring a video deletes its transcript and its face positions.
- [ ] PostGear stores where faces are in the picture, never who they are.
- [ ] The help page says this in plain words.

**Priority**: P0 | **Story Points**: 3

### Epic CA-11: Creator Tools And Editor Seats

#### CA-11.1: Make An Emote

> **As a** streamer,
> **I want** to turn a moment from my stream into an emote,
> **So that** my chat has my own face in it.

**Acceptance Criteria:**
- [ ] **Creator Tools** (in the Clips page's actions row) opens **Emote Maker**. I pick a clip or a video from my workspace, or paste a link that comes in the usual way.
- [ ] A square crop box sits over the picture; I can move and resize it, and it stays square. Under 112 source pixels it says "This will look soft."
- [ ] A trim bar holds one window of at most **3 seconds** (in steps of a tenth of a second); dragging past 3 seconds stops at 3 seconds.
- [ ] The emote plays on a loop at 28, 56 and 112 pixels, and a **chat preview** shows four lines of chat, one with five of my emote, with a light and dark switch. I can type my own line; it is never saved.
- [ ] **Export For Twitch**, **Export For 7TV** and **Export For BTTV** each give a download of files with their sizes and "under the limit" or the reason it is not. Twitch gets 28, 56 and 112 pixel files within its size and frame limits; 7TV gets one larger file; BTTV gets the three sizes.
- [ ] If a file is over its limit, the maker lowers the frame rate and colours step by step and never changes my crop or length. If the smallest try is still too big it says "This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop."
- [ ] An optional background colour removal: I click the background colour on the picture and slide a similarity bar; edges are softer in 7TV files than in GIFs and a note says so.
- [ ] A line says "Use clips of your own stream. Twitch reviews emotes before they go live. Check each site's current rules before you upload."
- [ ] It costs no AI minutes. Each download counts toward the day's download limit.

**Priority**: P1 | **Story Points**: 5

#### CA-11.2: Make A Stream Schedule Picture

> **As a** streamer,
> **I want** my Twitch schedule turned into a picture,
> **So that** I can post "when I am live" every week without drawing it.

**Acceptance Criteria:**
- [ ] **Schedule Maker** asks for my Twitch name (placeholder "Enter your Twitch name") and, beside it, **Fill It In By Hand**.
- [ ] It reads my public Twitch schedule for the week and shows it in my time zone ("All times Asia/Kolkata"); the time zone can be changed from a list. Daylight saving changes and shows that cross midnight are handled; a cancelled show reads **Off**; a vacation reads "On a break until Mon 23 Nov".
- [ ] I pick one of five themes, **Clean Blue**, **Light Blue**, **Cool**, **Dark** and **Red**, and a shape (Portrait, Landscape).
- [ ] It opens in Design Studio with the week filled in as seven rows; every word can be edited by hand, and **Refresh From Twitch** asks "Replace your edits with Twitch's schedule?" before it replaces them.
- [ ] I can download it as a PNG and send it to the composer.
- [ ] A channel with no schedule opens seven rows marked Off with "This channel has no Twitch schedule. Fill it in by hand."; an unknown name says "We could not find that Twitch channel."
- [ ] It costs no AI minutes.

**Priority**: P1 | **Story Points**: 5

#### CA-11.3: Invite An Editor

> **As an** agency owner,
> **I want** to invite a freelancer who can cut and caption but cannot publish,
> **So that** I get help without giving away my channels.

**Acceptance Criteria:**
- [ ] The Team page's invite dialog offers **Member**, **Admin** and **Editor** as choices. Under **Editor**: "Editors can make clips and designs and save post drafts. They cannot connect channels, schedule or publish, see billing or analytics, or invite people."
- [ ] An Editor invite needs an email address; the link works only for that address, once, for a week. The email says "invited you to join {workspace} as an editor."
- [ ] A seat line reads "2 of 3 editor seats used". When none are left, **Invite** says "No editor seats left. Remove an editor or change your plan." The number of seats comes from the plan (set by the operator, never in code).
- [ ] The seat limit is checked again when the invitation is accepted: if two people accept at once for the last seat, one is admitted and the other sees the same sentence.
- [ ] Changing a member to Editor checks the seats too. A disabled Editor does not use a seat.
- [ ] After a downgrade, existing Editors keep working; the Team page says "You have 5 editors and your plan allows 3. Remove 2 to add more." and new invites are refused.
- [ ] The Team page lists Editors with an **Editor** tag; an admin can change or remove them as with anyone else. The last admin rule is unchanged.

**Priority**: P1 | **Story Points**: 8

#### CA-11.4: Work As An Editor

> **As an** editor,
> **I want** the tools I need and nothing I should not touch,
> **So that** I can do my job and nobody worries.

**Acceptance Criteria:**
- [ ] After accepting I land on Clips. My rail shows Clips, Design Studio, Media, Composer, Calendar, AI Copilot and Home; Channels, Analytics, SEO, Discover, Workflows, Billing, API Keys and Webhooks are simply not there.
- [ ] I can import, find clips, edit, export and download; make designs and brand kits; upload media; use the Emote Maker and Schedule Maker; and use AI Copilot. These spend the workspace's AI minutes and AI credits.
- [ ] In the composer I can create, edit and delete **drafts** and pick channels, but **Schedule**, **Publish Now** and **Next Available** are not offered; if I try one by another way, I see "Editors cannot do this. Ask an admin." and nothing changes.
- [ ] Typing the address of a page I cannot use shows "You do not have access to this page." with a link back to Clips, never a broken page.
- [ ] Anything I make is marked with my name, so an admin can see who made what.
- [ ] I cannot see any channel's tokens or connect, disconnect or refresh a channel, change billing, make API keys or webhooks, run workflows, invite or remove anyone, or change anyone's role.
- [ ] The Home page hides the analytics tiles for me.

**Priority**: P1 | **Story Points**: 5

---

## 4. UX Best Practices For This Module

| # | Principle | What it means in Clips AI |
|---|---|---|
| 1 | **Show what AI did** | Removed words are struck through, bleeped words are marked, lost-speaker stretches are flagged. Nothing changes silently. |
| 2 | **Everything AI does can be undone** | Each AI action is one undo step, and turning a switch off restores what was there. |
| 3 | **Prices before presses** | Every AI button or summary shows its AI minutes first. Listening to a video is paid once, and a failed step gives its minutes back. |
| 4 | **AI suggests, people decide** | Titles come as three choices. Detected cameras and followed speakers can be fixed by hand. |
| 5 | **Say what AI cannot do** | "It does not know the rules of your game." "We lost the speaker for 3 seconds here." |
| 6 | **Text is the fastest editor** | Anything about speech (cut, fix, search, clip) can be done from the transcript. |
| 7 | **Set once, reuse** | Recipes and the brand kit carry choices from one clip to the next and from one person to the next. |
| 8 | **Waiting has words** | "Listening to what is said", "Finding faces", "Waiting for our turn, about 4 minutes". |
| 9 | **Plain words** | Captions, transcript, speaker, recipe. Never "ASR", "diarization", "inference", "model", "tokens", "keyframes". |
| 10 | **People are not data** | Face positions, never identities; deleted with the video. |
| 11 | **The editor is a preview** | The editor matches the export closely and says so; **Preview Export** shows the real result. |
| 12 | **A seat is not a key** | An Editor sees only what they can use; what they cannot do is absent, and a try says "Editors cannot do this. Ask an admin." |

---

## 5. Edge Cases And Expected Behaviour

| Situation | What the user sees |
|---|---|
| No speech in the video | "We could not hear any speech in this video." Nothing is charged. |
| Speech under loud game sound or music | Captions are made; unsure words are underlined; a note says "Some words were hard to hear. Check the underlined ones." |
| Two languages in one video | Captions in both where it can; unsure words underlined |
| A language we do not support | "We cannot make captions in this language yet." |
| The AI service is not running | "Captions are not available right now. Everything else still works." |
| AI work is queued | "Waiting for our turn, about 4 minutes" |
| Listening fails half way | "We could not finish listening to this video. Your AI minutes were given back." with **Try Again** |
| The month's AI minutes are used up | "This workspace has used all its AI minutes for this month. They reset on 1 December." AI buttons are off; Sprint 12's manual tools still work |
| An Editor tries to schedule, publish, connect a channel or change billing | "Editors cannot do this. Ask an admin." Nothing changes. A typed address for a page they cannot use shows "You do not have access to this page." |
| An Editor invite when all editor seats are used | "No editor seats left. Remove an editor or change your plan." |
| Two people accept the last editor seat at once | One is admitted; the other sees "No editor seats left. Remove an editor or change your plan." |
| A plan is lowered below the number of Editors | Existing Editors keep working; "You have 5 editors and your plan allows 3. Remove 2 to add more." |
| Schedule Maker finds no Twitch schedule | Seven rows marked Off and "This channel has no Twitch schedule. Fill it in by hand." |
| Schedule Maker cannot find the Twitch name | "We could not find that Twitch channel." |
| An emote is still over the size limit after every step down | "This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop." Nothing is downloaded for that size |
| An emote stretch is longer than 3 seconds | The trim bar stops at 3 seconds; the server also refuses with "An emote can be 3 seconds at most." |
| A captions file cannot be read | "We could not read this captions file. Check that it is an SRT or VTT file." Nothing changes |
| An Auto-Edit recipe needs a part that is missing (no face, a deleted style) | The clip still comes back and a note says "Follow The Speaker was skipped: we could not find anyone to follow." |
| A random time of day has no free minute | "That part of the day is full. Try another." |
| A link from TikTok or Instagram while they are off | "We cannot bring in videos from this site yet." |
| Find Clips with a request nothing matches | "Nothing matched what you asked for. Here are the best moments we found instead." |
| No face in the video | Follow The Speaker says "We could not find anyone to follow in this clip." and stays off |
| The speaker leaves the picture | The frame holds; a timeline mark; "We lost the speaker for 3 seconds here." with **Fix By Hand** |
| Many faces (a crowd) | "There are many faces here. Pick who to follow." with the faces as choices |
| Detect Camera finds nothing | "We could not find a face camera. Drag the box yourself." |
| A deleted sentence would leave the clip under 3 seconds | "A clip needs at least 3 seconds." and the delete is not applied |
| A word is fixed, then the video is listened to again | The fix is kept |
| A recipe names a style or kit that no longer exists | The clip falls back to **Clean** (or no kit) and says which part was missing |
| Export All with some locked qualities | Those clips export at the best quality the plan allows, and the list says so |
| A montage of clips with different shapes | "These clips have different shapes. Pick one shape for the montage." |
| A link from a newly added site fails | The same sentences as Sprint 12, with the site's name |
| Google Drive is not connected, or access was removed | "Connect Google Drive to pick a file." |
| A platform has no AI label | The composer shows "This platform has no label for AI. Say it in your caption if you need to." |
| Bleep finds nothing | "No words to bleep in this clip." |
| Text To Speech in a language the voice cannot read | "This voice cannot read this language. Pick another voice." |

---

## 6. Completion Checklist ✅

**Epic CA-1: Captions**
- [ ] CA-1.1 Add Captions To A Clip
- [ ] CA-1.2 Choose A Caption Style
- [ ] CA-1.3 Fix A Word
- [ ] CA-1.4 Make My Own Style (P1)
- [ ] CA-1.5 Captions In Another Language (P1)
- [ ] CA-1.6 Captions Follow Every Edit
- [ ] CA-1.7 Captions From A File (P1)

**Epic CA-2: Edit By Transcript**
- [ ] CA-2.1 See The Words Beside The Clip
- [ ] CA-2.2 Delete Words To Cut The Video
- [ ] CA-2.3 Remove Silences And Filler Words (P1)

**Epic CA-3: Clip Setup And Smarter AI**
- [ ] CA-3.1 Set The Run Up Before It Costs Anything
- [ ] CA-3.2 AI That Understands What Is Said
- [ ] CA-3.3 Look For Action (P1)
- [ ] CA-3.4 Pick A Genre (P2)

**Epic CA-4: Follow The Speaker**
- [ ] CA-4.1 Find My Face Camera
- [ ] CA-4.2 Keep The Speaker In Frame

**Epic CA-5: AI Effects**
- [ ] CA-5.1 Bleep Bad Words (P1)
- [ ] CA-5.2 A Hook Title On The First Seconds
- [ ] CA-5.3 Open With The Best Two Seconds (P1)
- [ ] CA-5.4 Turn Text Into A Voice (P2)

**Epic CA-6: Recipes And Brand Kit**
- [ ] CA-6.1 Save My Settings As A Recipe
- [ ] CA-6.2 A Brand Kit For Clips (P1)
- [ ] CA-6.3 Starter Recipes (P1)
- [ ] CA-6.4 Auto-Edit A Whole Video (P1)

**Epic CA-7: Many Clips At Once**
- [ ] CA-7.1 Export All
- [ ] CA-7.2 Stitch Clips Into One Video (P1)

**Epic CA-8: More Places To Bring Video From**
- [ ] CA-8.1 More Sites In The Link Box (P1)
- [ ] CA-8.2 Bring In A File From Google Drive (P2)

**Epic CA-9: Posting**
- [ ] CA-9.1 Posting Times That Look Natural (P1)
- [ ] CA-9.2 Say When A Clip Was Made With AI (P1)
- [ ] CA-9.3 Pick A Random Time Of Day (P2)

**Epic CA-10: Fair And Dependable**
- [ ] CA-10.1 Prices Before Presses
- [ ] CA-10.2 Honest Waiting (P1)
- [ ] CA-10.3 What AI Knows About People Is Deleted With The Video

**Epic CA-11: Creator Tools And Editor Seats**
- [ ] CA-11.1 Make An Emote (P1)
- [ ] CA-11.2 Make A Stream Schedule Picture (P1)
- [ ] CA-11.3 Invite An Editor (P1)
- [ ] CA-11.4 Work As An Editor (P1)

**UX And Quality Gates**
- [ ] `CLIPS_SIMULATION=true` and `MEDIA_SIMULATION=true` run every screen with no network and no AI model; `e2e/clips-ai.spec.ts` passes under them; `npm run validate` (now including the Python service) is green.
- [ ] Captions on the sample clip stay in step after a trim, a split, a deleted part and a speed change, in the editor and in the export (the editor is a close preview; Preview Export matches the export).
- [ ] AI Minutes ledger: every AI step is charged once (a double press and a replayed step charge once), is reversed when it fails or finds nothing, and never refunds twice; the chip, the button prices and the billing page agree.
- [ ] Editor seat: every denial in CA-11.4 is seen once (the sentence, the log line, the absent rail items, the page address), the seat count holds at invite and at accept, and an Editor can never schedule or publish by any route.
- [ ] Emote Maker and Schedule Maker each export their files and pass their checks (the 3 second limit, the size ladder, a clock change, no schedule, an unknown name).
- [ ] Every Sprint 12 document still opens and exports the same (a saved set of Sprint 12 clips is re-exported and compared).
- [ ] Light, dark and Lilac checked at 1366 px and 1920 px; Tamil and Hindi captions render with the right shapes.
- [ ] Copy rules hold: Title Case names, sentence case messages, "Enter your ..." placeholders, no em dash, no middle dot; the title-case test is green.
- [ ] Every row of section 5 has been seen once (in simulation where it can be forced).
- [ ] The real-test plan ([`../sprint-13/real-test-plan.md`](../sprint-13/real-test-plan.md)) has been run once with real videos, with Arvind's OK.
- [ ] The completion checklist is written through `sprint-closeout`.

---

## 7. How We Know It Works (After Launch)

| Measure | Target |
|---|---|
| Caption words that need no fixing, on clear speech | 95% or more |
| Time to listen to a one hour video | under 10 minutes |
| AI clips kept (opened or exported) out of AI clips found | 40% or more (up from the Sprint 12 target of 25%) |
| Clips that start and end on a sentence | 95% or more |
| Follow The Speaker stretches that need Fix By Hand | under 10% of a clip's length |
| Exported clips that carry captions | 60% or more |
| Clips made from a recipe, in workspaces with three or more members | 50% or more |
| AI steps that fail and refund | under 2% |
| Videos with a recipe or Auto-Edit Video used on them | 30% or more |
| Workspaces that use an Editor seat, among workspaces with three or more members | 20% or more |
| Emote exports that fit the platform's limits without a second try | 90% or more |
| Channels with posting slots set, among channels that publish more than twice a week | 40% or more |
