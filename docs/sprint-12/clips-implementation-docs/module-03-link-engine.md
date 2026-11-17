# Module 03: Link Engine

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session)
> **Depends on**: [Module 02](module-02-media-runtime.md)
> **Stories**: CL-1.2 (server side), CL-13.4; CL-1.7 (server side: the channel lister and its routes, Add A Channel And Browse Its Streams) and CL-1.8 (the hidden ids); foundations for CL-1.4, CL-12.1
> **Next**: [Module 04](module-04-import-pipeline.md) (Import Pipeline)

## Goal

After this module a pasted link becomes one well-defined answer: which platform and what kind of video it is, its title, channel, length and qualities, or one plain sentence saying why not. The `Downloader` exists with a real binding (yt-dlp and FFmpeg) and a simulated one (fixtures and two generated sample videos), including the range fetch every later module depends on. `POST /clips/links/probe` works. A second engine, the `ChannelLister`, answers "what has this channel put out lately?" from a handle, with four bindings (Twitch Helix, the YouTube Data API, yt-dlp flat listing, and a simulated one), a cache, throttles and the `ClipChannel` routes (My Channels). No video is stored yet and there is no page.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names, simulation links, error codes).
- Sprint doc: What The Research Settled (items 4 and 5), Providers, API Routes (the probe row), Simulation.
- User stories: CL-1.2, CL-13.4; section 5, the link rows.
- Research: [`04-link-import-and-fetch.md`](../research/04-link-import-and-fetch.md), all of it: the probe fields, the flags, each platform's link shapes and traps, the range-fetch design, the error list, the spike checks. [`11-channel-browser.md`](../research/11-channel-browser.md), all of it (the lister, the four bindings, the routes, the cache, the quotas, the legal note, the spike checks). [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), sections 6 and 13 (reading `clips.browse_channels` through the resolver). [`03-open-source-reference-repos.md`](../research/03-open-source-reference-repos.md), the Twitch and Kick access section. [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md), "What We Never Do".
- Code: `packages/media-tools/` from Module 02 (`runTool`, `withScratch`, `probeFile`, the doctor); `packages/video-engine/src/links/types.ts`; `apps/worker/src/clips/providers.ts`; `packages/discover-engine/src/simulation.ts` and `fixtures/` (how a fixture binding is built and how anything not recorded is refused); `packages/seo-engine/src/crawler/url-guard.ts` (`assertSafeUrl`); `apps/api/src/modules/discover/discover.engine.ts` (one factory that knows both worlds, and how `YOUTUBE_API_KEY` is used there); `apps/api/src/modules/discover/discover.cache.ts` (one in-flight fetch per cache key); `apps/api/src/modules/redis/redis.service.ts`; the entitlement resolver from Module 01.

## Design

### 1. Link Recognition (`packages/video-engine/src/links/recognise.ts`, pure)

`recogniseLink(input: string): LinkRef | LinkRefusal`. It parses with `URL`, accepts only `https`, lower-cases the host, strips tracking parameters, and matches the shapes in the research's recognition table:

| Platform | Shapes | Kind |
|---|---|---|
| YouTube | `youtube.com/watch?v=`, `youtu.be/<id>`, `youtube.com/live/<id>` | `video` (or `past_stream` once the probe says so) |
| YouTube | `youtube.com/shorts/<id>` | `short` |
| YouTube | `youtube.com/clip/<id>` | `clip` |
| Twitch | `twitch.tv/videos/<digits>` | `past_stream` |
| Twitch | `clips.twitch.tv/<slug>`, `twitch.tv/<channel>/clip/<slug>` | `clip` |
| Kick | `kick.com/<channel>/videos/<uuid>` | `past_stream` |
| Kick | `kick.com/<channel>/clips/<id>`, `kick.com/<channel>?clip=<id>` | `clip` |

Refusals: a channel, playlist, search or home page is `link_not_a_video`; a bare channel page that is live is `link_live`; any other host is `link_unsupported`. `LinkRef` is `{ platform, kind, externalId, canonicalUrl }`, and `canonicalUrl` is rebuilt from the id, never the pasted text. This function is the extractor allowlist for import and download: yt-dlp is only ever given a `canonicalUrl` it produced. (The channel lister has its own, separate allowlist of listing extractors, section 5; the import probe keeps refusing lists.)

