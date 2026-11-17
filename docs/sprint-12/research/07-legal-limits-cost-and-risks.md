# Sprint 12 Research: Legal, Limits, Cost And Risks

> **Written**: 2026-11-14, **revised 2026-11-17** (FFmpeg-only render: the Remotion licence and the Chrome host costs are removed and the cost model uses measured FFmpeg speeds). This is not legal advice. It is the engineering reading of each platform's terms, what we do about it, what it costs, and the choices left to Arvind. Lines marked "needs a legal read" should go to a lawyer before real customers use link import.
> **Decision on record** (Arvind, 2026-11-14): pasting YouTube, Twitch and Kick links is in scope, as StreamLadder and OpusClip do. This file records the risk and the mitigations. It does not reopen the decision.

## 1. Platform Terms, As They Read Today

| Platform | Document | What it says (short quotes) | What it restricts, in plain words |
|---|---|---|---|
| YouTube | Terms of Service, dated 2022-01-05 (youtube.com/t/terms, verified 2026-11-14) | You may not "access, reproduce, download, distribute, transmit, broadcast, display, sell, license" Content "except: (a) as expressly authorized by the Service; or (b) with prior written permission from YouTube". You may not "circumvent, disable, fraudulently engage with, or otherwise interfere with any part of the Service" | Downloading a video with a tool is outside the terms unless YouTube allows it. There is no carve-out for the uploader's own video, although YouTube Studio lets owners download their own files |
| YouTube | API Services Developer Policies (developers.google.com/youtube/terms/developer-policies, verified 2026-11-14) | III.E.1: "You and your API Clients must not, and must not encourage, enable, or require others to" (a) "download, import, backup, cache, or store copies of YouTube audiovisual content without YouTube's prior written approval", (b) make content available for offline playback. III.I.7: must not "separate, isolate, or modify the audio or video components of any YouTube audiovisual content" | PostGear is a YouTube API client today (it publishes through the Data API). These policies bind the developer, not only the API calls. An API compliance audit could treat link import as a breach and cut the YouTube publishing access. **This is the largest single risk in the sprint. Needs a legal read** |
| Twitch | Terms of Service, "Last modified on 08/12/2026" as printed (legal.twitch.com/en/legal/terms-of-service, verified 2026-11-14) | The licence does not permit "(d) use of any data mining, robots, or similar data gathering or extraction methods; (e) downloading (except page caching) of any portion of the Twitch Services, the Materials, or any information contained in them, except as expressly permitted". Users must not access the services "by means of any robot, spider, scraper, crawler, or other automated means for any purpose, or bypass any measures Twitch may use to prevent or restrict access" | Fetching VODs, clips and chat replay with a tool is outside the terms. Reading chat replay through an unofficial endpoint is the clearest case, which is why it sits behind `CLIPS_TWITCH_CHAT` |
| Twitch | Developer Services Agreement, "Last modified on 12/04/2024" (legal.twitch.com/en/legal/developer-agreement, verified 2026-11-14) | "Do not store copies of Twitch Content or Program Materials, unless you: (a) obtain prior written authorization from Twitch [...]; (b) control the rights associated with such content; or (c) cache such information for only a twenty-four hour time period". "You must adopt and integrate our embeddable player for all Twitch video content." | Binds us only if we register a Twitch application. Sprint 12 does not. If a later sprint adds Twitch sign-in, exception (b) is the one our rights record supports |
| Kick | Terms of Service, last updated 2026-03-23 (kick.com/terms-of-service, verified 2026-11-14) | Section 1.4 prohibits "copying, distributing, or disclosing any part of the Service in any medium" and "using any automated system, including "robots," "spiders," "offline readers," etc. to access any part of the Service". Section 2.1: "The User Content you create remains yours." | Same shape as Twitch: automated access and copying are outside the terms; the streamer keeps ownership of the stream |

**Read together**: all three platforms forbid automated downloading in their terms, and all three leave ownership of the video with the person who made it. So there are two separate questions. Copyright: answered by the uploader's rights (our rights record). Contract with the platform: not answered by anything we can do; it is a risk we carry. The practical exposure is not a lawsuit against a small tool; it is blocked server IPs, a broken extractor, and, for YouTube, the API access we already depend on.

