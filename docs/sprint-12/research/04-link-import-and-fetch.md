# Sprint 12 Research: Link Import And Fetch

> **Written**: 2026-11-14, finished 2026-11-15. A fact marked **verified** was read by Claude on the date shown, in the tool's own documentation, source code or issue tracker. A fact marked **reported** comes from memory or a secondary source and was not read.
> **What was not done**: no video was downloaded and yt-dlp was never run against a real site. Everything here comes from reading. Section 7 lists what the Module 03 real-network spike must prove before the rest of the sprint leans on it.
> **Decision on record** (Arvind, 2026-11-14): pasting YouTube, Twitch and Kick links is in scope, through open-source tools. This file records how it works, the risks and the mitigations. It does not reopen the decision.
> **Short names used below**: "yt-dlp README" is github.com/yt-dlp/yt-dlp/blob/master/README.md and "yt-dlp source" is a file under github.com/yt-dlp/yt-dlp/tree/master/yt_dlp.

## 1. Summary Matrix

| Platform | Kinds in Sprint 12 | How the video is served | What yt-dlp needs | Range fetch | Biggest risk |
|---|---|---|---|---|---|
| YouTube | vod, short, clip | Separate video and audio streams over HTTPS, merged by FFmpeg | Deno for the JavaScript challenges; sometimes a PO Token; sometimes cookies | `--download-sections` with padding, then our exact cut | "Sign in to confirm you're not a bot" on server addresses |
| Twitch | vod (past broadcast, highlight), clip | HLS: one media playlist per quality, MPEG-TS segments. Clips are MP4 files | Nothing extra | Our own playlist slice, handed to FFmpeg | Past broadcasts expire; sub-only; the route is Twitch's private GraphQL |
| Kick | vod, clip | HLS on `stream.kick.com` | Browser impersonation (curl_cffi) for the API calls | Our own playlist slice, handed to FFmpeg | Cloudflare checks; the open section bug 16054 |

## 2. yt-dlp Basics

### 2.1 Licence, Releases And Files

| Fact | Detail |
|---|---|
| Licence of the code | The Unlicense: "free and unencumbered software released into the public domain" (github.com/yt-dlp/yt-dlp/blob/master/LICENSE, verified 2026-11-14). |
| Licence of the standalone files | "the PyInstaller-bundled executables include GPLv3+ licensed code, and as such the combined work is licensed under GPLv3+" (yt-dlp README, Licensing, verified 2026-11-14). We run it as a separate program and never link it, so the house licence rule holds, but the worker image ships a GPLv3+ binary and must keep its notices. |
| Release channels | `stable` "(mostly) monthly", and "often stale and prone to external breakage"; `nightly` is "the recommended channel for regular users"; `master` builds after every push (yt-dlp README, Update, verified 2026-11-14). |
| Real cadence | The last twelve stable tags: 2026.10.26, 10.21, 08.19, 07.04, 06.09, 03.17, 03.13, 03.03, 02.21, 02.04, 01.31, 01.29. The longest gap is twelve weeks (api.github.com/repos/yt-dlp/yt-dlp/releases, verified 2026-11-14). |
| Age warning | A version "older than 90 days" prints a warning (yt-dlp README; `update.py`, verified 2026-11-14). |
| Files | `yt-dlp_linux` (glibc 2.17 or later), `yt-dlp_linux_aarch64`, `yt-dlp_musllinux`, `yt-dlp.exe`, `yt-dlp_macos` are standalone. The file named `yt-dlp` is a zip that needs Python 3.11 or later. The `.zip` "unpackaged" builds have "no auto-update" (yt-dlp README, Release Files, verified 2026-11-14). |
| What the standalone files carry | The Python runtime, `yt-dlp-ejs` and curl_cffi. curl_cffi is "included in most builds except `yt-dlp` (Unix zipimport binary) and `yt-dlp_x86`" (yt-dlp README, Impersonation, verified 2026-11-14). |
| What it needs beside it | `ffmpeg` and `ffprobe` (merging, sections) and a JavaScript runtime for YouTube (yt-dlp README, Dependencies, verified 2026-11-14). |

### 2.2 Probe Without Downloading

`-J` (`--dump-single-json`): "Quiet, but print JSON information for each URL or infojson passed. Simulate unless --no-simulate is used. If the URL refers to a playlist, the whole playlist information is dumped in a single line" (yt-dlp README, verified 2026-11-14). One line of JSON arrives on stdout; warnings and errors go to stderr.

```
yt-dlp -J --ignore-config --no-playlist --use-extractors <allowlist> --js-runtimes deno:<path> --color never --socket-timeout 20 -- <canonical url>
```

