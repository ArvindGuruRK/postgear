# Sprint 13 Research: Reference Features

> **Written**: 2026-11-14. Screens are described from the local screenshots (gitignored, on this machine only). Web facts marked **verified** were fetched by Claude on that day; **reported** means a secondary source or a page that could not be read. Nothing is copied from OpusClip or StreamLadder: this file records what a person sees, never how it is built.
> **Scope**: every OpusClip and StreamLadder feature that Sprint 12 does not ship, and who owns it in Sprint 13. Module numbers are the 16 modules of the approved plan (2026-11-14).

## 1. What Sprint 12 Already Covers

Paste a YouTube, Twitch or Kick link or upload a file; Streams and Clips libraries; manual clipping; the editor with layouts (Fullscreen, Blurred, Split), crops, text, stickers and GIFs, zoom and speed, sound effects and music; export presets; AI highlights from signals (loudness, scene change, chat spikes); Send To Composer; Download In Any Format. None of that is repeated below.

## 2. Screenshot Key

| Key | File | Shows |
|---|---|---|
| O1 | [opusclip/01](../../screenshots/opusclip/01-landing-paste-link-supported-sources-tooltip.png) | Landing page, the supported-sources tooltip |
| O2 | [opusclip/02](../../screenshots/opusclip/02-home-clip-long-video-youtube-link-recipe-chips.png) | Home: three tabs, link box, recipe chips |
| O3 | [opusclip/03](../../screenshots/opusclip/03-editor-uploading-9x16-ai-enhance-panel.png) | Editor in 9:16 with the AI Enhance panel |
| O4 | [opusclip/04](../../screenshots/opusclip/04-editor-processing-16x9-ai-enhance-panel.png) | Editor in 16:9, processing |
| O7 | [opusclip/07](../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png) | Clip Setup: recipe, captions, hook, credit summary |
| O8 | [opusclip/08](../../screenshots/opusclip/08-clip-setup-ratio-and-ai-layouts-picker.png) | Clip Setup: ratio and AI layouts picker |
| S8 | [streamladder/08](../../screenshots/streamladder/08-clip-editor-effects-zoom-speed-censor-silences-hook.png) | Editor, Effects list |
| S9 | [streamladder/09](../../screenshots/streamladder/09-clip-editor-audio-sound-effects-music.png) | Editor, Audio tab |
| S10 | [streamladder/10](../../screenshots/streamladder/10-clip-editor-ai-captions-styles-language.png) | Editor, AI captions |
| S13 | [streamladder/13](../../screenshots/streamladder/13-publisher-new-post-share-to-caption-facebook-reels.png) | Publisher, New Post |
| S14 | [streamladder/14](../../screenshots/streamladder/14-publisher-new-post-ai-content-disclosure.png) | Publisher, AI disclosure switch |
| S15 | [streamladder/15](../../screenshots/streamladder/15-publisher-when-menu-next-available-now-schedule.png) | Publisher, the When menu |
| S16 | [streamladder/16](../../screenshots/streamladder/16-publisher-schedule-date-time-random-time-of-day.png) | Publisher, Schedule Post dialog |
| S21 | [streamladder/21](../../screenshots/streamladder/21-publisher-save-title-template-popover.png) | Publisher, Save Title Template |
| S22 | [streamladder/22](../../screenshots/streamladder/22-publisher-create-template-colour-name-text.png) | Publisher, Create A New Template |
| S23 | [streamladder/23](../../screenshots/streamladder/23-publisher-posting-slots-21-a-week-generated.png) | Posting slots, generated week |
| S24 | [streamladder/24](../../screenshots/streamladder/24-publisher-posting-slots-exact-times-plus-minus-window.png) | Posting slots, exact times |
| S26 | [streamladder/26](../../screenshots/streamladder/26-montage-maker-locked-upgrade.png) | Montage Maker, locked |
| S27 | [streamladder/27](../../screenshots/streamladder/27-schedule-maker-twitch-username-gate.png) | Schedule Maker |
| S28 | [streamladder/28](../../screenshots/streamladder/28-clip-downloader-paste-twitch-or-kick-clip-url.png) | Clip Downloader and the tool grid |
| S29 | [streamladder/29](../../screenshots/streamladder/29-emote-maker-twitch-clip-to-emote.png) | Emote Maker |