Tests: a table of thirty or so real-shaped links per platform, each to its expected answer, plus hostile input (credentials in the URL, another scheme, a look-alike host such as `youtube.com.evil.example`, a 5,000 character string).

### 2. The Downloader (`packages/media-tools/src/downloader/`)

The interface from the sprint doc, with two bindings.

**Real** (`yt-dlp.downloader.ts`):

- Every call goes through `runTool` with a fixed argument base: `--ignore-config`, `--no-playlist`, `--no-warnings`, `--abort-on-unavailable-fragments` (the default silently leaves holes), `--use-extractors` set to the extractors the platform needs (the exact names are in research 04), the JavaScript runtime from `YTDLP_JS_RUNTIME` (Deno by default), `--proxy`, `--cookies` and `--extractor-args` only when `YTDLP_PROXY`, `YTDLP_COOKIES_FILE` and `YTDLP_EXTRACTOR_ARGS` are set, a socket timeout, and `--` before the URL. Never a format or output string built from user text.
- The tool is the official standalone executable (on Linux `yt-dlp_linux`, not the Python zip, which lacks the impersonation Kick needs). Deno is the JavaScript runtime it uses for YouTube.
- Size and length limits cannot rest on `--max-filesize`: it is ignored for HLS and FFmpeg downloads. The length is checked from the probe before any fetch, and `runTool` is given a watcher that sums the scratch folder every few seconds and kills the process past the cap.
- yt-dlp exits with 1 for almost every failure, so causes are read from its last lines against the exact strings in research 04's error table.
- `probe`: `--dump-single-json --skip-download`, parsed with a Zod schema that keeps only the fields the research lists, mapped to `LinkInfo`. `live` comes from `live_status`. The answer must be one video (`_type` is `video`); a list is `link_not_a_video`, because `--no-playlist` alone does not refuse a pure playlist. YouTube's "most replayed" heat map, when the probe carries it, is kept on `LinkInfo` as an optional `replayed` array for Module 16. Formats are reduced to at most one entry per height (H.264 with AAC preferred, as research 04 section on formats explains) plus one audio-only entry, each with a stable `id`, a label ("1080p") and `bytes` when the platform gives it.
- `fetchProxy`: the best H.264 with AAC rendition at or below `maxHeight`, written to `outFile` in the scratch folder, with `--max-filesize` and a duration filter from the plan's limits, and progress parsed from a `--progress-template` line.
- `fetchRange`: the per-platform strategy from the research. Twitch and Kick: fetch the media playlist of the chosen rendition, slice it by cumulative `EXTINF` to the wanted window (keeping discontinuity tags), write a local playlist and hand it to FFmpeg with a protocol allowlist. YouTube: `--download-sections` on a padded range with `--force-keyframes-at-cuts` (a plain copy starts on a nearby keyframe, not the asked time), then an exact local cut; this path gives no progress until it ends, so the stage shows no number for it. Both end with the same normalise step (H.264, AAC, constant frame rate, a 2 second closed GOP) so every result seeks exactly. The playlist slicer is a pure function with its own tests.
- `fetchFormat`: one `LinkFormat.id` to a file, merged to MP4 or M4A.
- Errors: yt-dlp's exit and its last lines are mapped to the taxonomy in the research (`link_private`, `link_not_found`, `link_live`, `platform_resting`, and `tool_failed` for the rest). The user never sees yt-dlp's text.

**Simulated** (`fixture.downloader.ts`): knows the links in the README Names table. Each answers `probe` from a JSON fixture and the fetch calls by copying (or cutting with FFmpeg) one of two generated sample videos. Any other link is `link_not_found`. The private, live and missing links answer their error.

