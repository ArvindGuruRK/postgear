# Sprint 13 Research: Creator Tools And Editor Seats

> **Written**: 2026-11-17. The design for decision D7 "Creator Tools" in the brief (Sprint 13 Module 14): an Emote Maker, a Schedule Maker and Editor Seats. Documents only: no code was changed. Platform pages were fetched on 2026-11-17; a fact marked **(reported)** was not read on the platform's own page (Twitch's help site and BetterTTV's pages did not render for the reader, so their numbers come from search excerpts or secondary pages and are marked). Code was read on branch `instagram-direct-and-threads`.

## 1. The Short Version

| Part | What | Recommendation |
|---|---|---|
| B. Emote Maker | Pick a clip or video, a stretch of at most 3 seconds, a square crop. Export Twitch (28, 56, 112 px GIF), 7TV (one WebP or APNG) and BTTV (28, 56, 112 px) | One FFmpeg pass per size, a quality ladder that stops under the byte cap, a chat preview in the browser. Chroma key for background removal; AI removal is left out |
| C. Schedule Maker | A Twitch name becomes a weekly picture in five themes | Built **inside Design Studio**: one new layout (`schedule-week`), a `rows` slot, five themes as data. Export is the existing PNG exporter at 1080 by 1350 and 1920 by 1080. No new renderer |
| D. Editor Seats | A restricted role for a freelancer or a helper | A new `Role.EDITOR` enum value. It fails closed on the API, needs 9 existing `@Roles` decorators changed (of 57), and removes 6 fail-open checks in the web app. Seats have their own entitlement key |

## 2. Emote Rules On Each Platform

| Platform | Rule | Source |
|---|---|---|
| Twitch | Three square sizes: **28, 56 and 112 px** | Search excerpts of help.twitch.tv "Emote Formatting" and "Animated Emotes", 2026-11-17 **(reported)**; StreamLadder's blog agrees for PNG (streamladder.com/blog/how-to-add-animated-emotes-to-twitch, verified 2026-11-17) |
| Twitch, animated | GIF only. Manual upload: three GIFs, "each ... cannot exceed **512 KB**". Auto-resize upload: one square GIF from 112 to 4096 px, "**1 MB** max". "Cannot be more than **60 frames**". "Must not flash or flicker more than **3 times** within a 1 second period" | same excerpts **(reported)** |
| Twitch, who | Animated emotes need Affiliate or Partner status | StreamLadder blog, verified; excerpts **(reported)** |
| Twitch, static | PNG with transparency. A 25 KB cap is quoted for static emotes by third parties, but the excerpts tie 25 KB to badges. Unclear | **(reported, conflicting)**; we cap static PNG at 25 KB to be safe |
| 7TV | Formats "PNG, APNG, WEBP, WEBM, or GIF". Max "**7MB**". Up to "**1000x1000px** (7TV resizes automatically)". Animated: GIF or WEBM, "**1000 max frames**". Public uploads wait in a review queue | help.7tv.app/en/articles/11069712-how-to-upload-an-emote-to-7tv, verified 2026-11-17; review queue **(reported)** |
| BetterTTV | No published upload rules were found. Image addresses come in 1x, 2x and 3x (28, 56, 112 px is the natural fit). A free account has few shared slots | github.com/night/betterttv issues via search, 2026-11-17 **(reported)**. We use Twitch's set and 512 KB |

**Consequence for the tool.** Twitch is the hard target (512 KB at 112 px, 60 frames). The profiles are data (section 3.3), so a changed rule is a one-line edit, and the page text says "Check each site's current rules before you upload".

## 3. The Emote Maker

### 3.1 Flow (after the StreamLadder screen)

[`streamladder/29`](../../screenshots/streamladder/29-emote-maker-twitch-clip-to-emote.png) shows: a paste box "Enter Twitch clip url" with **Get clip** and **Upload from computer**; a video with a dashed square crop box over a face; a waveform trim bar with a short highlighted window and a time marker (0:07); an **Emote preview** card with three small switch icons (Twitch, 7TV, BTTV); three **Export for ...** buttons; a **Twitch Chat preview** card with a sun and moon switch and four chat lines, one holding five emotes.

