# Sprint 12 Research: Highlight Signals

> **Written**: 2026-11-14, finished 2026-11-15. A fact marked **verified** was read by Claude on the date shown (documentation, source code, a paper) or produced by running FFmpeg 9.0.2 on a small synthetic file made on the spot. A fact marked **reported** was not read. No real video was analysed.
> **Rule for this sprint**: Sprint 12 finds clip moments from signals only: loudness, scene changes and (behind a switch) Twitch chat. No transcription, no vision model, no Python. Sprint 13 adds those as more tracks into the same scorer.

## 1. Summary Matrix

| Signal | Where it comes from | Cost on a 6 hour source | Works for | Sprint 12 |
|---|---|---|---|---|
| Loudness | FFmpeg `ebur128` on the analysis audio | Seconds to a few minutes | Every video with sound | **Yes**, always |
| Scene changes | FFmpeg `scdet` on the editor proxy | The heaviest step: one decode of the proxy | Edited videos, cutscenes, deaths, menus | **Yes**, capped |
| Silence | FFmpeg `silencedetect` | With loudness | Snapping clip edges; muted sections | **Yes**, as a helper, not a score |
| Twitch chat replay | Twitch's private GraphQL route | Hundreds to thousands of small requests | Twitch past broadcasts with a busy chat | **Behind `CLIPS_TWITCH_CHAT`**, off by default, never required |
| YouTube live chat replay | yt-dlp `live_chat` | n/a | Ended YouTube live streams | Out of scope |
| Kick chat replay | No documented route | n/a | n/a | Out of scope |
| Transcript, speech, faces, motion | Sprint 13 | n/a | Talking videos, context | Sprint 13 |

## 2. The Analysis Audio File

Made once at import, kept as a `ClipAsset`, reused by loudness, silence, the waveform and Sprint 13's transcription: 16 kHz, mono.

| Container | Size for 6 hours | Verdict |
|---|---|---|
| WAV, 16-bit PCM | 16,000 x 2 bytes x 21,600 s = 691 MB | Too big to store per video |
| FLAC | Roughly half of WAV (reported) | Lossless, still hundreds of MB |
| AAC, 32 kbps, in M4A | 32,000 / 8 x 21,600 = 86 MB | **Pick**: FFmpeg's own AAC encoder is in every build, and loudness and speech models do not need lossless input (reported) |

```
ffmpeg -i proxy.mp4 -vn -ac 1 -ar 16000 -c:a aac -b:a 32k analysis.m4a
```

For Twitch, yt-dlp's playlist request sets `allow_audio_only=true` (github.com/yt-dlp/yt-dlp `yt_dlp/extractor/twitch.py`, verified 2026-11-14), so the analysis audio could one day be fetched without any video. Not needed in Sprint 12: the proxy is already on disk.

## 3. Loudness

### 3.1 `ebur128` (The Pick)

"EBU R128 scanner filter ... By default, it logs a message at a frequency of 10Hz with the Momentary loudness (identified by M), Short-term loudness (S), Integrated loudness (I) and Loudness Range (LRA)." Momentary is a 400 ms window, short-term is 3 seconds. With `metadata=1`, "the audio input will be segmented into 100ms output frames, each of them containing various loudness information in metadata. All the metadata keys are prefixed with `lavfi.r128.`" (ffmpeg.org/ffmpeg-filters.html, ebur128, verified 2026-11-14).

```
ffmpeg -hide_banner -nostats -loglevel error -i analysis.m4a -af "ebur128=metadata=1,ametadata=mode=print:file=-" -f null -
```

What stdout looks like (run on a synthetic 16 kHz file, verified 2026-11-14): one header line per 100 ms frame, then one line per key.

```
frame:10   pts:16000   pts_time:1
lavfi.r128.M=-47.787
lavfi.r128.S=-47.787
lavfi.r128.I=-70.000
lavfi.r128.LRA=0.000
lavfi.r128.LRA.low=0.000
lavfi.r128.LRA.high=0.000
```

Parse rule: a line starting `frame:` sets the time from `pts_time:`; lines `lavfi.r128.M=` and `lavfi.r128.S=` give LUFS as decimals. Before the first 400 ms are filled, and in digital silence, M reads `-120.691`; clamp everything below -70 to -70. Adding `key=lavfi.r128.M` to `ametadata` prints only that key (verified by running). Without `metadata=1` the same numbers arrive on stderr as `t: 0.199938   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU`, followed at the end by a `Summary:` block with `I:         -23.4 LUFS`, which Module 14's loudness pass can reuse. The stdout form is easier to parse and is the pick.

