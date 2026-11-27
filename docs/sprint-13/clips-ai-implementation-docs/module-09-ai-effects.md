# Module 09: AI Effects

> **Sprint 13, Clips AI** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 03](module-03-captions.md), [Module 04](module-04-transcript-editing-and-speech-cleanup.md)
> **Stories**: CA-5.1, CA-5.2, CA-5.3, CA-5.4
> **Next**: [Module 10](module-10-recipes-and-brand-kit.md)

## Goal

After this module the Effects tab has four AI rows. **Bleep Bad Words** finds swear words in the transcript, bleeps or mutes them in the sound and stars them in the captions. **Add Hook Title** offers three titles written from the clip's words and puts the chosen one on the first seconds. **Add Hook Clip** plays the best one to five seconds first, then the clip from its start. **Text To Speech** turns a typed line into a voice on the sound row, with an open-source voice only and behind a switch that stays off until that voice's whole licence chain has passed (D13-06).

## Read First

- `CLAUDE.md`, Sprint 12's README, then the README in this folder.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) section 7.
- User stories: Journey B steps 4 to 6; CA-5.x; section 5 (nothing to bleep, a voice that cannot read a language).
- Sprint doc: The Clip Document, Version 2 (`bleeps`, `segments[].role`).
- Decisions: D13-02 (AI Minutes), D13-06 (text to speech: open-source voice only), D13-10 (the AI label), D13-16 (ASS). Research: [`09-ass-captions-and-edit-cookbook.md`](../research/09-ass-captions-and-edit-cookbook.md) sections 5 (bleeps and mutes, **verified**), 6 (many cuts) and 7 (the hook clip).
- Research: [`06-captions-moments-and-vision.md`](../research/06-captions-moments-and-vision.md) (word censoring, the hook title and hook clip as segments, text to speech options); [`02-libraries.md`](../research/02-libraries.md) (the word lists and their licence, the text-to-speech rows: one option is GPL and can only run as a separate program, one needs an older Python, a hosted one is being retired in early 2027); [`07-cost-deploy-and-risks.md`](../research/07-cost-deploy-and-risks.md), voice rights and the AI label.
- Code: Sprint 12 Module 13's Effects panel and Module 14's sound items; the render compiler in `packages/video-engine/src/render/` (`frameState`, `buildRenderPlan`, `compileFfmpeg`, `buildAss`) and `packages/video-preview` (`PreviewEngine`, its Web Audio sounds); Module 03's captions mapping and edits; Module 04's `TranscriptText`; `packages/video-engine/src/time/` (segments, the time map); Module 05's title writer agent; Sprint 12 Module 11's `TextItem` and text styles (drawn by ASS).

## Design

### 1. Bleep Bad Words

