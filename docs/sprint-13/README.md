# Sprint 13: Clips AI (Captions, Smarter AI And Auto-Reframe)

> **Status**: Documents written 2026-11-14 and 2026-11-15, revised 2026-11-17 after Arvind settled every open question (see the Decision Ledger below). **Built 2026-11-26 to 28** on `sprint-13-clips-ai` (modules 01 to 16; progress and every decision in [`clips-ai-implementation-docs/README.md`](clips-ai-implementation-docs/README.md); what is done and what is not in the [completion checklist](../sprint-completion-checklists/sprint-13-completion-checklist.md)). Everything was built and checked under simulation: no model was downloaded and no hosted AI service was called. The real test ([`real-test-plan.md`](real-test-plan.md)) is next, after Sprint 12's own ([`../sprint-12/real-test-plan.md`](../sprint-12/real-test-plan.md), section 7).
> **The idea** (Arvind, 2026-11-14): once the core of Clips is built and tested for real, add everything else StreamLadder and OpusClip have: speech to text and captions, AI that understands what is said, finding fails and big moments from the picture, following the speaker's face, and the Python service these need, plus recipes, montage, more link sources, creator tools and publisher upgrades. Build it as a strong second layer on Sprint 12's foundations, not a rewrite.

## What Is In This Folder

| Document | Read it for |
|---|---|
| [`research/01-reference-features.md`](research/01-reference-features.md) | Every OpusClip and StreamLadder feature Sprint 12 does not have, and which module takes it; what PostGear's scheduler already has |
| [`research/02-libraries.md`](research/02-libraries.md) | Every Python and npm library with its version, licence and verdict |
| [`research/03-open-source-reference-repos.md`](research/03-open-source-reference-repos.md) | Open-source AI clippers and the libraries under them, read for their logic, with the licence rule |
| [`research/04-transcription.md`](research/04-transcription.md) | Speech to text: our own machine against hosted services, speed, languages, cost, the provider interface |
| [`research/05-python-media-service.md`](research/05-python-media-service.md) | The Python service: layout, Temporal across two languages, tooling, the typed contract, images, where to run it |
| [`research/06-captions-moments-and-vision.md`](research/06-captions-moments-and-vision.md) | Captions on the two clocks, reading transcripts for moments, speech cleanup, faces and following the speaker, action in the picture |
| [`research/07-cost-deploy-and-risks.md`](research/07-cost-deploy-and-risks.md) | Cost per hour of video, the AI Minutes meter, deployment shapes, privacy and AI labels, the risks register |
| [`research/08-approach-on-postgear.md`](research/08-approach-on-postgear.md) | How it sits on Sprint 12: data flow, where the code goes, what is reused |
| [`research/09-ass-captions-and-edit-cookbook.md`](research/09-ass-captions-and-edit-cookbook.md) | **Verified by running FFmpeg**: captions through ASS, bleeps, many cuts, montage, following the speaker, emotes |
| [`research/10-creator-tools-and-editor-seats.md`](research/10-creator-tools-and-editor-seats.md) | Emote Maker, Schedule Maker and the restricted Editor team seat |
| [`../sprint-12/research/13-screenshot-coverage.md`](../sprint-12/research/13-screenshot-coverage.md) | The audit that proves every reference screenshot has a home |
| [`../sprint-documents/sprint-13-clips-ai.md`](../sprint-documents/sprint-13-clips-ai.md) | **The sprint doc**: architecture, document version 2, the media service and its contract, jobs, data model, API routes, definition of done |
| [`../new-modules/user-stories-clips-ai.md`](../new-modules/user-stories-clips-ai.md) | **The user stories**: journeys, acceptance criteria, UX rules, edge cases, the completion checklist |
| [`clips-ai-implementation-docs/README.md`](clips-ai-implementation-docs/README.md) | **The build plan**: seventeen modules, one per Claude Code session, with the kickstart prompt |
| [`real-test-plan.md`](real-test-plan.md) | **The real test**: how Arvind tests every module with real videos after the build |

## Reading Order

1. This page, including the Decision Ledger.
2. The sprint doc, for the whole shape in one read.
3. The user stories, section 2 (the journeys), then section 5.
4. Research 07 (cost, privacy, risks).
5. The module index, then the modules in number order when building.
6. The real-test plan, when the build is done.

## The Pitch In One Paragraph

Anjali opens last week's 58 minute podcast and presses **Find Clips**. A **Clip Setup** screen asks what she wants: she types "the part about quitting my job", picks **30 To 60 Seconds** and **Vertical**, ticks **Follow The Speaker**, and reads the price in AI Minutes in the summary. Eight clips come back with titles, scores and reasons. She opens one: the frame is on whoever is talking, **captions** show word by word, she fixes a name once in the **Transcript** and it is fixed everywhere, she deletes a rambling sentence and the video cuts with it, and **Remove Silences** tightens the rest. Vikram types "funny fails", turns on **Look For Action**, bleeps two words and opens his clip with the crash, then makes an emote from his reaction in **Emote Maker**. Meera saves a client's look as a **recipe**, invites an **Editor** who can cut but not publish, Arun runs **Export All** on eight clips, and the composer sends them out at times that never look automated.