### 3.2 The Others

| Filter | Invocation | Output | Use |
|---|---|---|---|
| `astats` | `-af "asetnsamples=n=1600:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-"` | `frame:1    pts:1600    pts_time:0.1` then `lavfi.astats.Overall.RMS_level=-47.092778` (verified by running, 2026-11-14) | Plain RMS in dB per 100 ms. Not needed: `ebur128` is weighted the way people hear |
| `volumedetect` | `-af volumedetect` | At the end only: `mean_volume: -29.7 dB`, `max_volume: -19.0 dB` (verified by running; "Statistics about the volume will be printed in the log when the input stream end is reached", ffmpeg.org/ffmpeg-filters.html, verified 2026-11-14) | One number per file: a check that the video has sound at all |
| `silencedetect` | `-af "silencedetect=noise=-35dB:d=0.5"` | stderr lines `silence_start: 3`, then `silence_end: 6` and `silence_duration: 3` on one line, split by a bar (verified by running). Defaults: noise -60 dB, duration 2 seconds (docs, verified 2026-11-14) | A list of quiet gaps: clip edges snap to them, and a long exact silence marks a muted Twitch section |

`ebur128` and `silencedetect` run in one FFmpeg process (`-af "silencedetect=...,ebur128=metadata=1,ametadata=..."`), one pass over the audio (the two were run separately here, not yet chained). Speed on real files was not measured; audio-only analysis is normally hundreds of times faster than real time (reported), so six hours should take a minute or two. Module 16 records the real figure.

## 4. Scene Changes

| Filter | What the documentation says | Output (verified by running, 2026-11-14) |
|---|---|---|
| `select='gt(scene,X)'` with `showinfo` | `scene` is a "value between 0 and 1 to indicate a new scene"; "Comparing scene against a value between 0.3 and 0.5 is generally a sane choice" | stderr: `[Parsed_showinfo_3 @ ...] n:   0 pts:     15 pts_time:7.5 ...` for each kept frame. With `metadata=mode=print:key=lavfi.scene_score:file=-` in place of `showinfo`: `frame:0    pts:15      pts_time:7.5` then `lavfi.scene_score=0.717847` |
| `scdet` | "sets frame metadata with mafd between frame, the scene score"; threshold is "a percentage of maximum change. Good values are in the [8.0, 14.0] range", default 10 | stderr at each cut: `[Parsed_scdet_2 @ ...] lavfi.scd.score: 28.041, lavfi.scd.time: 7.5`. With `metadata=mode=print:file=-`, **every** frame: `frame:9    pts:9       pts_time:4.5`, `lavfi.scd.mafd=1.259`, `lavfi.scd.score=0.230` |

(ffmpeg.org/ffmpeg-filters.html, select and scdet, verified 2026-11-14.)

**Pick `scdet` with the metadata print**: it gives a score for every sampled frame (0 to 100), so the track is a continuous "how much is the picture changing" curve, and cuts are simply the samples at or above 10.

```
ffmpeg -hide_banner -nostats -loglevel error -skip_frame nokey -i proxy.mp4 -an -vf "scale=320:-2,scdet=threshold=10,metadata=mode=print:file=-" -f null -
```

**Cost, and how to cap it.** Measured on a 60 second synthetic 720p30 H.264 file on a 12-thread laptop (verified by running, 2026-11-14; far too short to be exact, and a synthetic picture decodes faster than gameplay):

| Run | Speed |
|---|---|
| Decode only | 29 x real time |
| `scdet` at full rate and size | 22 x |
| `fps=2,scale=320:-2,scdet` | 24 x |
| `-skip_frame nokey` + `scale=320:-2,scdet` | 59 x |

The lesson: decoding is the cost. `fps=2` drops frames after they are decoded, so it barely helps. `-skip_frame nokey` (an input option) decodes keyframes only, which is the real saving. At 20 to 30 x, six hours of 720p costs 12 to 18 minutes of CPU; keyframes-only should be several times faster on a long file. The caps, in order:

