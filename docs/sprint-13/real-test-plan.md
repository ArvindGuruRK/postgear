# Sprint 13: Real Test Plan

> **Status**: Written 2026-11-15, revised 2026-11-17 for the sixteen-module plan (Module 14 is Creator Tools And Editor Seats). Run it after Module 16 is done.
> **Who**: Arvind runs it by hand. Claude Code fixes what it finds, one defect per session.
> **Why**: every module is built and checked in simulation, with recorded transcripts, recorded face boxes and recorded AI answers. This plan is the first time a real speech model listens, a real face detector looks, and a real AI model reads and judges. It also decides the switches that are off by default.

## 1. How This Works

1. **Pass 1, simulation**: repeat every module's Hand Check in one sitting on the finished build.
2. **Pass 2, real**: the test table in section 4, with your own videos. Write the outcome in the Result column of the log.
3. **Defect loop**: each failure gets a row in the log and a fix session (section 6).
4. **Decisions**: section 7 lists the switches and numbers this test settles.
5. **Sign-off**: section 8.

Create `docs/sprint-13/real-test-log.md` when you begin and copy the tables into it; this plan stays clean.

## 2. Before You Start

| Need | How |
|---|---|
| Sprint 12 still passes | `npm run test:e2e -- e2e/clips.spec.ts` green on this build |
| The Python service with models | `uv sync --group ml` in `apps/media`; the first real listen downloads the model (several hundred MB to a few GB) |
| Real mode | In `.env`: `CLIPS_SIMULATION="false"`, `MEDIA_SIMULATION="false"`, `AI_SIMULATION="false"` with a real model key, `TRANSCRIBER="faster-whisper"`; keep `PUBLISH_SIMULATION="true"` until test A-62 |
| A budget | AI model calls here are real and cost money (small: research 07 puts a full pass under a few dollars). Set a spending cap on the provider's dashboard first. This is the one place the "no paid calls" rule is lifted, with your OK |
| Optional lanes | `GROQ_API_KEY` for test A-06; `CLIPS_ACTION_VISION="true"` for A-33; `CLIPS_TTS="true"` for A-45 if a voice was chosen |
| Two workspaces | A Free one and a paid one (billing simulation); set one to `low` and one to `high` `clips.queue_priority` in the operator screen for test A-70 |
| Twitch keys | `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in `.env` (the pair Sprint 12's channel browser uses), for A-83 |
| A second email address | One you can read, for the Editor invite in A-84 and A-85 |

**Your test material** (videos you own or may use):

| Id | What | Link or file | Length |
|---|---|---|---|
| V1 | One person talking to camera, clear English, 5 to 15 minutes | | |
| V2 | A two-person podcast or interview, wide shot, 30 minutes or longer | | |
| V3 | A gaming stream with a face camera in a corner and game sound, an hour or longer | | |
| V4 | A video in Tamil, 5 minutes or longer | | |
| V5 | A video mixing Tamil or Hindi with English | | |
| V6 | A video with music and no speech | | |
| V7 | A video with a crowd or a panel of four or more people | | |
| V8 | A clip with two swear words in it | | |
| V9 | A link from each new site you plan to switch on (Vimeo, Rumble, Loom, X, Facebook, LinkedIn, Dailymotion) | | |

## 3. Pass 1: Simulation

With the three simulation flags on. One row per module: do its Hand Check.

| Module | Hand Check passed | Notes |
|---|---|---|
| 01 Media Service Foundations | | |
| 02 Transcription | | |
| 03 Captions | | |
| 04 Transcript Editing And Speech Cleanup | | |
| 05 Clip Setup And Highlights V2 | | |
| 06 Visual Moments | | |
| 07 Face Detection And Detect Camera | | |
| 08 Auto-Reframe | | |
| 09 AI Effects | | |
| 10 Recipes And Brand Kit | | |
| 11 Montage And Batch Export | | |
| 12 More Sources And Platforms | | |
| 13 Publisher Upgrades | | |
| 14 Creator Tools And Editor Seats | | |
| 15 Scale, Cost And Deploy | | |
| 16 Hardening | | |

Also in this pass: `npm run validate` (Python included) and both e2e suites are green.

## 4. Pass 2: Real

### Listening And Captions

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-01 | Add Captions on a one minute clip of V1 | Captions within a couple of minutes; write down the time taken | 02, 03 |
| A-02 | Read the captions against the speech | Count the wrong words out of the first hundred; write it down | 02 |
| A-03 | Add Captions on a second clip from the same stretch | Free, instant | 02 |
| A-04 | Add Captions on a clip of V3 (game sound under speech) | Usable; unsure words underlined; count the wrong words | 02, 03 |
| A-05 | Add Captions on V4 and V5 | Tamil letters join correctly in the editor and the export; count the wrong words; note how mixed speech is handled | 02, 03 |
| A-06 | With `TRANSCRIBER="groq"`: listen to the whole of V2 | Much faster; the same quality or better; the time and the provider's bill written down | 02, 15 |
| A-07 | Add Captions on V6 | "We could not hear any speech in this video." and no charge | 02 |
| A-08 | Each of the six styles on V1; drag, resize, Words At Once | All look right; nothing overflows | 03 |
| A-09 | Fix a name; Replace Everywhere; open another clip of the same video | Fixed there too | 03 |
| A-10 | Trim, split, delete a part, set a part to 2x | Captions stay on their words | 03 |
| A-11 | Translate Captions to another language and back | Readable; switches back | 03 |
| A-12 | Export a captioned clip at 1080p; compare with the editor at five moments | Same words, place, style and timing | 03 |

### Transcript Editing

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-20 | Open the Transcript pane on V1; play | The marked word keeps up with the voice | 04 |
| A-21 | Delete three sentences; listen to each cut | No clicks, no half words | 04 |
| A-22 | Remove Silences on V2 with the slider at 0.8, then at 0.5 | Counts make sense; speech does not sound rushed or clipped | 04 |
| A-23 | Remove Filler Words on V1 | The list is right; nothing meaningful removed | 04 |
| A-24 | Video page transcript: find a word, select two sentences, Create Clip | The clip is exactly that stretch | 04 |

### Smarter AI

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-30 | Clip Setup on V2, whole video, no request, 30 To 60 Seconds | The price in AI Minutes before the run matches what is charged; clips come back with titles and reasons; time taken written down | 05 |
| A-31 | Watch the top eight: does each start and end on a sentence and stand on its own? | A yes or no for each, written down | 05 |
| A-32 | Run again on V2 with a request that matches one topic of the episode | That topic comes first, marked as matching | 05 |
| A-33 | On V3 with Look For Action and `CLIPS_ACTION_VISION="true"` | Action clips with a sentence about what is seen; mark each as a real moment or not | 06 |
| A-34 | The same with the vision switch off | Action clips without a sentence; compare the hit rate with A-33 | 06 |
| A-35 | A request nothing matches | "Nothing matched what you asked for. Here are the best moments we found instead." | 05 |

### Faces And The Speaker

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-40 | Detect Camera on a Split clip of V3 | The Camera box lands on the face camera; time taken written down | 07 |
| A-41 | Detect Camera on V1 (no face camera) | The "could not find a face camera" sentence | 07 |
| A-42 | Follow The Speaker on a vertical clip of V2; watch all of it | The speaker is in frame; movement is calm; it cuts when the speaker changes. Write down how many seconds were wrong | 08 |
| A-43 | Show Both on the same clip | Two stacked frames, each on a person | 08 |
| A-44 | Follow The Speaker on V7 | The "many faces" picker, or a sensible result | 08 |
| A-45 | Fix By Hand on a lost stretch; switch the feature off | The fix holds; off restores the old layout | 08 |

### Effects, Recipes, Many Clips

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-50 | Bleep Bad Words on V8 | Both words found, bleeped in the export, starred in captions | 09 |
| A-51 | Add Hook Title on V1 three times | Titles are sensible and true to the words | 09 |
| A-52 | Add Hook Clip with the suggestion | The opening seconds are a good pick; captions show on it | 09 |
| A-53 | Text To Speech, if switched on | The voice is acceptable; the clip is flagged as using a made-up voice | 09 |
| A-54 | Save a recipe; run Clip Setup on V1 with it | Every clip comes out styled | 10 |
| A-55 | Brand kit with a logo, an intro and an outro; export | All three are in the video | 10 |
| A-56 | Export All on eight clips | One notice; time for the batch written down | 11 |
| A-57 | A montage of five clips from two videos, with Fade | Plays in order; exports | 11 |
| A-58 | Apply each of the five starter recipes to a clip of V1, one after another | Each does what its name says (Captions Only changes nothing but captions; Reframe changes only the frame); each can be copied and changed | 10 |
| A-59 | Auto-Edit Video on V1 (the whole video) | One edited clip comes back in one press, with a plain line about any part it skipped; the time taken and the AI Minutes charged written down | 10 |

### Sources And Posting

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-60 | Paste each V9 link | A card with the site's name; import one from each | 12 |
| A-61 | Google Drive, if built: pick a file | It comes in as an upload | 12 |
| A-62 | With `PUBLISH_SIMULATION="false"`: Next Available on two posts with a 15 minute window; publish one clip marked Made With AI to a YouTube channel you own (the demo workspace has none: connect yours first) | Different minutes near their slots; on YouTube the video shows the altered-content label; on Instagram the post shows its AI label | 13 |
| A-63 | Set posting slots with weekday windows on one real channel (for example 9:00 on weekdays and 18:30 at weekends, plus or minus 15 minutes); use the random time picker and Shuffle Times; publish one post for real at the next slot | Posts land inside the right window on the right weekday, never on the same minute twice; the post goes out and shows on the platform | 13 |
| A-64 | Read TikTok's and Pinterest's developer pages for an AI label field (left `'none'` in Module 13, reported but not confirmed) | If one is confirmed, set its `aiLabel` to `'field'`, map it in its publish call, add a test row | 13 |

### Fairness, Money And Privacy

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-70 | Queue three AI runs; start one from the `low` priority workspace | The waiting line with a time; the `high` priority workspace goes first, and the `low` one still starts within its 30 minute ageing limit | 15 |
| A-71 | Compare the admin cost route with the AI provider's dashboard for the day | Within about a fifth of each other | 15 |
| A-72 | Search every log of the session for a sentence you know is in V1, and for your Twitch client secret | Not found | 16 |
| A-73 | Remove V1; look in the private bucket | No transcript, face file, still or emote export is left | 15 |
| A-74 | Open five clips made in Sprint 12 before this sprint | Unchanged; they export the same | 16 |
| A-75 | **AI Minutes check**: note the chip ("N of M AI minutes left"), run Add Captions on a 5 minute clip, a Find Clips run and a Look For Action run, then force one failure (stop the Python service mid run). Compare the chip and the operator Usage tab with the minutes of video the steps worked on | The meter equals the work done: each step charged the price shown before the press; the failed run gave its minutes back; a stretch listened to twice charged once; an Editor's use shows under the workspace's total | 15, 02, 05 |

### Creator Tools And Editor Seats

| Id | Do this | Expect | Module |
|---|---|---|---|
| A-80 | Emote Maker on a 3 second moment of V1: crop your face, Export For Twitch; then for BetterTTV | Three GIFs for Twitch (28, 56 and 112 px), each under 512 KB and at most 60 frames; nothing flickers; the sizes in bytes are written down. Remove Background on a green wall if you have one | 14 |
| A-81 | Export For 7TV; open the WebP, the APNG and the GIF | All three open and loop; decide which one 7TV should list first (set it in the profile) | 14 |
| A-82 | If Arvind says yes: upload the 112 px set to your own Twitch channel's emote page (Affiliate or Partner needed) | Twitch accepts the files, or its message is written down and the profile data is corrected | 14 |
| A-83 | Schedule Maker with your real Twitch username, in each of the five themes and both shapes | The week matches your Twitch schedule in your time zone; a cancelled segment shows Off; text fits its cell; the PNG is exactly 1080 by 1350 or 1920 by 1080. Then a username with no schedule | 14 |
| A-84 | Invite your second email as an Editor; accept it in another browser profile | The email names the role; the Editor lands on Clips Home; the seat line reads "1 of N editor seats used" | 14 |
| A-85 | As that Editor, confirm every denial in the matrix: open Channels, Analytics, SEO, Discover, Workflows, Billing, API Keys, Webhooks by address; try to schedule and Post Now from the composer; save a draft; make a clip, a design and an emote; then invite a third Editor past the seat limit from the admin side | Each denied page says "You do not have access to this page"; scheduling is absent and a direct request is refused; the draft, clip, design and emote work; the extra invite says "No editor seats left" | 14 |

## 5. Measurements To Write Down

| What | Value |
|---|---|
| Machine used (processor, memory, graphics card if any) | |
| A-01: seconds to listen to one minute of speech on this machine | |
| A-06: the same through the hosted lane, and its bill for V2 | |
| A-02, A-04, A-05: wrong words in a hundred (clear English; under game sound; Tamil; mixed) | |
| A-30: time and AI Minutes for a full run on V2 | |
| A-59: time and AI Minutes for Auto-Edit Video on V1 | |
| A-80: bytes of each Twitch and BetterTTV file, and the ladder rung each stopped at | |
| A-81: bytes of the 7TV WebP, APNG and GIF | |
| A-31: clips that stand on their own, out of eight | |
| A-33 and A-34: real action moments out of those found, with and without the vision check | |
| A-40: seconds to find faces in a one minute clip | |
| A-42: seconds of wrong framing in the clip | |
| A-56: minutes for eight exports | |
| A-71: AI cost for the whole test day | |

## 6. When Something Fails

Add a row to the log:

| Id | Test | What happened | Module | Fixed in | Re-tested |
|---|---|---|---|---|---|

Then open a fresh Claude Code session and paste:

```text
We are fixing a defect found in the Sprint 13 real test.

