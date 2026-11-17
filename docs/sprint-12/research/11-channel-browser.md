# Sprint 12 Research: The Channel Browser

> **Written**: 2026-11-17. The design for decision D7 "Browse My Channels" in the brief: add a Twitch, YouTube or Kick channel by handle, see its past streams and clips, import one with a click. Documents only: no code was changed. Platform documents were fetched and read on 2026-11-17; a fact marked **(reported)** was not read on a platform's own page. Code was read on branch `instagram-direct-and-threads`.
> **Short names**: "Helix" is Twitch's API (dev.twitch.tv/docs/api). "yt-dlp source" is a file under github.com/yt-dlp/yt-dlp/tree/master/yt_dlp. "Lister" means the new `ChannelLister` described in section 6.

## 1. The Short Version

| Question | Answer |
|---|---|
| What is it | A list of public videos and clips for a channel the person typed by name. Metadata only. Nothing is downloaded until the person presses Import, and Import is the existing link import |
| Twitch | Official Helix with an app token (free, no user login): `Get Users`, `Get Videos`, `Get Clips` |
| YouTube | Official Data API v3 with an API key: `channels.list` (`forHandle`), `playlistItems.list`, `videos.list`. About 2 quota units per 50 videos |
| Kick | **No official route for videos or clips.** docs.kick.com has 26 pages and none covers them. We list through yt-dlp's `kick:videos` and `kick:clips`, which call Kick's own website endpoints. Unofficial, so it can break |
| Fallback | yt-dlp `--flat-playlist -J` on the worker, for Kick always and for Twitch and YouTube when the official route is off or out of quota |
| What is stored | A `ClipChannel` row (name, avatar, ids) and a list of hidden ids. Never the video list itself, only a short cache |
| Plan limit | A new entitlement key `clips.browse_channels` (section 9) |

This replaces one line of `07-legal-limits-cost-and-risks.md` section 4 ("Call the YouTube Data API or a Twitch API to help an import"). The brief (D7) wins. The price is paid in section 10.

## 2. What The Reference Shows

| Screen | What it does | Our answer |
|---|---|---|
| [`streamladder/38`](../../screenshots/streamladder/38-streams-empty-connect-twitch-or-kick.png) | Streams page, empty: "Connect your Twitch or Kick account. Add your Twitch or Kick username in settings and we'll pull your streams and clips". Buttons **Sort**, **Show hidden**, "0 streams", **Find clips from stream**. A Twitch and a Kick chip, **Add your account** | A Streams tab with the same controls. The account is a typed handle, not a login |
| [`streamladder/25`](../../screenshots/streamladder/25-clips-library-status-tabs-connect-account.png) | Clips page with the same connect card, status tabs (All, New, Draft, Exported, Scheduled, Hidden), **Sort**, **Source**, list and grid switch | Source filter and the view switch are Module 07. The connect card is shared |
| [`streamladder/01`](../../screenshots/streamladder/01-home-paste-url-error-twitch-youtube-kick.png), [`39`](../../screenshots/streamladder/39-clipgpt-find-clips-paste-twitch-vod-url.png) | **Browse Twitch** and **Browse Kick** beside the paste box | Three entries: Browse Twitch, Browse YouTube, Browse Kick, each opening the channel picker |

StreamLadder ties the connection to the account's own name. PostGear does not check ownership (no sign-in), so the rights tick at Import carries the weight (section 10).

## 3. Twitch Helix

All rows read at dev.twitch.tv/docs/api/reference (users, videos, clips, schedule pages), verified 2026-11-17.

