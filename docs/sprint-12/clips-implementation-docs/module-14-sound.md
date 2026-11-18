# Module 14: Sound

> **Sprint 12, Clips** | Status: Done with gaps (2026-11-19; see the README Progress row) | Size: L (one full session, may need a second: the catalogue's sound ingest is half the work)
> **Depends on**: [Module 01](module-01-contracts-and-data.md) (the library tables), [Module 09](module-09-timeline.md), [Module 12](module-12-stickers-and-gifs.md) (the shared ingest engine and library routes)
> **Stories**: CL-9.1, CL-9.2, CL-9.3, CL-9.4
> **Next**: [Module 15](module-15-export.md) (Export)

## Goal

After this module the Audio tab works as a real library: an **open-source catalogue** of sound effects and music that is safe to use in posts (about 650 effects and about 150 music tracks at launch), searchable by name, tag and category, with favourites and the workspace's own uploaded sounds; a sound row on the timeline; volume for the video and for each sound; fades; and an export whose loudness is evened out by a two-pass `loudnorm` to about -14 LUFS. The catalogue is filled by an operator-run, licence-guarded ingest, never by users (decision D12-09). The music shelf is thin, and the screen says so.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 7 (the Sound row), 8 (Audio).
- User stories: CL-9.1, CL-9.2, CL-9.3, CL-9.4; Journey B step 6.
- Sprint doc: The Clip Document (the `audio` track, `AudioItem`, `anchor`); Database (the library tables); API Routes (library).
- Research: [`10-open-source-sound-and-sticker-libraries.md`](../research/10-open-source-sound-and-sticker-libraries.md), sections 1 to 3 and 5 to 15 (the verdict table of sources, the licence allow-list, the data model, search, the ingest and its guard, categories, credits, launch volume, takedown, the search API, risks); [`09-ffmpeg-render-cookbook.md`](../research/09-ffmpeg-render-cookbook.md), section 8 (the audio graph and the two-pass loudness, verified) and section 1 (`atempo`, `apad`); [`05-editor-and-render.md`](../research/05-editor-and-render.md), sections 2 and 3 (Web Audio in the preview, what it cannot match) and section 5 (the two passes).
- Code: Module 12's ingest engine, library module and `normalise` helpers; Module 09's Sound row and reducers; Module 11's `addItem` and `TimeField`; Module 05's `renderClip` (the measuring hook) and compiler; Module 04's peaks builder (reuse it for uploads); Module 02's `PrivateStorage` and upload calls; `apps/api/src/modules/media/file-type.ts` (sniffing real types); `packages/ui` (`Slider`, `Toggle`, `Tabs`, `Segmented`).

## Design

### 1. The Sound Item (engine)

`AudioItem` is `{ id, kind: 'audio', start, duration, anchor, sound, trimStart, volume, fadeInMs, fadeOutMs, loop }` with `sound` one of `{ source: 'library', soundId }` or `{ source: 'upload', assetId }`. `trimStart` is where in the sound file playback begins, so a sound can be trimmed from either end. `volume` is 0 to 2. `loop` repeats the sound to fill the item (music set to Whole Clip). Sound effects default to `anchor: 'moment'`; music to `anchor: 'clip'`.

Edits: `addSound(doc, sound, atMs, kind)`, `updateSound`, `removeSound`, and the time reducers from Module 09 (a sound cannot be stretched past its own length unless it loops). `setSegmentVolume(doc, segmentId, volume)` and `setVideoVolume(doc, volume)` (sets every segment) for the video's own sound. Limit: 20 sounds a clip.

### 2. The Catalogue

The tables are Module 01's (`ClipSound`, with the shared `ClipLibrarySource`, `ClipFavourite`, `ClipLibraryRun`, `ClipLibraryDeny`, `ClipLibraryMiss`). A sound row holds its name, tags, category, kind (`SFX` or `MUSIC`), duration, optional `bpm`, measured loudness and true peak, 100 waveform peaks (0 to 255), its file key, and its licence evidence (licence code, licence address, author, origin, origin id, source address, whether the adapter judged it an original work, retrieved date, checksum).

- **Categories**: sound effects **Alerts And Notifications** (`alerts`), **Ambient Sounds** (`ambient`), **Reactions** (`reactions`), **Transitions** (`transitions`), **Gaming** (`gaming`), **Comedy** (`comedy`), **Impacts** (`impacts`), **Whooshes** (`whooshes`); music **Calm** (`calm`), **Upbeat** (`upbeat`), **Tense** (`tense`), **Cinematic** (`cinematic`), **Lo-Fi** (`lofi`), **Epic** (`epic`). `taxonomy.ts` maps source words to a category (whoosh, swoosh to `whooshes`; hit, punch, slam to `impacts`; bell, ding, notification, click to `alerts`; rain, wind, crowd, room tone to `ambient`; laugh, boing, honk to `comedy`; coin, jump, power-up, laser to `gaming`; riser, swipe, glitch to `transitions`); a Kenney pack's own name is a strong hint (Impact Sounds to `impacts`, Interface Sounds and UI Audio to `alerts`, Sci-fi and Digital Audio to `gaming`, Music Jingles to `upbeat` or `cinematic` by tag). Tags are lowercase, deduplicated, at most 12, brand words stripped.
- **Sources and verdicts** (research 10 section 3): **Pick**: PostGear's own sounds made with FFmpeg (tones, noise, filtered sweeps; ours, CC0 by our choice), Kenney's audio packs (CC0: Impact Sounds 130, Interface Sounds 100, RPG Audio 85, Sci-fi Sounds 70, Digital Audio 60, UI Audio 50, Music Jingles 50, Casino Audio 50, and a 90-file Voiceover Pack), and hand-picked OpenGameArt items that are CC0. **Later, only after written permission** (Module 21): Openverse and Freesound, each behind its own switch and never auto-published (their terms ask for written permission for commercial use). **Reject**: Pixabay, Mixkit, the YouTube Audio Library, Sonniss, Jamendo, ccMixter (terms forbid what we do). Sounds never take CC BY, because a credit cannot ride along inside a sound in a finished video.
- **Launch volume** (no outside permission needed): about **650 sound effects** (Kenney about 450 after hiding clicks and silence, our own about 80, hand-picked CC0 the rest) and about **150 music tracks** (Kenney Music Jingles 50, about 60 CC0 loops and tracks picked by hand from OpenGameArt, about 12 of our own loops, the rest short loops). **The music shelf is thin: a few hours of loops and jingles, not a song catalogue.** The panel says "The music shelf is small: loops and short tracks, not songs." A paid licence that allows redistribution inside a SaaS can be added later through the same table (it needs a decision first: `COMMERCIAL` is not on the allow-list).
- The old fixed pack of about 40 files, its manifest, the bundled files in a composition package and any Pixabay or Mixkit wording are gone. Nothing is bundled with the app.
- **The trap in StreamLadder's own list**: it shows "Nintendo Switch Click" and "Windows 10 Notification", other companies' sounds. The guard refuses brand-named items (below).

### 3. The Sound Ingest (operator only, `apps/worker/src/scripts/`)

```
npm run clips:library:ingest -- --kind sound --source kenney|own|opengameart
        [--path <folder or list.json>] [--category <slug>] [--limit 200] [--dry-run] [--auto-publish]
npm run clips:library:publish -- --run <runId>
npm run clips:library:remove  -- --id <id> --reason "..."
```

The same engine and the same safeguards as Module 12's: worker app, media worker box, `CLIPS_LIBRARY_INGEST=true` required in the shell, no route accepts a source, everything lands `STAGED`, a report is written, the operator reviews a sample (at least 20 items or 10 percent) and publishes. Sound adapters: `own` (a generator, not binary files: FFmpeg `lavfi` definitions in the repo that make the tones, noises, sweeps, pops and loops, plus their `licences.json`), `kenney` (an unzipped pack; the adapter reads `License.txt` and refuses the pack unless it says CC0), `opengameart` (an operator-written JSON list of page addresses; the operator confirms the licence line on each page; CC0 only, so CC-BY, CC-BY-SA, GPL and OGA-BY are refused; it never uses `--auto-publish`). The Openverse and Freesound adapters are built but disabled (`CLIPS_INGEST_OPENVERSE_OK` and a Freesound equivalent default off) and are Module 21's.

The steps for audio (research 10 section 8.2):

1. **Fetch** through the safe fetcher: size cap 12 MB, timeout, no private addresses, one request at a time. Sniff the real type, then `ffprobe` to confirm it decodes.
2. **Licence guard**, before any transcoding. Allowed for sounds: `OWN`, `CC0-1.0`, `PDM-1.0` only. Refused with a recorded reason: `licence_not_allowed`, `licence_url_mismatch`, `missing_metadata` (no title, source address, licence or creator; Kenney and our own carry a fixed creator in their manifest), `mature`, `brand_name` (the block list starts with `nintendo, windows, mario, zelda, pokemon, minecraft, netflix, disney, marvel, apple, iphone, android, youtube, tiktok`; the operator extends it), `derivative_signal` (cover, remix, bootleg, ripped, "from the game", "from the movie", theme from, ost, soundtrack, sample from, mashup, "by <artist>"), `not_original`, `no_category`.
3. **The original-work rule**: `originalWork` is true for `own` and Kenney by construction. For OpenGameArt it is true only when the creator is a named individual account, the text has no derivative signal, and (for music) the item has a creator page. An item that fails goes to the report as `needs_review` and not into the catalogue. This is how we keep "only items whose source metadata says original work" (the brief).
4. **Dedupe**: sha256 of the bytes (`sourceChecksum`, unique) and `(origin, originId)`; items on `ClipLibraryDeny` are skipped.
5. **Normalise**: decode, mix to stereo (mono sources stay mono and are duplicated at play time), resample to 48 kHz (the render's rate), trim silence at the start and end (`silenceremove`, with `areverse` for the tail), add a 5 ms fade in and out to avoid clicks, and measure with `ebur128`. **Loudness target**: music and ambient to about -16 LUFS integrated with a true peak of -1.5 dB; effects shorter than 3 seconds are peak-normalised to -3 dBFS, because loudness is unreliable on very short sounds. Limits: effects 0.1 to 15 seconds, music 5 seconds to 10 minutes; outside that, rejected. The final export pass still runs `loudnorm` (section 7).
6. **Encode** to AAC-LC in `.m4a` at 128 kbps, tags stripped (`-map_metadata -1`): one fixed format keeps the editor and the render simple. **Peaks**: 100 values (0 to 255) from the decoded samples, stored on the row; no image file.
7. **Store** in the public media bucket as `library/sounds/<first 2 hex>/<sha256>.m4a` (immutable, cached for a year); **write** the row `STAGED` with the evidence and the run id; **report** one line per accepted item (name, licence, author, source address, retrieved date, checksum) and the count of each rejection reason.

**Seed at install**: the seed runs `own` and `kenney` with `--auto-publish` from a release bundle (no outside call); the hand-picked OpenGameArt items ship in the bundle as already-reviewed rows. **Growth**: one source and one category at a time, driven by `ClipLibraryMiss`, a run a month adding 50 to 150 reviewed items. Nothing a user uploads enters the catalogue.

### 4. Search, Favourites And Uploads (API)

Shares Module 12's library module: categories, favourites and credits routes, the generated `tsvector` search, the throttle.

| Route | Query or body | Answer |
|---|---|---|
| `GET /clips/library/sounds` | `q`, `kind=sfx\|music`, `category`, `favourites=true`, `page`, `pageSize` (default 24, max 60) | `{ items, page, pageSize, total, hasMore }` |
| `GET /clips/library/categories?type=sound&kind=` | none | `[{ slug, name, count }]` |
| `PUT /clips/library/favourites`, `DELETE /clips/library/favourites/:type/:itemId` | `{ type: 'sound', itemId }` | favourite on or off |
| `POST /clips/sounds/uploads` | one file | the asset, `checking` |
| `GET /clips/sounds/uploads`, `DELETE /clips/sounds/uploads/:assetId` | none | the workspace's ready sounds; delete refuses with 409 and the count when a clip uses it |

- A sound item: `{ id, name, kind, category, tags, durationMs, bpm, previewUrl, peaks, isFavourite, credit: null }` (a CC BY sound never exists). A query always adds `status = 'ACTIVE'`.
- **Own sounds**: MP3, WAV, M4A and AAC by their real bytes, **at most 20 MB**, a single upload; the storage gauge is checked through `EntitlementResolver.assert` for `clips.storage_gb`. The file lands in the private space under `library/` as a `ClipAsset` of kind AUDIO with `meta.status: 'checking'`, and `clipSoundCheckWorkflow` (`postgear-media`) runs `probeFile` (audio only, at most 10 minutes), makes the peaks, converts to AAC M4A at 48 kHz, and marks it ready or removes it with a sentence. Uploads stay in the workspace and never enter the catalogue.
- A sound removed after a rights request shows "This sound was removed from the library." on its item and **Export Clip** asks before leaving it out; a hidden one keeps working (research 10 section 12).

### 5. The Compiler: The Sound Graph (`render/audio.ts`, pure)

The recipe is cookbook section 8, run on FFmpeg 9.0.2 (a 12 s mix of three sources came out at exactly 12.000000 s, 48000 Hz, 2 channels, and every level window matched the sum of the tones' powers):

```
anullsrc=r=48000:cl=stereo,atrim=duration=DUR,asetpts=PTS-STARTPTS[base];
[VID]volume=VV,aresample=48000,aformat=channel_layouts=stereo[v];
[K:a]aresample=48000,aformat=channel_layouts=stereo,volume=SV,afade=t=in:st=0:d=FI,afade=t=out:st=OUTSTART:d=FO,adelay=MS|MS[sK];
[base][v][s1]...amix=inputs=N:normalize=0:duration=first:dropout_transition=0[mix]
```

- The silent `anullsrc` base of the clip's exact length with `duration=first` fixes the length; `normalize=0` leaves the gains as set (without it each input is divided by the number of inputs). `adelay` takes whole milliseconds, one value per channel (`MS|MS`). `trimStart` becomes `-ss` on the sound's input (or `atrim=start=`); a looping sound uses `-stream_loop -1` and `atrim=duration=`.
- The clip's own sound is the concat output; each segment's `volume` is applied in its chain (muted is `volume=0`). Gains are linear and fades are linear, the same shapes the preview's `GainNode` ramps draw.
- The clip-wide fades (Module 13's Fade In and Fade Out) are an `afade` on the mix, before `loudnorm`. Then `apad=whole_dur` and `-t` (Module 05) keep the sound the same length as the picture.
- **Parity cases** (added to `render-parity.test.ts`): the cookbook's three-tone mix with RMS level windows within 1 dB (voice only, voice with music, all three, effect over); a sound placed at 3.0 s starts within a frame; `adelay` and fades at known times.

### 6. The Loudness Pass (`render/loudness.ts` and `renderClip`)

`amix` sums the layers and does not even out the result, so several loud layers can distort. The render measures and corrects:

- **Pass 1** (`compileMeasure(plan)`): the same sound graph on its own, with `loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json`, to `-f null -`. The JSON block arrives on stderr at normal log level, so this run is **not** started with `-loglevel error`. It costs seconds.
- **Pass 2**: the main run, with `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..:offset=..:linear=true` appended to the mix, writing 48 kHz audio. Verified result: a -32.6 LUFS input came out at -13.8 LUFS by an independent `ebur128` measure (true peak -7.0 dBFS); one dynamic pass gave -14.3.
- **Fallback to dynamic mode**: `linear=true` only holds when the input's loudness range fits the target; otherwise FFmpeg falls back to dynamic mode and says so on stderr. The executor logs it and records the mode.
- **Skip rules**: a clip with no sound at all (no sound items, every part muted or without an audio stream) skips both passes; a clip already within 1 LU of -14 with a true peak at or below -1.5 skips pass 2.
- The job's `output` records `{ inputLufs, inputTp, finalLufs, mode: 'linear' | 'dynamic' | 'skipped' }`, so the real-test plan and Module 15's result line can read it. No extra limiter is added (`loudnorm` has a true-peak ceiling); the loud-clip test in the Done When decides whether one is needed, and the answer goes in the Decision Log.
- Preview Export (Module 15) runs both passes too, so it plays the exact mix.

### 7. The Preview's Sound

`PreviewEngine`'s audio layer (slot from Module 08): each sound is decoded once into an `AudioBuffer` and started with `AudioBufferSourceNode.start(contextTime, offsetSeconds)` when the playhead enters it, re-started on every seek and every segment hand-over (the `<video>` and the audio context are two clocks that can drift by tens of milliseconds), with a `GainNode` whose `linearRampToValueAtTime` ramps follow the item's volume and fades. The context starts suspended until a user gesture; pressing Play is one. Sounds are read from the public bucket (CORS is set up in Module 02). The video's own sound goes through the same graph with `createMediaElementSource`, because `<video>.volume` cannot go above 1 and Video Volume goes to 200%.

The preview **does no loudness normalisation**: it sums the gains. So the balance (music under the voice) matches the export, the overall level does not, and the Audio tab says "Exports are evened out so they are never too quiet or distorted." Preview Export plays the exact mix. Very slow or fast parts may sound rough in both (Module 13).

### 8. The Audio Tab (`components/clips/panels/audio-panel.tsx`)

- At the top, always: **Video Volume** (`Slider`, 0% to 200%) with a mute button (a ghost icon button with `TooltipHint`). With a part selected the slider sets that part; with none, every part.
- `Tabs`: **Sound Effects**, **Music**, **Favourites**, **Uploaded**. Each list has a search field ("Enter your search") that finds sounds by name and tag as you type, and category chips. Each row: a play button (ghost; one preview plays at a time; a plain `<audio>` on the preview address), the name, the length, a small picture of the sound's shape (the peaks), a star ("Add To Favourites", "Remove From Favourites"), a details line (source, author, licence, from `ClipLibrarySource`) behind a small "i", and **Add** (secondary, small). Add puts the sound on the timeline at the playhead, on its own row, and selects it.
- No match: "Nothing found for "zap". Try another word or pick a category." Empty Favourites: "No favourites yet. Star a sound to keep it here." A line under the Music list: "The music shelf is small: loops and short tracks, not songs."
- **Uploaded**: **Upload A Sound** (secondary), rows with a "Checking" state, and a menu with **Delete Sound** (red confirm). A file that is not a sound, or is over 20 MB, is refused with a sentence.
- For the selected sound: **Volume** (`Slider`), **Fade In** and **Fade Out** (`Toggle`s, one second each; music turns both on when added), **From** and **For** (`TimeField`), and **On This Moment** or **Whole Clip** as in the Text panel (Whole Clip loops music to the clip's length).
- A **Credits** link opens `/credits/clips` (built in Module 12; this module adds the sound sources to it).
- The Sound row shows each sound as a bar with its shape (the peaks); the video's own waveform stays under the Video row.
- A small level meter beside Video Volume moves while the clip plays (the preview's `AnalyserNode`), turning to the warning colour when the mix peaks. It is a hint, not a measurement.

### 9. Tests

- Engine: the sound item schema, edits, the 20 limit, the fade and volume curve as a pure function.
- Compiler: the sound graph snapshot (base, a delayed effect with fades, a looping bed, a muted part), `adelay` in whole milliseconds, the `amix` flags, the loudness argument builders as snapshots, the skip rules, the parity cases of section 5, a loud-clip run showing the final loudness near -14 LUFS.
- Ingest: the guard on recorded candidates (every reason; CC BY refused for sounds; brand and derivative names; `needs_review`), normalisation arguments as snapshots, `--dry-run` writes nothing, no start without `CLIPS_LIBRARY_INGEST`, the `own` generator makes decodable files within the loudness targets.
- API: search (kind, category, prefix, ranking, no match with `suggest`, tenancy), favourites, upload (type by bytes, size cap, storage gauge), list, delete in use.
- Web: the panel (previews one at a time, Add at the playhead, star, search and chips, volume and fades change the document, Whole Clip loops, upload states, delete confirm), sound bars, the preview's gain ramps as a pure function.

## Scope

**In**: sound items, the open-source catalogue's sound side (adapters `own`, `kenney`, `opengameart`, the sound guard and normalisation, search, favourites), own sound upload and check, the compiler's sound graph, the loudness pass, the preview's Web Audio layer, the Audio tab, sound bars, the level hint, sound sources on the credits page.
**Out**: Openverse and Freesound intake (Module 21, after written permission), a paid music licence, recording a voice-over, automatic lowering of music under speech, noise removal and voice enhancement (Sprint 13 or later), the operator Library screen (Module 19).

## Tasks

- [x] `AudioItem`, edits, limits, the volume and fade curve.
- [x] The sound side of the ingest: adapters `own` (generator), `kenney`, `opengameart`; the sound guard and the original-work rule; normalisation, encode, peaks, report; the seed bundle.
- [x] The sound search route and the shared pieces reused from Module 12; favourites; the sound credits groups.
- [x] Own sounds: upload, `clipSoundCheckWorkflow`, list, delete.
- [x] The compiler's sound graph and its parity cases.
- [x] The loudness passes in `renderClip` with skip rules and recorded values.
- [x] The preview's audio layer and level hint.
- [x] The Audio panel and sound bars.
- [x] Title-case test green.
- [x] `verify-change`; update the Progress table and the Decision Log (the limiter question, the launch counts reached).

**Gaps at close (2026-11-19)**: the catalogue holds our own 92 sounds (80 effects, 12 music tracks), not the doc's launch volume of about 650 and 150: the Kenney and OpenGameArt adapters are built and tested, but their packs must be downloaded by a person into `CLIPS_LIBRARY_BUNDLE_DIR` (no outside fetch without the owner's word). Openverse and Freesound are built and switched off (Module 21). No limiter was added: the loud test came out at -14.0 LUFS and -1.4 dBTP from a +2.2 dBTP mix. The sound at 150% and the fades were checked by the meter and the export's measurement, not listened to (a headless browser has no ears), so Hand Check 3 is the ear test. Removing a library sound that a clip uses was checked in tests only.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js sounds render
npx jest --config packages/media-tools/jest.config.js render
npx jest --config apps/worker/jest.config.js clips library
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/panels
npm run clips:library:ingest -- --kind sound --source own --dry-run
```

## Done When

- A sound effect and a music loop can be found by search or category, previewed, added, moved, trimmed, faded and removed.
- Starring a sound puts it in Favourites for every member; a removed sound drops off the list with no error.
- An uploaded MP3 becomes usable after its check; a text file renamed `.mp3` is refused with a sentence; an upload never appears in the shared catalogue.
- Video Volume changes the selected part, or every part when none is selected; mute works; 150% is really louder in the editor.
- An exported clip with loud music and a loud video is not distorted, and a quiet clip is brought up: the job's output shows the measured and final loudness, near -14 LUFS.
- The sound ingest refuses CC BY, NC and unknown licences, branded names and derivative signals; it writes a report; new items stay `STAGED` until published; it will not start without `CLIPS_LIBRARY_INGEST=true`.
- A seeded environment shows the launch set: about 650 effects and about 150 music tracks (the real counts go in the Progress notes), and the music line is honest about it.
- `/credits/clips` lists every sound source with its licence.
- No bundled sound files, no Pixabay, Mixkit or YouTube Audio Library item, and no outside request exist anywhere in the code.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin (the seed has run):

1. Audio, Sound Effects: search "whoosh", pick the Whooshes chip. Play two previews (the first stops when the second starts). Add one at the playhead and star it.
2. Music: add a loop, set it to Whole Clip, Volume 20%. It has fades on. Read the line about the small shelf.
3. Favourites: the starred effect is there. Sign in as another member: the same.
4. Set Video Volume to 150% and play: the meter moves, and warns on the loud burst.
5. Upload an MP3 of your own: "Checking", then it is in Uploaded. Add it.
6. Press Preview Export (once Module 15 is in) and listen: nothing is distorted; the music is under the video.
7. Credits: every sound source has its licence.

## Handoff

Module 15 shows the loudness line in the export result, runs both loudness passes for Preview Export, and asks before leaving out a removed sound. Module 19 builds the operator's Library screen and counts uploaded sounds in the workspace's storage. Module 21 holds Openverse and Freesound intake (after the permission emails), a paid music licence and voice-over recording. Sprint 13 adds silence removal, bleeping and text to speech, all of which produce or change sound items and segments through the edits defined here.