Read, in this order:
1. CLAUDE.md
2. docs/sprint-12/clips-implementation-docs/README.md and docs/sprint-13/clips-ai-implementation-docs/README.md (rules, names, decision logs)
3. docs/sprint-13/real-test-plan.md, test <ID>, and docs/sprint-13/real-test-log.md, row <ID>
4. docs/sprint-13/clips-ai-implementation-docs/module-NN-*.md (the module that owns the test)

The defect: <what happened, what was expected>.

Find the cause before changing anything, and tell me what it is in a few lines. Fix the cause, not the symptom. Add a test that fails without the fix (in simulation; record a new fixture from the failing case if that is what reproduces it, with no real speech or faces in it). Run verify-change. Write the fix in the Decision Log if it changes a decision, and fill the "Fixed in" cell of the log row. Do not commit or push unless I ask.
```

Quality problems (wrong words, a poor pick, a jumpy frame) are not always defects. For those, the fix session tunes the one file that holds the numbers (`signals/tuning.ts`, `reframe/tuning.ts`, the picker's prompt, the caption pager's limits), once, from your marks, and records the before and after.

## 7. Decisions This Test Settles

| Decision | From | Your call |
|---|---|---|
| Our own machine, the hosted lane, or `auto` for listening, and the threshold | A-01, A-06 | |
| The default speech model (`large-v3-turbo` or a smaller one) | A-01, A-02 | |
| Tamil captions on at launch | A-05 | |
| Look For Action's vision check on or off | A-33, A-34 | |
| Text To Speech on, off or parked | A-53 | |
| Which new sites stay on | A-60 | |
| Follow The Speaker on by default in Clip Setup, or off | A-42 | |
| The AI Minutes prices and the plan allowances (`clips.ai_minutes_per_month`) cover the bills | A-71, A-75 | |
| Editor seats on or off at launch, and the seat numbers per plan (`members.editors_max`) | A-84, A-85 | |
| The emote sizes and caps Twitch accepts (28, 56, 112 px, 512 KB, 60 frames) | A-80, A-82 | |
| Which file 7TV should list first (WebP, APNG or GIF) | A-81 | |
| Whether Editors may schedule one day (Module 17 item 19) | A-85 | |

## 8. Sign-Off

- [ ] Pass 1 is green for all sixteen modules, with `validate` and both e2e suites.
- [ ] Every Pass 2 test passed, or is listed in the log as accepted by Arvind with the reason.
- [ ] The measurements in section 5 are filled in.
- [ ] Every decision in section 7 is made, set in `.env.example` or in the operator Plans table (entitlement values), and written in the Decision Log.
- [ ] Sprint 12's clips are unchanged (A-74).
- [ ] The completion checklist exists (`docs/sprint-completion-checklists/sprint-13-completion-checklist.md`).

| | |
|---|---|
| Tested by | |
| Date | |
| Build (commit) | |
| Open items | |