| JSON field | Use | Note |
|---|---|---|
| `_type` | Must be `video` | Set to `video` when absent (`YoutubeDL.py` `sanitize_info`, verified 2026-11-14). `playlist` is refused. |
| `id`, `extractor`, `extractor_key` | Identity and dedup | `extractor` is the extractor's name: `youtube`, `twitch:vod`, `twitch:clips`, `kick:vod`, `kick:clip` (`YoutubeDL.py` line 1902 and the extractor files, verified 2026-11-15). |
| `title`, `uploader`, `uploader_id`, `channel`, `channel_id`, `timestamp` | The preview card | "None of the aforementioned meta fields are guaranteed to be present" (yt-dlp README, verified 2026-11-14). Every field is optional in our Zod shape. |
| `duration` | Plan limit check | Seconds. Missing on a running stream. |
| `is_live`, `was_live`, `live_status` | Refuse live | `live_status` is one of `not_live`, `is_live`, `is_upcoming`, `was_live`, `post_live` ("was live, but VOD is not yet processed") (yt-dlp README, verified 2026-11-14). |
| `availability`, `age_limit` | Refuse gated videos | `availability` is `private`, `premium_only`, `subscriber_only`, `needs_auth`, `unlisted` or `public` (yt-dlp README, verified 2026-11-14). |
| `thumbnails[]` | The preview card | `url`, sometimes `width`, `height`, `preference`. |
| `section_start`, `section_end` | A YouTube clip's range inside its parent video | Set by the `youtube:clip` extractor (`extractor/youtube/_clip.py`, verified 2026-11-14). |
| `formats[]` | Our format picker | `format_id`, `ext`, `vcodec`, `acodec` (the text `none` when the stream is absent), `height`, `width`, `fps`, `tbr`, `filesize` or `filesize_approx`, `protocol` (`https`, `m3u8_native`, `http_dash_segments`, `mhtml`), `url`, `manifest_url` (yt-dlp README, Filtering Formats; `extractor/common.py`, verified 2026-11-14). |

Twitch adds storyboard formats (`sb0`, `sb1`, ext `mhtml`, no video codec) that the picker must drop (`extractor/twitch.py`, verified 2026-11-14). HLS formats usually carry no `filesize`; estimate it as `tbr` times `duration`.

### 2.3 Flags On Every Call

| Flag | Why |
|---|---|
| `--ignore-config` | "Don't load any more configuration files", so a stray config on the box cannot change behaviour. |
| `--no-playlist` | "Download only the video, if the URL refers to a video and a playlist". It does not refuse a pure playlist or channel link; link recognition and the `_type` check do that. |
| `--use-extractors youtube,youtube:clip,twitch:vod,twitch:clips,kick:vod,kick:clip` | The allowlist. Names are matched as regular expressions against the lower-cased extractor names (`YoutubeDL.py` lines 932 to 939, verified 2026-11-15). The generic extractor is never on. Whether the bare name `youtube` also lets `youtube:tab` through is a spike check. |
| `--js-runtimes deno:<path>` | "Only deno is enabled by default"; the path is passed so nothing depends on `PATH`. |
| `--abort-on-unavailable-fragments` | The default is `--skip-unavailable-fragments`, which would leave silent holes in a video. |
| `--retries 3 --fragment-retries 3 --socket-timeout 20` | Defaults are 10 and 10; the workflow owns retries. |
| `--match-filters "!is_live & live_status!=is_upcoming & duration<=?<max>"` | A second lock on fetch calls. A rejected video prints "does not pass filter (...), skipping .." (`utils/_utils.py`, verified 2026-11-14). |
| `--max-filesize <size>` | Only the plain HTTP downloader honours it (`downloader/http.py` is the one place that checks it; HLS, DASH and FFmpeg downloads do not; verified 2026-11-14). The runner must also watch the scratch folder and kill the process past the cap. |
| `--proxy`, `--cookies` | From env only (section 11). |
| `--cache-dir <worker folder>`, `--color never`, `--no-mtime`, `-o <scratch>/<name>.%(ext)s`, `--` before the address | Housekeeping; `--` stops an address being read as a flag. |

Never passed: `--enable-file-urls` ("disabled by default for security reasons"), `--cookies-from-browser`, `--exec`, `--remote-components`, `--live-from-start`, `--print-traffic` (all yt-dlp README, verified 2026-11-14).

### 2.4 Format Selection, Sections And Cuts