## The Decision Ledger

On 2026-11-17 Arvind handed every open question to Claude and asked for a real production-grade SaaS answer. This is the ledger of those calls. **Nothing here is open.** Each line says what was chosen, why, and the one thing that would make us look at it again. The modules cite these entries as `D13-NN`. Sprint 12's own ledger is in [`../sprint-12/README.md`](../sprint-12/README.md).

| ID | Question | The Call | Why | Reopen If |
|---|---|---|---|---|
| D13-01 | When does this start? | Only after Sprint 12 has passed its exit gate. Module 01 first corrects these documents against what was actually built | These documents were written before Sprint 12 existed in code | Sprint 12 is abandoned or reshaped |
| D13-02 | How is AI paid for? | The **AI Minutes meter** built in Sprint 12 (one minute of video an AI step works on; listening is charged once per stretch; following the speaker and detecting the camera are free). Module 15 audits prices and queue priority only | One clean currency for all of Clips, and an operator-editable allowance per plan | The operator prefers credits for Clips too |
| D13-03 | May speech go to a hosted service? | **Yes, behind a switch**: our own machine is the default; `TRANSCRIBER=auto` sends long stretches to a hosted fast lane (Groq) above a threshold; the privacy text names the provider when it is on | Speed on long videos matters more than a few cents; the sound leaves our servers only when the lane is on | A privacy-first customer needs it off for them (a per-workspace setting later) |
| D13-04 | Listen at import or on demand? | **On demand**, only the stretch asked for | Nobody pays to listen to six hours for a 40 second clip | Most users end up wanting every video listened to |
| D13-05 | Tamil captions at launch? | **Yes**, editable, with unsure words underlined | Arvind's users include Tamil speakers; Tamil is weaker but usable | The real test shows it is not usable |
| D13-06 | Text to speech? | **Open-source voice only**, behind `CLIPS_TTS`: Kokoro through `kokoro-onnx` if its whole licence chain passes when built, otherwise parked. No hosted voice | The same open-source stance as the libraries, and OpenAI's speech models are being retired | A clean open voice for Indian languages appears |
| D13-07 | Vision check on stills? | **Off by default** (`CLIPS_ACTION_VISION`); the real test decides | Sends still pictures to the AI provider; worth it only if the picks are better | The real test shows a clear gain |
| D13-08 | Which new sites? | **On**: Vimeo, Rumble, Dailymotion, Loom, X, Facebook, LinkedIn, Reddit, Pinterest, Threads. **Built but off**: TikTok, Instagram, Zoom, Dropbox. Riverside and StreamYard: upload only | The off ones usually need a login or break often; each site has its own switch | A site proves reliable in the real test |
| D13-09 | Google Drive? | **Built last, behind a key**, using Google's own picker and the narrow `drive.file` scope; parked if the consent screen is not changed | OpusClip has it; PostGear never lists a Drive or keeps a token | The consent screen change is refused |
| D13-10 | When is the AI label suggested? | Only for a made-up voice or picture, never for captions, cuts, layouts or following a speaker | That is the line YouTube's own policy draws | A platform's rule changes |
| D13-11 | An always-on graphics card? | **No**, not at first: our own processor or the hosted lane, then a card rented by the second, then an always-on card only at thousands of hours a month | Cost; research 07's ladder | Volume passes the ladder's trigger |
| D13-12 | The AI model snapshot? | Moving `ai-engine` off its retiring model is **a separate platform task** to finish before 2027-01-14 | It is outside this sprint but has a deadline | n/a |
| D13-13 | Legal read on faces and voices? | Required **before an EU or India launch** (`needs a legal read` in research 07); until then faces are boxes only, deleted with the video | We store where faces are, never who they are | n/a |
| D13-14 | What is the score called? | **Score**, with reasons; never "virality" | Nobody can promise virality | n/a |
| D13-15 | Emote Maker, Schedule Maker and Editors? | **Built** in the new Module 14 (**Creator Tools And Editor Seats**); an Editor is a restricted team seat that can cut, caption and export but cannot connect channels, publish or change billing | They are screens in the StreamLadder captures (research 13 of Sprint 12) and Arvind asked for full coverage | The Editor seat's blast radius proves too large (then park only that part) |
| D13-16 | Render engine here? | **FFmpeg only**, as in Sprint 12 (D12-04): captions and text are drawn through ASS subtitles (libass with HarfBuzz) | Same engine for the whole product; no second renderer | n/a |
| D13-17 | Starter recipes and Auto-Edit? | **Built** in Module 10: five starter recipes and **Auto-Edit Video** (one press turns a whole video into one edited clip) | OpusClip's recipe chips and "Auto-edit footage" | n/a |

## Where Each Decision Lands

| Decision | Modules |
|---|---|
| D13-02 AI Minutes | 02, 05, 06, 09, 15 (audit) |
| D13-03 hosted lane | 02, 15 |
| D13-06 text to speech | 09 |
| D13-08 sites | 12 |
| D13-15 creator tools and seats | 14 |
| D13-16 ASS captions | 03, 04, 09, 11 |
| D13-17 recipes | 10 |