| Step | PostGear |
|---|---|
| Source | A source already in the workspace (an imported clip, video or upload), or a pasted link through the existing probe and import. A Twitch clip is at most 60 seconds, so it imports whole. The preview plays the light copy (D2 `PreviewEngine`) |
| Trim | A bar with one draggable window, **hard limit 3.0 seconds**, 0.1 second steps. The API refuses longer (`emote_too_long`) |
| Crop | A square box, drag and resize, kept square. A warning when the box is under 112 source pixels ("This will look soft") |
| Look | Optional: remove a plain background (section 5), flip, a still frame for non-animated |
| Preview | The emote at 28, 56 and 112, looping, plus the chat mock (section 6) |
| Export | **Export For Twitch**, **Export For 7TV**, **Export For BTTV**. Each gives a zip of files and the sizes in bytes. Each file reports "under the limit" or why not |

### 3.2 Where It Runs

Preview and crop are browser work. Export is a worker activity `emoteExport` on the media queue, using `runTool` and the compiled plan style of D2 (filter graph in a script file, argument array). It reads the sharp range file when it exists, else the proxy. Outputs go to the private clips bucket and a signed link. Each encode is small, so the API waits up to 25 seconds and answers; longer ones show the usual job card. Downloads count against `clips.downloads_per_day`. No AI Minutes are used.

### 3.3 Profiles As Data

```ts
interface EmoteProfile {
  id: 'twitch' | 'sevenTv' | 'bttv';
  outputs: { size: number; format: 'gif' | 'webp' | 'apng' | 'png'; maxBytes: number }[];
  maxFrames?: number;          // Twitch 60, 7TV 1000
  maxSeconds: 3;
  note: string;                // shown under the button
}
// twitch: 28/56/112 gif, 512 KB, 60 frames (+ still png 25 KB). sevenTv: 256 webp or apng, 7 MB, 1000 frames. bttv: 28/56/112 gif, 512 KB
```

## 4. FFmpeg Commands

The `palettegen` and `paletteuse` options below are from the filters' author (blog.pkh.me/p/21-high-quality-gif-with-ffmpeg.html, verified 2026-11-17: `stats_mode` is `full` or `diff`, `dither=bayer` with `bayer_scale`, `diff_mode=rectangle`; smaller files come from a lower frame rate and from avoiding error-diffusion dithers). ffmpeg.org's filters page was too long for the reader to reach `palettegen`, so `max_colors`, `reserve_transparent` and `alpha_threshold` are **(reported)**. Encoder options for `libwebp` are from ffmpeg.org/ffmpeg-codecs.html (verified 2026-11-17: `-lossless` 0 or 1, `-compression_level` 0 to 6 default 4, `-quality` 0 to 100 default 75). The APNG muxer option `-plays` is from ffmpeg.org/ffmpeg-formats.html (verified: "0 causes an infinite loop"). The encoder name `libwebp_anim` and its `-loop` are **(reported)** and are spike checks.

```
# GIF for Twitch at 112 px (repeat for 56 and 28), 3 s at 20 fps = 60 frames
ffmpeg -y -ss 12.4 -t 3.0 -i range.mp4 -an -filter_complex_script emote112.fcs -loop 0 emote112.gif
# emote112.fcs
[0:v]crop=480:480:620:210,fps=20,scale=112:112:flags=lanczos,split[a][b];
[a]palettegen=max_colors=128:stats_mode=diff[p];
[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle

# Animated WebP for 7TV, 256 px, lossy, keeps alpha
ffmpeg -y -ss 12.4 -t 3.0 -i range.mp4 -an -vf "crop=480:480:620:210,fps=24,scale=256:256:flags=lanczos,format=yuva420p" \
  -c:v libwebp_anim -lossless 0 -quality 80 -compression_level 6 -loop 0 emote256.webp

# APNG alternative (lossless, large)
ffmpeg -y -ss 12.4 -t 3.0 -i range.mp4 -an -vf "crop=480:480:620:210,fps=20,scale=256:256:flags=lanczos,format=rgba" -f apng -plays 0 emote256.apng

```

`-ss` before `-i` seeks fast on the range file, which starts on a known time (the `coveredStartSec` rule of `04-link-import-and-fetch.md` section 6). Values are placeholders from the editor. The crop is `size:size:x:y` in source pixels.

### 4.1 The Size Loop

Never change the pixel size or the length silently. Walk a ladder from best to smallest, encode, measure, stop at the first file under the cap and under the frame limit.