| Need | Selector |
|---|---|
| Editor proxy: best H.264 at or below 720p with AAC | `-f "bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720]/b[height<=720]/b" --merge-output-format mp4` |
| A chosen height `H` | `-f "bv*[vcodec^=avc1][height<=H]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=H]/b[height<=H]"` |
| The sort form, which never comes back empty | `-S "res:720,vcodec:h264,acodec:aac" -f "bv*+ba/b"` (the README's own `-t mp4` preset sorts with `vcodec:h264,...,acodec:aac`) |

The first branch serves YouTube (separate streams), the second a muxed H.264 stream (Twitch and Kick HLS), the third anything at or below 720p, which the import step re-encodes. "Formats for which the value is not known are excluded unless you put a question mark after the operator", which is why Twitch clips (no codec fields) fall to the third branch (yt-dlp README, Format Selection, verified 2026-11-14). The default sort prefers `av01 > vp9.2 > vp9 > h265 > h264`, so we must always ask for H.264.

**Recommended**: the probe already returns every format, so a pure `pickFormats(linkInfo, quality)` in our code chooses the ids and the fetch passes `-f <video id>+<audio id>`. The picker is tested on fixtures; the selector strings above stay as the fallback.

**Sections.** `--download-sections "*<start>-<end>"`: 'A "*" prefix denotes time-range instead of chapter ... Needs ffmpeg' (yt-dlp README, verified 2026-11-14). In the source, a section request always goes to the FFmpeg downloader, which puts `-ss <start> -t <length>` in front of each input and adds `-c copy` unless `--force-keyframes-at-cuts` is set (`downloader/__init__.py` line 89, `downloader/external.py`, verified 2026-11-14). `--force-keyframes-at-cuts` "is slow due to needing a re-encode, but the resulting video may have fewer artifacts around the cuts". When FFmpeg cannot take the format, yt-dlp stops with "This format cannot be partially downloaded. Aborting" (`YoutubeDL.py`, verified 2026-11-14).

### 2.5 Progress Output

`--newline` prints each update on its own line; `--progress-template` exposes the video under `info` and the numbers under `progress`; `--progress-delta SECONDS` spaces the lines (yt-dlp README, verified 2026-11-14).

```
--newline --progress-delta 1 --progress-template "download:PG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(progress.eta)s"
```

Missing numbers should print as `NA`, the `--output-na-placeholder` default (yt-dlp README, verified 2026-11-14; that it applies to progress lines is spike check 4). Percent is `downloaded_bytes / (total_bytes or total_bytes_estimate)`, or `fragment_index / fragment_count` for HLS. **The FFmpeg downloader reports nothing until it ends**: an external downloader fires one `finished` event (`downloader/external.py`, verified 2026-11-14). So a YouTube section fetch has no percentage; show a busy bar, or grow it from the output file's size against the estimate.

### 2.6 Exit Codes

`0` success; `1` any reported error (an `ERROR:` line on stderr) or a cookie load error; `2` bad options; `100` the updater failed or needs a restart; `101` downloads cancelled by `--max-downloads` or `--break-match-filters` (`__init__.py`, verified 2026-11-14). Code 1 covers almost every failure, so the cause is read from the stderr text (section 10).

## 3. YouTube

**Link shapes** (`extractor/youtube/_video.py` `_VALID_URL`, `_clip.py`, verified 2026-11-14): `watch?v=<id>`, `youtu.be/<id>`, `/shorts/<id>`, `/live/<id>`, `/embed/<id>`, `/v/<id>`; the id is 11 characters of `[0-9A-Za-z_-]`. `youtube.com/clip/<clip id>` is its own extractor: it reads the page, finds the parent video and returns it with `section_start` and `section_end` in seconds.

**Formats.** The `-f` ids are YouTube's itags. Only one muxed (progressive) stream is still common, itag 18, 360p H.264 with AAC; everything else is a video-only or audio-only stream. H.264 (`avc1`) stops at 1080p; 1440p and above are VP9 or AV1 only; AAC audio is itag 140 at about 128 kbps (all reported, to be confirmed from a real probe in the spike). So the 720p proxy is two downloads and an FFmpeg merge, and a 4K export means fetching VP9 or AV1 and re-encoding, which the exact pre-cut does anyway.

**The JavaScript runtime.** "To download from YouTube, yt-dlp needs to solve JavaScript challenges presented by YouTube using an external JavaScript runtime" (github.com/yt-dlp/yt-dlp/wiki/EJS, verified 2026-11-14). Deno 2.3.0 or later is on by default; Node needs 22.0.0 or later and `--js-runtimes node`, which is above the repo's 20.9 floor, so Deno is the pick (see `02-libraries.md`). The solver scripts are inside the official executables. With no runtime, the `web` and `tv_samsung` clients are dropped and only `visionos` remains (yt-dlp README, `player_client`, verified 2026-11-14); the warning reads "n challenge solving failed: Some formats may be missing".

**The bot check.** YouTube answers some server addresses with "Sign in to confirm you're not a bot". yt-dlp turns any reason that says "sign in" into an error with a cookies hint, and reports "All player responses are invalid. Your IP is likely being blocked by Youtube" when every client is refused (`_video.py`, verified 2026-11-14).

| Mitigation | What the documents say | Cost and risk |
|---|---|---|
| A clean address (`--proxy`) | "a PO Token does not bypass IP-based login restrictions" (github.com/Brainicism/bgutil-ytdlp-pot-provider README, verified 2026-11-14) | Paid by the GB; only the fetch goes through it |
| A PO Token provider | "TL;DR recommended setup: Use a PO Token Provider plugin to provide the `mweb` client with a PO Token for GVS requests" (github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide, verified 2026-11-14). bgutil is an HTTP server on port 4416 (Docker image, Node 22 or Deno 2) plus a yt-dlp plugin zip; it "does not guarantee bypassing 403 errors or bot checks" | One more container; must bind to loopback only |
| Player clients | Default `tv_samsung,visionos,web`; `--extractor-args "youtube:player_client=..."` changes it. `web`: "Only SABR formats available"; `tv`, `web_embedded`, `android_vr`: no token needed (yt-dlp README; PO Token Guide, verified 2026-11-14) | Free; changes with every yt-dlp release |
| Cookies of an operator account | "By using your account with yt-dlp, you run the risk of it being banned"; cookies rotate, so they are exported from a private window that is then closed (github.com/yt-dlp/yt-dlp/wiki/Extractors, verified 2026-11-14) | Last resort; never a customer's cookies |
| Slow down | "the rate limit for guest sessions is ~300 videos/hour"; past it the error is "This content isn't available, try again later", for "up to an hour" (wiki Extractors; `_video.py`, verified 2026-11-14) | Free |

**Age-gated, members-only, private.** Cookies are "only necessary for content that requires an account to access, such as private playlists, age-restricted videos and members-only content" (wiki Extractors, verified 2026-11-14). The `web_embedded` client "only successfully works around the age-restriction sometimes" (yt-dlp README, verified 2026-11-14). Sprint 12 refuses all three: `age_limit >= 18`, an `availability` other than `public` or `unlisted`, or the error text, map to a plain message.

## 4. Twitch

**Link shapes** (`extractor/twitch.py`, verified 2026-11-14): `twitch.tv/videos/<digits>`, `twitch.tv/<channel>/v/<digits>` and `/video/<digits>`, `player.twitch.tv/?video=v<digits>` (hosts `www`, `m`, `go`); clips at `clips.twitch.tv/<slug>` and `twitch.tv/<channel>/clip/<slug>`; a bare `twitch.tv/<channel>` is the live stream. A `?t=1h2m3s` on a video link becomes `start_time`.

**How a past broadcast is served** (same file, verified 2026-11-14): a GraphQL call to `gql.twitch.tv/gql` with the web player's public Client-ID returns a playback access token (`value`, `signature`); `usher.ttvnw.net/vod/<id>.m3u8` with `allow_source=true`, `allow_audio_only=true`, `supported_codecs=av1,h265,h264`, `sig` and `token` returns the master playlist; each quality is a media playlist. "Source" is the rendition whose address contains `/chunked/`. The request also asks for an audio-only rendition. Renditions can be AV1 or HEVC, so the picker asks for `avc1` first. Segments are about ten seconds of MPEG-TS (reported).

| Topic | Fact |
|---|---|
| Sub-only | Usher answers 403 with `vod_manifest_restricted` or `unauthorized_entitlements`; yt-dlp says "You must be logged into an account that has access to this subscriber-only content" (`twitch.py`; the same codes in `TwitchDownloaderCore/TwitchHelper.cs`, verified 2026-11-14). Refused. |
| Still running | `is_live` is true while the thumbnail is the `404_processing` image on an `ARCHIVE` broadcast (`twitch.py`, verified 2026-11-14). Refused. |
| Muted audio | Twitch silences parts with claimed music; TwitchDownloader's notes speak of "Restore VOD unmuting" and of old "muted highlights" (github.com/lay295/TwitchDownloader/releases, verified 2026-11-14). The segment naming is reported, not read. We take what the playlist gives; the loudness track sees silence. |
| Expiry | Past broadcasts last 7 days, 14 for Affiliates, 60 for Partners, Turbo and Prime; highlights and uploads stay, inside a 100 hour allowance (reported: help.twitch.tv did not render for the reader, the numbers come from secondary pages). This is why HD is fetched when the clip is made, not at export. |
| Gone | "Video <id> does not exist", "This clip is no longer available" (`twitch.py`, verified 2026-11-14). |
| Fragility | The query hashes are hard-coded in yt-dlp and change: TwitchDownloader shipped "Update ShareClipRenderStatus query hash" and "Update chapter query hash" (releases, verified 2026-11-14). Keeping yt-dlp current is the fix. |
| What yt-dlp needs | No runtime, no cookies. Optional `--extractor-args "twitch:client_id=..."` (yt-dlp README, verified 2026-11-14). |

**Clips** come from the `ShareClipRenderStatus` query as MP4 addresses per quality, signed with `sig` and `token`; a second, portrait set has ids starting `portrait-` and must be skipped (`twitch.py`, verified 2026-11-14). A clip is a plain HTTPS file of 60 seconds or less: fetched whole, no range fetch.

**The official alternative for the channel owner** (dev.twitch.tv/docs/api/clips and dev.twitch.tv/docs/change-log, verified 2026-11-14). `GET /helix/clips` returns clip facts by `id` (up to 100), `broadcaster_id` or `game_id` (`url`, `embed_url`, `thumbnail_url`, `duration`, `vod_offset`) with any valid token, but no file address. `POST /helix/clips` clips a live stream (up to 90 seconds captured, scope `clips:edit`, "an asynchronous process"). Get Clips Download "Provides URLs to download the video file(s) for the specified clips" and has been generally available since 2025-10-30; who may call it was not read (reported: the broadcaster and their editors). Create Clip From VOD has been generally available since 2026-02-05. No Helix endpoint returns a past broadcast's file (reported). **Verdict**: a clean later path for "my own Twitch clips" once PostGear has a Twitch login; not Sprint 12, which has no Twitch connection.

## 5. Kick

**Link shapes** (`extractor/kick.py`, verified 2026-11-14): `kick.com/<channel>/videos/<uuid>` (a 36 character UUID), `kick.com/<channel>/clips/clip_<id>` and `kick.com/<channel>?clip=clip_<id>`; a bare `kick.com/<channel>` is the live stream; `/videos` and `/clips` alone are lists.

**How it is served** (same file, verified 2026-11-14): a POST to `web.kick.com/api/v1/stream/<uuid>/playback` returns `playback_url.vod`, an HLS playlist on `stream.kick.com`. A real media playlist quoted in issue 16054 has 12.5 second `.ts` segments, `#EXT-X-PLAYLIST-TYPE:EVENT`, `#EXT-X-PROGRAM-DATE-TIME` on every segment and Twitch-style tags (`#EXT-X-TWITCH-TOTAL-SECS`), and ran to 37 hours (github.com/yt-dlp/yt-dlp/issues/16054, verified 2026-11-14). Sub-only videos answer "This video requires a channel subscription"; an ongoing stream's VOD has `is_live`. A clip is either a small HLS playlist or a direct file.

**Impersonation.** Every Kick API call is made with `impersonate=True` (`kick.py`, verified 2026-11-14). With no curl_cffi the request still goes out, with the warning "The extractor is attempting impersonation, but no impersonate target is available. If you encounter errors, then see https://github.com/yt-dlp/yt-dlp#impersonation" (`extractor/common.py`, `YoutubeDL.py`, verified 2026-11-14), and Cloudflare is then likely to refuse it (reported). The standalone `yt-dlp_linux` carries curl_cffi; the Python zip does not. The issue's log also shows yt-dlp handing Cloudflare cookies (`__cf_bm`, `_cfuvid`) to FFmpeg for the segment requests, so our own slicer may have to carry cookies and headers too (spike check 9).

**The section bug** (github.com/yt-dlp/yt-dlp/issues/16054, verified 2026-11-14): opened 2026-02-24, still **open** on 2026-11-14 with labels `external-issue`, `site-bug`, `triage`, three comments, the last on 2026-03-01, nobody assigned. After a network drop Kick writes `#EXT-X-DISCONTINUITY` into the VOD; `--download-sections` past that point "downloads much more than needed", writes only part of it, and "the downloaded file is not at the time that I specified". A maintainer: "this seems more like an ffmpeg bug than something that can be fixed in yt-dlp". Both workarounds posted there do what section 6 proposes: read the media playlist, keep the segments whose cumulative `EXTINF` time overlaps the range, write a small local playlist. So Kick ranges never go through `--download-sections`.

## 6. The Range Fetch Design

```ts
fetchRange(source: LinkRef, startSec: number, endSec: number, quality: QualityId):
  Promise<{ file: string; coveredStartSec: number; coveredEndSec: number }>
```

The caller asks for the clip range plus handles (10 seconds each side). The answer says what the file really covers, so the exact cut is `startSec - coveredStartSec` into it.

| Source | Strategy | State |
|---|---|---|
| Twitch VOD, Kick VOD | Slice the media playlist ourselves, hand a local playlist to FFmpeg | The method is verified in two other tools; our run is not |
| YouTube video, short | `--download-sections` on a padded range, stream copy, then an exact local re-encode cut | Flags verified; where a copied section really starts is not |
| YouTube clip | The parent video with `section_start` and `section_end` from the probe, then as above | Verified in source |
| Twitch clip, Kick clip | Fetch the whole file (60 seconds or less), cut locally | Verified in source |
| Uploaded file | Read from our own storage | Ours |

**The HLS slice, step by step.**

1. Probe again (the signed addresses are short-lived, reported) and take the chosen format's `url`, which for HLS is the media playlist; `manifest_url` is the master (`extractor/common.py`, verified 2026-11-14).
2. Fetch the playlist through the safe fetcher: only the host the probe returned, 5 MB cap (the 37 hour playlist in issue 16054 is about 10,800 entries).
3. Walk it: add each `#EXTINF` to a running time; keep a segment when it ends after `start - pad` and starts before `end + pad`. Keep an `#EXT-X-MAP` line if present. Keep a `#EXT-X-DISCONTINUITY` that falls between two kept segments. Refuse `#EXT-X-KEY` other than `NONE`, and `#EXT-X-BYTERANGE`.
4. Write a local playlist: header, the kept `#EXTINF` lines with absolute segment addresses, `#EXT-X-ENDLIST`.
5. FFmpeg reads it with a protocol allowlist (`file,https,tls,tcp`, reported option names) and stream-copies to one file. `coveredStartSec` is the start time of the first kept segment.
6. The exact cut re-encodes from that file (Module 05 owns the encode settings).

TwitchDownloader does the same: `GetStreamListTrim` picks parts by summed duration, then FFmpeg runs with `-ss <offset>` and `-t <length>`; its code notes that "Some VODs have bad audio data which FFmpeg doesn't like in copy mode" (`TwitchDownloaderCore/VideoDownloader.cs`, verified 2026-11-14), so the copy step needs a re-encode fallback for audio.

**The time base rule.** Cumulative `EXTINF` time is the one clock. The proxy and the HD rendition must both be built from it, or a mark made on the proxy lands on a different frame in HD. This is the most important thing the spike proves (check 7).

**YouTube.** `--download-sections "*<start-10>-<end+10>"` with our chosen ids and no `--force-keyframes-at-cuts`: FFmpeg seeks and copies, so the file starts on a keyframe near the asked time, not on it. Two ways to get a known start: (a) measure the real start and cut from there, or (b) add `--force-keyframes-at-cuts` on the padded range, which decodes and so seeks exactly, at the price of one extra encode of about 80 seconds of video. **Recommendation**: build (b) as the default because it is exact by construction, and let the spike show whether (a) is safe enough to save the encode.

## 7. The Real-Network Spike (Module 03)

Run once by hand on the real network with Arvind's own videos, written up in the module's spike report. Each line is a pass or fail.

1. Probe a public YouTube video, a Short, a clip, a Twitch past broadcast, a Twitch highlight, a Twitch clip, a Kick VOD and a Kick clip: `_type`, `extractor` and every field in section 2.2 are as described. Save each JSON (trimmed) as a fixture.
2. From a real YouTube probe, write down which heights exist in `avc1`, which stream is muxed, and the audio ids. Replace the "reported" line in section 3.
3. The allowlist refuses a YouTube playlist, a channel page, a Twitch `/videos` page and a non-listed site (note the message and exit code); a live stream on each platform is refused by the probe fields, and by `--match-filters` on a fetch call.
4. Progress lines parse on a plain download and on an HLS download, and missing numbers print as `NA`.
5. From the worker's real address (not a laptop): does YouTube answer, or show the bot check? Repeat with `YTDLP_PROXY`. Record which player clients worked.
6. The 720p proxy of a one hour video on each platform: time taken, file size, and that progress lines parse.
7. Time base: mark a visible event on the proxy, `fetchRange` it in HD, and confirm the same frame within 100 ms, on Twitch and on Kick.
8. A Twitch or Kick VOD with a `#EXT-X-DISCONTINUITY` (a stream that dropped): the slice still lands on time.
9. Kick: can FFmpeg and the safe fetcher read the playlist and segments with no cookies? If not, which headers and cookies from the probe are needed. Kick without curl_cffi fails, and with the standalone binary works.
10. YouTube section fetch: the offset between the asked start and the real first frame under stream copy, over five ranges; and the time `--force-keyframes-at-cuts` adds.
11. A sub-only, an age-gated, a private and a deleted video each produce the stderr text that section 10 expects; a Twitch VOD with muted sections is fetched and its playlist and audio described.
12. `--max-filesize` on an HLS fetch does nothing, and the runner's own size watch stops it. Cancel mid-fetch: the process tree dies and the scratch folder is clean.
13. `yt-dlp -U` on the standalone file in a writable folder updates in place; record the exit code and the downgrade command.

## 8. Node Integration

| Option | Version, licence, last publish | What it does | Verdict |
|---|---|---|---|
| Our own runner | n/a | `runTool` in `@postgear/media-tools`: `spawn` with an argument array, no shell, timeout, output caps, line callbacks, kill on cancel (Module 02) | **Pick** |
| `youtube-dl-exec` | 3.1.19, MIT, 2026-10-28; 77,072 downloads in the week to 2026-11-13 | A postinstall script downloads the binary; on Linux "It requires Python 3.11 or above available in your system as `python3`", so it fetches the Python zip, the build without curl_cffi | **Reject**: a network call at install, the wrong build for Kick, and flags turned into arguments by a helper we do not control |
| `ytdlp-nodejs` | 3.4.5, MIT, 2026-07-29; 3,585 a week | Also downloads the binary at install | **Reject** |
| `yt-dlp-wrap` | 2.3.12, MIT, last published 2023-09-13; 12,244 a week | Event wrapper over the process | **Reject**: three years without a release |

(registry.npmjs.org and api.npmjs.org for each package; github.com/microlinkhq/youtube-dl-exec README; verified 2026-11-14.) A wrapper adds nothing we need: the probe is one JSON line, progress is our own template, and the argument list is a security boundary we want to own and test.

## 9. Link Recognition Table

Recognition is our own pure code (regular expressions modelled on yt-dlp's, which are public domain). It returns `{ platform, kind, id }` and a **canonical address built from those three parts**; the pasted text itself never reaches yt-dlp. Hosts are matched exactly, `https` only, tracking parameters dropped.

| Shape | Platform | Kind | Id | Sprint 12 |
|---|---|---|---|---|
| `youtube.com/watch?v=<11>`, `youtu.be/<11>`, `youtube.com/embed/<11>` (also `music.youtube.com`, in yt-dlp's tests, verified 2026-11-15; `m.` reported) | youtube | vod | the 11 characters | Yes |
| `youtube.com/shorts/<11>` | youtube | short | the 11 characters | Yes |
| `youtube.com/live/<11>` | youtube | vod, or live when the probe says `is_live` or `is_upcoming` | the 11 characters | Ended streams only |
| `youtube.com/clip/<id>` | youtube | clip | the clip id | Yes |
| `youtube.com/playlist?list=`, `/@name`, `/channel/...` | youtube | list | n/a | No: "Paste the link of one video" |
| `twitch.tv/videos/<digits>`, `twitch.tv/<channel>/v/<digits>`, `twitch.tv/<channel>/video/<digits>` | twitch | vod | the digits | Yes |
| `clips.twitch.tv/<slug>`, `twitch.tv/<channel>/clip/<slug>` | twitch | clip | the slug | Yes |
| `twitch.tv/<channel>` (live); `twitch.tv/<channel>/videos`, `/clips`, `twitch.tv/collections/<id>` (lists) | twitch | live, list | n/a | No |
| `kick.com/<channel>/videos/<uuid>` | kick | vod | the UUID | Yes |
| `kick.com/<channel>/clips/clip_<id>`, `kick.com/<channel>?clip=clip_<id>` | kick | clip | `clip_<id>` | Yes |
| `kick.com/<channel>` (live); `kick.com/<channel>/videos`, `/clips` (lists) | kick | live, list | n/a | No |

A `list=` parameter on a watch link is dropped and the single video is kept. The kind from the shape is a first guess; the probe's `live_status` has the last word.

## 10. Error Taxonomy

| Code | Cause | How it is detected | Message for the person | Retry helps |
|---|---|---|---|---|
| `link_not_supported` | Not one of our shapes, or its platform is off in `CLIPS_PLATFORMS` | Recognition, before any process | "This link is not from YouTube, Twitch or Kick. Paste a video link, or upload the file." | No |
| `link_is_list` | Channel, playlist, collection | Recognition, or `_type` is `playlist` | "This link is a channel or a playlist. Paste the link of one video." | No |
| `video_live` | Still streaming, or not started | `is_live`, `live_status` in `is_live`, `is_upcoming`, `post_live`; "The channel is not currently live" for a channel link | "This stream is still live. Come back when it has ended." | Later |
| `video_not_found` | Deleted, expired or mistyped | "Video unavailable" (YouTube's text, reported); "Video <id> does not exist"; "This clip is no longer available"; Kick's API error text | "This video is gone, or the link is wrong." | No |
| `video_private` | Private or login needed | `availability` `private` or `needs_auth`; "This video is only available for registered users" | "This video is private. Only public videos can be imported." | No |
| `video_members_only` | Sub-only, members-only, paid | `availability` `subscriber_only` or `premium_only`; "subscriber-only content"; "requires a channel subscription" | "This video is for subscribers only, so it cannot be imported. You can upload the file instead." | No |
| `video_age_restricted` | Age gate | `age_limit >= 18` with no formats; "confirm your age" | "This video is age-restricted, so it cannot be imported. You can upload the file instead." | No |
| `video_geo_blocked` | Not available where the server is | "not available from your location due to geo restriction"; "has not made this video available in your country" | "This video cannot be reached from our servers. You can upload the file instead." | No |
| `video_drm` | Protected stream | "This video is DRM protected" | "This video is protected and cannot be imported." | No |
| `video_too_long` | Over the plan's length | `duration` from the probe | "This video is longer than your plan allows (6 hours)." | No |
| `platform_bot_check` | The platform distrusts our address | "Sign in to confirm you're not a bot"; "Your IP is likely being blocked"; "requiring a captcha challenge" | "YouTube is not letting our server read this video right now. Try again in a while, or upload the file." | Sometimes; alert the operator |
| `platform_rate_limited` | Too many requests | "This content isn't available, try again later"; "HTTP Error 429" (reported) | "Too many imports are running. We will try again shortly." | Yes, with a wait |
| `platform_changed` | The site changed and yt-dlp is behind | "Unable to extract" (reported); "No video formats found!"; "Requested format is not available"; "challenge solving failed" | "We could not read this video. We are looking into it. You can upload the file instead." | After an update; alert the operator |
| `fetch_network` | Timeouts, dropped fragments | "Got error:", "Giving up after N retries", a process timeout | "The download was interrupted. Trying again." | Yes, three times |
| `fetch_too_big` | Output passed the size cap | The runner's own size watch | "This video is too large to import." | No |
| `source_expired` | The original went away between import and clip | `video_not_found` during an HD fetch | "The original video is no longer online, so this clip uses the preview quality." | No |
| `tool_missing` | yt-dlp, Deno or FFmpeg missing or too old | The doctor; "ffmpeg is not installed" | "Video import is not set up on this server." | No; operator |

The quoted yt-dlp texts were read in `YoutubeDL.py`, `extractor/common.py`, `utils/_utils.py`, `extractor/twitch.py`, `extractor/kick.py` and `extractor/youtube/_video.py` (verified 2026-11-14), except where marked. Matching is by substring, most specific first, and an unmatched error is `platform_changed` with the last 8 KB of stderr in the job log, never in the message.

## 11. Operations

| Need | How |
|---|---|
| Stay current without a deploy | The binary lives on a writable volume at `YTDLP_PATH`, outside the image. A maintenance activity runs `yt-dlp -U` weekly and on demand: "a release binary will only update to its current channel". `--update-to stable@<tag>` pins or rolls back; `--update-to nightly` switches channel (yt-dlp README, Update, verified 2026-11-14). The doctor runs afterwards and the previous file is kept for one cycle. |
| Minimum version | A constant, `2026.10.26` today, compared with `yt-dlp --version`. The doctor warns past 60 days of age, before yt-dlp's own 90 day warning. The solver scripts ride inside the binary; the Deno floor is 2.3.0. |
| Kill switch per platform | `CLIPS_PLATFORMS` (default `youtube,twitch,kick`), read on every probe. A platform that is off answers `link_not_supported` with its name; uploads keep working. |
| Proxy | `YTDLP_PROXY` becomes `--proxy` (HTTP, HTTPS or SOCKS: `socks5://user:pass@host:1080/`). Our own playlist and segment requests must use the same exit. The value is redacted in logs. |
| Cookies | `YTDLP_COOKIES_FILE` becomes `--cookies`, an operator account only. yt-dlp reads and writes the file, so each job works on a copy in its scratch folder (reported behaviour). |
| Extra extractor settings | **New name proposed**: `YTDLP_EXTRACTOR_ARGS` (for example `youtube:player_client=mweb`), so a client change needs no deploy. |
| Rate limiting ourselves | Probe results cached for 10 minutes per canonical id; a counter per platform and exit address (start at 120 YouTube extractions an hour, well under the ~300 an hour guest limit); two fetches per platform at once; `--sleep-requests 0.75`, the value in yt-dlp's own `-t sleep` preset; a breaker that pauses a platform for 10 minutes after three `platform_bot_check` or `platform_rate_limited` results in a row. |

## 12. Open Questions

**Open question for Arvind**: stable or nightly yt-dlp in production? The project calls stable "often stale" and nightly "recommended". Recommendation: stable with the minimum version check, and a one-line switch to nightly when a break lasts longer than a day.

**Open question for Arvind**: how far to go against YouTube's bot check. Recommendation: ship with nothing extra; if spike check 5 fails, add a proxy first, the PO Token provider second, an operator account's cookies only as a last resort because the account can be banned.

**Open question for Arvind**: ship Kick if the spike shows Cloudflare refusing the server? Recommendation: keep the code, leave `kick` out of `CLIPS_PLATFORMS` until it passes, and say "Upload the file instead" meanwhile.

**Open question for Arvind**: the official Twitch clip download endpoints exist now. Recommendation: note them for Sprint 13's "More Sources" module, which is where a Twitch login would arrive.