**Samples** (`packages/media-tools/scripts/make-samples.ts`, `npm run clips:samples`): generates the two videos with FFmpeg's test sources into a git-ignored folder on first use: a 3 minute "talk" (a test pattern with a counter, quiet with a few tone bursts) and a 10 minute "stream" (hard scene flips and loud bursts at fixed times, written down in a JSON beside it, so Module 16's highlights are predictable). The stream sample also has a recorded chat fixture with bursts at the same times. Nothing is downloaded; there is no licence question.

### 3. Platform Switch And Limits

- `CLIPS_PLATFORMS` is read once into `enabledPlatforms`; a recognised link on a paused platform is `platform_paused` before any tool starts.
- A per-platform breaker in Redis: five `platform_resting` answers in ten minutes rest that platform for ten minutes (`platform_resting` at once, no tool started).
- A workspace throttle: ten probes a minute (`probe_throttled`).

### 4. The Probe Route

- `clipProbeWorkflow` on `postgear-media`: one activity, `probeLink(canonicalUrl)`, 20 second timeout, no retry on the non-retryable types.
- `ClipLinksService.probe(orgId, url)`: recognise (422 on a refusal), switch, breaker, throttle, then the Redis cache (`clips:probe:<hash of canonicalUrl>`, ten minutes), then `client.workflow.execute` with a 25 second cap. The plan's longest video, read through the resolver (`clips.max_video_minutes`), is checked against `durationMs` (402 `clips_video_too_long`, with both lengths in the message). The answer also says whether this workspace already has the video (`existingVideoId`).
- `POST /clips/links/probe` with a `.strict()` schema (`url`, trimmed, at most 2,000 characters). The thumbnail in `LinkInfo` is our own address: `GET /clips/links/thumbnail?u=<signed>` fetches it through `fetchBinarySafely` (2 MB cap, image types only) so the browser never talks to the platform.
- Messages in `clips.messages.ts`, exactly the sentences in the stories' section 5.

### 5. Channel Browsing (`ChannelLister`, Decision D12-17)

My Channels: a person types the name of a Twitch, YouTube or Kick channel, and the app lists its public streams, videos and clips so one can be imported with a click. **Metadata only.** Nothing is downloaded until the person presses **Import**, and Import is the existing link import. Design: research 11, sections 3 to 9.

**The interface** (`packages/media-tools/src/channels/`, with the types in `packages/video-engine/src/links/types.ts`): `ChannelLister { platform; resolve(handle); list(channel, { kind, cursor, limit, period, sort }) }`, where `kind` is `streams`, `clips`, `uploads` or `shorts`. A listed item is `{ externalId, kind, title, publishedAt, durationSec, viewCount, thumbnailUrl, state, expiresAt? }`, and `state` is `ready`, `live`, `upcoming` or `processing`. The lister **never returns a download address**: the web builds the canonical link from `{ platform, kind, externalId }` with `recogniseLink`'s builder and posts it to the existing `POST /clips/links/probe`, so Import keeps every check there (live, private, members only, age, plan length, the rights tick). The real list of what is imported is found by matching `platform` and the external id inside the workspace, never stored.

**Four bindings:**