1. Decode keyframes only. We write the proxy ourselves, so its keyframe interval (2 seconds proposed, Module 04) sets the scene sample rate at 0.5 Hz, with extra keyframes where the encoder saw a cut.
2. Scale to 320 wide before `scdet`.
3. A time limit of one tenth of the source length; past it the scene track is dropped and the scorer runs without it.
4. Scene analysis runs after loudness, so a slow host still produces clips.

## 5. Chat Replay

### 5.1 Twitch (Unofficial, Behind A Switch)

**No official route.** Helix has no endpoint for a past broadcast's chat. The 2025 and 2026 entries of Twitch's change log add clip endpoints and chat-sending features, but nothing that reads past messages (dev.twitch.tv/docs/change-log, first 100,000 characters, verified 2026-11-14). EventSub and IRC deliver live chat only.

**The route everybody uses** is the one the Twitch web player uses, read here in TwitchDownloader's source (github.com/lay295/TwitchDownloader `TwitchDownloaderCore/ChatDownloader.cs` and `TwitchObjects/Gql/GqlCommentResponse.cs`, MIT, verified 2026-11-14):

| Part | Value |
|---|---|
| Request | `POST https://gql.twitch.tv/gql`, header `Client-ID` (the web client's public id), JSON body |
| Operation | `VideoCommentsByOffsetOrCursor`, a persisted query named by a hard-coded `sha256Hash` |
| Variables | First page: `{ "videoID": "<id>", "contentOffsetSeconds": <start> }`. Later pages: `{ "videoID": "<id>", "cursor": "<last edge cursor>" }` |
| Answer | `data.video.comments.edges[].node` with `contentOffsetSeconds`, `createdAt`, `commenter`, `message.fragments[]` (`text`, and `emote` when the fragment is an emote); `pageInfo.hasNextPage` |
| Known oddities | "video.comments can be null for some dumb reason": retried with a growing wait, giving up after ten ("Received too many null comment lists"). A `commenter` can be null (deleted account). `data.video` is null for a deleted or expired VOD. Offsets can be shifted against the video ("Video comments are offset by ~N seconds. Adjusting offsets...") |

**Breakage history** (github.com/lay295/TwitchDownloader/releases, verified 2026-11-14): the latest release is 1.56.5 on 2026-07-20, and the notes of the last ten releases include "Update ShareClipRenderStatus query hash", "Update chapter query hash", "Update clip info API", "Fix issues with downloading clip chats" and "Fix being unable to download chats from VODs with wrong lengths". Twitch changes these private queries a few times a year, with no notice. An earlier break in 2023, when Twitch began asking for an integrity token, is reported, not read.

**Limits.** A channel can turn chat replay off for its past broadcasts, and then the route returns nothing (reported). A page holds a few dozen messages (reported), so a busy six hour stream is thousands of requests; we fetch one page at a time, cap at 3,000 pages and 5 minutes, and keep what we have.

**Why a switch, and never required.** The route is undocumented, rides on Twitch's own client id, can break or be blocked on any day, and sits outside the developer agreement (see `07-legal-limits-cost-and-risks.md`). So: `CLIPS_TWITCH_CHAT=false` by default; a failure is a warning on the run ("Chat could not be read"), never an error; the scorer treats chat as an optional track; and we store only the per-second counts, never names or message text.

### 5.2 YouTube And Kick (Out Of Scope)

- **YouTube**: ended live streams have a chat replay, and yt-dlp exposes it as a `live_chat` subtitle with protocol `youtube_live_chat_replay` (`yt_dlp/extractor/youtube/_video.py`, verified 2026-11-14). Ordinary uploads have none. Out of scope for Sprint 12.
- **YouTube "most replayed"**: yt-dlp's test for a YouTube video lists a `heatmap` field with 100 points (`yt_dlp/extractor/youtube/_clip.py`, verified 2026-11-14). It arrives in the probe JSON for free and is a ready-made highlight curve for popular videos. Its exact shape was not read (reported: `start_time`, `end_time`, `value`). Not in the sprint's three signals; see the open questions.
- **Kick**: the public API's change log shows chat sending, deleting and webhook events, and no route for past messages (docs.kick.com, verified 2026-11-14); yt-dlp's Kick extractor has no chat support (`yt_dlp/extractor/kick.py`, verified 2026-11-14). The site's own private endpoint is reported only. Out of scope.

## 6. What The Paper And The Open Repositories Do

| Source | Signals | Method and numbers | What we take |
|---|---|---|---|
| **Lightor**: "Towards Extracting Highlights From Recorded Live Videos: An Implicit Crowdsourcing Approach", Jiang, Qu, Wang, Wang, Zheng (arXiv 1910.12201, read at ar5iv.labs.arxiv.org/html/1910.12201, verified 2026-11-14; the copy at www2.cs.sfu.ca/~jnwang/papers/lightor.pdf would not open in the reader) | Chat only: message count, message length (hype messages are short), message similarity | 25 second sliding windows scored by logistic regression. **Chat lags the moment**: start = peak - c, with c learned and stable "in the range from 23s to 27s". Picked windows must be at least 120 seconds apart; overlapping windows keep the one with more messages. Chat Precision@10 of 0.82 from one labelled video. Needs about 500 or more chat messages an hour; ad bots inflate counts; breaks and game set-up get flagged | The lag (windows start well before the chat peak), a minimum distance between picks, the 500 an hour floor, and the honest limits |
| **hougesen/twitch-highlight-finder** (MIT; `highlight-finder/src/finder/mod.rs`, `analyzer/src/analysis/mod.rs`, verified 2026-11-14) | Chat, weighted by emotes, which makes it "indifferent to languages" | Message score = (10 + the highest emote score in the message) / 10, with emote scores 0 to 10 (the tests use Kappa 8, PogChamp 10). Scores are summed in fixed 10 second buckets. The average ignores buckets under one message a second. A bucket is an outlier above 2 x max(95th percentile, average, 10). Neighbouring outliers join into one clip. No lead-in; its own note says "TODO: switch to sliding window?" | Emote weighting as a per-message multiplier; ignoring dead time when taking the baseline; joining neighbours |
| **nirvagold/stream-clipper** (MIT; `src-tauri/src/highlight/scorer.rs`, `merger.rs`, `types.rs`, `audio/analyzer.rs`, `chat/analyzer.rs`, verified 2026-11-14) | Audio RMS plus voice detection; chat rate, keywords ("POG", "CLIP IT", "OMG"), emote density | Baseline = the **median**. Audio: a chunk must pass a percentile threshold and either hold voice or meet three of: sudden change, a transient, sustained into the next chunk, above baseline + 1.5 standard deviations; spikes within 3 seconds merge, 2 second minimum. Chat: 5 second windows, a spike when the count passes baseline x a multiplier, or enough keywords, or emote density. Combine: audio 0.6, chat 0.4, **x 1.5 when both overlap**. Highlights overlapping by more than half of the shorter one merge. Each carries a 0 to 100 score and plain reasons, and padding before and after | The median baseline, the agreement bonus, the merge rule, and reasons as a list beside the score |
| **joaohenggeler/twitch-chat-highlights** (MIT; README, verified 2026-11-15) | Counts of chosen words and emotes per category ("counting the occurrence of the LUL emote in a 20-second window") | `bucket_length`, a `message_threshold` floor, `top_bucket_distance_threshold` (drop lower-ranked picks too close to a better one), `top_url_delay` ("how many seconds to subtract ... to give context") | Named reaction categories, keeping the best of nearby picks, and the lead-in |
| **josec07/clipper** | n/a | **Not read: the repository answered 404 on 2026-11-14** (page, raw files, and the owner's public list). A search snippet describes it as a chat burst detector with fuzzy word matching and no machine learning (reported) | Nothing |

**Reaction words.** A starter list for the chat weight, case-insensitive, whole words: `LUL`, `KEKW`, `OMEGALUL`, `LMAO`, `POG`, `Pog`, `PogChamp`, `POGGERS`, `W`, `L`, `clip it`, `clip that`, `CLIP`, `OMG`, `WTF`, `monkaS`, `Kappa` (`PogChamp`, `Kappa`, `POG`, `CLIP IT`, `OMG` and `LUL` appear in the repositories above; the rest are reported). Third-party emotes (BetterTTV, FrankerFaceZ, 7TV) arrive as plain words in the text, which is why word matching catches them.

## 7. The Proposed Scorer

A pure function in `packages/video-engine` (no FFmpeg, no network, no clock, no randomness): `scoreHighlights(tracks, durationSec, options) -> HighlightRange[]`. The same tracks always give the same clips, which is what makes simulation and tests exact.

**Inputs**: named, versioned tracks sampled at a fixed rate.

| Track | Version | Rate | Value |
|---|---|---|---|
| `loudness` | 1 | 10 Hz | Momentary loudness in LUFS x 10, as an integer, floor -700 |
| `scene` | 1 | 2 Hz | `scdet` score 0 to 100 (the highest in each half second; 0 where no frame was sampled) |
| `chat` | 1 | 1 Hz | Weighted messages in that second x 10: each message counts 1.0, or 1.5 when it holds a reaction word or an emote |

**Steps.**

1. **One grid.** Resample every track to 2 Hz: loudness and scene take the highest value in each half second; chat is spread evenly, then smoothed with a 5 second average.
2. **Rolling baseline.** For each sample, the median and the median absolute deviation (MAD) of the track over the surrounding 300 seconds (150 each side; the whole file when it is shorter than 10 minutes). Rolling, because a stream's level drifts as the game, music and audience change.
3. **Z-score.** `z = (x - median) / (1.4826 x MAD + floor)`, clamped to 0 to 6, so only upward spikes count. Floors stop a silent stretch making everything look loud: 1 LU for loudness, 2 for scene, 0.2 messages a second for chat.
4. **Chat lag.** Shift the chat track 8 seconds earlier before combining, so the chat reaction lines up with the sound of the moment.
5. **Weighted sum.** `S = sum(w x z) / sum(w)` over the tracks that are present. If two or more tracks have `z >= 2` within 5 seconds of each other, multiply `S` by 1.25.
6. **Peaks.** Smooth `S` over 3 seconds. Take local highs with `S >= 2.0`, strongest first, dropping any within 45 seconds of one already taken. Keep at most one per 6 minutes of video, never fewer than 5 allowed or more than 30.
7. **Windows.** Start = peak - lead-in, end = peak + 8 seconds, then extend the end while `S` stays above 1.0. Snap the start back to a scene cut within 3 seconds, else to the end of a silence within 2 seconds. Clamp the length to 15 to 60 seconds (grow backwards first: context comes before the moment) and to the video's bounds.
8. **Merge.** Two windows overlapping by more than half of the shorter one become one, keeping the higher score; if the result passes 60 seconds, keep 60 around the stronger peak.
9. **Score.** `score = round(100 x (1 - exp(-S_peak / 2.5)))`: 2.0 gives 55, 3.0 gives 70, 4.0 gives 80, 6.0 gives 91.
10. **Reasons.** Up to two, strongest first, from each track's highest `z` within 5 seconds of the peak. Stored as codes; the copy lives in the messages file.

| Default | With chat | Without chat |
|---|---|---|
| Weight: `chat` | 0.50 | n/a |
| Weight: `loudness` | 0.35 | 0.70 |
| Weight: `scene` | 0.15 | 0.30 |
| Lead-in | 20 s when chat is the strongest reason | 12 s |

| Reason code | Condition | Shown as |
|---|---|---|
| `chat_burst` | chat `z >= 3` | "Chat exploded" |
| `chat_rise` | chat `z >= 2` | "Chat picked up" |
| `loud` | loudness `z >= 3` | "Loud reaction" |
| `louder` | loudness `z >= 2` | "Louder than usual" |
| `fast_cuts` | scene `z >= 2` | "Fast scene changes" |
| `agreement` | the 1.25 bonus applied | "Sound and chat peaked together" |

**Missing tracks.** A track that is absent is left out and the weights are divided by the sum of those present, so scores stay on the same scale. A track counts as absent when it does not exist (no chat on YouTube, Kick or uploads; the switch is off; the fetch failed), when it is flat (MAD of 0 across the file), or when chat has fewer than 500 messages an hour (Lightor's floor). The run records which tracks were used, so the screen can say "Found from sound and picture" or "Chat was too quiet to use". With no usable track at all (a silent screen recording), the run returns no clips and the plain message "We could not find strong moments in this video. Mark clips by hand."

**Where the numbers come from.** The lag and the minimum distance follow Lightor (which uses a longer 120 seconds because it ranks whole highlights, not 15 to 60 second clips); the median baseline, the bonus and the merge rule follow stream-clipper (its bonus is 1.5; ours is milder because our tracks are already normalised); the emote weight follows twitch-highlight-finder. Every threshold above is a starting value: none has been tuned on real videos, and Module 16 must log hand-made clips beside the proposals so the real-test pass can adjust them. A change to any default bumps the scorer version (`signals-v1`).

**Cost.** Six hours at 2 Hz is 43,200 samples per track. A rolling median over 600 samples, recomputed every 10 seconds and interpolated, is a few million operations: well under a second.

## 8. Track File Format

**Proposal: one gzipped JSON file per track**, matching the `SignalTrack` type in Module 01 with three optional additions (`unit`, `startSec`, `meta`).

```json
{ "name": "loudness", "version": 1, "sampleRateHz": 10, "unit": "lufs_x10", "startSec": 0,
  "values": [-700, -478, -472, -231],
  "meta": { "tool": "ffmpeg 9.0.2", "filter": "ebur128", "sourceDurationSec": 21600 } }
```

Values are integers (scaled by ten), so the JSON stays short and compresses well; sample `i` covers the time `startSec + i / sampleRateHz`. No nulls: a missing sample is the track's floor. Stored at `clips/<orgId>/<videoId>/track-<name>-<hex>.json.gz` as a `ClipAsset`.

| Track, 6 hours | Samples | Raw JSON (arithmetic) | Gzipped (estimate, not measured) |
|---|---|---|---|
| `loudness`, 10 Hz | 216,000 | about 1.1 MB (5 characters a value) | 250 to 400 KB |
| `scene`, 2 Hz | 43,200 | about 130 KB | 20 to 40 KB (mostly zeros) |
| `chat`, 1 Hz | 21,600 | about 65 KB | 15 to 25 KB |

Under half a megabyte per six hour video in total. A typed-array layout (a JSON header line, then little-endian Int16) would be 432 KB raw for loudness and 86 KB for scene, a little smaller and faster to read, but it cannot be opened, diffed or hand-edited, and the simulation mode ships recorded tracks as fixtures in the repository. **Recommendation**: gzipped JSON in Sprint 12; the `version` field leaves room to change the layout later.

**Rules.** A track is written once and reused: pressing Find Clips again, or shipping a new scorer, costs no FFmpeg time. Changing how a track's values are produced bumps its `version`; the scorer refuses versions it does not know and the run says which track was skipped.

## 9. Honest Limits

| What signals cannot do | Why | What we say or do |
|---|---|---|
| Calm talking videos (podcasts, tutorials, interviews) | Speech has no loudness spikes and no cuts | Few or no clips, and the plain "mark clips by hand" message. This is the main gap until Sprint 13 |
| Know where a thought starts and ends | No words | Silence snapping helps a little; a clip can still open mid-sentence |
| Tell a great play from a loud alert | A donation sound, an ad, intro music and a jump scare all look alike | Reasons are shown so a person can judge in a second; clips are proposals with status NEW |
| Tell hype from spam | Raids, sub trains and bots flood chat (Lightor names ad bots) | The floor of 500 messages an hour, the per-message weight cap, and the agreement bonus |
| Use chat anywhere but Twitch | No replay route for uploads, YouTube or Kick in this sprint | Sound and picture only, with different weights |
| See through muted audio | Twitch silences claimed music | Long exact silences are excluded from the baseline |
| Say anything about a single-camera gameplay stream from cuts | The picture changes all the time, or never | Scene has the lowest weight |

**What Sprint 13 adds**, each as one more track or as a re-ranker over the same windows: a transcript (sentence edges for snapping, hooks, topics, and scoring by a language model), a `speech` track from voice detection, `motion` and "fail" detection, `faces`, and a vision check on the top candidates. The scorer's shape (tracks in, ranges out) does not change.

## 10. Open Questions

**Open question for Arvind**: turn Twitch chat on for the first release? Recommendation: keep `CLIPS_TWITCH_CHAT=false`, try it in the real-test pass on three busy streams, and turn it on only if it holds for the whole pass.

**Open question for Arvind**: use YouTube's "most replayed" curve as a fourth track (`replay`)? It is free in the probe and would be the strongest signal for popular uploads, where chat does not exist. Recommendation: yes, as a small addition to Module 16, if the Module 03 spike confirms the field's shape; it stays optional like chat.

**Open question for Arvind**: scene analysis on keyframes only (fast, coarse) or at 2 frames a second (finer, several times slower)? Recommendation: keyframes only, with the Module 16 measurement on a real six hour proxy deciding.

**Open question for Arvind**: who tunes the weights? Recommendation: the real-test plan records, per test video, which proposed clips Arvind kept and which moments he marked by hand; one tuning round follows, then the defaults are frozen as `signals-v1`.