```ts
const ladder = [[20,256,'bayer3'],[20,128,'bayer3'],[15,128,'bayer4'],[15,64,'bayer5'],[12,64,'none'],[10,32,'none']]; // [fps, colours, dither]
// frames = round(seconds * min(step.fps, floor(maxFrames / seconds)))  -> never over 60 for Twitch
```

If the last step is still over, the answer is `emote_too_big`: "This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop." That is six encodes at 112 px at most per size. 28 px and 56 px files nearly always fit at step one. Real sizes are **not measured**: the Module 14 spike encodes three real clips and records the byte counts so the ladder order can be tuned.

## 5. Background Removal

| Option | Feasible | Notes |
|---|---|---|
| Chroma key (`chromakey` or `colorkey` in FFmpeg; both exist, filters page table of contents, verified 2026-11-17, options **reported**) | **Yes, built in** | The person clicks the background colour (an eyedropper on the video) and sets Similarity. Works on green screens and plain walls. Output must carry alpha: `format=rgba`, then for GIF `palettegen=reserve_transparent=1` and `paletteuse=alpha_threshold=128` (**reported**). GIF alpha is one bit, so edges look rough; WebP and APNG keep soft edges |
| Person segmentation by a model (for example rembg with a U2-Net family model, MediaPipe selfie segmentation) | Possible, **not in v1** | Both are open-source (**reported**, licences not read). It needs the Sprint 13 Python media service, a model file, and a pass over about 60 frames per emote. The result is better than a key on a busy room. We leave it out and name it as a later option. If it is added, the licence of the model weights has to be read first, as for every other asset |
| Nothing | Default | The crop is the emote |

## 6. The Chat Preview

A pure React card, no outside images. Four lines in the style of the reference: names in the Twitch-like colours, short words, one line with five emotes in a row. A sun and moon switch swaps `#18181b` and white grounds. Emotes draw at 28 px and, on a 2x screen, from the 56 px file. The first line holds only text, the second one emote at the end, the fourth five. A text field lets the person type their own line; it is never stored or sent. The Twitch brand colour and wordmark are not used, only the word "chat".

## 7. Rights For Emotes

Emotes are made from a clip, so the Sprint 12 rights tick applies (the source import already stores it). The Emote Maker adds one line under Export: "Use clips of your own stream. Twitch reviews emotes before they go live." Nothing is checked for faces or ownership. See D13-13 for the faces and voices read.

## 8. Twitch Schedule Facts

From dev.twitch.tv/docs/api/reference/schedule, verified 2026-11-17.

| Fact | Detail |
|---|---|
| Route | `GET https://api.twitch.tv/helix/schedule?broadcaster_id=<id>` |
| Token | "either a user access token or an app access token", no scope. So the same app token as the Sprint 12 channel browser works. Name to id is `Get Users?login=` (`11-channel-browser.md` in Sprint 12 research) |
| Params | `start_time` (RFC3339 UTC; segments that end after it, including one in progress; default now), `first` 1 to 25 (default 20), `after` cursor, `id` (up to 100). `utc_offset` is "Not supported" |
| Segment | `id`, `start_time` (UTC), `end_time` (UTC or null), `title`, `canceled_until` (equals `end_time` if a recurring segment was cancelled, else null), `category` (`id`, `name`, or null), `is_recurring` |
| Wrapper | `broadcaster_id`, `broadcaster_name`, `broadcaster_login`, `vacation` (`start_time`, `end_time`, or null) |
| Errors | 404 for "The broadcaster has not created a streaming schedule" and for a schedule with no segments |
| Time zone | **None in the answer.** Everything is UTC. The broadcaster's own zone is not returned |
| No box art | The segment carries a category id and name only. Game pictures need another call (not read, **reported**) and are left out of v1 |

## 9. The Schedule Maker

### 9.1 Why Design Studio

Design Studio already has what the picture needs: formats `portrait` (1080 by 1350) and `landscape` (1920 by 1080) in `packages/design-engine/src/formats.ts`; themes as data (`Theme`: `colors` by role, `type` by role, optional `art`); layouts as data (`SlideLayout`: regions, slots, decor); `SlideView` drawn the same in the editor and at export; `buildExportPage` and the Playwright exporter (`apps/api/src/modules/studio/design-exporter.ts`) shooting a lossless PNG then one encode; brand kits, fonts (52 shipped), the editor panel for hand edits, and Send To Composer. Writing a second renderer would repeat all of it.