| Binding | Runs where | Used for |
|---|---|---|
| `TwitchHelixLister` | API, plain HTTPS to the fixed host `api.twitch.tv` | Twitch, when `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are set. An **app token** (client credentials, no user login) from `id.twitch.tv`, cached in Redis until a day before it expires, refetched once on a 401. `Get Users` for the name, `Get Videos` (`type=archive` for past streams) and `Get Clips`, 50 items a page. `muted_segments` is always null with an app token, so muted videos cannot be flagged in the list (they surface at Import); the list shows an "Expires in about N days" note from `broadcaster_type` |
| `YouTubeDataLister` | API, fixed host `www.googleapis.com` | YouTube, with `CLIPS_YOUTUBE_API_KEY` (a separate Google Cloud project from the one holding the publishing credentials; in development it may fall back to `YOUTUBE_API_KEY`). `channels.list` with `forHandle`, then `playlistItems.list` on the uploads list, then `videos.list` for length and live state: about 2 quota units a page of 50. Never `search.list` |
| `YtDlpFlatLister` | Worker activity `clipListChannel` on the media queue (the API waits up to 25 seconds, as the probe does) | Kick always (Kick has no official route for videos or clips), Twitch and YouTube as the fallback. `yt-dlp -J --flat-playlist --use-extractors <listing extractor> -I 1:50 -- <channel page>` through `runTool`; it pages by index, so a later page re-walks the earlier ones (acceptable for a fallback) |
| `SimulatedLister` | In process, from fixture files | `CLIPS_SIMULATION=true`: the channel **`simstreamer`** on all three platforms, about 30 items each, including a live stream, one still processing, one near expiry and a long list for paging. Nothing reaches the network |

A selector picks the binding per call: the official one first; the flat lister on a coded failure (`platform_rate_limited`, `quota_exhausted`, keys missing). Item shapes are normalised in the binding, so the UI never knows the source.

**The yt-dlp allowlist for listing.** The listing extractors `kick:videos`, `kick:clips`, `twitch:videos`, `twitch:videos:clips` and `youtube:tab` are allowed **only for the lister**, in a second argument builder with its own snapshot test. The import probe and the download keep refusing lists; a list URL can never reach them. The lister is given only a channel page URL it built itself from a validated handle and a fixed host, never pasted text.

**Handle rules** (a pure `validateHandle(platform, text)` in the engine, which also cuts a pasted channel link down to its handle): Twitch 4 to 25 of `a-z 0-9 _`; YouTube `@` plus 3 to 30 letters, digits and `. _ -` (a `/channel/UC...` id also works); Kick letters, digits, `_` and `-`, at most 25. A video link pasted as a channel answers `link_is_a_video` ("That is a video link. Paste it in the link box on Clips.").

**Caching.** Redis key `clipch:<platform>:<externalId>:<kind>:<sort>:<period>:<cursor>`. Fresh for **10 minutes**. After that the list is fetched again; if that fails the stale copy is served for **at most 24 hours** with an "Updated N hours ago" note, and a copy older than that is refused (Twitch's developer agreement allows caching Twitch data for only twenty-four hours; YouTube data is kept **at most 30 days** by policy, our cache is never longer than the 24 hours). One in-flight fetch per key (the `DiscoverCache` pattern), so ten open tabs cost one call. Thumbnails are not copied: the browser loads the platform's own address.

**Throttles and quotas.** Per workspace: 30 list calls a minute, 6 add or resolve calls a minute, one refresh per channel per 30 seconds. Per platform: Twitch stops at 80 percent of the `Ratelimit-Limit` read from the headers; **YouTube: a Redis counter caps Clips at 60 percent of the shared key's 10,000 units a day** (6,000), reset at midnight Pacific, so Discover (which uses the same kind of key) keeps room; yt-dlp flat listing runs two at a time per platform behind the same breaker as the probe. Paging: 50 items a page, at most 20 pages (1,000 items) a session ("Showing the newest 1,000. Paste a link for older videos.").

**Routes** (class-level `@Roles(ADMIN, USER)`, `.strict()` Zod bodies, `organizationId` checked on every row):

| Route | What |
|---|---|
| `POST /clips/channels` `{ platform, handle }` | Validate, resolve, create a `ClipChannel`. 402 `clips_channel_limit` over the plan (`clips.browse_channels` through the resolver: Free 1, Standard 3, Pro 5, Team 10, Ultimate 20) |
| `GET /clips/channels` | The workspace's channels |
| `GET /clips/channels/:id/streams?kind&cursor&sort&hidden` | One page of 50 items. `sort` is `newest` or `views` (YouTube lists newest first only, so `views` is refused for it with a sentence). Items hidden by this workspace are left out unless `hidden=true`. Each item carries `imported: true` and the `videoId` when this workspace already has it |
| `PUT /clips/channels/:id/hidden/:externalId`, `DELETE` the same path | Hide and unhide one item (ids only, never titles) |
| `DELETE /clips/channels/:id` | Remove the channel and its hidden ids |
| `POST /clips/channels/:id/refresh` | Drop the cache for this channel (one a 30 seconds) |

Messages (in `clips.messages.ts`): `channel_not_found` "We could not find that channel. Check the spelling."; `clips_channel_limit` "Your plan allows {n} channels. Remove one to add another."; `list_unavailable` "This channel's list is not available right now. Try again in a few minutes."; `quota_exhausted` "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link."; `platform_changed` "We could not read this list. We are looking into it. You can paste a link instead."

**Registration and keys guide.** This feature registers a Twitch application, which binds PostGear to Twitch's Developer Services Agreement; so use a **dedicated Twitch application** for listing only (a revoked app then touches nothing else). Add to the keys guide (`docs/sprint-12/` and `.env.example`): create the app at dev.twitch.tv/console (category "Website Integration", OAuth redirect `http://localhost` is enough because no user logs in), copy the **Client ID** into `TWITCH_CLIENT_ID`, press **New Secret** and copy it into `TWITCH_CLIENT_SECRET` (shown once). For YouTube: a **separate** Google Cloud project, enable "YouTube Data API v3", create an API key restricted to that API and the server's address, and put it in `CLIPS_YOUTUBE_API_KEY`. Neither key is ever logged (the logger redacts both names and the token).

