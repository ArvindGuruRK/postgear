# Sprint 12: Real Test Plan And Exit Gate

> **Status**: Written 2026-11-14, before the build; revised 2026-11-17 for the FFmpeg-only render and Preview Export, AI Minutes, My Channels, the open sound and sticker library, and the operator screen. Run it after Module 20 is done.
> **Who**: Arvind runs it by hand. Claude Code fixes what it finds, one defect per session.
> **Why**: every module is built and checked in simulation, where nothing touches a real platform. This plan is the first time real links, real long videos and real publishing are used. Sprint 13 does not start until the gate at the end is green.

## 1. How This Works

1. **Pass 1, simulation**: repeat every module's Hand Check in one sitting on the finished build, to catch what later modules broke in earlier ones.
2. **Pass 2, real**: the test table in section 4, with your own material. Write the outcome in the Result column of the log.
3. **Defect loop**: each failure gets a row in the log and a fix session (section 6). Re-run the failed test and the ones near it.
4. **Exit gate**: section 7. When every line is ticked, Sprint 13 may start.

Create `docs/sprint-12/real-test-log.md` when you begin and copy the tables into it; this plan stays clean.

## 2. Before You Start

| Need | How |
|---|---|
| The tools | `npm run clips:doctor` shows FFmpeg 9.0.2 (with libass, HarfBuzz and libx264), ffprobe, yt-dlp, its JavaScript runtime and the font manifest as OK. Run `npm run clips:fonts:build` first if the doctor says a font is missing |
| Real mode | In `.env`: `CLIPS_SIMULATION="false"`. Keep `PUBLISH_SIMULATION="true"` until test R-46 says to switch it |
| Storage | `STORAGE_PROVIDER="s3"` against MinIO from `docker compose` (or a staging R2 or S3 bucket pair if you have one), so the private space, the public library prefix and signed addresses are the real code path |
| AI | `AI_SIMULATION` stays `"true"`: Find Clips does not call an AI model in Sprint 12 (signals only). The AI minutes ledger is still the real one |
| Plans | `BILLING_SIMULATION="true"`; `ENTITLEMENTS_SOURCE="db"`; the seeded plan values are in the sprint doc |
| Channel lists | `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` from a dedicated Twitch application, and `CLIPS_YOUTUBE_API_KEY` from a separate Google project, for tests R-17 to R-19 only. Kick needs neither |
| Twitch chat | `CLIPS_TWITCH_CHAT="true"` for tests R-23 and R-24 only |
| The library | The seeded library (PostGear's own sounds and art, the Kenney packs and the Noto animated emoji) is installed, and `CLIPS_LIBRARY_INGEST` stays off. No Openverse or Freesound call is made unless Arvind has their written OK |
| The operator | `demo@postgear.local` (the seeded superadmin) on staging; on a production-like run put its address in `OPERATOR_EMAILS`. A second, ordinary account is the "not an operator" check |
| A second workspace | The seeded "PostGear Second Org", for the privacy tests and the override tests |
| A Free and a paid workspace | Billing simulation: put one workspace on Free and one on Pro |

**Your test material** (fill this in; use videos you own or have permission to use):

| Id | What | Link or file | Length |
|---|---|---|---|
| M1 | A YouTube video of yours, 5 to 15 minutes, with speech | | |
| M2 | A YouTube video of yours, an hour or longer | | |
| M3 | A YouTube Short of yours | | |
| M4 | A Twitch past stream, 2 hours or longer, with chat replay | | |
| M5 | A Twitch clip | | |
| M6 | A Kick past stream | | |
| M7 | A Kick clip | | |
| M8 | A recording on your disk, MP4, 500 MB or more | | |
| M9 | A recording on your disk in MKV or WebM | | |
| M10 | A video with no sound | | |
| M11 | A link to a private or members-only video | | |
| M12 | A link to a stream that is live right now | | |
| M13 | Your own Twitch channel (the name), with past streams and clips | | |
| M14 | Your own YouTube channel (the handle), with at least 50 uploads | | |
| M15 | A Kick channel with past streams (best effort; Kick may block us) | | |

## 3. Pass 1: Simulation

With `CLIPS_SIMULATION=true`. One row per module: do its Hand Check as written in its module doc.

| Module | Hand Check passed | Notes |
|---|---|---|
| 01 Contracts And Data | | |
| 02 Media Runtime | | |
| 03 Link Engine | | |
| 04 Import Pipeline | | |
| 05 Thin Slice | | |
| 06 Clips Home And Videos | | |
| 07 Manual Clipping And The Clips Library | | |
| 08 Editor Shell | | |
| 09 Timeline | | |
| 10 Layouts And Crops | | |
| 11 Canvas Handles And Text | | |
| 12 Stickers And GIFs | | |
| 13 Effects | | |
| 14 Sound | | |
| 15 Export | | |
| 16 AI Highlights | | |
| 17 Send To Composer | | |
| 18 Download In Any Format | | |
| 19 Retention, Quotas And Safety | | |
| 20 Hardening | | |

Also in this pass: `npm run validate`, `npm run test:e2e -- e2e/clips.spec.ts` and `npm run test:e2e -- e2e/operator.spec.ts` are green, and the FFmpeg parity tests run (not skipped) against the FFmpeg on this machine.

## 4. Pass 2: Real

Each test names the module that owns it, so a failure goes to the right document.

### Links And Import

| Id | Do this | Expect | Module |
|---|---|---|---|
| R-01 | Paste M1 | The link card within 10 seconds: picture, title, channel, length, "Video", YouTube badge | 03, 06 |
| R-02 | Paste M3, M5, M7 | Each card names its kind: "Short", "Clip" | 03 |
| R-03 | Paste M4 and M6 | "Past stream" with the right length | 03 |
| R-04 | Paste M11 | "This video is private or needs a login, so we cannot read it." and no Import button | 03 |
| R-05 | Paste M12 | "This stream is still live. Come back when it has ended." | 03 |
| R-06 | Paste a link from another site, and a YouTube channel link | The "we can only read" and the "channel or a list" sentences | 03 |
| R-07 | Import M1 without ticking the box | Not possible; the button is disabled | 06 |
| R-08 | Import M1 | Progress in words without a reload; ready; the bell says so; the time taken is written down | 04 |
| R-09 | Import M2, close the browser, come back in 10 minutes | The import carried on; the state is right | 04 |
| R-10 | Import M4 (2 hours or more) | Ready; time and stored size written down | 04 |
| R-11 | Import M6 | Ready | 04 |
| R-12 | Import M1 again | "You already have this video." | 04 |
| R-13 | Start importing M2 in another workspace and cancel at about 30% | It stops within seconds; no files are left (check the bucket) | 04 |
| R-14 | Upload M8; switch Wi-Fi off for 20 seconds half way | It carries on and finishes | 04 |
| R-15 | Upload M9 | Ready and playable | 04 |
| R-16 | Upload a renamed text file with an `.mp4` name | Refused with its sentence | 04, 02 |
| R-17 | Add M13 in **Streams**; browse its streams and clips; sort by Most Viewed; hide two rows, then **Show Hidden**; press **Import** on one past stream; look at a stream that is live (if any) | The channel is found by name; rows have picture, title, date, length and views; the list shows within 3 seconds; hidden rows come back; **Import** fills the link card and still needs the rights tick; a live stream has no Import; write down whether the list came from Helix or the fallback | 03, 06 |
| R-18 | Add M14 (the handle); open **Videos**, **Streams** and **Shorts**; scroll to the 50th row; import one | Newest first with the "YouTube lists newest first" hint; lengths and views are right; **Show More** works; the import works; note the quota used (the Google console shows it) | 03, 06 |
| R-19 | Add M15 (best effort); open **Streams** and **Clips**; import one | The list loads, or says "This channel's list is not available right now. Try again in a few minutes." and the paste box still works. Write down which | 03, 06 |

### Manual Clips And AI

| Id | Do this | Expect | Module |
|---|---|---|---|
| R-20 | On M2's page: play, jump, zoom the timeline, use Space, J, K, L | Smooth; the pictures and the sound's shape match the video | 07 |
| R-21 | Mark three ranges with I and O; Create Clip each time | Three drafts, drawn on the timeline | 07 |
| R-22 | Find Clips on M1 (speech, calm) | Either a few clips or the "no stand-out moments" sentence; AI minutes charged as the label said (0.25 for each minute of video, rounded up) and the chip went down by the same number | 16 |
| R-23 | Find Clips on M4 with chat on | Clips with "Chat exploded" among the reasons; watch five: are they real moments? Write a yes or no for each | 16 |
| R-24 | Find Clips on M6 | Works from sound and picture only | 16 |
| R-25 | Find Clips on M10 (no sound) | The no-sound sentence; no crash | 16 |
| R-26 | Run out of AI minutes and press Find Clips | Disabled with "This workspace has used all its AI minutes for this month. They reset on 1 December." and **See Plans**; nothing charged | 16 |
| R-27 | Press Find Clips twice quickly on M1, then stop the worker half way through another run and let it fail | One charge for the double press; the failed run gives its minutes back and says so | 16 |
| R-28 | Open M2 and press **Edit Whole Video** (it is over 30 minutes, so the button should be off); then use a video under 30 minutes | The long one says why; the short one opens the editor on one clip over the whole video | 07 |

### The Editor

| Id | Do this | Expect | Module |
|---|---|---|---|
| R-30 | Open a clip from M4; Vertical; try Split, then Gameplay (the game large, the face camera in a small rounded box), then Blurred with each Crop Ratio; boxes over the face camera and the game | Each layout looks right; the camera box is rounded in Gameplay; one is saved as a layout and applied to a second clip in one click | 08, 10 |
| R-31 | Trim both ends, split in the middle, delete a part, undo all, redo all | Every step right; autosave says Saved; reload keeps it | 09 |
| R-32 | Add text in three fonts, a sticker from each group, an animated emoji | Move, resize, turn, time them; they snap | 11, 12 |
| R-33 | In **Elements**, search the sticker library for "wow" and for three words of your own; narrow by category; star two stickers; open **Favourites**; add an animated one (a GIF) and a still one; look at one that needs a credit | Results come back by name and tag; categories narrow them; a search with no match says "Nothing found for ..." with categories; favourites show for every member of the workspace; the animated one moves in the editor and in Preview Export; the credit "i" shows its line; the **Credits** link lists the sources | 12 |
| R-34 | Add a zoom; set a part to 2x and another to 0.5x; give the clip the Cinematic and then the Black And White look; turn on Fade In and Fade Out | Text stays in place; the zoom stays on its moment; pitch sounds natural; the looks change the colour (the editor is close, the export may differ a little); the fades go to black and silence | 13 |
| R-35 | Add music at 20%, a sound effect, your own sound | Levels are as set | 14 |
| R-38 | In **Audio**, search sound effects and music by a word, narrow by category, star two sounds, open **Favourites**, and read the details line of one | Search and categories work; the music shelf says it is small; favourites are kept; the details line names the source, author and licence | 14 |
| R-39 | Use a library sticker and a library sound in a clip. In the operator screen **Hide** both. Reopen the clip, then export it. Then **Remove** the sticker, reopen the clip, and press **Export Clip** | After Hide: neither shows in search, but the clip still plays and exports with both. After Remove: "This sticker was removed from the library." on the item, and **Export Clip** asks before leaving it out | 12, 14, 19 |
| R-36 | Drag an end 40 seconds past the original range | "Getting more of the video", then it fills in | 09 |
| R-37 | Open the same clip in two browsers and edit in both | The second gets the "someone else changed this clip" sentence | 08 |

### Export, Posting And Download

| Id | Do this | Expect | Module |
|---|---|---|---|
| R-40 | Export the R-30 to R-35 clip at 1080p | Done; in Media with a picture and length; the panel showed "About N minutes left" while it ran; time taken written down | 15 |
| R-41 | Press **Preview Export** on the same clip, then play it and the real export side by side at five moments (the start, a zoom, a speed change, a sticker, the end) | Preview Export has the same layout, text, stickers, looks, zoom, speed and sound mix as the real export; only the size and sharpness differ. Write down any difference, and the time Preview Export took | 05, 15 |
| R-42 | Export a horizontal and a square clip | Right shapes | 15 |
| R-43 | On the Free workspace: pick 1080p; export at 720p | The lock dialog says "1080p export needs a higher plan."; the 720p export has the small mark | 15 |
| R-44 | Close the browser during an export | It finishes; the bell says so | 15 |
| R-45 | Send To Composer with TikTok, Instagram, YouTube, X and LinkedIn connected | Unfit channels show their reason; the draft opens with the clip | 17 |
| R-46 | With `PUBLISH_SIMULATION="false"`, publish one clip to one channel you own | It is live; the clip shows Scheduled, then links to the post | 17 |
| R-47 | Download M1 in 720p and as audio; on Free keep downloading until the day's limit | Files play; the Downloads row expires as it says; after the 5th download: "You have reached today's limit of 5 downloads. It resets at midnight UTC." | 18 |
| R-48 | Make a Preview Export of a clip, close the dialog, edit the clip, and look at the panel; then make one that fails (stop the worker) | After the edit: "You changed this clip after the last preview."; the failure says "We could not make the preview. Try again." and the clip is untouched | 15 |
| R-49 | Compare the **editor** with the real export at the same five moments as R-41 | The editor matches closely (colours of looks may differ a little, long text may wrap at another word, very slow or fast sound may be muted in the editor); anything bigger than that is a defect | 08, 15 |
| R-45b | In **Send To Composer** and in the composer's media picker (**Clips** tab, Select A Clip) pick an exported clip; open the **Coming Up** panel after scheduling | Both routes attach the clip; **Sort** and the list or grid switch work; the clip shows as Scheduled; **Coming Up** lists the post with **View Calendar** | 17 |

### Limits And Safety

| Id | Do this | Expect | Module |
|---|---|---|---|
| R-50 | On Free, paste a video longer than an hour | The too-long sentence with See Plans | 19 |
| R-51 | Copy a video's playing address and open it in a private window after its expiry time | Refused | 02 |
| R-52 | In the second workspace, open the first workspace's video, clip and job addresses | Not found | 19, 20 |
| R-53 | Set a video's `expiresAt` to yesterday and wait for the cleanup | Removed; exported clips still in Media; the notice was sent | 19 |
| R-54 | Set `CLIPS_PLATFORMS="twitch,kick"` and paste a YouTube link | The paused sentence; M4 still works | 03 |
| R-55 | Remove a video with the operator route | Gone; the admins' notice | 19 |
| R-56 | As the operator, open `/operator`, **Plans**, and change `clips.max_video_minutes` for Free from 60 to 90 (a reason, **Review Changes**, **Save Changes**). On the Free workspace paste an 80 minute video, then a 100 minute one. Then set it back to 60 | Within seconds the 80 minute video shows **Import Video** and the 100 minute one is refused with "This video is longer than your plan allows (90 minutes). Upgrade the plan to bring in longer videos."; after the reset the 80 minute one is refused again with the 60 minute sentence; no restart was needed | 19, 01 |
| R-57 | Add an override for the second workspace: `clips.ai_minutes_per_month` set to 2,000, ending tomorrow, with a reason. Check its chip. Then in the database set `expiresAt` to a minute ago and check again | The chip reads "N of 2,000 AI minutes left" while the override runs and goes back to the plan's value after it ends, with no restart; the workspace's used minutes are unchanged; a start row and an end row are in the Change Log | 19, 01 |
| R-58 | Read the **Change Log** after R-56 and R-57; try to edit or delete a line; open `/operator` as an ordinary account and as a signed-out visitor | Each change has When, Who, What, Old, New and Reason; nothing can be edited; the other two see the ordinary "not found" page | 19 |
| R-59 | After R-22, R-27 and an import: compare the **Usage** tab's entries with the work done (the video length, the 0.25 rate, the double press, the failed run) | Minutes used equal the work done; the double press is one entry; the failed run has a reversal that nets it to zero; the import was charged at the video's length and reversed for a cancelled import (R-13) | 19, 04, 16 |
| R-60 | Lower a plan value below what a workspace uses (Free `clips.storage_gb` to 1 with 3 GB of videos in the Second Org), then raise it again | Nothing is deleted; new imports are refused with "Your videos use 3 GB, over your plan's 1 GB. Delete some, or upgrade, to bring in more."; exports of existing clips still work; raising it again lets imports resume | 19, 04 |

## 5. Measurements To Write Down

These numbers set the plan limits and the hosting size.

| What | Value |
|---|---|
| Machine used (CPU, memory) | |
| R-08: import time for M1, and its stored size | |
| R-10: import time for M4, and its stored size | |
| R-23: Find Clips time on M4 | |
| R-23: real moments out of the five watched | |
| R-40: export time for a clip of N seconds at 1080p | |
| Memory use of the worker during an export | |
| Did YouTube show a bot check at any point? When? | |
| R-17 to R-19: time to the first page of a channel list, and which route answered (Helix, YouTube Data API, the fallback) | |
| R-18: YouTube quota units used for adding the channel and paging 50 rows | |
| R-59: AI minutes and import minutes charged against the work done (a one line check per run) | |
| Sound and sticker searches tried and how many found at least one result | |

**FFmpeg render speed table.** Render the same 45 second clip (a vertical clip with the Gameplay layout, two stickers, two text items with outlines, a zoom, one 2x part, music, a look and fades) at each setting on the real host, with nothing else running, and write down seconds taken and the "times real time" figure (clip seconds divided by seconds taken). The first column is what the cookbook measured on a busy laptop at `veryfast`, for comparison. Then set the plan values and the planning figure from your numbers.

| Setting | Laptop figure (cookbook) | Seconds taken here | Times real time here | Worker memory |
|---|---|---|---|---|
| 720p, 30 fps | about 1.0 times real time | | | |
| 720p, 60 fps | not measured | | | |
| 1080p, 30 fps | about 0.7 | | | |
| 1080p, 60 fps | about 0.4 | | | |
| Preview Export (about 360 pixels wide) | about 2.4 | | | |
| A caption-heavy clip (the same clip with 40 lines of text) at 1080p, 30 fps | not measured | | | |
| A 30 minute clip made by Edit Whole Video at 720p, 30 fps | not measured | | | |

Until the host is measured, the planning figure is 1.5 to 3 times the clip's length at 1080p30 and 2.5 to 5 times at 1080p60, on a shared 4 to 6 core machine.

## 6. When Something Fails

Add a row to the log:

| Id | Test | What happened | Module | Fixed in | Re-tested |
|---|---|---|---|---|---|

Then open a fresh Claude Code session and paste:

```text
We are fixing a defect found in the Sprint 12 real test.

Read, in this order:
1. CLAUDE.md
2. docs/sprint-12/clips-implementation-docs/README.md (rules, names, decision log)
3. docs/sprint-12/real-test-plan.md, test <ID>, and docs/sprint-12/real-test-log.md, row <ID>
4. docs/sprint-12/clips-implementation-docs/module-NN-*.md (the module that owns the test)

The defect: <what happened, what was expected>.

Find the cause before changing anything, and tell me what it is in a few lines. Fix the cause, not the symptom. Add a test that fails without the fix. Run verify-change. Write the fix in the Decision Log if it changes a decision, and fill the "Fixed in" cell of the log row. Do not commit or push unless I ask.
```

A defect that changes the design (not just the code) is written in the sprint doc's Deviations section too.

## 7. Exit Gate To Sprint 13

- [ ] Pass 1 is green for all twenty modules, with `validate` and both e2e suites.
- [ ] Every Pass 2 test passed, or is listed in the log as accepted by Arvind with the reason.
- [ ] One clip from each platform (YouTube, Twitch, Kick) and one upload went from link to a published post. If Kick or a channel list was blocked (R-19), the log says so and the paste route worked.
- [ ] Preview Export matches the real export (R-41) for layouts, text, stickers, looks, zoom, speed and sound, and the editor matches closely (R-49).
- [ ] The operator tests passed (R-56 to R-60): a plan value changed and the next check obeyed it, an override with an end date was obeyed and ended, the Change Log has every change, a non-operator sees "not found", and the AI minutes and import minutes equal the work done.
- [ ] The library tests passed (R-33, R-38, R-39): search, categories and favourites work, every item shows its licence evidence, and a hidden item does not change an existing clip.
- [ ] The measurements in section 5, including the FFmpeg render speed table, are filled in, and the plan values in `/operator` (the Clips group) were set from them.
- [ ] **The screenshot coverage audit**: [`research/13-screenshot-coverage.md`](research/13-screenshot-coverage.md) was re-read against the finished build and every one of the 48 screens is still Covered, Existing, Parked or Not Planned, with no new gap. Any gap found is written in the log.
- [ ] No open defect touches the clip document, the time map, `frameState`, storage keys, the job table, the usage ledger, the entitlement keys or the queue names (Sprint 13 builds on all of them).
- [ ] The completion checklist exists (`docs/sprint-completion-checklists/sprint-12-completion-checklist.md`, written by `sprint-closeout`).
- [ ] The branch is merged, or Arvind has named the branch Sprint 13 is cut from.

## 8. Sign-Off

| | |
|---|---|
| Tested by | |
| Date | |
| Build (commit) | |
| Open items carried to Sprint 13 | |