| Call | What we use | Facts |
|---|---|---|
| App token | `POST https://id.twitch.tv/oauth2/token`, form body `client_id`, `client_secret`, `grant_type=client_credentials` | Answer has `access_token`, `expires_in`, `token_type`. No refresh token. "Non-sensitive data only" (dev.twitch.tv/docs/authentication/getting-tokens-oauth, verified 2026-11-17). Needs env `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (new; `.env.example` has none today) |
| `GET /helix/users?login=<name>` | Name to id, `display_name`, `profile_image_url`, `broadcaster_type` | An app token works. Up to 100 ids plus logins per call. Deleted and suspended accounts are omitted. A malformed login fails the whole call, so we validate first |
| `GET /helix/videos?user_id=<id>&type=archive&first=100` | Past streams | App or user token. `first` 1 to 100, default 20. Cursor in `pagination.cursor`. `type` is `all`, `archive`, `highlight`, `upload`. `period` is `all`, `day`, `week`, `month`. `sort` is `time`, `trending`, `views` |
| Video fields | `id`, `stream_id`, `title`, `created_at`, `published_at`, `url`, `thumbnail_url`, `viewable`, `view_count`, `language`, `type`, `duration`, `muted_segments` | `duration` is text like `3m21s` or `1h0m5s`. `thumbnail_url` holds `%{width}x%{height}` and "currently the width must be 320 and the height must be 180". `viewable` is always `public` |
| `muted_segments` | Muted music spans | **"Always null when using an app access token."** So the list cannot flag muted VODs. They show up at Import (the probe and the loudness track) |
| The 500 limit | A `game_id` query stops at 500 videos | A `user_id` query has no stated cap |
| `GET /helix/clips?broadcaster_id=<id>&first=100` | Clips | App or user token. Sorted by views, descending. "Across multiple requests, the maximum is approximately 1,000 results. To get more, split the query by different `started_at` and `ended_at` ranges." `ended_at` defaults to a week after `started_at` |
| Clip fields | `id`, `url`, `thumbnail_url`, `title`, `view_count`, `created_at`, `duration` (seconds, 0.1 precision), `vod_offset`, `video_id`, `creator_name` | No file address. `Get Clips Download` needs a user token with `editor:manage:clips` or `channel:manage:clips`, so it is not usable here |
| Rate limit | A token bucket per app, a separate bucket for app tokens | Headers `Ratelimit-Limit`, `Ratelimit-Remaining`, `Ratelimit-Reset`; 429 on empty (dev.twitch.tv/docs/api/guide, verified 2026-11-17). The page's sample shows 800 but "doesn't state the actual limit". Treat 800 a minute as **(reported)** and read the headers |
| Live now | Is the newest archive still running | `Get Streams` by `user_id` (not fetched, **reported**). If its stream id equals a video's `stream_id`, that video is live |

**Expiry badge.** `broadcaster_type` (affiliate, partner, empty) decides how long past broadcasts last: 7 days normally, 14 for Affiliates, 60 for Partners (**reported**, from `04-link-import-and-fetch.md` section 4). The row can say "Expires in about 3 days". Highlights and uploads do not expire that way.

## 4. YouTube Data API v3

Read at developers.google.com/youtube/v3, verified 2026-11-17, except where marked.

| Step | Call | Cost |
|---|---|---|
| Find the channel | `channels.list?part=snippet,contentDetails&forHandle=@name` | 1 unit. "The forHandle parameter specifies a YouTube handle", with or without the `@`. Not marked as needing OAuth, so a key is enough |
| The uploads list | `contentDetails.relatedPlaylists.uploads` from that answer (the field is not described on the page we read; **reported**, widely used) | free in the same call |
| A page of videos | `playlistItems.list?part=snippet,contentDetails&playlistId=<uploads>&maxResults=50&pageToken=` | 1 unit. `maxResults` is 0 to 50, default 5. `nextPageToken` pages on |
| Length, views, live | `videos.list?part=contentDetails,statistics,snippet,liveStreamingDetails&id=<50 ids>` | 1 unit. Up to 50 ids is **reported** (the page does not state it). Duration is ISO 8601 (`PT1H2M3S`), `liveBroadcastContent` is `live`, `upcoming` or `none`, age limits sit in `contentDetails.contentRating` (all **reported**: the page lists parts, not fields) |
| Quota | Default 10,000 units a day, `search.list` is the costly call (developers.google.com/youtube/v3/determine_quota_cost) | We never call `search.list` |

**Cost in practice.** Adding a channel is 1 unit. Each page of 50 videos is 2 units. A channel with 10,000 uploads is 200 pages and 400 units, so a person scrolling the whole list spends 4 percent of a day's quota. We page on demand only (section 7), and a Redis counter caps Clips at 60 percent of the day so Discover (which already uses `YOUTUBE_API_KEY`, see `apps/api/src/modules/discover/discover.engine.ts`) keeps room.

**The uploads list has gaps.** It holds public uploads and finished live streams. It does not split Shorts from videos (only duration hints, and Shorts may be 3 minutes, `07` section 7). Private, unlisted and members-only items do not appear without OAuth (**reported**). So the tabs are Videos, Streams (live ended) and Shorts is just a length filter, not a platform fact.

**Policy.** YouTube's API policy lets us keep "Non-Authorized Data" for "not longer than 30 calendar days" and requires fresh data (III.E.4.d, III.E.4.e), and bars copying audiovisual content (III.E.1.a). Listing does neither. Any page that shows YouTube content must show YouTube Brand Features (III.F.2.a). All from developers.google.com/youtube/terms/developer-policies, verified 2026-11-17. Our cache lives at most 24 hours (section 7), so it passes. Each YouTube row carries a small YouTube mark.

## 5. Kick And yt-dlp

**Kick has no official video or clip route.** docs.kick.com/llms.txt lists 26 pages: Categories, Users, Channels, Channel Rewards, Chat, Moderation, Livestreams, Public Key, KICKs, Ads and the event pages. None is for VODs or clips (verified 2026-11-17). `GET /public/v1/channels` takes up to 50 slugs (25 characters each) and an app token, and returns `is_live`, `stream_title` and a `stream` block, but no videos. `GET /public/v2/livestreams` returns only active streams. So Kick listing is **unofficial by necessity**.

**What yt-dlp has today** (yt-dlp source `extractor/kick.py`, `extractor/twitch.py`, verified 2026-11-17):

| Extractor | `IE_NAME` | URL it takes | Backing call | Notes |
|---|---|---|---|---|
| `KickVideosIE` | `kick:videos` | `kick.com/<channel>/videos` | `v1/channels/{creator_id}/videos` on Kick's web host, after `v2/channels/{slug}` | A channel list. New since our 2026-11-14 reading, which showed only `kick:vod` and `kick:clip` |
| `KickClipsIE` | `kick:clips` | `kick.com/<channel>/clips` | `v1/channels/{creator_id}/clips`, cursor paged | A channel list |
| `TwitchVideosIE` | `twitch:videos` | `twitch.tv/<channel>/videos` | GraphQL `FilterableVideoTower_Videos`, 100 a page | Flat entries carry `id`, `title`, `thumbnail`, `duration`, `view_count` |
| `TwitchVideosClipsIE` | `twitch:videos:clips` | `twitch.tv/<channel>/clips` | GraphQL `ClipsCards__User`, 20 a page | Also `timestamp`, `language`. **Note**: `twitch:clips` is the single-clip extractor, not the list |
| `youtube:tab` | `youtube:tab` | `youtube.com/@name/videos`, `/streams`, `/shorts` | The website's own browse data | Flat entries may miss fields; `--extractor-args youtubetab:approximate_date` fills date and timestamp in flat mode (yt-dlp README, verified 2026-11-17) |

None of the listing extractors needs a login (`twitch.py`: the `Authorization` header is sent only if a cookie exists). Twitch's route is Twitch's private GraphQL, the same fragile route noted in `04` section 4.

**The call** (worker, `runTool`, argument array, no shell):

```
yt-dlp -J --flat-playlist --ignore-config --use-extractors kick:videos -I 1:50 --color never --socket-timeout 20 -- https://kick.com/<slug>/videos
```

`--flat-playlist` "do not extract a playlist's URL result entries; some entry metadata may be missing", `-I` takes `[START]:[STOP]` (yt-dlp README, verified 2026-11-17). It pages by index, not cursor, so page 3 re-walks pages 1 to 3: acceptable for a fallback. A separate allowlist for listing is needed (`kick:videos`, `kick:clips`, `twitch:videos`, `twitch:videos:clips`, `youtube:tab`). The **import probe keeps refusing lists** (`04` section 9); only the lister may use them.

**Spike checks for Module 03** (additions to `04` section 7): (a) `kick:videos` and `kick:clips` from the worker's address, with and without curl_cffi; (b) the fields a Kick flat entry holds (duration, views, date; unread); (c) `youtube:tab` flat fields with `approximate_date`; (d) one real Helix run with a new app.

## 6. The Design

### 6.1 Data

```prisma
model ClipChannel {
  id             String   @id @default(uuid())
  organizationId String
  platform       ClipPlatform          // TWITCH | YOUTUBE | KICK (reuse the Module 01 enum)
  handle         String                // lower case login, @handle, or slug as typed and checked
  externalId     String                // Twitch user id, YouTube channel id, Kick slug
  displayName    String
  avatarUrl      String?
  uploadsListId  String?               // YouTube only
  broadcasterType String?              // Twitch: affiliate | partner | ""
  lastSyncedAt   DateTime?
  error          String?               // a code from section 8, null when fine
  createdById    String?
  createdAt      DateTime @default(now())
  hidden         ClipChannelHidden[]
  @@unique([organizationId, platform, externalId])
}
model ClipChannelHidden {            // ids only, never titles
  channelId  String
  externalId String
  hiddenAt   DateTime @default(now())
  @@id([channelId, externalId])
}
```

No video rows. A video is a `ClipVideo` only once imported, and the list marks it "Imported" by matching `platform` and the external id inside the workspace.

### 6.2 The Interface

```ts
type ListKind = 'streams' | 'clips' | 'uploads' | 'shorts';
interface ChannelRef { platform: ClipPlatform; handle: string; externalId: string;
  displayName: string; avatarUrl: string | null; uploadsListId?: string; broadcasterType?: string }