## 2. How The Reference Products Handle Rights

| Product | What it does | Source |
|---|---|---|
| OpusClip | Prints "By continuing, you confirm you have rights to use this video." under the Create button on the clip setup screen | [`opusclip/07`](../../screenshots/opusclip/07-clip-setup-recipe-captions-hook-credit-summary.png) |
| OpusClip | Terms: "you represent and warrant you have all rights necessary to do so", "You are solely responsible for all User Submissions you contribute to the Services." A DMCA policy with a designated agent, a postal address and a notices email | opus.pro/terms-of-service, verified 2026-11-14 (effective date 2025-11-17, reported) |
| StreamLadder | No rights line in the editor or the paste dialog in any of the 39 captures. Terms say "You retain your intellectual property ownership rights over content you submit to us" and list the Google, YouTube and TikTok terms for those services. No takedown procedure was found on the page; Twitch and Kick are not named | streamladder.com/policies/terms, last updated 2026-10-23, verified 2026-11-14 |
| VidsSave | A public downloader. The home page and FAQ say nothing about copyright; the terms link was not read | vidssave.com, verified 2026-11-14 |

PostGear does more than both: the confirmation is a tick box, and the answer is stored.

## 3. Our Mitigations

1. **A rights confirmation on every import and every download.** The tick box text is versioned. `ClipVideo` stores `rightsConfirmedAt`, `rightsConfirmedById` and `rightsTextVersion`; the API answers 422 `rights_required` without it. The row and its rights record stay after the files are deleted.
2. **Private storage.** Sources, proxies, segments and working files live in the private bucket (`CLIPS_PRIVATE_BUCKET`), never the public media bucket. The browser gets a signed URL that lasts minutes. Only an exported clip becomes a `Media` row.
3. **Retention and auto-delete.** Sources and working files are removed after the plan's period, with a notice three days before (options in section 12). Downloader output is deleted after 24 hours.
4. **A takedown path** (section 5).
5. **No public downloader page.** Download needs a signed-in workspace, the rights tick and the plan's allowance. No logged-out page, no landing copy that invites downloading other people's videos.
6. **A switch per platform.** `CLIPS_PLATFORMS` lists the link sources that are on. Removing `youtube` turns YouTube import off in one setting, without a deploy; uploads keep working.
7. **Public videos only.** Sub-only, members-only, age-gated, private and paid videos are refused with a plain message. We never ask a person for their cookies or password, and `YTDLP_COOKIES_FILE` is never a customer's.
8. **Honest wording.** The product says "Import your video", never "download any video".
9. **Guidance where it matters.** The link card carries a short "What can I import?" note: your own videos, videos you have permission for, and a pointer for game footage (section 6).

**Open question for Arvind**: the exact tick box sentence. Recommendation: "This video is mine, or I have permission to use it." (version 1), with a link to the note in point 9.

## 4. What We Never Do

- Fetch a video that needs a subscription, a membership, a payment, an age check or a login.
- Use a customer's cookies, password or session to reach a platform.
- Offer a public or logged-out downloader, or advertise "download any video".
- Put a source video, a proxy or a working file in the public bucket, or hand out a link that does not expire.
- Keep source videos past the retention period, or keep anything after a valid removal request.
- Import a playlist, a channel or a live stream that is still running. One link, one finished video.
- Call the YouTube Data API or a Twitch API to help an import. Publishing credentials and import stay apart.
- Strip a platform's watermark or a creator's credit, or separate and re-offer a video's audio as a file of its own outside the Download feature.
- Pass a pasted link to FFmpeg or a shell as a string. Arguments are arrays; hosts are on an allowlist.
- Ship a sound, song, sticker or emoji whose licence we have not read (section 8).
- Copy code, art, sounds or wording from StreamLadder, OpusClip or VidsSave.
- Make a paid call in development. `CLIPS_SIMULATION=true` is the local default and is refused in production.

## 5. The Takedown Path

**What a notice must contain** (the DMCA-style basics, which most platforms and hosts follow): who is complaining and how to reach them; the work they own; the material they want removed and where it is; a statement that the use is not authorised; a statement that the notice is accurate and that they are the owner or act for the owner; a signature.