**The platform switch also governs listing:** `CLIPS_PLATFORMS` hides a platform's Browse entry as well as its Import, so if YouTube is off in production (decision D12-15) its list is hidden too. Kick listing is off by default until the spike passes.

**Legal note** (engineering reading, not legal advice; full text in research 11, section 10): metadata only before Import; the cache obeys the strictest rule read (24 hours); thumbnails are not copied; the file itself still comes from yt-dlp, never from a listing route; Import keeps the rights tick and its stored record; a person may add any public channel, not only their own, because ownership cannot be proven without a login, so the rights tick carries the claim.

### 6. The Real-Network Spike (Only With Arvind's OK In The Session)

Run once, with links and channels Arvind supplies, and write `../research/14-link-spike-report.md` in the research format: for each platform, does probe work from this machine, which renditions are offered, does `fetchProxy` work, is `fetchRange` exact to the frame at three places in a long video (start, middle, near the end), how long each took, any bot check, and what the Kick section bug does today. Add the **channel spike checks** of research 11, section 5: `kick:videos` and `kick:clips` from the worker's address with and without the impersonation extra, the fields a Kick flat entry holds (length, views, date), `youtube:tab` flat fields with `approximate_date`, and one real Helix run with the new Twitch app. If a strategy fails, change it here and say so in the Decision Log. Without the OK, skip this task and leave it unticked.

### 7. Tests

- Engine: the recognition table; `validateHandle` per platform and the link-to-handle cutting; the canonical link builder per listed item kind.
- Tools: the yt-dlp argument builder (snapshot of the argument array for each call, proving no user text reaches a flag position), the listing argument builder (its own snapshot, allowlisted extractors only), the probe mapper against recorded JSON for each platform (hand-trimmed real shapes from the research), the error mapper, the playlist slicer (plain, with discontinuities, a window that starts mid-segment, past the end), the fixture binding; the listers: contract tests on recorded fixtures (Helix users, videos with null `muted_segments`, a clips page with a cursor, an empty channel, a 404, a 429 with `Ratelimit-Reset`; YouTube `forHandle` miss and quota 403; a `kick:videos` flat answer) that all produce identical item shapes, the Helix duration parser (`3m21s`, `1h0m5s`) and the ISO 8601 parser.
- API: the probe service with a fake workflow client (refusals, switch, breaker, throttle, cache hit, too long, already here), route tenancy and schema specs, the thumbnail route's refusals; the channel routes (tenancy: another workspace's channel id is 404; the plan limit through a fake resolver; strict bodies); the selector (official then flat, keys missing, the YouTube day budget spent); the cache (fresh, stale on error, a copy older than 24 hours refused, one in flight per key); the simulation never reaches the network.

## Scope

**In**: recognition, the `Downloader` (both bindings), samples and fixtures, the platform switch, breaker and throttle, the probe workflow and route, the thumbnail route, the `ChannelLister` with its four bindings, cache, throttles, routes and messages, the Twitch and Google key steps, the spike report.
**Out**: storing any video (04), the import job (04), rendering (05), the page, the link card and the Browse dialog (06), the download job and its tab (18).