## 3. OpusClip Features Left After Sprint 12

"Bolt" means the yellow lightning mark OpusClip puts on features that cost extra credits.

| Feature | What The User Sees | How It Is Presented | Owner |
|---|---|---|---|
| Clip Setup screen | One page between "paste" and "processing": source card on top, settings in the middle, a Summary column on the right with one Create button ([O7]) | The only step before work starts; nothing runs until Create | Module 05 |
| Adjust range (Credit Saver) | A filmstrip with two handles and three time boxes (start, length, end); the words "Credit saver" beside it ([O7]) | Trimming the range lowers the processing charge before any money is spent | Module 05 |
| Speech language | "Speech language: Auto" dropdown on the source card ([O7]). The landing tooltip names English, German, Spanish, French, Portuguese "and other 20 more" ([O1]) | Auto by default | Module 02 (detect), shown in Module 05 |
| Genre | "Genre: Auto" dropdown beside it ([O7]) | Auto by default, a hint to the picker | Module 05 (a prompt hint, no model of its own) |
| Upload SRT | A quiet "Upload SRT" link beside Layout ([O7]) | Skips transcription when the person has captions | Module 02 (import as a transcript) |
| AI picks | "AI picks: Auto" dropdown under Clipping ([O7]) | How many clips to return | Module 05 |
| Clip length | "Clip length: 30s~59s" dropdown ([O7]) | A range, not one number | Module 05 |
| Moments to include | An optional text box with an example and a "How to prompt" help link ([O7], [O8]) | Free text that steers the picker | Module 05 |
| Ratio picker | Four tiles: 9:16, 16:9, 1:1, 4:5, one ticked ([O8]) | Inside the Layout popover | Module 05 (Sprint 12 documents already carry a ratio) |
| Layouts AI can use | Seven ticked thumbnails: Fill, Fit, Split, Three, Four, Screen Share, Gameplay ([O8]) | Multi-select: the AI may pick any ticked layout per clip | Module 05 (picker), Modules 07 and 08 (Fill, Fit, Split, Gameplay). Three, Four and Screen Share: P2, they need speaker counting |
| Fit layout crop ratio | Three tiles: Original, 4:3, 1:1 ([O8]) | Only applies to Fit | Module 05 (a setting on Sprint 12's Blurred layout) |
| Recipes | A "Recipe: Clip long video" dropdown with collapsible "Recipe settings" ([O7]); chips on Home: Clean Up Recording, Auto-Edit Talking Videos, Captions, Reframe, Upscale, Social Edits, AI B-Roll, Translate And Dub, See All Recipes ([O2]); "Recipe updates? Save" when settings changed ([O8]) | A recipe is a saved set of switches; "Your Recipe sets which edits run" | Module 10 |
| Brand kit | A "Brand kit: No brand kit" dropdown beside Recipe ([O7]); a Brand Kit rail item ([O2], [O3]) | "Your brand kit sets the look, like your logo, intro, outro and caption style" | Module 10 (extends the `BrandKit` model Studio already has) |
| AI captions and styles | A Captions switch (on), then a scrolling row of animated style tiles: Word Cut, Marker Sweep, Negative Keywords, Karaoke; the chosen tile says Selected ([O7]) | Under "Essentials", shown as Free in the Summary | Module 03 |
| Caption translation | A switch with a language dropdown ("English") in the Translate group ([O7]) | No bolt: no extra credits | Module 03 |
| Voice dubbing | A switch with "Choose a language" ([O7]); "Video dubbing" in AI Enhance ([O3]) | Bolt | P2 (Module 16) |
| Auto hook, headline styles | A switch marked Beta with a "Headline" dropdown and three portrait tiles: Editorial, Statement, Classic ([O7]) | Listed as "Headline, Free" in the Summary | Module 09 (hook intro title; three styles to match) |
| Voiceover hook | "Auto generate voiceover hook" in AI Enhance ([O3]) | One click | Module 09 (hook title plus text to speech; the "auto" pairing is P2) |
| Motion graphics | A switch marked Beta ([O7]) | Bolt | Not Planned: generated motion templates are a product of their own |
| AI emojis | A switch ([O7], [O3]) | Free | P2 (cheap once captions exist: one model call picks emoji from Sprint 12's own pack) |
| AI keywords highlighter | A switch in AI Enhance ([O3]); the "Marker Sweep" and "Negative Keywords" styles show it ([O7]) | Free | Module 03 (a style property; the words come from one model call) |
| Auto B-roll | A switch with an "AI video B-roll" dropdown ([O7]); a B-Roll rail tab ([O3]) | Bolt. Stock and AI image clips are capped per plan | P2 (Module 16) |
| Speech cleanup | A switch with "Remove pause and filler words" ([O7]); in the editor a Speech Cleanup button over the transcript and three actions: Remove Filler Words, Remove Pauses, Remove Bad Takes ([O3]) | Group "Sound sharp" | Module 04 (pauses, filler). Remove Bad Takes: P2 |
| Enhance audio | A switch ([O7]); "Speech enhancement" in AI Enhance ([O3]) | Bolt, capped per day on Pro | P2 (Sprint 12 already runs a loudness pass on export) |
| Auto sound effects | A switch ([O7], [O3]) | Bolt | P2 |
| Auto zoom | A switch in "Look good" ([O7]) | Free | P2, after Module 08 (it would write the same zoom keyframes) |
| Auto transitions | A switch ([O7], [O3]); a Transitions rail tab | Free | P2 (Sprint 12 has no transition between segments yet) |
| Auto colour correction | A switch ([O7], [O3]) | Free | Not Planned: easy to make footage worse, hard to test |
| Eye contact correction | A switch in AI Enhance ([O3]) | Pro only | P2 (Module 16); needs a generative face model and a GPU |
| Auto censor | An action in AI Enhance ([O3]) | One click | Module 09 (word censoring) |
| Upscale | A recipe chip on Home ([O2]) | Starter and up | Not Planned: GPU super-resolution, high cost per minute |
| Reframe with tracking | Top-bar chips "9:16", "Layout: Fill", "Track: ON" ([O3], [O4]) | Tracking is a switch on the clip | Modules 07 and 08 |
| Transcript editing pane | The left half of the editor is the transcript, with search, filter and download icons ([O3]) | Text and timeline side by side | Module 04 |
| Virality score | A score on each clip (opus.pro/pricing, verified 2026-11-14: Starter and up) | Paid | Module 05, named Clip Score with its reasons (the `Clip` row already has `score` and `reasons`) |
| Reprompt clipping | Run the picker again with a new prompt (opus.pro/pricing, verified 2026-11-14) | Starter and up | Module 05 (re-uses the stored transcript, no second transcription) |
| Clipping by sight and sound | "Multi-source clipping (visual objects, sound, emotion, genre curation)" (opus.pro/pricing, verified 2026-11-14) | Pro | Module 06 |
| Credit summary | Summary lines per feature ("Video processing 10 credits", Clipping Free, Captions Free), "Premium features: Applied to top 10 clips", Total, Create, an amber "Not enough credits. You need 10 more." with Add Credits, and "By continuing, you confirm you have rights to use this video." ([O7]) | The price is shown before the click | Module 05 |
| Auto-import | New videos from a verified YouTube account are clipped by themselves (opus.pro/pricing, verified 2026-11-14) | Starter and up | P2 (Module 16) |
| Brand vocabulary | Names and terms the transcriber must spell right (opus.pro/pricing, verified 2026-11-14) | Pro | Module 02 (word list passed to the transcriber), stored on the brand kit in Module 10 |
| Speaker caption colours | One colour per speaker | "Coming soon" on their page | P2 (needs speaker diarisation) |
| Custom fonts | Upload up to two fonts | Pro | Not Planned: only open-licence fonts ship in PostGear |
| Auto-Edit Footage, Open Editor tabs | Two more Home tabs ([O2]) | Entry points | Not Planned as tabs; "auto-edit" is a recipe in Module 10 |
| XML export, API, team seats | Premiere and DaVinci export, a public API (opus.pro/pricing, verified 2026-11-14) | Pro and Business | Not Planned |

## 4. StreamLadder Features Left After Sprint 12

"Diamond" is StreamLadder's mark for a paid feature.

| Feature | What The User Sees | How It Is Presented | Owner |
|---|---|---|---|
| AI-powered captions | A Captions tab: "Select the spoken language" (Automatically Detect), then style tiles grouped All Styles, Popular, Cozy, each with View All ([S10]) | Diamond on the panel title | Module 03 |
| Custom caption styles | A "Create a style" tile above the presets ([S10]) | First in the list | Module 03 |
| AI word censoring | "Make your videos TikTok friendly" ([S8]) | Diamond | Module 09 |
| Text to speech | "Turn your text into speech" ([S8]) | Diamond | Module 09 |
| AI remove silences | "Remove silent moments from your clip" ([S8]) | Diamond | Module 04 |
| AI hook intro title | "Adds a intro hook title to the start of your clip" ([S8]) | Diamond | Module 09 |
| Add a hook clip | "Pick the moment that plays first", marked New ([S8]) | No diamond | Module 09 |
| Effects (special effects) | "Add special effects to your video", marked New ([S8]) | Diamond | P2: a visual effects pack is content work, not AI |
| Montage Maker | A grid of exported clips behind a lock: "Stitch your exported clips into one video." ([S26]) | Paid | Module 11 |
| Emote Maker | Paste a Twitch clip, drag a square crop, pick a short range, preview the emote and a chat, export for Twitch, 7TV or BTTV ([S29]) | A free side tool | P2 (Module 16) |
| Stream Schedule Maker | Asks for a Twitch username, then themes and a weekly "Catch Me Live" image ([S27]) | A free side tool | P2 (Module 16); a Studio template would do the same job |
| Clip Downloader | Twitch, YouTube and Kick clip links ([S28]) | A free side tool | Sprint 12 Module 18; more sites in Module 12 |
| AI disclosure switch | "AI Generated Content Disclosure: Disclose if your video was generated or edited by AI." with Yes and No, under the Facebook Reels section ([S14]) | Per platform, default No | Module 13 |
| Caption and title templates | "Save or select template" under the caption and under each title ([S13]); a popover to name it ([S21]); a dialog with 20 colour dots, name and text, Save and Save And Apply ([S22]) | "Quickly save and reuse your favorite titles and hashtags" | Module 13 |
| When menu | Next Available ("Use the next free slot in your schedule"), Now, Schedule, and Manage Posting Schedule; the main button changes to Post Now or Schedule Post ([S15]) | One split control in the footer | Module 13 |
| Schedule dialog | A month calendar, "Scheduled on this day" with that day's free slots, Choose A Time, and Pick A Random Time: Morning, Noon, Afternoon, Evening ([S16]) | A sentence confirms the date, time and zone | Module 13 |
| Posting slots, generated | A slider from a snail to a flame reading "21x a week"; "Your week, generated" as seven columns of "+/- 7:50 AM" chips; Shuffle Times ([S23]) | A note says each post goes out at a natural minute inside the window, never on the hour and never two at once | Module 13 |
| Posting slots, exact | Rows of a time, a "+/-15 min" window and seven weekday chips; Add Another Time; Back To Suggested Times ([S24]) | The manual mode behind "Set exact days and times" | Module 13 |
| Editors | A Team group with "Editors", marked New ([S13], [S26]); "Invite editors to clip, edit and schedule with you on Pro" (streamladder.com, verified 2026-11-14) | Pro | P2 (Module 16) |
| Best posting times | "Find your best posting times automatically" (streamladder.com, verified 2026-11-14) | Analytics | P2 (needs real engagement data per channel) |
| Mention someone | A button under the caption ([S13]) | Per platform | Not Planned: needs each platform's people search |
| Mobile app | iOS and Android apps (streamladder.com, verified 2026-11-14) | Free download | Not Planned: Clips is desktop only |

### 4.1 What PostGear's Scheduler Already Has (Checked In The Code 2026-11-14)

Module 13 adds to this; it does not start from nothing. PostGear's "publisher" is the Composer, so these upgrades help every post, not only clips.

| Already There | Where | What Module 13 Adds |
|---|---|---|
| Posting times per channel: a list of minutes since local midnight, the same every day, 1 to 48 entries, default 02:00, 06:40 and 11:40 | `Integration.postingTimes` (JSON in a text column), `channels/dto/channels.schema.ts`, `PostingTimesDialog` | Weekdays and a +/- window on each time (the dialog's own comment names the missing weekday grid as a known limit). Old rows read as every day, window 0 |
| Next free slot: the first posting time at least 5 minutes ahead with no queued post within a minute of it, read in an IANA time zone, looking up to 366 days ahead | `nextFreeSlot()` in `packages/automation/src/queue/next-free-slot.ts`, used only by the workflow step Add To Queue (`when: 'nextSlot'`) | The same function offered in the Composer as Next Available, and a natural minute inside the window: never on the hour, never two posts in one minute |
| Composer footer: a date and time picker, Save As Draft, Add To Calendar, and a chevron with Post Now | `components/composer/composer.tsx` | The three-way When menu (Next Available, Now, Schedule) and a random time by part of day |
| The channel's times offered when rescheduling, and drawn as rows in the calendar's day view | `posts/reschedule-dialog.tsx`, `calendar/day-view.tsx` | The window shown on those rows |
| Signatures: saved text blocks inserted in the Composer, one can be the default | `Signatures` model, Settings, `composer/editor-inserts.tsx` | Caption and title templates with a colour. They can extend Signatures or be a new model (Module 13 decides) |
| Per-channel post settings (YouTube title, privacy, made for kids; TikTok privacy and comment switches) | `packages/social-core/src/providers/*` | An AI disclosure setting; no provider has one today |
| Generated week, Shuffle Times | Not there | New |

## 5. More Link Sources (Module 12)

OpusClip's tooltip reads: "For Pro plan, we support videos from: YouTube, Google Drive, Vimeo, Zoom, Rumble, Twitch, Facebook, LinkedIn, Twitter, Loom, Riverside, StreamYard and more" ([O1]). The yt-dlp column is from `supportedsites.md` on the master branch (raw.githubusercontent.com/yt-dlp/yt-dlp/master/supportedsites.md, verified 2026-11-14). An extractor existing does not mean it works on every link: Module 12 repeats Sprint 12's real-network spike for each site it adds.

| Source | yt-dlp Extractor | What To Expect | Verdict For Module 12 |
|---|---|---|---|
| YouTube, Twitch, Kick | `youtube`, `twitch:vod`, `twitch:clips`, `kick:vod`, `kick:clips` | Shipped in Sprint 12 | Already in |
| Vimeo | `vimeo` | Public videos; private and password links need a login (reported) | **Add** |
| Rumble | `Rumble` (also `RumbleEmbed`, `RumbleChannel`) | Public videos | **Add**, the single-video extractor only |
| Loom | `loom` (`loom:folder` is marked Currently Broken) | Share links | **Add**, single videos only |
| Zoom | `zoom`, `zoom:clips` | Cloud recording share links; passcode links may fail (reported) | **Add, best effort** |
| X | `twitter` (also `twitter:broadcast`, `twitter:spaces`) | Public posts; some need a login (reported) | **Add, best effort**, posts only |
| Facebook | `facebook`, `facebook:reel` | Public videos and reels; login walls are common from server addresses (reported) | **Add, best effort** |
| LinkedIn | `LinkedIn` | Public posts only | **Add, best effort** |
| Google Drive | `GoogleDrive`, `GoogleDrive:Folder` | Only files shared by link. A private file needs the owner's permission | **OAuth file picker**: Google Picker with the `drive.file` scope, then a download through the Drive API by the Node worker. Keep the yt-dlp extractor for "anyone with the link" files |
| Riverside | none | No public link form | **Upload** (their own export) |
| StreamYard | none | No public link form | **Upload** |
| Public MP4 address | `generic` (blocked by Sprint 12's allowlist) | OpusClip Pro takes a "public mp4 URL" | **Add as a direct file fetch** through `assertSafeUrl` and ffprobe, not by opening `generic` |
| Dropbox, Dailymotion | `Dropbox`, `dailymotion` | Share links, public videos | **Add** (cheap, low risk) |
| TikTok, Instagram | `TikTok`, `Instagram` (`instagram:user` is marked Currently Broken) | Heavy bot checks; mostly other people's videos | **Downloader only, behind a switch** (see the open question) |

**Open question for Arvind**: should the downloader take TikTok and Instagram links? They are the most asked-for "download" sources and the ones most likely to be someone else's video. Recommendation: ship them behind `CLIPS_EXTRA_SOURCES`, off by default, with the same rights tick, and decide after the Sprint 12 real-test pass.

**Open question for Arvind**: Google Drive needs the Drive API switched on in the Google Cloud project and a consent-screen change. Recommendation: `drive.file` only (the person picks each file, PostGear never sees the rest of the Drive), which Google lists as a non-sensitive scope (reported; confirm in the console).

## 6. Pricing And Plans Read Today

### 6.1 OpusClip (opus.pro/pricing, verified 2026-11-14)

| | Free | Starter | Pro | Business |
|---|---|---|---|---|
| Price a month | $0 | $15 | $29 | Custom |
| Watermark | Yes | No | No | No |
| Export window | 3 days, up to 1080p | 30 days | No limit | No limit |
| Clipping | Spoken word only, 9:16 only | Adds reprompt, virality score, speech cleanup, upscale, custom reframing, text and timeline editing | Adds clipping by sight and sound, prompt-to-clip, object tracking, eye contact, transitions, dubbing, AI sound effects, bulk export, 4K | Adds SSO, analytics, sub-teams, a dedicated queue |
| AI B-roll | No | 3 AI image and 3 stock clips a month | 50 AI image clips a day, unlimited stock, AI video B-roll | Same as Pro |
| Brand templates | 1 | 1 | Up to 4 | Custom |
| Link sources | Upload (10 GB) and YouTube | Adds Google Drive, Vimeo, Zoom, Rumble, StreamYard | Upload to 30 GB, public MP4 address, "many more platforms" | Same as Pro |
| Posting | No | YouTube Shorts, TikTok, Instagram | Scheduler, plus Facebook, LinkedIn, X, Pinterest, Threads, Bluesky | Same as Pro |
| Team | No | No | 2 users a pack, up to 4 | Unlimited |
| Storage | Expires after 3 days | Expires after 29 days | 100 GB | Custom |

**Credits**: the pricing page asks "How many credits do you need?" but did not define a credit in the text read today. Secondary sources say one credit is one minute of processed video, with Free at 60, Starter at 150 and Pro at 300 credits a month (reported). The Clip Setup screenshot agrees with the one-minute rule: a 10:39 video is priced at "Video processing: 10 credits" while Clipping, Captions and Headline are each "Free", and bolt features are "Applied to top 10 clips" ([O7]).

### 6.2 StreamLadder

The pricing address redirects into the app and returned no text on 2026-11-14, so prices are **reported**. The home page (streamladder.com, verified 2026-11-14) names four plans and no prices: Free (clip editor, converter, downloader; "Basic editing never adds a watermark, on any plan"), Starter (Content Publisher), Creator (ClipGPT), Pro (4K 60 fps export, posting to X, workspaces for editors), with a 7-day trial. Secondary sources disagree on prices: Starter $15, Creator $27 and Pro $39 a month in one; older Silver $9 and Gold $15 tiers in another (both reported). No credit model is described anywhere: AI clip finding is unlocked by the plan, not metered (reported). In the screenshots every Effects entry except Add A Hook Clip, the Audio tab and AI captions carry the diamond ([S8], [S9], [S10]), and Montage Maker is locked ([S26]).

### 6.3 What Their Credit Models Teach Our Pricing

1. **Charge the source minute, once.** OpusClip prices the processing of the video and gives clipping, captions and the headline away. The transcript is the cost; everything built on it is nearly free. Our price should follow our cost the same way.
2. **Show the bill before the click.** The Summary column with a line per feature and a clear shortfall message is the pattern to copy ([O7]).
3. **Let people pay less by trimming.** "Credit saver" turns the range picker into a price control.
4. **Cap the expensive extras per clip, not per video.** "Applied to top 10 clips" keeps bolt features from multiplying with clip count.
5. **A flat plan with no meter is the other model.** StreamLadder sells tiers. It is simpler to explain and it invites heavy use, which only works when the cost per hour is very low (signals in Sprint 12, self-hosted transcription in Sprint 13).
6. **Minutes are easier to grasp than credits.** PostGear's credits already mean "AI text and images". `07-cost-deploy-and-risks.md` weighs a separate minutes allowance against sharing that balance.

## 7. The Sprint 13 Cut

| # | Module | Features It Takes |
|---|---|---|
| 01 | Media Service Foundations | None a person sees; the Python service every row below needs |
| 02 | Transcription | Speech language (auto and manual), word timings, Upload SRT, brand vocabulary |
| 03 | Captions Track And Styles | AI captions, style presets (word-by-word, karaoke, marker sweep), custom styles, keyword highlighter, caption editing, caption translation |
| 04 | Transcript Editing And Speech Cleanup | Transcript pane, delete words to cut, remove silences, remove filler words |
| 05 | Clip Setup And AI Highlights V2 | Clip Setup screen, adjust range, genre, AI picks, clip length, moments prompt, ratio, layouts AI can use, fit crop ratio, credit summary, Clip Score with reasons, reprompt |
| 06 | Visual Moments | Motion and "fail" detection, a vision check on candidates |
| 07 | Face Detection And Facecam Detect | Face boxes, facecam region for Split and Gameplay |
| 08 | Auto-Reframe | "Track: On", smoothed face-following crops, Fill and Fit |
| 09 | AI Effects | Word censoring, hook intro title (Editorial, Statement, Classic), hook clip, text to speech |
| 10 | Recipes And Brand Kit | Recipes with saved switches, recipe chips on Clips Home, brand kit (logo, caption style, intro and outro) |
| 11 | Montage And Batch Export | Montage Maker, export many clips at once |
| 12 | More Sources And Platforms | Vimeo, Rumble, Loom, Zoom, X, Facebook, LinkedIn, Dropbox, Dailymotion, direct MP4, Google Drive picker, the downloader for more sites |
| 13 | Publisher Upgrades | Next Available, weekly posting slots with a +/- window and Shuffle Times, random time of day, AI disclosure switch, caption and title templates with colours |
| 14 | Scale, Cost And Deploy | Nothing a person sees: GPU option, queues, cost numbers |
| 15 | Hardening, E2E, Closeout | Nothing new |
| 16 | P2 Backlog | See section 8 |

## 8. Parked For Later

| Feature | Verdict | Reason |
|---|---|---|
| Voice dubbing | P2 | Voice cloning raises consent and rights questions, and a good voice is a paid API |
| Auto B-roll | P2 | Stock licences or generated video; cost per clip is high |
| Eye contact correction | P2 | Generative face edit, GPU only, uncanny when it fails |
| Emote Maker, Stream Schedule Maker | P2 | Streamer-only side tools; Schedule Maker fits Studio better |
| Auto-import from a channel | P2 | Needs polling and a spend guard so it cannot burn an allowance unattended |
| Editor roles | P2 | A change to workspace permissions, wider than Clips |
| AI emojis, auto zoom, auto transitions, auto sound effects | P2 | Small once captions, face tracks and the transcript exist; held back to keep 13 testable |
| Enhance audio, remove bad takes | P2 | Each needs a model of its own (noise removal, repeated-take detection) |
| Three, Four and Screen Share layouts | P2 | Need to know who is speaking, which the sprint's face detector does not answer |
| Speaker caption colours, best posting times | P2 | Need diarisation and real engagement data |
| Motion graphics, upscale, auto colour correction | Not Planned | High cost or a high chance of a worse video |
| Custom font upload, XML export, mobile app, mention search | Not Planned | Outside the Clips product for now |

## 9. UX Patterns Worth Copying

1. **One setup page, one Create button.** Everything the AI will do is chosen on one scrollable page, in groups (Essentials, Sound Sharp, Look Good, Translate), before anything runs ([O7]).
2. **A price panel that reads like a receipt.** One line per feature, "Free" spelled out, the total beside a bolt, and a plain shortfall message with the fix beside it ([O7]).
3. **The range picker is also the cost control.** Filmstrip, two handles, three time boxes, and the saving named ([O7]).
4. **Auto is the default for every choice.** Language, genre, AI picks: a person can press Create without touching anything ([O7]).
5. **Caption styles are picked by looking.** Each tile is the style itself, animated, with a short name under it; the chosen one is labelled ([O7], [S10]).
6. **Layouts as ticked thumbnails.** Seven little pictures with ticks say more than seven checkboxes with names ([O8]).
7. **Recipe and brand kit side by side.** One line explains the split: the recipe decides which edits run, the brand kit decides the look ([O7]).
8. **Recipe chips under the link box.** The common jobs are one click from Home, with "See all" at the end ([O2]).
9. **Transcript and video share the editor.** Text on the left, picture on the right, Speech Cleanup as the one button over the text ([O3]).
10. **AI actions and AI switches in one list.** One-shot actions have no switch; lasting effects have one; the icon rail stays the way back to manual tools ([O3]).
11. **The state chips over the canvas.** Ratio, layout and tracking as three small chips that open their own menus ([O3], [O4]).
12. **Effects as a list of named cards.** Icon, name, one line of what it does, a badge when it is new or paid ([S8]).
13. **Language first, then style.** The captions tab asks the spoken language before it shows styles ([S10]).
14. **When to post is one split control.** Next Available, Now or Schedule, with the schedule's settings one click away ([S15]).
15. **Slots feel human.** A weekly amount slider, a generated week, Shuffle Times, and one sentence that explains the natural-minute window ([S23], [S24]).
16. **Random time by part of day.** Morning, Noon, Afternoon, Evening as four icons beside the exact time ([S16]).
17. **Templates where the text is typed.** "Save or select template" sits under each field, with a colour to tell templates apart ([S13], [S21], [S22]).
18. **Disclosure where the platform's own fields are.** The AI switch lives in the platform's section, not in a global setting ([S14]).
19. **A locked tool shows itself.** Montage Maker is visible, blurred, with one sentence and one button ([S26]).

PostGear draws all of these in its own design system: `ChoiceTiles` for the pickers, `Tabs` for the one toggle bar, `Alert` for the shortfall, placeholders that read "Enter your ...", Title Case names, no shadows on dropdowns.

## 10. Open Questions

- **Open question for Arvind**: the plan's Module 03 lists "word-by-word animation, edit, custom styles, translation". This file adds the keyword highlighter to it and leaves AI emojis in P2. Recommendation: accept; the highlighter is what makes two of the caption styles in the screenshot work (Marker Sweep, Negative Keywords).
- **Open question for Arvind**: OpusClip offers seven AI layouts, Sprint 13 can deliver four (Fill, Fit, Split, Gameplay). Recommendation: show only the four, and add the rest when speaker detection is built.
- **Open question for Arvind**: "virality score" is a claim we cannot prove. Recommendation: call it Clip Score and always show the reasons beside the number.
- **Open question for Arvind**: StreamLadder's prices could not be read today. Recommendation: open the upgrade page while signed in and add a screenshot before the sprint doc quotes any StreamLadder price.

[O1]: ../../screenshots/opusclip/01-landing-paste-link-supported-sources-tooltip.png
[O2]: ../../screenshots/opusclip/02-home-clip-long-video-youtube-link-recipe-chips.png
[O3]: ../../screenshots/opusclip/03-editor-uploading-9x16-ai-enhance-panel.png
[O4]: ../../screenshots/opusclip/04-editor-processing-16x9-ai-enhance-panel.png
[O7]: ../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png
[O8]: ../../screenshots/opusclip/08-clip-setup-ratio-and-ai-layouts-picker.png
[S8]: ../../screenshots/streamladder/08-clip-editor-effects-zoom-speed-censor-silences-hook.png
[S9]: ../../screenshots/streamladder/09-clip-editor-audio-sound-effects-music.png
[S10]: ../../screenshots/streamladder/10-clip-editor-ai-captions-styles-language.png
[S13]: ../../screenshots/streamladder/13-publisher-new-post-share-to-caption-facebook-reels.png
[S14]: ../../screenshots/streamladder/14-publisher-new-post-ai-content-disclosure.png
[S15]: ../../screenshots/streamladder/15-publisher-when-menu-next-available-now-schedule.png
[S16]: ../../screenshots/streamladder/16-publisher-schedule-date-time-random-time-of-day.png
[S21]: ../../screenshots/streamladder/21-publisher-save-title-template-popover.png
[S22]: ../../screenshots/streamladder/22-publisher-create-template-colour-name-text.png
[S23]: ../../screenshots/streamladder/23-publisher-posting-slots-21-a-week-generated.png
[S24]: ../../screenshots/streamladder/24-publisher-posting-slots-exact-times-plus-minus-window.png
[S26]: ../../screenshots/streamladder/26-montage-maker-locked-upgrade.png
[S27]: ../../screenshots/streamladder/27-schedule-maker-twitch-username-gate.png
[S28]: ../../screenshots/streamladder/28-clip-downloader-paste-twitch-or-kick-clip-url.png
[S29]: ../../screenshots/streamladder/29-emote-maker-twitch-clip-to-emote.png