**Procedure**:

1. A public address (`copyright@` on the production domain) and a short page that lists the points above.
2. An operator finds the video by link, workspace or clip id and calls `DELETE /admin/clips/videos/:videoId`. The files go at once; the row stays with `removedReason = 'rights_request'`.
3. Clips cut from that source are hidden and their exports removed from the Media library. Posts already published live on the platforms; the notice sender is pointed to the platform's own form for those.
4. The workspace owner is told what was removed and why, and how to answer if they hold the rights (a counter notice).
5. A workspace with repeated valid notices loses link import (a repeat-infringer rule; three notices is a common choice, and the number is ours to set).
6. Target: act within 36 hours of a complete notice.

**Needs a legal read**: PostGear is run from India. The safe harbour there is the IT Act's intermediary rules, not the US DMCA; the 36-hour figure comes from those rules (reported). A US safe harbour would need a registered agent at the US Copyright Office (reported). Which one applies depends on where the company and its customers are.

**Open question for Arvind**: the address. Recommendation: `copyright@rkay.in`, forwarded to you, added to the footer and the Terms before link import reaches real customers.

## 6. Game Footage: The User's Responsibility, Surfaced As Guidance

Game publishers set their own rules for posting gameplay. They are a class of rights the tick box cannot check for the user.

- **Rockstar Games and Take-Two** publish a "Policy on posting copyrighted Rockstar Games material" (support.rockstargames.com, article 200153756; reported: the page timed out today, details come from search summaries of it and press coverage). It accepts gameplay videos made by fans for non-commercial use, and says Take-Two removes spoilers (endings, major story reveals), pre-release and leaked footage, cutscenes or in-game shows posted on their own, and videos that promote cheating. Last updated 2025-01-10; questions go to `copyright@take2games.com` (all reported).
- GTA 6 launches on 2026-11-19 and is our first marketing wave, so this policy will be tested in the first week.
- Other publishers (Nintendo, Riot, Epic, Mojang) have their own pages with different rules (reported).

**What we do**: the "What can I import?" note says that game footage follows the publisher's video policy, that spoilers and leaked footage get removed by publishers, and that the person posting is responsible. We do not judge footage, and we do not block games.

## 7. Per-Platform Upload Limits For Export Presets

Read from each platform's own documentation today, unless marked.

| Platform | Max length | Max size | Shape | Codecs and container | Frame rate | Source |
|---|---|---|---|---|---|---|
| TikTok (Content Posting API) | 10 minutes through the API; the account's own cap can be lower | 4 GB | 360 to 4096 px each side | MP4 (recommended), WebM, MOV; H.264 (recommended), H.265, VP8, VP9 | 23 to 60 | developers.tiktok.com/doc/content-posting-api-media-transfer-guide (reported: the site refused our connection; text read through a reader proxy 2026-11-14) |
| Instagram Reels (Graph API) | 3 seconds to 15 minutes | 300 MB | Width up to 1920 px; ratio 0.01:1 to 10:1, 9:16 recommended | MOV or MP4, moov atom first, no edit lists; H.264 or HEVC, progressive, closed GOP, 4:2:0; AAC up to 48 kHz, 128 kbps; video up to 25 Mbps | 23 to 60 | developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media, verified 2026-11-14 |
| Facebook Reels (Reels API) | 3 to 90 seconds | not stated | 9:16; 1080 x 1920 recommended, 540 x 960 minimum | MP4; H.264, H.265, VP9, AV1; closed GOP of 2 to 5 seconds; AAC-LC stereo, 48 kHz, 128 kbps or more | 24 to 60, fixed | developers.facebook.com/docs/video-api/guides/reels-publishing, verified 2026-11-14 |
| YouTube Shorts | Up to 3 minutes (since 2024-10-15) | as YouTube upload | Square or vertical | as YouTube upload | as YouTube upload | support.google.com/youtube/answer/15424877, verified 2026-11-14 |
| YouTube upload | 12 hours; 15 minutes until the account is verified | 256 GB | 16:9 standard; vertical and square accepted | MP4, moov atom first; H.264 High, 4:2:0; AAC-LC, 48 kHz. Suggested 8 Mbps at 1080p30, 12 Mbps at 1080p60, 5 Mbps at 720p30 | 24 to 60, as recorded | support.google.com/youtube/answer/71673 and /answer/1722171, developers.google.com/youtube/v3/docs/videos/insert, verified 2026-11-14 |
| X | 20 minutes (125 on Premium); 0.5 seconds minimum | 8 GB (16 GB on Premium) | Ratio 1:3 to 3:1; the page states dimensions "between 32x32 and 1280x1024" | H.264 High; AAC-LC (not HE-AAC); 4:2:0, progressive, no open GOP | Up to 60 | docs.x.com/x-api/media/quickstart/best-practices, verified 2026-11-14 |
| Threads | 5 minutes | 1 GB | Width up to 1920 px; 9:16 recommended | Same container and codec rules as Instagram; video up to 100 Mbps | 23 to 60 | developers.facebook.com/docs/threads/posts, verified 2026-11-14 |
| LinkedIn (Videos API) | 3 seconds to 30 minutes | 75 KB to 500 MB (the upload field allows 5 GB) | not stated | MP4 | not stated | learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api, verified 2026-11-14 |
| Pinterest | 4 seconds to 15 minutes | 2 GB | Square or vertical (2:3, 4:5, 9:16); no taller than 1:2, no wider than 1.91:1 | MP4, MOV or M4V; H.264 or H.265 | not stated | help.pinterest.com/en/business/article/pinterest-product-specs, verified 2026-11-14 |