### 9.2 What Changes In The Engine

The slots today are text, list, image and logo. A schedule needs rows of three short fields. Option 1 squeezes a row into a list item (`Mon|7 PM|Minecraft`), which is fragile to edit. **Option 2 (recommended)** adds a typed slot.

```ts
// packages/design-engine/src/types.ts (DESIGN_SCHEMA_VERSION 2 -> 3, upgrade() adds nothing for old designs)
export type SlideRole = ... | 'schedule';
export type SlotKind  = ... | 'rows';
export type SlotId    = ... | 'schedule';
export const MAX_SCHEDULE_ROWS = 7;
export interface ScheduleRow { day: string; time: string; title: string; off?: boolean }   // each field plain text, capped like MAX_TEXT_LENGTH
export interface ElementState { ... rows?: ScheduleRow[] }                                // rows slots only
export interface ScheduleSource {                                                         // optional, DesignDocument.schedule
  source: 'twitch' | 'manual'; login: string | null; timeZone: string;                  // IANA, for example "Asia/Kolkata"
  weekStart: string;                                                                     // "2026-11-16", the Monday in that zone
  fetchedAt: string | null;
}
```

Touch points, all inside the engine and its consumers: `types.ts`, `schema.ts` (Zod `.strict()` for `rows` and `schedule`), `layouts/schedule.ts` (new file, exported in `layouts/index.ts`), `render/SlideView.tsx` (a `RowsSlot`), `fit.ts` (fit a row's title to its cell), `bindings.ts`, the editor panel (a small table editor), and `presets/` (five rows). The API's Zod gate for design writes already parses through `schema.ts`, so no route changes. Registration follows the existing pattern (layouts, themes and presets in their `index.ts` files, `presets/build.ts` rows), and `layouts.test.ts`, `presets.test.ts`, `themes.test.ts` and `schema.test.ts` cover the new entries. The one real risk is `fit.ts`: a row's title must shrink inside a fixed cell, so the fitter needs a one-line mode.

The layout `schedule-week@1`: slots `eyebrow` (small line, hidden by default), `headline` ("Catch Me Live", typed), `subheadline` (the zone line, bound text "All times Asia/Kolkata"), `schedule` (the rows), `handle` and `logo` (optional). Regions use `byFormat`: portrait is one column of seven rows (each about 12 percent of the height); landscape is two columns, four rows left and three right with the headline in the left top.

### 9.3 The Five Themes

Five `Theme` entries in a new `themes/schedule.ts`, ids `schedule-clean-blue`, `schedule-light-blue`, `schedule-cool`, `schedule-dark`, `schedule-red`. The names follow the reference ([`streamladder/27`](../../screenshots/streamladder/27-schedule-maker-twitch-username-gate.png) shows the five cards); the colours and type are our own and are set in the build, checked by `themes.test.ts` for contrast.

| Theme | `style` | `family` | Intent | Heading face |
|---|---|---|---|---|
| Clean Blue | light | blue | White ground, strong blue day column | `sora` |
| Light Blue | colourful | teal | Pale sky ground, white row cards | `outfit` |
| Cool | colourful | purple | Deep violet ground, soft glow art | `space-grotesk` |
| Dark | dark | mono | Near black ground, one bright accent | `bebas-neue` |
| Red | colourful | red | Red ground, white text rows | `anton` |

Each is a preset row (`shape: 'schedule'`, `theme: ...`, optional `art`), in a new preset category "Schedule" so the Studio gallery shows them too. All five are free in v1 (the `premium` flag exists if that changes). Fonts are in the shipped OFL set (`FontId` list in `types.ts`).

### 9.4 The Wizard And The Fetch

A thin page under Creator Tools: **Schedule Maker**.

| Step | What happens |
|---|---|
| 1. Name | "Enter your Twitch name" (placeholder rule: starts with "Enter your"). A second tab, **Fill It In By Hand**, skips the fetch |
| 2. Fetch | `POST /studio/schedules/fetch` `{ login, timeZone, weekStart }`. The API calls `Get Users`, then `Get Channel Stream Schedule` with `start_time` = the week's start as a UTC instant, `first=25`, paging while `pagination.cursor` is set and the segment starts before the week's end. Returns rows, `vacation`, and the caller's zone. Cached 10 minutes in Redis (24 hour hard limit, as in the channel browser) |
| 3. Theme | Five cards and a format switch (Portrait 1080 by 1350, Landscape 1920 by 1080) |
| 4. Open | `POST /studio/designs` with the chosen preset and `elements.schedule.rows` filled; the person lands in the normal Studio editor and edits any word by hand |
| 5. Export | The existing export panel: PNG (or JPEG 92). Send To Composer as before |

**Refresh From Twitch** in the editor re-fetches and, because it would replace hand edits, asks first ("Replace your edits with Twitch's schedule?").

### 9.5 Turning Segments Into Rows

1. The zone is a name from `Intl.DateTimeFormat().resolvedOptions().timeZone` in the browser, changeable from a list, and stored in `DesignDocument.schedule.timeZone`. The picture prints "All times Asia/Kolkata" (a friendly label such as IST is added when `Intl` gives one). Nothing is guessed from the broadcaster.
2. Each segment's UTC `start_time` is converted with `Intl.DateTimeFormat(..., { timeZone })`, which handles daylight saving per date. A week that crosses a clock change shows the true local times.
3. The day is the local date of the start. A segment that runs past midnight stays on its start day.
4. A segment with `canceled_until` set is dropped and its day reads "Off". A day with no segment reads "Off".
5. Two or more segments on one day join in one row's time and title ("7 PM Minecraft, 10 PM Chat"), up to two; a third shows "+1 more" and the editor warns it will not fit.
6. If `vacation` overlaps the week, the subheadline reads "On a break until Mon 23 Nov" and the rows are left as fetched.
7. Time is 12 or 24 hour by a switch in the editor panel. When a segment title is blank, the category name is used.

### 9.6 No Schedule, Or Not Twitch

A 404 (no schedule, or no segments) opens the same editor with seven rows (Monday to Sunday, week starting by the person's locale), all "Off", and a note: "This channel has no Twitch schedule. Fill it in by hand." Kick and YouTube have no schedule route in what we read, so those people always use the by-hand tab. A person who types a login that does not exist sees "We could not find that Twitch channel."

## 10. Editor Seats: What Exists Today

| Fact | Where |
|---|---|
| `enum Role { SUPERADMIN ADMIN USER }`. `UserOrganization` holds `role` (default `USER`) and `disabled`; unique on `[userId, organizationId]` | `packages/db/prisma/schema.prisma` lines 233 to 246 and 778 to 782 |
| `RolesGuard` reads the org cookie, loads the live membership (`disabled: false` in the `where`), and allows when `requiredRoles.includes(role)`. It sets `activeOrg` even on routes with no `@Roles`. A superadmin bypasses roles, never the workspace. The role is read **per request**, not stored in the token | `apps/api/src/common/guards/roles.guard.ts` |
| `@Roles(...)` is `SetMetadata`; the handler wins over the class (`getAllAndOverride`) | `common/decorators/roles.decorator.ts` |
| Invites are **signed tokens, not rows**: orgId, role, optional email, expiry (a week), single use through a Redis claim. `Role` enum in three Zod places | `modules/org/invite-token.service.ts`, `org.service.ts`, `dto/org.schema.ts` |
| Team page: member list, invite dialog (role `USER` or `ADMIN`), change role, remove, leave. The last admin cannot leave, demote or be removed | `apps/web/src/components/settings/*`, `org.service.ts` |
| `Plan.members`: FREE 1, STANDARD 1, PRO 3, TEAM 10, ULTIMATE unlimited. The comment says "**Not enforced yet**". Nothing counts members at invite or at accept | `apps/api/src/modules/billing/plans.ts`, `org.service.ts` |
| Audit: only `securityLogger` lines (`rbac.denied` already logs user, org, role, required). No audit table in the schema | `common/logging/security-logger.ts`, `schema.prisma` (searched) |
| Content rows carry authors: `Design.createdById`; Sprint 12 adds `createdById` and the rights fields to `ClipVideo` | `schema.prisma` line 1120 |

### 10.1 Blast Radius, Counted

**API** (`grep` of `@Roles(` outside specs, 2026-11-17): 57 decorators in 27 controller files, 23 on a class and 34 on a handler.

| Decorator | Class | Handler | Total |
|---|---|---|---|
| `Role.ADMIN, Role.USER` | 21 | 5 | 26 |
| `Role.ADMIN` | 2 | 28 | 30 |
| `Role.ADMIN, Role.SUPERADMIN` | 0 | 1 | 1 |

Also: 15 controllers have no `@Roles` at all (auth, v1 API-key routes, Studio fonts, health and others, so any member reaches those that read `@CurrentOrg()`); 3 Zod enums list `[ADMIN, USER]`; one role union in `mail.service.ts`; role comparisons in `org.service.ts` (last admin), `dashboard.service.ts`, `notifications.repository.ts` (audience `admins`), `automations.service.ts` (line 636) and `discover/settings.service.ts` (line 214). **Every one of those compares for ADMIN, so a new value fails closed.**

**Web**: 17 role comparisons in 15 files. Nine are positive (`role === 'ADMIN' || role === 'SUPERADMIN'`) and fail closed. **Six are `role !== 'USER'` and would let an Editor see the manage buttons**: `billing-view.tsx:86`, `api-keys-manager.tsx:80`, `settings/webhooks/page.tsx:47`, `builder-page.tsx:473`, `connection-picker.tsx:76` and `team-view-model.ts:54`. Types `WorkspaceRole`, `InviteRole` and `ROLE_LABELS` (and the invite dialog's choices) also change.

## 11. Three Options

| | A. `Role.EDITOR` | B. A `permissions` set on the member | C. An `isEditor` flag on `USER` |
|---|---|---|---|
| Idea | One more enum value, allow-lists by role | A string list per member, a `@Can('posts:schedule')` decorator | A boolean on `UserOrganization`; guard subtracts routes |
| Default for a new route | **Denied** until its decorator names Editor | Denied (if every route is decorated) | **Allowed**: a `USER` with the flag passes every `@Roles(ADMIN, USER)` route unless something blocks it |
| API edits | 9 existing decorators, 2 new on posts, 3 Zod enums, 1 mail union | All 57 decorators, or two systems side by side; a permission table and UI | A marker on the routes to block (about 40) or the allow-list again; guard change |
| Web edits | 6 fail-open checks, types, labels | Every check becomes a permission lookup | Same as A plus the flag in the session |
| Migration | `ALTER TYPE "Role" ADD VALUE 'EDITOR'` (additive, no data change) | A column or table, a backfill | A column |
| Flexibility | A fixed Editor | Any mix (custom roles) | Fixed |
| Verdict | **Recommended** | Right later if customers ask for custom roles; today it is two security models in one codebase | Rejected: fails open |

Postgres notes: an added enum value cannot be used in the same transaction that adds it, so the migration adds the value and nothing else (the `prisma-change` skill handles `migrate` and `generate`).

## 12. The Recommended Design

### 12.1 Capability Matrix

Editor means a person who makes content and does not run the account. **Yes** is allowed for Editors.

| Area | Editor | Decorator change | Why |
|---|---|---|---|
| Clips (Sprint 12 and 13: import, browse channels, edit, export, download, Emote Maker, Schedule Maker) | Yes | New controllers carry `ADMIN, USER, EDITOR` | The reason for the seat. Plan meters count against the workspace |
| Design Studio, brand kits | Yes | studio (class) | Content work |
| Media library | Yes | media (class) | Uploads and clips feed drafts |
| Composer and calendar, read | Yes | posts (class) | They need to see what is planned |
| Composer, write | **Drafts only** | posts service: Editor may create, edit and delete a post only when its state is `DRAFT` before and after | They prepare, an admin decides |
| Schedule, reschedule, publish now | **No** | posts `:group/schedule` and `:group/publish-now` get their own `@Roles(ADMIN, USER)` | Publishing speaks for the brand |
| Tags, signatures (read), global search, notifications, Home | Yes | tags, signatures (class), search, notifications, dashboard (the member route) | Needed to work; Home hides analytics tiles for Editors |
| AI text and image generation | Yes | ai (class) | Content help. It spends the workspace's AI credits, see risks |
| Connect, disconnect or refresh channels; see tokens | No | none (already ADMIN) | Credentials |
| Billing, plan, invoices | No | none (ADMIN) | Money |
| Invite, remove, change roles | No | none (ADMIN) | Access control |
| API keys, webhooks, workflows (automations) | No | none | Integrations that publish or leak |
| Analytics, SEO analyzer, Discover | No | none | Business data and credit spend; add later if asked |
| Scheduling status, operator screens | No | none | Internal |

The channel list (`GET /channels`, `GET /channels/providers`) carries no `@Roles` today, so an Editor can already pick channels when saving a draft; the response must stay free of tokens (it is today).

**Count**: 9 existing decorators edited (studio, media, tags, signatures, posts, search, notifications, ai at class level, and the dashboard member route), 2 new handler decorators, 48 untouched. The two new Clips controllers and the Creator Tools routes carry the Editor value from the start.

### 12.2 One Source Of Truth

The web app must not import `@postgear/db` (it is never allowed in a browser bundle), so the table lives twice, in `apps/web/src/lib/capabilities.ts` and `apps/api/src/common/capabilities.ts`, and a test compares the two: `canConnectChannels`, `canSchedule`, `canPublish`, `canViewAnalytics`, `canManageTeam`, `canManageBilling`, and so on, each a function of the role. The 17 scattered web comparisons move to it, which removes the six fail-open checks. Server layouts for the denied pages (Analytics, SEO, Discover, Workflows, Channels, Billing, Webhooks, API Keys) return a plain "You do not have access to this page" with the existing `Alert`, so a typed address does not show a broken page. The rail hides the same items.

### 12.3 Seats

| Rule | Detail |
|---|---|
| Key | New entitlement `members.editors_max` (number) in the registry of `12-plans-entitlements-and-usage.md`, separate from `members.max` so a cheap seat does not eat a full seat. Placeholders for the operator: FREE 0, STANDARD 1, PRO 3, TEAM 10, ULTIMATE 25 |
| Count | Memberships with `role = EDITOR` and `disabled = false`. Admins and members are not counted here |
| When checked | A soft check when an invite is made ("No editor seats left"). The **hard check at accept**, inside the transaction that creates the membership, under a per-workspace advisory lock, because invites are not rows and a count of "pending" is impossible |
| Role change | Changing a member to Editor re-checks the cap |
| Over the cap after a downgrade | Existing Editors keep working; the Team page shows "You have 5 editors and your plan allows 3. Remove 2 to add more." New invites are refused. No automatic disabling |
| `members.max` | Still not enforced; making it count is a separate decision and would need a grandfather rule for existing workspaces |

### 12.4 Invite Flow Copy

| Place | Copy |
|---|---|
| Invite dialog, role choices | Member, Admin, **Editor** (`ChoiceTiles`) |
| Under Editor | "Editors can make clips and designs and save post drafts. They cannot connect channels, schedule or publish, see billing or analytics, or invite people." |
| Seat line | "2 of 3 editor seats used" |
| No seat | "No editor seats left. Remove an editor or change your plan." |
| Address | **Required** for an Editor invite (the link is bound to it), because an Editor is usually someone outside the team |
| Email | The invitation names the role: "invited you to join {workspace} as an editor" |
| Accept page | "You have been invited to join {workspace} as an editor." After accepting, the Editor lands on Clips Home |

### 12.5 Audit Trail

Smallest useful: four new `SecurityEvent` names in `security-logger.ts`: `member.invited`, `member.joined`, `member.role_changed`, `member.removed`, each with actor, target, role and org. `rbac.denied` already logs a blocked Editor action. Attribution of work is by `createdById` on designs, clips and posts (confirm posts carry it in the build). A queryable `AuditEntry` table and a Team page activity tab are **not** in v1; they are the first thing to add if an agency asks "who changed this".

## 13. The Reference's Editors

What is known: the left rail has a **Team** group with **Editors** and a "New" tag ([`streamladder/25`](../../screenshots/streamladder/25-clips-library-status-tabs-connect-account.png), [`38`](../../screenshots/streamladder/38-streams-empty-connect-twitch-or-kick.png)); the home page says "Invite editors to clip, edit and schedule with you on Pro", and the Pro plan lists "workspaces for editors" (`01-reference-features.md` section on plans, read from streamladder.com on 2026-11-14). A search for a help page on 2026-11-17 found nothing for StreamLadder. So its seat model, price and limits are **unknown**.

| | StreamLadder (as far as known) | PostGear |
|---|---|---|
| Tier | Pro | Any paid tier with seats (FREE has 0) |
| Can schedule | Yes, by its own words | **No in v1** (drafts only) |
| Model | A separate workspace for editors (reported) | A role inside the workspace |

**Open question for Arvind**: may Editors schedule? Recommendation: no in v1. A freelancer who can schedule can publish to the brand's channels with no review, and PostGear has no approval step yet. When customers ask, add an "Editors Can Schedule" switch per workspace (an entitlement-style boolean the admin sets), or a Request Approval state on drafts.

## 14. Tests

| Area | What |
|---|---|
| `RolesGuard` | Editor allowed on an Editor route, refused (403, `rbac.denied` logged) on an ADMIN route; disabled Editor refused; superadmin unchanged |
| **Route matrix** (the safety net) | A spec reads `ROLES_KEY` for every controller and handler through Nest's `Reflector`, and compares with a checked-in table `editor-access.json` listing each route as `allow` or `deny`. A new route with no entry fails the test, so Editor access is always a decision |
| Posts | Editor creates and edits drafts; refused when the body asks for `QUEUE` or when the stored post is not a draft; delete refused on a non-draft; `schedule` and `publish-now` are 403 |
| Seats | At cap, accept fails with a plain message; two accepts racing for the last seat admit one; disabled editors do not count; role change re-checks |
| Invites | Editor token round trip; address required; old tokens still verify |
| Web | The capabilities table matches the API's; rail and pages for Editor; the six former `!== 'USER'` sites; invite dialog copy; Title Case test |
| Emote Maker | Trim over 3 seconds refused; ladder stops at the first fit; frame cap; golden frame test for crop; profile data parses; chat preview renders |
| Schedule Maker | UTC to zone conversion across a daylight saving change; midnight cross; cancelled segment; vacation; 404 to manual rows; Zod schema accepts and refuses rows; layout and theme tests; export one PNG per format in the browser spec |

## 15. Risks

| Risk | Likelihood | Effect | Handling |
|---|---|---|---|
| A fail-open web check shows Editors admin buttons | Medium before the fix | Confusing 403s | Replace the six sites with the capabilities table; test them |
| A new route forgets the Editor decision | Medium over time | Editor blocked (safe) or over-exposed if allowed by mistake | The route matrix test |
| Editors spend AI credits | Medium | Workspace credits drained | Same pool, counted per user in the ledger; a per-Editor cap is P2 |
| Editor deletes shared media | Low | A scheduled post loses its picture | Media usage check exists (`GET /media/:id/usage`); delete only own uploads is P2 |
| Invite link sent to the wrong person | Low | Access to content tools | Address binding required for Editors, single use, a week expiry |
| Seat race at accept | Low | One too many Editors | Advisory lock inside the accept transaction |
| Downgrade leaves too many Editors | Medium | Support questions | Banner, no auto removal |
| Twitch app terms and stored schedule text | Low | App revoked | The same dedicated listing app as the channel browser; the person edits and owns the text; 24 hour cache of the raw call |
| GIF over 512 KB at 112 px | Medium | A failed export | Ladder, then a clear message; measured in the spike |
| `libwebp_anim` or `palettegen` options differ on FFmpeg 9.0.2 | Low | Command error | Spike check against the pinned build before the module starts |
| Emote rules change | Medium | Rejected uploads | Profiles are data; page says to check the site's rules |
| People make emotes from others' clips | Medium | Rights | Source rights tick; the line in section 7 |
| Schedule text over a cell | Medium | Clipped picture | Row fitter in `fit.ts`; the editor warns on a third segment |

## 16. Where It Lands

Sprint 13 Module 14, three parts. **14a Emote Maker**: a profile table, `emoteExport` activity, crop and trim UI, chat preview (size M). **14b Schedule Maker**: engine change (types, schema v3, layout, themes, presets, `RowsSlot`, fitter), `POST /studio/schedules/fetch`, the wizard (size M). **14c Editor Seats**: the enum migration, the decorator and service edits, the capabilities table, seats key, invite and Team copy, the route matrix test (size M, and it should land **first**, because Clips routes need the Editor value from day one). Env values: none new beyond the Twitch pair added for Sprint 12 Module 03. Entitlement keys added: `members.editors_max`.