interface ListedItem {
  externalId: string;          // the id inside the canonical link, never a URL from the API
  kind: 'vod' | 'highlight' | 'upload' | 'clip' | 'short';
  title: string; publishedAt: string; durationSec: number | null; viewCount: number | null;
  thumbnailUrl: string | null; state: 'ready' | 'live' | 'upcoming' | 'processing';
  expiresAt?: string;          // Twitch archives
}
interface ChannelLister {
  platform: ClipPlatform;
  resolve(handle: string): Promise<ChannelRef>;                       // throws a coded error
  list(ch: ChannelRef, q: { kind: ListKind; cursor?: string; limit: number; period?: Period;
       sort?: 'newest' | 'views' }): Promise<{ items: ListedItem[]; nextCursor?: string }>;
}
```

The lister never returns an address. The web builds the canonical link from `{platform, kind, id}` with the same pure recognition code as `04` section 9 and posts it to the existing `POST /clips/links/probe`. Import is therefore unchanged and keeps every check there (live, private, members only, age, plan length, rights tick).

| Binding | Where it runs | Used for |
|---|---|---|
| `TwitchHelixLister` | API (plain HTTPS to the fixed host `api.twitch.tv`, via `operator-fetch`-style locked origin) | Twitch, when both Twitch env values are set |
| `YouTubeDataLister` | API (fixed host `www.googleapis.com`) | YouTube, when a key is set and the day's budget is not spent |
| `YtDlpFlatLister` | Worker activity `clipListChannel` on the media queue; the API waits up to 25 seconds, as the probe does (`08` section 1) | Kick always. Twitch and YouTube as fallback |
| `SimulatedLister` | In process, from fixture files | `CLIPS_SIMULATION=true`. Channels `acme` (Twitch, Kick) and `@acme` (YouTube), about 30 items each: ready, one live, one processing, one near expiry, one huge-count page |

A selector picks the binding per call: official first, flat listing on a coded failure (`platform_rate_limited`, `quota_exhausted`, keys missing). Item shapes are normalised in the lister, so the UI never knows the source.

### 6.3 Routes

| Route | Role | What |
|---|---|---|
| `GET /clips/channels` | member | The workspace's channels |
| `POST /clips/channels` `{platform, handle}` | member | Validate, resolve, create. 422 `channel_limit` over the plan. Pasted channel links are accepted and cut down to the handle |
| `DELETE /clips/channels/:id` | member | Remove it and its hidden ids |
| `POST /clips/channels/:id/refresh` | member | Drop the cache (one a 30 seconds) |
| `GET /clips/channels/:id/items?kind=&cursor=&sort=&period=&showHidden=` | member | One page, 50 items |
| `PUT` and `DELETE /clips/channels/:id/hidden/:externalId` | member | Hide and unhide |

All under the class-level `@Roles(ADMIN, USER)`, plus the Editor value from `10-creator-tools-and-editor-seats.md` (Sprint 13 research) if that ships; Zod `.strict()` bodies; the handler checks `organizationId` on every row.

### 6.4 Handle Rules

| Platform | Accepted | Check before any call |
|---|---|---|
| Twitch | login, or a `twitch.tv/<login>` link | 4 to 25 of `a-z 0-9 _` after lower-casing (**reported** rule); one `Get Users` call |
| YouTube | `@handle` or a `youtube.com/@handle` link | `@` plus 3 to 30 of letters, digits, `. _ -` (**reported**); `/channel/UC...` ids also accepted |
| Kick | slug, or a `kick.com/<slug>` link | letters, digits, `_ -`, at most 25 (the Channels API says "each max 25 characters", docs.kick.com/apis/channels, verified 2026-11-17) |

A video link pasted in the add box is answered with "That is a video link. Paste it in the link box on Clips." No handle is ever put into a URL without encoding and the platform's host fixed in code.

## 7. Caching And Throttles

| Layer | Rule |
|---|---|
| Cache | Redis, key `clipch:<platform>:<externalId>:<kind>:<sort>:<period>:<cursor>`. Fresh for 10 minutes. After that the list is fetched again; if the fetch fails, the stale copy is served for up to **24 hours** with an "Updated N hours ago" line. 24 hours is the strictest of the three rules read: Twitch's agreement allows caching for "only a twenty-four hour time period" (legal.twitch.com/en/legal/developer-agreement, verified 2026-11-14 in `07`), YouTube's is 30 days |
| Locks | One in-flight fetch per cache key (the `DiscoverCache` pattern in `apps/api/src/modules/discover/discover.cache.ts`), so ten tabs open at once cost one call |
| App token | Cached in Redis until `expires_in` minus one day; on a 401 it is fetched once and the call retried once |
| Per workspace | 30 list calls a minute, 6 add or resolve calls a minute, one refresh per channel per 30 seconds |
| Per platform | Twitch: stop at 80 percent of `Ratelimit-Limit` (read from headers). YouTube: 6,000 units a day for Clips, a Redis counter reset at midnight Pacific (quota resets then, **reported**). yt-dlp flat: two at a time per platform, and the 10 minute breaker of `04` section 11 |
| Paging | 50 items a page; at most 20 pages (1,000 items) per session. Beyond that: "Showing the newest 1,000. Paste a link for older videos." Twitch clips beyond 1,000 use date windows through a Period filter |
| Thumbnails | The browser loads the platform's own thumbnail address (Twitch at 320 by 180). We do not copy it |

## 8. The Screens

The Streams tab sits in Clips beside Clips and Uploads. Names are Title Case, sentences stay sentence case.

| State | What the person sees |
|---|---|
| No channel yet | A card: **Add A Channel**. "Add the name of a Twitch, YouTube or Kick channel. We list its public videos and clips so you can import one with a click." Three chips: Twitch, YouTube, Kick. Button **Add A Channel** |
| Add dialog | `ChoiceTiles` for the platform; input placeholder "Enter the channel name"; **Check** shows the avatar and display name; then **Add Channel**. Under it: "Only public videos are listed. Nothing is downloaded until you import one." |
| List | Channel chips on top (avatar, name, a small platform mark; a remove menu). Tabs per platform: Twitch and Kick **Streams** and **Clips**; YouTube **Videos**, **Streams**, **Shorts**. Toolbar: **Sort** (Newest, Most Viewed), **Period** (Twitch), **Show Hidden**, **Refresh**, "Updated 4 minutes ago", item count |
| Row | Thumbnail, title, date, length, **View Count** ("12,408 views"), expiry text for Twitch archives, **Import** button, hide icon. Imported rows show **Open** instead |
| Live | A "Live Now" badge, no Import button, tooltip "Come back when the stream has ended" (`video_live`) |
| Processing | "Still Processing" badge, no Import (`post_live`) |
| Many videos | "Show More" and scroll load; after 20 pages the note in section 7 |
| Loading | Skeleton rows, never a spinner over old rows |
| Error | Alert with the code's message (below), **Try Again**, and for `platform_rate_limited` "We will retry shortly" |

Sort "Most Viewed" is the platform's own order for Twitch (`sort=views`, clips default to views). For YouTube the API gives only newest first, so the control is disabled for it and says "YouTube lists newest first". Sorting loaded rows only would mislead.

| Code | Message |
|---|---|
| `channel_not_found` | "We could not find that channel. Check the spelling." |
| `channel_limit` | "Your plan allows N channels. Remove one to add another." |
| `list_unavailable` | "This channel's list is not available right now. Try again in a few minutes." |
| `quota_exhausted` | "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link." |
| `platform_changed` | "We could not read this list. We are looking into it. You can paste a link instead." |

## 9. Limits, Refusals And Plans

| Rule | Detail |
|---|---|
| Channels per workspace | New entitlement key `clips.browse_channels` (number): FREE 1, STANDARD 3, PRO 5, TEAM 10, ULTIMATE 20. Added to the Module 01 registry (`12-plans-entitlements-and-usage.md`). Placeholders the operator edits |
| What is refused | A live stream or a stream still processing (listed, not importable). A channel with no public videos (empty state, not an error). Private, members-only and age-gated videos are not on public lists, or fail at the probe with the codes of `04` section 10 |
| Sub-only and muted VODs | Not detectable from the list (Helix hides `muted_segments` from app tokens, section 3). They fail or are flagged at Import. The row gets no warning in advance, and the docs say so |
| Huge channels | Paged, capped at 1,000 items a session (section 7) |
| Platform switch | `CLIPS_PLATFORMS` hides a platform's Browse entry as well as its Import. If YouTube is off in production (D12-15), YouTube listing stays hidden too, so we do not show a list we cannot import from |
| Roles | Any member. Editors (Sprint 13) may browse and import |

## 10. Legal And Terms Note

This is the engineering reading of each document, not legal advice.

| Platform | What the list touches | Our position |
|---|---|---|
| Twitch | The Developer Services Agreement binds us **once we register a Twitch application**, and this feature registers one. It says "Do not store copies of Twitch Content ... unless you ... (c) cache such information for only a twenty-four hour time period" and wants the embeddable player for Twitch video (legal.twitch.com/en/legal/developer-agreement, last modified 2024-12-04, verified 2026-11-14) | Metadata cached 24 hours at most; thumbnails not copied; the file itself still comes from yt-dlp, which the Terms of Service already put outside the rules (`07` section 1). `07` section 3 says the agreement applies only if we register an app and "Sprint 12 does not". **That line is now out of date.** Mitigation: a **dedicated Twitch application** used only for listing, so a revoked app cannot touch anything else |
| YouTube | The API policy binds the developer. Listing is allowed; copying audiovisual content (III.E.1.a) is not. If listing and import share one Google project, an audit of import could reach the listing key and, worse, the publishing credentials | A **separate Google Cloud project** for the listing key (`CLIPS_YOUTUBE_API_KEY`, falling back to `YOUTUBE_API_KEY` in development only), never the project that holds the publishing OAuth client. Production use waits for the same legal read as D12-15 |
| Kick | Terms 1.4 bar "automated systems" (`07` section 1); we call Kick's website endpoints through yt-dlp | Unofficial and the one most likely to break or be blocked. Off by default in `CLIPS_PLATFORMS` until the spike passes, as for import |

What does not change: metadata only before Import; Import keeps the **rights tick** (`rightsConfirmedAt`) and the stored answer; the list never offers a download of its own; "What can I import?" is linked from the add dialog. A person can add any public channel, not only their own, because we cannot verify ownership without a login.

**Open question for Arvind**: any public channel, or only the person's own? Recommendation: any public channel. We cannot prove ownership without OAuth, the rights tick already puts the claim on the person, and a restriction we cannot enforce would only inconvenience honest users.

## 11. Tests

| Area | What |
|---|---|
| Pure | Helix `duration` parser (`3m21s`, `1h0m5s`, `45s`); ISO 8601 parser; thumbnail template; handle validators and link-to-handle cutting; canonical link builder per item kind |
| Listers | Contract tests per binding on recorded fixtures (users, videos with `muted_segments: null`, clips page with cursor, empty channel, 404, 429 with `Ratelimit-Reset`, YouTube `forHandle` miss, quota 403, `kick:videos` flat JSON) producing identical `ListedItem` shapes |
| Selector | Official then flat fallback; keys missing; day budget spent; breaker open |
| Cache | Fresh, stale on error, stale older than 24 hours is refused, one in-flight per key |
| Routes | Tenancy (another workspace's channel id is 404), plan limit, strict bodies, role matrix |
| Web | Each state in section 8; Import posts the canonical link to the probe; hidden rows; Title Case test |
| Simulation | `CLIPS_SIMULATION` serves the fixtures and never reaches the network; refused in production |

## 12. Risks

| Risk | Likelihood | Effect | Handling |
|---|---|---|---|
| Kick endpoints change or Cloudflare blocks | High | Kick list fails | Off by default until the spike passes; flat lister behind a breaker; "paste a link" message |
| Twitch revokes the listing app | Low | Twitch list falls back to flat listing | Dedicated app; flat fallback; no other feature depends on it |
| YouTube quota spent by Discover and Clips together | Medium | Lists fail late in the day | 60 percent cap for Clips, shared counter, flat fallback |
| Stale data shown past a platform's cache rule | Low | Terms breach | 24 hour hard limit in code, tested |
| People list channels they do not own | Medium | Import of others' videos | Rights tick and stored record (`07` section 3), takedown path |
| Helix `muted_segments` null hides muted VODs | Certain | A surprise at Import | Said in the docs and the Import preview; the loudness track sees silence |
| yt-dlp flat entries lack fields | Medium | Blank length or views | Show a dash; fields are optional in the Zod shape |
| Large `ClipChannel` counts on one workspace | Low | Slow Home | Plan limit; a lazy tab |

## 13. Where It Lands

Module 01 adds the two tables, the platform enum use and the `clips.browse_channels` key. Module 03 adds the lister interface, three bindings, the simulated one and the spike checks. Module 06 adds the Streams tab, the add dialog and the Browse entries on the link box. Env values added to `.env.example`: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `CLIPS_YOUTUBE_API_KEY`.