Posting caps read on the same pages: Instagram 100 API posts in 24 hours, Facebook Reels 30, Threads 250.

**What this means for the presets**:

- **One safe file fits every platform**: MP4, H.264 High, yuv420p, progressive, constant 30 fps, closed GOP of 2 seconds, moov atom first, AAC-LC stereo at 48 kHz and 128 kbps or more, 1080 x 1920.
- **Bitrate**: 8 Mbps at 1080p30 and 5 Mbps at 720p30 (YouTube's figures). At 8 Mbps a minute is about 61 MB, so Instagram's 300 MB allows about 4 minutes 50 seconds. Longer clips for Instagram drop the bitrate to fit.
- **4K vertical (2160 px wide) is over the 1920 px width limit** on Instagram and Threads. If 4K ships, those two get the 1080p file.
- **Length rules the Composer must check** (Module 17): Facebook Reels 90 seconds, Shorts 3 minutes, Threads 5 minutes, TikTok 10 minutes, Instagram and Pinterest 15 minutes, LinkedIn 30 minutes.
- **X is the odd one**: its page states a 1280 x 1024 ceiling and a 5,000 kbps minimum that disagrees with its own table. Test a 1080 x 1920 file in the real-test pass before promising it.

## 8. Stickers, Emoji, Sound And Music Licences

### 8.1 Klipy (rejected 2026-11-17)

Status: **not used**. The owner asked for open-source libraries only, and the findings below are why Klipy cannot be the catalogue. Kept as the record of that decision; the replacement is [research 10](10-open-source-sound-and-sticker-libraries.md).

- **Keys and limits**: a test key is capped at 100 calls an hour; a production key gives "limitless requests" and is requested through the Partner Panel after testing (klipy.com/developers, verified 2026-11-14; a third-party page says 100 a minute).
- **Attribution**: developers must follow Klipy's attribution guidelines and show its branding. The guidelines themselves sit in a shared folder we could not read. A client library's notes say the rule is a "Search KLIPY" placeholder and a "Powered by KLIPY" mark (reported). StreamLadder shows "Powered by KLIPY" beside each group heading ([`streamladder/07`](../../screenshots/streamladder/07-clip-editor-elements-stickers-gifs.png)).
- **Ads**: Klipy can return ads in Trending, Search, Categories and Recents. The Ads API is "completely optional" and is switched per app (klipy.com/developers, verified 2026-11-14). We keep it off.
- **Caching and storing**: no readable page states a rule. The consumer terms (klipy.com/support/terms-services, updated 2026-06-23, verified 2026-11-14) allow only "personal and non-commercial" use and say "you shall not copy, modify, publish, transmit, distribute" content; they point to separate API Terms that we could not open. Content is provided "AS IS", with no promise about the rights in a GIF.
- **Verdict**: fine for search and preview behind the switch. Copying a chosen item into our storage (which a render needs) and commercial use in exported videos are **not confirmed**. Needs the API Terms read, or a written answer from Klipy, before a production key.

**Open question for Arvind**: Klipy's reported placeholder rule ("Search KLIPY") breaks our "Enter your ..." rule, and the single-search rule. Recommendation: allow it inside the Klipy tab only, as a licence condition, and record the exception in the decision log.

### 8.2 Noto Animated Emoji

Licensed under CC BY 4.0 (remotion.dev/docs/animated-emoji, verified 2026-11-14; the project page at googlefonts.github.io/noto-emoji-animation showed no licence text to our reader). CC BY 4.0 asks for credit to the maker, a link to the licence, and a note if the work was changed. We put "Animated emoji: Noto Emoji Animation by Google, CC BY 4.0" with both links on an in-app Credits page and in the repository notices. Whether every exported video also needs a credit **needs a legal read**; common practice is a credits page only.

### 8.3 Verdict Table

| Source | Licence, as read | Bundle in PostGear? |
|---|---|---|
| PostGear's own stickers and synthesised sounds | Ours | **Yes** (safest) |
| Noto animated emoji | CC BY 4.0 (verified, section 8.2) | **Yes**, with the credit |
| Kenney audio packs | "public domain licensed (CC0)", free "even in commercial projects", credit optional (kenney.nl/support, verified 2026-11-14) | **Yes**, keep each pack's licence file |
| Freesound, CC0 filter | CC0: "you can do pretty much what you want with the sound" (freesound.org/help/faq, verified 2026-11-14) | **Yes**, file by file, recording the sound's page and licence on the day |
| Freesound, CC BY | Credit the creator every time | **No** for the pack (credit cannot follow a clip) |
| Freesound, CC BY-NC | No commercial use | **No** |
| Pixabay | Free, no credit, but "You cannot sell or distribute the Content [...] on a Standalone basis", including "through a stock media platform"; bulk copying is prohibited (pixabay.com/service/terms, updated 2026-10-20, verified 2026-11-14) | **No**. A sound picker inside a SaaS looks like a library. A user may upload a file they downloaded themselves |
| Mixkit | A separate free licence per item type; reported to forbid redistribution and competing libraries (mixkit.co/license, opened 2026-11-14 but the licence text did not load; reported) | **No** |
| YouTube Audio Library | "copyright-safe" on YouTube, with credit for its Creative Commons tracks; the page grants nothing for use inside another product (support.google.com/youtube/answer/3376882, verified 2026-11-14) | **No** |
| Klipy GIFs and stickers | Section 8.1 | **Not used** (rejected 2026-11-17) |

**Open question for Arvind**: who builds the first sound and music pack. Recommendation: about 40 sound effects from Kenney and Freesound CC0, checked file by file with a `LICENCES.md` beside them, and no music in the pack until a CC0 or paid-licence source is chosen; people upload their own music.

## 9. Cost Model

### 9.1 Sizes

| File | Assumption | Size |
|---|---|---|
| Editor proxy, 720p H.264 | 1.5 Mbps video for YouTube 720p30 up to 3 Mbps for Twitch 720p60, plus 128 kbps audio | 0.7 to 1.4 GB an hour; **plan on 1 GB an hour** |
| Analysis audio, filmstrip, waveform | Mono speech-rate audio, one small picture every few seconds, peak data | about 30 MB an hour |
| HD segment for one clip | 60 seconds plus two 5-second handles at 8 Mbps | about 70 MB |
| Rendered clip, 1080 x 1920 | 8 Mbps video, 128 kbps audio | about 61 MB a minute (38 MB at 720p, 5 Mbps) |

A six-hour stream is about 6 GB of proxy, not the 20 GB or more of the original. That is the point of "proxy first, HD on demand".

### 9.2 Storage Prices Read Today

| Store | Storage | Egress | Free | Source |
|---|---|---|---|---|
| Cloudflare R2 | $0.015 a GB-month | Free | 10 GB, 1 million writes, 10 million reads | developers.cloudflare.com/r2/pricing, verified 2026-11-14 |
| Backblaze B2 | $6.95 a TB-month (about $0.007 a GB) | Free up to 3 times the stored amount, then $0.01 a GB | 10 GB | backblaze.com/cloud-storage/pricing, verified 2026-11-14 |
| AWS S3 Standard | $0.023 a GB-month | $0.09 a GB after 100 GB free | none that lasts | aws.amazon.com/s3/pricing (reported: the tables did not load; only the 100 GB allowance was read today) |

### 9.3 Three Scenarios

Sources and working files are kept 30 days; exports are kept. Storage is taken at month six (working files plus six months of exports). S3 egress assumes each proxy hour is watched once and each export leaves once. Render hours assume 1.5 minutes of FFmpeg per exported 60 second clip at 1080p30 (the measured figure is 1.4 times the clip length on a shared laptop, `09-ffmpeg-render-cookbook.md`, section 9) and add 0.2 minutes for each Preview Export.

| Scenario | Source hours a month | Clips a month | Stored at month six | R2 | B2 | S3 (reported rates) | Render hours a month |
|---|---|---|---|---|---|---|---|
| A. Demo | 20 | 100 | 64 GB | $0.81 | $0.38 | $1.47 | about 3 |
| B. Early (50 active workspaces) | 500 | 2,500 | 1,590 GB | $23.70 | $10.98 | $86 ($37 storage, $50 egress) | about 62 (was 83 with the old 2 minute estimate) |
| C. Growth (500 active workspaces) | 5,000 | 25,000 | 15,900 GB | $238 | $110 | $942 ($366 storage, $576 egress) | about 625 (was 833) |

R2 stays the pick: the app already uses it, egress is free (the editor streams the proxy, and Instagram and Threads fetch each published file by link), and B2's saving is small until scenario C.

### 9.4 Render Time And The Media Worker

- **FFmpeg-only render is measured, not guessed** (`09-ffmpeg-render-cookbook.md`, sections 9 and 10, verified 2026-11-17 on FFmpeg 9.0.2, Intel i7-10850H with 12 threads, while other programs used 25 to 60 percent of the CPU). A typical 20 second 9:16 clip (fullscreen game, rounded camera box, two stickers, two outlined texts, a three-source audio mix) rendered at **1.04x realtime at 720p30, 0.69x at 1080p30 and 0.42x at 1080p60** (`veryfast`, one run each). A 60 second 1080p30 clip is therefore about 85 seconds on that shared laptop; the first version of the graph was twice as slow because of the overlay pixel format, which the compiler rules now forbid.
- **Planning figures until Module 05 measures the real host**: 1.5 to 3 times the clip length at 1080p30 and 2.5 to 5 times at 1080p60. The cost table above uses 1.5 minutes for a 60 second 1080p30 clip. The old Remotion estimate (one to three times, then two minutes, with Chrome) is gone.
- **Preview Export** (360 wide, `ultrafast`) ran at 2.4x realtime, so about 25 seconds for a 60 second clip; most of that is reading the 1080p source.
- **The Blurred layout is cheap in FFmpeg**: a blur of a 108 x 192 copy and one upscale. The slow cases were an `rgba` overlay path and heavily outlined text, both avoided by the compiler rules.
- **Linux**: FFmpeg has no glibc floor beyond its build (the BtbN Linux builds need 2.28 or newer, `02-libraries.md`). yt-dlp's standalone Linux file is glibc, so the worker image stays Debian.
- **No render licence**: the per-render fee the Remotion design carried ($0.01 a render, $100 a month minimum once the team passed three people) does not exist. FFmpeg is a GPL program run as a separate process on our own servers (`02-libraries.md`, section 3).

**The hosting assumption today** ([`05-hosting-and-costs.md`](../../launch-readiness/05-hosting-and-costs.md), [`deployment-platforms-guide.md`](../../deployment-platforms-guide.md)): Railway Hobby for the demo, or one Hostinger KVM 2 (2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB transfer), with the whole stack using about 3 to 4 GB and 0.3 vCPU on average. The guide warns that Hostinger cuts CPU to 20% when "CPU credits" run out.

**What a media worker needs beyond that**:

| Need | Why | Size |
|---|---|---|
| CPU | A render uses every core for about the clip's length; FFmpeg cuts and analysis do the same | 4 vCPU, not shared with the API |
| Memory | FFmpeg and its sources in flight; the test render held about 0.7 GB (no browser) | 4 GB is enough for one render, 8 GB leaves room for yt-dlp and analysis |
| Scratch disk | A six-hour proxy in flight, HD segments, render output | 100 GB local, cleaned per job |
| Outbound traffic | Everything fetched is pushed to storage | about 0.85 TB a month in scenario B, 8.5 TB in C (over KVM 2's 8 TB) |
| Operating system | The worker image, yt-dlp (glibc standalone) and FFmpeg | Debian slim, any recent glibc |
| A clean address | YouTube's bot check on data-centre addresses (see `04-link-import-and-fetch.md`) | `YTDLP_PROXY` if needed; pass only what must go through it, since paid proxies charge by the GB (reported) |

On the one-box plan this means a second box for `WORKER_ROLES=media,render`: the guide lists Hostinger KVM 4 (4 vCPU, 16 GB, 200 GB, 16 TB) and Hetzner CX33 (4 vCPU, 8 GB, 80 GB). On Railway the guide's rates ($20 a vCPU-month, $10 a GB-month, by the minute) put a 90 second render on 2 vCPU and 3 GB at about a third of a cent, but its $0.05 a GB egress makes pushing scenario B's files to R2 cost about $42 a month. One render worker at concurrency 1 covers scenario B; scenario C needs two.

## 10. Abuse And Security

| Threat | How it works | Control |
|---|---|---|
| SSRF through a pasted link | A link, or a redirect from it, points at an internal address or a cloud metadata service | Link recognition accepts only known hosts and shapes for the platforms in `CLIPS_PLATFORMS`; `assertSafeUrl` runs first; yt-dlp is locked to an extractor allowlist with the generic extractor off and playlists off; the worker's network blocks private ranges |
| Crafted uploads | A file named `.mp4` that is really a playlist (HLS, DASH, concat) can make FFmpeg read local files or fetch addresses (a known class of FFmpeg bug, reported) | ffprobe runs first, with the protocol allowlist set to `file` only; only MP4, MOV, WebM and Matroska containers pass; playlists and image sequences are refused; the process runs as a non-root user inside the job's scratch folder |
| Long or heavy videos (the video form of a zip bomb) | A small file that declares 100 hours, 16K frames or 1,000 fps | Length, pixel count and frame rate caps checked from ffprobe before any work; a time limit and an output size cap on every process; kill on cancel; scratch space capped per job |
| Quota exhaustion | One workspace queues dozens of six-hour imports or renders | Plan limits on hours and storage (402 `clips_hours_used`, `clips_storage_full`); a cap on jobs running at once per workspace; render concurrency 1 with a fair queue; credits for AI highlights; a per-IP and per-org throttle on link probes |
| Storage scraping | Guessing or sharing file addresses | Private bucket, no listing; random keys under the workspace prefix; signed URLs that last minutes and are issued only after the `@CurrentOrg()` check; the signing secret (`CLIPS_URL_SECRET`) stays on the server |
| Hostile third-party media | A GIF or sticker built to crash a decoder | Uploads are checked by real bytes, size-capped and normalised to APNG or PNG before they reach a render |
| The downloader as a free mirror | Sharing a download link with the world | Output lives 24 hours behind a signed link; a daily cap per plan; no public page |
| Leaked operator secrets | A proxy password or a cookies file in logs | Process arguments are redacted in logs; secrets come from env, never from a request |

## 11. Risks Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| YouTube treats link import as a breach of the API Developer Policies and limits our API project | low | YouTube publishing stops for every workspace | `CLIPS_PLATFORMS` switch; publishing credentials never touch import; own-video wording; a legal read before launch |
| A platform blocks the worker's address or adds a bot check | high over time | Imports from that platform fail | Proxy first so less is fetched; `YTDLP_PROXY`; clear error with "Upload the file instead"; upload always works |
| yt-dlp breaks after a site change | certain, several times a year | Imports fail until updated | Doctor check, minimum version, an update path that needs no deploy, fixtures to spot the break |
| A rights holder sends a takedown or a complaint | medium | Files removed; time lost; a bad day | Rights record, takedown path, 36-hour target, repeat-infringer rule |
| A user clips footage they have no right to and posts it | certain | The user's channel gets a strike; reflects on us | Tick box wording, the "What can I import?" note, game footage guidance |
| GTA 6 spoiler or leaked footage in week one | medium | Publisher takedowns against our users | Guidance note; no marketing copy that invites spoilers |
| Open catalogues are thinner than Giphy | medium | No film, TV or meme GIFs | Stated plainly in the product; a commercial provider is a parked item (Module 21 item 19) |
| A bundled sound or song turns out not to be CC0 | low | A claim against a user's video | File-by-file licence record; Kenney and Freesound CC0 only; no music in the first pack |
| Storage cost grows past revenue | medium | Monthly loss | Retention, quotas as a sum of `ClipAsset`, proxy first, cleanup job, a storage meter |
| Render is too slow on the chosen host | medium | Long waits; a queue that never clears | Measured 0.4x to 1x realtime on a shared laptop (`09-ffmpeg-render-cookbook.md`); Module 05 benchmark on the host; separate render worker; 720p default on Free; Preview Export at 360 wide |
| The preview and the export disagree on a look or a line break | medium | A user sees something different from what they edited | `frameState` shared numbers, parity tests, Preview Export, the softened promise (`05-editor-and-render.md`, sections 3 and 8) |
| A crafted file or link reaches FFmpeg or the network | low | Data leak or a hijacked worker | Section 10: allowlists, ffprobe first, non-root, private ranges blocked |
| An exported file is refused by a platform | medium | A scheduled post fails | One safe preset; length and size rules in `social-core`; the X test in the real-test pass |
| Exports pile up in the public Media bucket | certain | Slow cost growth | Exports count toward the workspace's storage; delete from the library works as today |
| Private or paid content slips through | low | A serious terms breach | Refuse on the probe's availability field; no cookies; a test for each refused kind |
| The takedown address is not watched | medium | A missed notice becomes a legal problem | Forward to the owner; add it to the launch checklist |
| Indian intermediary rules need more than we built | low | A compliance gap | Legal read before real customers; the rights record and removal log already exist |

## 12. Options For Arvind

**Retention of sources and working files**

| Option | What ships | Trade-off |
|---|---|---|
| A. 3 days on Free, 30 days on paid **(recommended)** | A cleanup job by plan; a notice three days before on paid plans, one day on Free; exports are kept | Matches OpusClip and Vizard's 3-day free storage; lowest cost and lowest rights exposure; a Free user must finish a video in three days |
| B. 30 days for everyone | One rule, one message | Simple; Free storage costs about ten times more |
| C. Keep until deleted | No cleanup job | Easiest to build; cost grows without limit and old sources sit as takedown risk |

**Free-plan watermark**

| Option | What ships | Trade-off |
|---|---|---|
| A. A small PostGear mark in a corner on Free exports, off on paid **(recommended)** | One image overlay in the render graph, driven by the plan | Free marketing and a clear reason to upgrade; some people dislike it |
| B. An end card instead of a corner mark | A one-second card after the clip | Cleaner picture; adds length, which matters at 90 seconds and 3 minutes |
| C. No watermark; gate on quality only | Free is 720p, paid is 1080p | Friendliest; gives up the mark every competitor uses |

**Upload cap for own files**

| Option | What ships | Trade-off |
|---|---|---|
| A. 2 GB on every plan, multipart **(recommended)** | Resumable S3 multipart straight to the private bucket | Matches StreamLadder's paid cap (verified 2026-11-14); holds about 35 minutes of 1080p at 8 Mbps, longer at lower bitrates |
| B. 250 MB on Free, 2 GB on paid | The same code with a plan check | Cheaper Free tier; StreamLadder's Free is 200 MB; more upgrade pressure on the first screen |
| C. 10 GB on paid | The same code; needs more scratch disk | Matches OpusClip (10 GB, verified 2026-11-14); a 10 GB file needs the bigger media box |

**Open question for Arvind**: does link import stay on if the legal read on the YouTube API policies comes back negative? Recommendation: keep Twitch, Kick and upload on, switch YouTube import off with `CLIPS_PLATFORMS`, and offer "Upload the file from YouTube Studio" in its place.