- Lists: `packages/video-engine/src/cleanup/word-lists/` holds a default list per language (English and Hindi from the open list research 02 names, with its licence and credit recorded beside it; Tamil starts empty), plus the workspace's own words from `ClipWordList` (`prisma-change`; `GET` and `PUT /clips/word-list`, admins and members, at most 200 words).
- `findBleepWords(transcript, lists)`: matches whole words, case-insensitive, with simple endings (plural, "-ing", "-ed") for English; returns `{ wordIndex, from, to, text }`. No model is called: a list is predictable and free.
- The document's `bleeps`: `{ id, source, from, to, mode }` in the video's time, padded by 40 ms each side. `setBleeps(doc, words, mode)` replaces the set; one undo step.
- **In the export** (`compileFfmpeg`, research 09 section 5): bleeps are mapped to **output** time through the time map and applied **after** `concat` and after any speed change (inside a segment `t` restarts, so a gate there would be wrong). The video's sound is muted by `aeval='val(0)*(1-(R1+R2+R3))':c=same`, sample accurate (a `volume=...:eval=frame` gate alone ends up to one audio frame, about 21 ms, late), and one `aevalsrc='0.35*sin(2*PI*1000*t)*(G1+G2+G3)':s=48000:d=<clip seconds>` makes the 1 kHz tone for every range at once; `amix=inputs=2:normalize=0:duration=first` joins them. `Gn = between(t,a,b)` is the gate and `Rn = clip((t-a)/0.005,0,1)*clip((b+0.005-t)/0.005,0,1)` ramps every mute edge by 5 ms (a hard mute clicked at 25 times the tone's own step; a 5 ms ramp did not). `mode: 'mute'` omits the tone. The expression grows about 20 characters a bleep. `c=same` keeps both channels gated.
- **In the editor**: `PreviewEngine` takes which bleeps are active from `frameState` and plays the tone with a Web Audio oscillator while a gain node mutes the video's sound inside each bleep (the same 5 ms ramps). It is a fast preview; **Preview Export** and the export itself are sample accurate.
- Captions (**caption masking**): `captionWords` replaces a bleeped word's text with its first letter and stars ("f***"), so the ASS writer draws the masked word and never the original. The original is untouched in the transcript.
- The row: a `Toggle`. On: the words found as a tick list (all ticked, each showing its time; clicking one seeks to it), a `Segmented` (**Bleep**, **Mute**), and **My Words**, a small dialog to edit the workspace's list ("Enter your word"). None found: "No words to bleep in this clip." Needs a transcript for the clip's stretch; if there is none, the row offers **Listen To This Clip** with its price in AI Minutes (Module 02's `ensure`). Finding the words is free: no model is called.

### 2. Add Hook Title

- `POST /clips/:clipId/hook-titles`: sends the clip's words (the sentences it plays, capped in length) to the title writer agent with a hook brief: three different titles of at most 7 words, in the clip's language, no hashtags, no quotes, no claims the words do not support. No AI minutes: it is small and bounded (a throttle of 10 a minute per workspace instead), so hook titles stay free. Simulated answers under `AI_SIMULATION`.
- The row: **Add Hook Title** opens three suggestion tiles and a field ("Enter your title"). Choosing adds a `TextItem` at 0 for 3 seconds, `anchor: 'clip'`, in one of three hook looks added to `TEXT_STYLES` (large, top third, high contrast; our own designs). It is an ordinary text item from then on, and like every text item it is **a text item drawn by `buildAss`** (libass), with the same box, outline and fade options; the editor's preview draws it from `frameState`.
- **Try Again** asks for three more.

### 3. Add Hook Clip

- In the engine: `setHook(doc, { fromOutputMs, toOutputMs })` copies that stretch of the clip (1 to 5 seconds) as a new first segment with `role: 'hook'` (the same source range played twice: once as the hook, once in its place). `removeHook(doc)` drops it. A clip has at most one hook. Items with `anchor: 'moment'` on that stretch appear in both plays, which is right. Items with `anchor: 'clip'` shift later by the hook's length when it is added (and back when removed), so they keep their place over the main clip. The one exception is a hook title (a text item made by Add Hook Title carries `meta.hookTitle`): it stays at 0, over the hook. Write this rule as a test: hook titles stay, other clip-anchored items move.
- A short cut sound is not added; a hard cut is the convention.
- Suggestion: `suggestHook(doc, signals, transcript)` picks the 2.5 seconds around the strongest signal peak inside the clip, snapped to word boundaries when there is a transcript.
- The row: **Add Hook Clip** opens a small view of the clip's timeline with a draggable 1 to 5 second range (the suggestion preselected) and a preview that plays "hook, then start". **Add**. On the main timeline the hook is the first bar with a small "Hook" label and its own delete.
- Captions show on the hook too (mapping loops over segments). In the export the hook is the same source range read twice: the compiler puts both segments in one run (one `split` and `asplit` of that run's input, hook range first, then the main part), so a hook is a segment with `role: 'hook'` and needs nothing special (research 09 section 7, verified: output 18.000 s, frames as expected).

### 4. Text To Speech (Behind `CLIPS_TTS`, Default Off)

- **The decision is made (D13-06): an open-source voice only, no hosted voice.** The candidate is **Kokoro through `kokoro-onnx`** (a locally run model, no per-minute bill, nothing leaves our machines). At build time, before anything is wired, check the whole licence chain: the model weights, `kokoro-onnx`, the phonemiser it needs (`espeak-ng` is GPL and can only run as a separate program, as research 02 notes), the voice files and their training data, and each language the voices cover. If every link allows use inside a paid product, write the result and the licence texts in the Decision Log and build it; **if any link fails, the item is parked** (the switch stays off, the row hidden, the item moved to Module 17 with the reason). Hosted voices are not used (OpenAI's speech models are being retired). Build the rest of this section under simulation either way.
- A `Speaker` provider interface in Python (the local model runs in `apps/media`): `speak(text, voiceId) -> an audio file`. Simulated binding: a generated tone pattern whose length follows the text.
- `POST /clips/voice` `{ text (up to 500 characters), voiceId }`: priced by `aiMinutesCost('voice', characters)` (1 AI minute per 1000 characters, whole minutes rounded up, minimum 1) and charged through `UsageService.consume` with the key `clips.ai:voice:<clipId>:<revision>:<hashOfInput>` (the same text and voice twice is one charge); the 402 `clips_ai_minutes_used` applies as everywhere. A SPEECH job makes the file (a failure reverses the charge), stores it as an AUDIO asset in the workspace's library with `meta { voice, text, madeByAi: true }`, and the editor adds it as a sound item at the playhead.
- `GET /clips/voices`: the voices with a short sample each.
- The row: a `Textarea` ("Enter your words"), voices with play buttons, the price ("Make The Voice (1 AI Minute)"), **Make The Voice** (`highlight`). "This voice cannot read this language. Pick another voice." when the text's script is not in the voice's list.
- A clip whose document uses a sound with `madeByAi` is flagged `usesAiVoice` on its view, which Module 13 uses to suggest the AI label (D13-10: only for a made-up voice, never for captions, cuts or following a speaker).

### 5. Tests

- Engine: `findBleepWords` (whole words only, endings, the workspace list), `setBleeps`, the caption masking, `setHook` and `removeHook` (the item rule), `suggestHook`.
- Compiler, with the real FFmpeg binary on a tone source: the bleep gate lands at the asked times within the probe's 5 ms (a 300 Hz tone muted at 1.000 to 1.500 and 4.000 to 4.050, the 1 kHz tone present exactly there, no step larger than the tone's own at the edges), several ranges in one graph, bleeps applied in output time on a clip with two segments and a 2x part; a hook plays first (frame stamps at known output times show the hook range then the main part). Preview: `frameState` lists the same active bleeps at sampled times.
- API: the word list routes, hook titles (throttle, free, cleaned output), voice (off, price from `aiMinutesCost`, charge key, reversal on failure, 402).
- Web: each row's states, the tick list, My Words, the suggestion tiles, the hook range picker, the voice row hidden when off.

## Scope

**In**: bleeping with lists, the hook title, the hook clip, text to speech behind its switch (or parked with a reason).
**Out**: detecting "sensitive topics" with a model, bleeping in the picture (blurring lips), cloned voices, dubbing a whole clip (Module 17).

## Tasks

- [x] Word lists with licence records; `ClipWordList` and its routes; `findBleepWords`; `setBleeps`. (The lists are PostGear's own, with a README in `cleanup/word-lists/`; the LDNOOBW lists wait for a fetch Arvind allows.)
- [x] The bleep gate and tone in `compileFfmpeg` (output time, 5 ms ramps), the Web Audio bleeps in `PreviewEngine`, caption masking.
- [x] The Bleep row with My Words.
- [x] The hook title route, the three hook text looks (drawn by `buildAss`), the row.
- [x] `setHook`, `removeHook`, `suggestHook`; the row and the timeline label.
- [x] The text-to-speech licence-chain check in the Decision Log (D13-06); then the Kokoro provider, route, job and row, or the item parked in Module 17. (The chain fails in-process because espeak-ng is GPL, so Kokoro runs as its own program: `apps/media/voice-program`, GPL-3.0-or-later, called by the media service with a file in and a file out and never imported. Built after the owner's OK on 2026-11-27, with ten voices, a sample each, `MEDIA_SPEAKER`, the media service's `GET /voices` as the only voice list, and a live check: two real voices made and added, a cancel stopping the program and giving the minute back.)
- [x] Title-case test green.
- [x] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js cleanup time captions render
npx jest --config packages/video-preview/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels
```

## Done When

- Turning on Bleep Bad Words on the sample clip (its recorded transcript has two planted words) bleeps both in the export (sample accurate, no click at the edges) and stars them in the captions; unticking one restores it.
- A workspace's own word is bleeped after it is added to My Words.
- Add Hook Title offers three titles and puts the chosen one on the first three seconds as an editable text.
- Add Hook Clip makes the clip open with the chosen seconds, with captions on them, and removing it restores the clip exactly.
- Text To Speech either works behind its switch with a recorded licence-chain decision (Kokoro through `kokoro-onnx`, open source only), priced in AI Minutes, or is parked with the reason written down.
- Each action is one undo step.

## Hand Check

With the three simulation flags on and the demo admin, in a captioned clip:

1. Effects, Bleep Bad Words: two words listed. Play: a tone over each, stars in the captions. Switch to Mute. Untick one.
2. My Words: add a word that is in the clip; it joins the list.
3. Add Hook Title: pick one of three; move it; change its look.
4. Add Hook Clip: the suggested range is selected; preview; Add. The timeline's first bar says Hook. Delete it.
5. If `CLIPS_TTS` is on: type a line, play a voice, Make The Voice; the sound is on the timeline.
6. Press Preview Export, then export at 720p and listen: the bleeps sit on the words.

## Handoff

Module 10's recipes store bleep (on, mode) and hook title (on, look). Module 13 reads `usesAiVoice`. Module 17 holds dubbing and cloned voices.