## Tasks

- [ ] `recogniseLink` with its table tests.
- [ ] The yt-dlp binding: argument base, `probe`, `fetchProxy`, `fetchRange` (both strategies), `fetchFormat`, the error mapper.
- [ ] The playlist slicer with tests.
- [ ] `npm run clips:samples`, the sample facts JSON, the chat fixture, the fixture binding.
- [ ] Both bindings in `createClipProviders`; the doctor warns when yt-dlp is missing outside simulation.
- [ ] Platform switch, breaker, throttle.
- [ ] `clipProbeWorkflow`, `ClipLinksService`, `POST /clips/links/probe`, the thumbnail route, messages.
- [ ] `validateHandle` and the canonical link builder for listed items.
- [ ] `ChannelLister`: the four bindings, the selector, the cache, the throttles and the YouTube 60 percent counter, the listing yt-dlp argument builder and its allowlist.
- [ ] The simulated lister and its `simstreamer` fixtures.
- [ ] `ClipChannel` routes (`POST`, `GET`, `streams`, hide and unhide, `DELETE`, refresh), the entitlement `clips.browse_channels`, messages.
- [ ] `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and `CLIPS_YOUTUBE_API_KEY` in the API env, `.env.example` and the keys guide; log redaction.
- [ ] The spike and `14-link-spike-report.md` (only with Arvind's OK).
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js links
npx jest --config packages/media-tools/jest.config.js downloader channels
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips
npm run clips:samples
```

## Done When

- Every link in the recognition table gives its expected answer; a look-alike host is refused.
- Under simulation, probing each simulation link answers in under two seconds with the right `LinkInfo`; the private, live and missing links answer their sentence; nothing touches the network.
- The argument snapshots show a fixed flag base and `--` before the URL for every call.
- The sliced playlist covers exactly the asked window in every slicer test.
- With YouTube removed from `CLIPS_PLATFORMS`, a YouTube link answers `platform_paused` and Twitch still works.
- With the worker stopped, the probe route answers within about 25 seconds with a plain sentence, not a hang.
- Under simulation, adding `simstreamer` on each platform lists about 30 items in pages of 50 or fewer; a second call inside ten minutes does not call the binding again; hiding an item removes it from the list and `hidden=true` brings it back.
- A workspace over its `clips.browse_channels` limit gets 402 `clips_channel_limit` with the plan's number in the sentence; another workspace's channel id answers 404.
- With both Twitch keys unset, a Twitch channel falls back to flat listing (simulated); a stale cache older than 24 hours is never served.
- No listing answer contains a download address, and no log line contains either Twitch value or the token.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin (the page comes in Module 06, so use the browser console or `curl` with the session cookie):

1. `POST /clips/links/probe` with the simulation Twitch link: title, "past_stream", 10 minutes, three qualities and audio.
2. The same with the private, the live and the missing simulation links: one sentence each.
3. A `https://vimeo.com/...` link: "We can only read YouTube, Twitch and Kick links for now. You can upload the file instead."
4. A YouTube channel link: "This link is a channel or a list. Paste the link of one video."
5. Probe eleven times in a minute: the eleventh is throttled.
6. Set `CLIPS_PLATFORMS="twitch,kick"`, restart, probe the simulation YouTube link: the paused sentence.
7. `POST /clips/channels` with `{ "platform": "TWITCH", "handle": "simstreamer" }`, then `GET /clips/channels/<id>/streams`: about 30 items, one marked live, one processing. Add a second channel on a Free workspace: the limit sentence.
8. Hide one item, list again (gone), list with `hidden=true` (back).
9. Post the canonical link of a listed item to `/clips/links/probe`: it answers like any pasted link.

## Handoff

Module 04 calls `fetchProxy` and uses `LinkInfo` to create the video row. Module 05 calls `fetchRange`. Module 06 draws the link card from the probe answer and `existingVideoId`, and the Browse dialog and Streams tab from the channel routes (Import posts the canonical link to the probe). Module 18 lists `LinkInfo.formats` and calls `fetchFormat`. Module 20's security sweep checks that Twitch and Google keys are never logged.
