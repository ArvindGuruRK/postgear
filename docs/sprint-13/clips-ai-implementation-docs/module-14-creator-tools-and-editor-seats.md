# Module 14: Creator Tools And Editor Seats

> **Sprint 13, Clips AI** | Status: Done 2026-11-28, one session (the Emote spike's real clips and platform pages wait for the owner) | Size: XL (may need two sessions: see "How To Split The Sessions")
> **Depends on**: [Module 03](module-03-captions.md) (the map's anchor) and the whole of Sprint 12. In practice it needs only Sprint 12's entitlement registry and operator screen (Modules 01 and 19), its Twitch app-token client (Module 03), `runTool` and the plan-file conventions of the FFmpeg compiler (Modules 02 and 05), the Clips controllers, and Design Studio. It edits every Clips controller written by Sprint 12 and by Modules 01 to 13 of this sprint, so run it after them; the route-matrix test finds anything missed.
> **Stories**: CA-11.1 Make An Emote, CA-11.2 Make A Stream Schedule Picture, CA-11.3 Invite An Editor, CA-11.4 Work As An Editor
> **Decisions**: D13-15 (built, Editors cannot schedule or publish in v1), D13-16 (FFmpeg only), D13-02 (the tools cost no AI Minutes)
> **Next**: [Module 15](module-15-scale-cost-and-deploy.md)

## Goal

After this module a workspace admin can invite a freelancer as an **Editor**: a seat that makes clips and designs and saves post drafts, and can do nothing that connects, publishes, bills or invites. A streamer can open **Creator Tools** from the Clips page, cut a 3 second **emote** from a clip, and download it sized for Twitch, 7TV or BetterTTV with every file under its cap. The same streamer can type a Twitch name and get a weekly **schedule picture** in one of five themes, as a normal Design Studio design, exported as a PNG. Seats are counted by their own entitlement, and the whole Editor wall is held up by a test that makes every route a decision.

## Read First

- `CLAUDE.md`, Sprint 12's README (names, entitlements, rules), then the README in this folder.
- User stories: CA-11.1 to CA-11.4 and the journeys that mention an Editor; section 5 (a seat race, an over-cap workspace, a crop under 112 pixels).
- Sprint doc: Creator Tools, Editor Seats, the `EMOTE` job row, Database (`Role.EDITOR`, `ClipJobKind`).
- Research: [`10-creator-tools-and-editor-seats.md`](../research/10-creator-tools-and-editor-seats.md), all of it (platform rules, the Twitch schedule facts, the blast radius counted, the three options, the matrix, the risks). [`09-ass-captions-and-edit-cookbook.md`](../research/09-ass-captions-and-edit-cookbook.md) section 12 (the emote commands run on FFmpeg 9.0.2 and their measured sizes; note its Twitch figures differ from research 10, see "Contradictions Found" below). Sprint 12's [`12-plans-entitlements-and-usage.md`](../../sprint-12/research/12-plans-entitlements-and-usage.md) (registry entry format, `EntitlementRefusedException`, `consume`, the operator Plans table), [`11-channel-browser.md`](../../sprint-12/research/11-channel-browser.md) (the Twitch app token, the 24 hour cache rule, `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`), [`13-screenshot-coverage.md`](../../sprint-12/research/13-screenshot-coverage.md) (screens 27 and 29 and the Editors entry).
- Reference screens (local only): `docs/screenshots/streamladder/27`, `29`, `25` and `38`.
- Code, Part A: `packages/db/prisma/schema.prisma` (`enum Role`, `UserOrganization`), `apps/api/src/common/guards/roles.guard.ts`, `common/decorators/roles.decorator.ts`, `common/logging/security-logger.ts`, `apps/api/src/modules/org/` (`invite-token.service.ts`, `org.service.ts`, `dto/org.schema.ts`), `modules/posts/` (the service and the controller's `:group/schedule` and `:group/publish-now`), `modules/billing/plans.ts`, `packages/entitlements/`, `apps/api/src/modules/entitlements/`, `apps/web/src/components/settings/` (the Team page and invite dialog), the six web files named in Part A section 6, `apps/web/src/lib/session.ts`, the rail component.
- Code, Part B: `packages/video-engine/src/render/` (compiler, `frameState`), `packages/media-tools` (`runTool`), `apps/worker/src/clips/`, Sprint 12 Module 15's export route and signed links, Module 17's media picker, `apps/web/src/components/clips/` (`ClipsDesktopOnly`, the job card helpers), `apps/web/src/components/clips/editor/` (the preview of Sprint 12 Module 08).
- Code, Part C: `packages/design-engine/src/` (`types.ts`, `schema.ts`, `formats.ts`, `layouts/`, `themes/`, `presets/`, `render/SlideView.tsx`, `fit.ts`, `bindings.ts`), `apps/api/src/modules/studio/` (`design-exporter.ts`, the designs routes), Sprint 12 Module 03's Twitch client and its Redis cache pattern (`discover.cache.ts`), `apps/web/src/components/studio/`.
- Skills to use: `prisma-change`, `new-api-module`, `new-page`, `temporal-workflow`, `verify-change`.

## How To Split The Sessions

Three parts, each its own section of Design and its own task list. Part A (Editor Seats) is built **first** because every later route wants the Editor value from day one. Then Part B (Emote Maker), then Part C (Schedule Maker). Each part is about the size of an M module.

- **Session 1**: Part A, then Part B if time allows. Commit Part A alone if Part B does not fit (`Module 14a: Editor Seats`).
- **Session 2** ("Module 14 is partly done. Its unticked task boxes are what is left."): the rest, then the Hand Check of all three. Commit as `Module 14b: Emote Maker` and `Module 14c: Schedule Maker`, or one commit if both fit.
- The Progress row says which parts are done. The parts do not depend on each other except that Parts B and C add routes that the Part A matrix must list.

## Contradictions Found While Writing This Module

| Where | Contradiction | What this module does |
|---|---|---|
| Research 10 section 12.1 against build order | The research says new Clips controllers carry Editor from the start, but Sprint 12 and Modules 01 to 13 are built before this module with `ADMIN, USER` only | This module adds EDITOR to every Clips controller. The route matrix test is the proof nothing is missed. The count "9 existing decorators" in the research is the older code only; the new Clips and entitlements controllers are on top of it and are counted in the build with a `grep` of `@Roles(` |
| Research 10 section 4 (a 7TV "WebP or APNG") against cookbook 09 section 12 (7TV page does not name animated WebP; GIF is the one format all accept) | Two sources disagree on the best 7TV file | Every platform export includes a GIF. The 7TV export adds animated WebP and APNG as extras. Profiles are data, so the real test (A-81) can promote WebP to the first choice |
| Research 10 (Twitch static cap 25 KB, animated 512 KB per size or 1 MB for auto-resize) against cookbook 09 (1 MB a file) | Different caps | The strictest wins: 512 KB per animated size, 25 KB per still, 60 frames. Spike task 1 reads Twitch's live page in a browser and edits the data if it differs |
| Sprint doc, Entitlement keys: "emote and schedule downloads count against `clips.downloads_per_day`" | The schedule picture is exported by Design Studio's existing exporter, which has no download meter | Emote exports count (one per `EMOTE` job). The schedule PNG is **not** metered: changing Studio's export route is outside this module and "Add; do not change". If metering is wanted, it is one `consume` call in the Studio export route, parked in Module 17 |
| Free plan watermark (`clips.export_watermark`) against an emote | A watermark would make a 28 px emote useless | Emotes and schedule pictures carry **no watermark** on any plan. Say so in the Decision Log |

## Design

### Part A: Editor Seats

**A1. The role and the migration.** Two migrations, in this order (use `prisma-change`; Postgres cannot use a new enum value in the transaction that adds it):

1. `ALTER TYPE "Role" ADD VALUE 'EDITOR'` and nothing else. Run `migrate:deploy` and `db:generate`.
2. The entitlement seed: a new registry key `members.editors_max` in `packages/entitlements` (type `number`, unit `count`, default 0, min 0, max 1000, scope `both`, `refusalCode: 'members_editor_seats_full'`), five `PlanEntitlement` rows (FREE 0, STANDARD 1, PRO 3, TEAM 10, ULTIMATE 25) with `ON CONFLICT DO NOTHING`, and five `EntitlementChange` "Seed" rows, as Sprint 12's seed does. The operator Plans tab shows it under a "Members" group with no screen work. The registry-and-seed consistency test (Sprint 12) must pass with the new key.

No other schema change. `members.max` stays unenforced (research 10 section 12.3).

**A2. One table of capabilities.** A pure file `packages/entitlements/src/capabilities.ts`: role names as a string union (`'SUPERADMIN' | 'ADMIN' | 'USER' | 'EDITOR'`, no import of `@postgear/db`), and one function per decision, each a function of the role:

| Function | ADMIN | USER | EDITOR |
|---|---|---|---|
| `canWorkOnClips`, `canUseStudio`, `canUseMedia`, `canUseCopilot`, `canReadCalendar`, `canSaveDrafts`, `canUseTags` | yes | yes | yes |
| `canSchedule`, `canPublish` | yes | yes | **no** |
| `canViewAnalytics`, `canUseSeo`, `canUseDiscover` | yes | yes | **no** |
| `canViewBilling`, `canViewChannels`, `canUseWorkflows`, `canConnectChannels`, `canViewDeveloperSettings` (as built: the code already let members do these) | yes | yes | **no** |
| `canManageChannels`, `canManageTeam`, `canManageBilling`, `canManageApiKeys`, `canManageWebhooks`, `canManageWorkflows`, `canManageWorkspaceSettings` | yes | no | no |

(The ADMIN and USER columns restate what the code does today; read the real decorators first and copy them, do not trust this table over the code.) `SUPERADMIN` behaves as `ADMIN` in a workspace, as today. A type-level check in the API (`satisfies Record<Role, ...>`) fails the build if the Prisma `Role` and this union drift. Research 10 suggested two copies with a parity test; one pure shared file is simpler, and `packages/entitlements` is already imported by both sides. If the package wiring proves awkward, fall back to the two copies and the parity test, and write it in the Decision Log.

**A3. The API wall (fails closed).**

- `@Roles(...)` allow-lists stay. A new route is denied to an Editor until its decorator names `Role.EDITOR`.
- Edit the older decorators: studio, media, tags, signatures, ai (class level), search, notifications and the dashboard member route (research 10 section 12.1). Add `Role.EDITOR` to every Clips controller (Sprint 12 and Modules 01 to 13), to `GET /entitlements/me`, `GET /clips/status`, the new `emotes` routes and the new Studio schedule route. Count them with `grep` and write the count in the Decision Log.
- **Posts** (the one subtle part). The posts controller class lets Editors in. The two handlers `POST /posts/:group/schedule` and `POST /posts/:group/publish-now` get their own `@Roles(ADMIN, USER)`. Defence in depth: one function `assertEditorMayWrite(actor, before, after)` in `posts.service.ts`, called by every create, update, delete and by every other service that creates or changes posts (Sprint 12's Send To Composer, Module 13's Next Available and slot assignment, repeat). For an Editor it allows only `DRAFT` to `DRAFT` (create as draft, edit a draft, delete a draft). Anything else is a 403 with `code: 'editor_forbidden'` and the sentence "Editors cannot do this. Ask an admin." A body that asks for `QUEUE` is refused even when the post is new. Because Clips' own routes call `PostsService`, they inherit this; a Clips route that must never serve an Editor (Module 13's slot assignment that schedules) also carries `@Roles(ADMIN, USER)`.
- The channel list routes carry no `@Roles` today, so an Editor can pick channels when saving a draft; the answer must stay free of tokens (it is today; a test asserts it).
- Public `/v1` routes use API keys, not roles; creating keys is ADMIN only, so nothing changes. Say so in the test file.
- `rbac.denied` already logs a refused Editor. Add the four member events (A8).

**A4. The route-matrix test (the safety net).** `apps/api/src/common/guards/editor-access.spec.ts` and the checked-in table `editor-access.json`.

- The spec builds the real application module, walks every controller and handler with Nest's `DiscoveryService`, and reads `ROLES_KEY` through `Reflector` (handler wins over class, as the guard does).
- Each route has one entry in the JSON: `allow` (names EDITOR), `deny` (does not), `draft-only` (allowed, with the service rule above), or `open` (no `@Roles` at all, so any member of the workspace including an Editor; each `open` entry carries a one line reason, for example "reads `@CurrentOrg()`, returns no secrets").
- The test fails on: a route with no entry, an entry with no route, an entry that disagrees with the decorators, an `open` entry with no reason. A new route can never reach production unclassified.
- A second spec runs the real `RolesGuard` against every route with a fake context for each of the four roles and checks the answer equals the table. A disabled Editor is refused. A superadmin is unchanged.

**A5. Seats.**

- Count: memberships with `role = EDITOR` and `disabled = false`. Admins and members are not counted here.
- `EditorSeatsService` in `modules/org`: `state(orgId) -> { used, limit, remaining }` (limit from `get('members.editors_max')`), and `assertRoom(orgId, tx)`.
- When checked: a soft check when an invite is made (`POST /org/invites` with role EDITOR answers 402 `members_editor_seats_full`, "No editor seats left. Remove an editor or change your plan."). The **hard check at accept**, inside the transaction that creates the membership, under a per-workspace advisory lock (`pg_advisory_xact_lock(hashtextextended('editor-seats:' || orgId, 0))`), because invites are signed tokens, not rows, so "pending invites" cannot be counted. Two accepts racing for the last seat admit one; the other gets the 402 sentence.
- A role change to Editor, and re-enabling a disabled Editor, run the same lock and check.
- After a downgrade: existing Editors keep working. The Team page shows "You have 5 editors and your plan allows 3. Remove 2 to add more." New invites are refused. Nothing is disabled automatically.
- `GET /org/seats` (ADMIN) feeds the invite dialog and the Team page.

**A6. Invites, Team page and the web.**

- Invite role is `ADMIN`, `USER` or `EDITOR` in the three Zod enums of `org.schema.ts`, the role union in `mail.service.ts`, and the invite dialog (`ChoiceTiles`: Member, Admin, Editor). The address is **required** for an Editor invite (the token is bound to it; check the accept step refuses a different account's address and fix it if the existing code does not).
- Tokens signed before the migration still verify (they carry `ADMIN` or `USER`).
- Copy (Title Case names, sentences in sentence case; one place for each string in `org.messages.ts` or the web messages file):

| Place | Copy |
|---|---|
| Invite dialog, role tiles | Member, Admin, Editor |
| Under Editor | Editors can make clips and designs and save post drafts. They cannot connect channels, schedule or publish, see billing or analytics, or invite people. |
| Seat line | 2 of 3 editor seats used (as built: "0 of 1 editor seat used" at a limit of 1) |
| No seat | No editor seats left. Remove an editor or change your plan. |
| Over the cap | You have 5 editors and your plan allows 3. Remove 2 to add more. |
| Email | {name} invited you to join {workspace} as an editor. |
| Accept page | You have been invited to join {workspace} as an editor. |
| Refusal anywhere | Editors cannot do this. Ask an admin. |
| Denied page | You do not have access to this page. |

- Replace the 17 scattered role comparisons in the web app with the capability functions. The six `role !== 'USER'` sites fail **open** for an Editor and must move first: `billing-view.tsx`, `api-keys-manager.tsx`, `settings/webhooks/page.tsx`, `builder-page.tsx`, `connection-picker.tsx`, `team-view-model.ts` (line numbers in research 10 will have moved; search `!== 'USER'`). Types `WorkspaceRole`, `InviteRole`, `ROLE_LABELS` gain Editor.
- The rail hides what `canX` denies. Server layouts of the denied pages (Analytics, SEO, Discover, Workflows, Channels, Billing, Webhooks, API Keys) show the plain denied page with the design-system `Alert`, so a typed address never shows a broken page. Home hides the analytics tiles for an Editor. After accepting, an Editor lands on Clips Home.
- Composer for an Editor: the date, **Add To Calendar** (schedule) and **Post Now** controls are replaced by **Save Draft**, with a tooltip "Editors cannot do this. Ask an admin." The calendar is read only (no drag to reschedule). Clips' **Send To Composer** makes a draft. Module 13's **Next Available**, slots and Shuffle Times are hidden.
- Editors spend the workspace's AI Minutes and AI credits (one pool). Add `meta.by` (the user id) to every `consume` call written by Modules 02 to 13 and this module so Module 15's cost route can show who spent what (check the AI credits ledger for a user id; if it has none, record that as a gap).

**A7. Attribution and audit.** Four new `SecurityEvent` names in `security-logger.ts`: `member.invited`, `member.joined`, `member.role_changed`, `member.removed`, each with actor, target, role and org. No audit table in v1 (research 10 section 12.5). Work is attributed by `createdById` on designs, clips and posts (confirm `Post` carries it; if not, add it as part of this part and say so). An activity tab on the Team page is Module 17.

### Part B: Emote Maker

**B1. Spike first (2 to 3 hours, results into the Decision Log).**

1. Open Twitch's emote help page and 7TV's upload page in a browser (the tools could not read Twitch's help site; research 10 section 2 marks those figures reported). Confirm sizes, 512 KB, 60 frames, the flashing rule; edit the profile data if anything differs.
2. On the pinned FFmpeg (9.0.2), check `libwebp_anim` and its `-loop`, `-plays 0` for APNG, `palettegen=reserve_transparent`, `paletteuse=alpha_threshold`, and `chromakey` against `colorkey` (options were reported, not read).
3. Encode three real clips (a face cam with a plain wall, a green screen, a busy room) at 112 px 3 seconds and write the byte counts at each ladder step into the Decision Log, so the ladder order can be tuned. The cookbook's numbers came from a test pattern and are smaller than real footage will be.

**B2. Profiles and the ladder (pure, in `packages/video-engine/src/emotes/`).**

```ts
interface EmoteProfile {
  id: 'twitch' | 'sevenTv' | 'bttv';
  outputs: { size: number; format: 'gif' | 'webp' | 'apng' | 'png'; maxBytes: number; extra?: boolean }[];
  maxFrames: number;           // Twitch 60, 7TV 1000, BTTV 60
  maxSeconds: 3;
  note: string;                // shown under the export button
}
```

| Profile | Files | Caps |
|---|---|---|
| `twitch` | GIF 28, 56 and 112 px; plus a still PNG at the same three sizes when the Still switch is on | 512 KB each, 60 frames, still PNG 25 KB |
| `sevenTv` | GIF 256 px; extras: animated WebP 256 px, APNG 256 px | 7 MB, 1000 frames |
| `bttv` | GIF 28, 56 and 112 px | 512 KB, 60 frames (the strictest known, see research 10 section 2) |

- `planEmote(request, profile)` returns the encode steps: crop `size:size:x:y` in source pixels, `fps` limited so `frames = fps x seconds` never passes `maxFrames`, scale `lanczos`, optional chroma key before the crop is scaled (`format=rgba`, key, then for GIF `palettegen=reserve_transparent=1` and `paletteuse=alpha_threshold=128`), optional horizontal flip.
- The **size ladder** is one pure function `nextRung(profile, output, rung)`; rungs are `[fps, colours, dither]`, starting from the research list (20 fps 256 colours, 20 fps 128, 15 fps 128, 15 fps 64, 12 fps 64 no dither, 10 fps 32 no dither), each capped by the frame limit. WebP walks `-quality` down instead of colours. Never change the pixel size or the length silently. If the last rung is over the cap the answer is `emote_too_big`: "This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop." (name the site in the sentence).
- The graph for each encode is written to a file and passed as `-/filter_complex graph.txt` (`-filter_complex_script` does not exist in FFmpeg 9.0.2), run through `runTool` with an argument array, never a shell string. Fix the bounds with Zod: crop inside the source, size square and at least 16, start and end within the covered range, `endMs - startMs <= 3000` (`emote_too_long`), step 100 ms.
- A crop under 112 source pixels is allowed with a warning ("This will look soft") in the page, not an error.

**B3. The job and the worker.**

- Add `EMOTE` to `ClipJobKind` (a `prisma-change` migration that adds the enum value alone, if the column is an enum; if Sprint 12 stored kinds as strings, only the Zod kind list changes). Stages: `fetching`, `encoding`, `finishing`. Add the kind, its input and output schemas and its timeout (10 minutes) to `packages/scheduling/src/clips.ts` (pure) and `clipEmoteWorkflow` beside the other clip workflows, on the media queue; workflow id `clip-job:<jobId>` as always. Use `temporal-workflow`.
- Activity `emoteExport` in `apps/worker/src/clips/`: ensure the covered range (the existing range-fetch path of export, so a stretch not yet local is fetched first; the `-ss` before `-i` rule needs the known `coveredStartSec`), then for each output run the ladder, measure each file, write a zip and the individual files to `clips/<orgId>/exports/<jobId>/emote-<platform>-<size>.<ext>` in the private bucket. The zip uses a small writer with a permissive licence (check it in the build and record the licence in the Decision Log). Scratch folder removed in `finally`. Output: for each file `{ name, bytes, fits, rung, frames, fps }`.
- **No watermark** and **no AI Minutes**. One press of an export button is one job and one `clips.downloads_per_day` unit, `consume` key `clips.download:<jobId>` created before the job, reversed on failure (Sprint 12 pattern).
- API (`apps/api/src/modules/clips/emotes/`, roles `ADMIN, USER, EDITOR`): `POST /clips/emotes/export` `{ videoId, startMs, endMs, crop, key, flip, still, platform }`. Waits up to 25 seconds for the answer (each encode is small); if it is not done it answers the job id and the page shows the usual job card. `GET /clips/emotes/:jobId` for the files and signed links (the Sprint 12 signed address helper, expiring). `emotes.messages.ts` holds every sentence. The rights tick of the source video already applies; add one line under Export: "Use clips of your own stream. Twitch reviews emotes before they go live." and "Check each site's current rules before you upload."
- Simulation: under `CLIPS_SIMULATION`/`MEDIA_SIMULATION` the activity still runs real FFmpeg on the generated sample (it is fast and needs no network), so every test exercises the real encoder. A force switch `[simulate:emote-too-big]` in the video title makes the last rung fail so `emote_too_big` can be seen.

**B4. The page.** `/[orgId]/clips/tools/emote`, inside `ClipsDesktopOnly`, reached from the **Creator Tools** button on the Clips page, from the Create tab's tool tiles, and from a clip's menu (**Make An Emote**, which opens the page with that clip's range). Layout after StreamLadder 29, our own styling:

| Part | Behaviour |
|---|---|
| Source | A picker of the workspace's videos and clips, or a pasted link through the existing probe and import (a Twitch clip is at most 60 seconds, so it imports whole). The video plays the light copy |
| Trim | One draggable window, hard limit 3.0 seconds, 0.1 second steps, a waveform bar. Over 3 seconds is stopped in the control and refused by the API |
| Crop | A square box, drag and resize, kept square, a "This will look soft" note under 112 source pixels |
| Look | **Remove Background** switch (colour key only): an eyedropper on the video and a Similarity slider; **Flip**; **Still Frame** (a PNG of the frame under the playhead for the Twitch still sizes) |
| Preview | The cropped, keyed stretch looping at 28, 56 and 112 px drawn in canvas from the video (an approximation: the exported files are the truth and are shown after export from their signed links), and the **chat preview** |
| Export | **Export For Twitch**, **Export For 7TV**, **Export For BTTV**. Progress as a job card; then a table of files with bytes and "Under the limit" or why not, **Download All** (the zip) and a download per file |

- `chat-preview.tsx`: a pure React card, no outside images, four lines in Twitch-like colours, one line with five emotes in a row, a sun and moon switch (`#18181b` and white grounds), a text field to type a line (never stored or sent). Emotes draw at 28 px, and from the 56 px file on a 2x screen. No Twitch logo or wordmark; the word "chat" only.
- No sample values in placeholders ("Enter your link").

### Part C: Schedule Maker

**C1. Engine changes (inside `packages/design-engine`, no second renderer).**

```ts
// types.ts: DESIGN_SCHEMA_VERSION 2 -> 3 (upgrade() adds nothing for old designs)
export type SlideRole = ... | 'schedule';
export type SlotKind  = ... | 'rows';
export type SlotId    = ... | 'schedule';
export const MAX_SCHEDULE_ROWS = 7;
export interface ScheduleRow { day: string; time: string; title: string; off?: boolean }
export interface ElementState { ... rows?: ScheduleRow[] }                 // rows slots only
export interface ScheduleSource {                                          // DesignDocument.schedule, optional
  source: 'twitch' | 'manual'; login: string | null; timeZone: string;     // IANA, e.g. "Asia/Kolkata"
  weekStart: string;                                                       // ISO date of the Monday in that zone
  fetchedAt: string | null; hour12: boolean;
}
```

- Touch points: `types.ts`, `schema.ts` (Zod `.strict()` for `rows` and `schedule`, each field plain text capped like `MAX_TEXT_LENGTH`), a new `layouts/schedule.ts` exported from `layouts/index.ts`, `render/SlideView.tsx` (a `RowsSlot`), `fit.ts` (a one-line mode so a row's title shrinks inside its cell: the one real risk), `bindings.ts`, the editor panel (a small table editor: day, time, title, Off), and `presets/` (five rows). Follow the existing registration pattern; extend `layouts.test.ts`, `presets.test.ts`, `themes.test.ts`, `schema.test.ts`. The API's design write gate already parses through `schema.ts`, so no route changes there.
- Layout `schedule-week@1`: slots `eyebrow` (hidden by default), `headline` ("Catch Me Live"), `subheadline` (bound to the zone: "All times Asia/Kolkata"), `schedule` (the rows), `handle`, `logo`. `byFormat` regions: portrait is one column of seven rows (each about 12 percent of the height), landscape is two columns, four left and three right, headline top left.
- Five `Theme` entries in `themes/schedule.ts`, ids `schedule-clean-blue`, `schedule-light-blue`, `schedule-cool`, `schedule-dark`, `schedule-red`. Names follow the reference; **colours and type are our own** (a light white and blue; a pale sky with white row cards; a deep violet with a soft glow; near black with one bright accent; a red ground with white rows), contrast checked by `themes.test.ts`, heading faces from the shipped 52 OFL fonts (research 10 section 9.3 proposes `sora`, `outfit`, `space-grotesk`, `bebas-neue`, `anton`). A new preset category "Schedule" so the Studio gallery shows them too. All free (the `premium` flag stays false).
- Export is the existing exporter: PNG at `portrait` 1080 by 1350 and `landscape` 1920 by 1080, or JPEG 92. Send To Composer works as today. Not metered (see Contradictions).

**C2. Pure conversion (`packages/design-engine/src/schedule/`).** No Node built-ins, `Intl` only.

- `localMidnightToUtc(isoDate, timeZone)` and `weekRange(weekStart, timeZone)`: the UTC instants the fetch needs, correct across a daylight saving change.
- `segmentsToRows(segments, { timeZone, weekStart, hour12 })`, the rules of research 10 section 9.5: convert each UTC start with `Intl.DateTimeFormat(..., { timeZone })`; the day is the local date of the start (a segment past midnight stays on its start day); a segment with `canceled_until` set is dropped and its day reads Off; a day with no segment reads Off; two segments on one day join into one row ("7 PM Minecraft, 10 PM Chat"), a third shows "+1 more" and the editor warns it will not fit; a blank title uses the category name; if `vacation` overlaps the week the subheadline reads "On a break until Mon 23 Nov" and rows are left as fetched. Output is always seven rows, Monday to Sunday (or the person's locale week start).

**C3. The fetch.** `POST /studio/schedules/fetch` `{ login, timeZone, weekStart }` in `apps/api/src/modules/studio/schedules/`, roles `ADMIN, USER, EDITOR`, `.strict()` Zod body.

- Validation: login lower-cased and matched to `^[a-z0-9_]{4,25}$` (a `twitch.tv/<login>` link is accepted and reduced); `timeZone` must be in `Intl.supportedValuesOf('timeZone')`; `weekStart` a valid date no earlier than the current week and no more than 8 weeks ahead. Throttle: 10 fetches a minute per workspace.
- Calls (verified 2026-11-17 on dev.twitch.tv/docs/api/reference/schedule): `Get Users?login=` for the id, then `GET /helix/schedule?broadcaster_id=` with the app token (the same cached token provider as Sprint 12's channel browser), `start_time` = the week's start as a UTC instant, `first=25`, following `pagination.cursor` while segments start before the week's end. `utc_offset` is not supported, so all times are UTC and the zone is ours (research 10 section 8).
- Answer: `{ broadcaster: { login, displayName }, segments: [{ start, end, title, category, canceledUntil, recurring }], vacation, fetchedAt }`. The web converts with `segmentsToRows`, so changing the zone needs no second call.
- A 404 from Twitch (no schedule, or no segments) answers `{ segments: [], noSchedule: true }`, not an error. An unknown login is `twitch_user_not_found`: "We could not find that Twitch channel." Any other failure is `schedule_fetch_failed` with a plain sentence; the raw Twitch error never reaches the user.
- Cache: Redis, key `clipsched:twitch:<login>:<weekStartUtc>`, fresh 10 minutes, stale copy served up to **24 hours** if Twitch fails (Twitch's agreement allows caching only 24 hours), one in-flight call per key (the `DiscoverCache` pattern). The app token and the client secret are never logged, never sent to the browser.
- Simulation (`CLIPS_SIMULATION`, or no Twitch keys in development): hand-written fixtures in `apps/api/src/modules/studio/schedules/fixtures/` for `simstreamer` (a normal week with one cancelled segment and a day with two), `simvacation`, `simnoschedule` (the 404) and `simnouser`; nothing real is fetched. A **Try A Sample** link on the page fills the by-hand rows from `simstreamer`'s week with no call at all.

**C4. The page and the editor.** `/[orgId]/clips/tools/schedule`, inside `ClipsDesktopOnly`.

| Step | What happens |
|---|---|
| 1. Name | "Enter your Twitch name" field. A second tab, **Fill It In By Hand**, skips the fetch. Kick and YouTube have no schedule route we could read, so those people use the by-hand tab |
| 2. Fetch | The route above; the zone defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`, changeable from a searchable list. The picture prints the zone name. Nothing is guessed from the broadcaster |
| 3. Theme | Five cards and a format switch (Portrait 1080 by 1350, Landscape 1920 by 1080); the cards render the real `SlideView` with the person's rows |
| 4. Open | `POST /studio/designs` with the chosen preset and `elements.schedule.rows` filled; the person lands in the normal Design Studio editor (full window) and can edit every word, switch 12 or 24 hour, and add or remove an Off day |
| 5. Export | The existing export panel (PNG or JPEG 92) and Send To Composer |

- **Refresh From Twitch** in the editor (shown only when `schedule.source === 'twitch'`) re-fetches and, because it replaces hand edits, first asks "Replace your edits with Twitch's schedule?".
- A 404 opens the editor with seven rows, all Off, and the note "This channel has no Twitch schedule. Fill it in by hand."
- Editors use it exactly as members do (the studio and schedule routes carry EDITOR).

### Env, Keys And Entitlements

| Item | Detail |
|---|---|
| Env | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`: **no new variable**; the pair Sprint 12 Module 03 added for the channel browser. This module reads them for the Schedule Maker. Check `.env.example` lists both with a comment naming both users |
| Keys guide steps | Append to the Clips keys guide (where Sprint 12 Module 03 wrote the Twitch steps; create the section if absent): sign in at `dev.twitch.tv/console`, turn on two factor sign-in if Twitch asks, **Register Your Application**, any name, a redirect address of `http://localhost` (the app token flow never uses it), category Website Integration, client type Confidential, then **New Secret**; copy the id and secret into `.env`. An app token needs no user login and no scope. Tell Arvind to confirm each step against the live console, since the page changes |
| Entitlement keys | New: `members.editors_max`. Used: `clips.enabled`, `clips.downloads_per_day` (emote exports). Refusal codes new: `members_editor_seats_full` (402). Error codes new: `editor_forbidden`, `emote_too_long`, `emote_too_big`, `emote_range_invalid`, `twitch_user_not_found`, `schedule_fetch_failed` |
| Job kind | `EMOTE` |

## Scope

**In**: `Role.EDITOR`, the capability table, the fail-closed wall, the route matrix and its test, seats with a hard check at accept, invites and Team copy, member security events; the Emote Maker (profiles, ladder, `EMOTE` job, page, chat preview, colour key); the Schedule Maker (schema v3, `rows` slot, layout, five themes, pure conversion, Twitch fetch with cache, wizard, Refresh From Twitch, by-hand mode).
**Out**: Editors that can schedule or publish (Module 17: a switch or an approval step), an audit table and Team activity tab, custom roles, metering Studio exports, model-based background removal (Module 17), Kick or YouTube schedules, box art for categories, publishing a schedule picture automatically, animated schedule pictures.

## Tasks

Part A: Editor Seats
- [x] Migration 1 (`Role` gains `EDITOR`), migration 2 (`members.editors_max` registry key and seed rows); `db:generate`.
- [x] `capabilities.ts` and the type-level role check.
- [x] `@Roles` edits: the older nine, every Clips controller, entitlements, studio schedule, emotes; the two handler decorators on posts; the count in the Decision Log.
- [x] `assertEditorMayWrite` and its callers (posts, Send To Composer, Module 13 slots, repeat).
- [x] `EditorSeatsService`, the advisory lock, soft check at invite, hard check at accept, role change and re-enable checks, `GET /org/seats`.
- [x] Invite Zod enums, mail union, address required for Editor, accept step checks the address, old tokens still verify.
- [x] `editor-access.json` and the two matrix specs.
- [x] Web: capability functions, the six fail-open sites, types and labels, rail, denied pages, Home, composer and calendar for an Editor, invite dialog and Team page copy, over-cap banner.
- [x] Four member security events; `meta.by` on `consume` calls.
- [x] Part A tests green; commit-ready note in the Progress row.

Part B: Emote Maker
- [ ] Spike (three real clips, the FFmpeg option checks, the platform pages) and the Decision Log entry. **Partly**: the FFmpeg option checks and the size ladder ran on the local samples (Decision Log); the three real clips and the live platform pages were not fetched, by the owner's rule, and wait for the owner.
- [x] `emotes/` profiles, `planEmote`, `nextRung`, bounds schema, their tests.
- [x] `EMOTE` kind, scheduling contract entry, `clipEmoteWorkflow`, `emoteExport` activity, the zip writer and its licence note.
- [x] `POST /clips/emotes/export`, `GET /clips/emotes/:jobId`, messages, the downloads meter charge and reversal.
- [x] The page: source, trim, crop, look, preview, chat preview, export panel, job card, files table; entries in Creator Tools and in a clip's menu.
- [x] Title-case test green; `/dev/components` section for the chat preview and the crop box.

Part C: Schedule Maker
- [x] Schema v3, types, `rows` slot, `schedule` role, `ScheduleSource`, schema and tests.
- [x] `schedule-week@1`, `RowsSlot`, the one-line fit mode, panel table editor.
- [x] Five themes, five presets, the "Schedule" category, contrast tests.
- [x] `localMidnightToUtc`, `weekRange`, `segmentsToRows` with the daylight saving and midnight tests.
- [x] `POST /studio/schedules/fetch`, the Twitch call, cache, throttle, fixtures, simulation.
- [x] The wizard page, the open-in-Studio step, Refresh From Twitch, the by-hand tab, Try A Sample.
- [x] Keys guide steps and `.env.example` comments.
- [x] `verify-change`; update the Progress table, the Decision Log, and the capability matrix table in the sprint doc if the build changed it.

## Tests

| Area | What |
|---|---|
| `RolesGuard` | Editor allowed on an Editor route; refused (403, `rbac.denied` logged) on an ADMIN route; disabled Editor refused; superadmin unchanged |
| **Route matrix** | Walks every controller and handler; fails on a route with no entry, an entry with no route, a mismatch with the decorators, an `open` entry without a reason; the guard run against every route for all four roles equals the table |
| Posts | Editor creates and edits drafts; refused when the body asks for `QUEUE` or the stored post is not a draft; delete refused on a non-draft; `schedule` and `publish-now` are 403; **every other route that can create or change a post** (Send To Composer, Module 13 slots, repeat, bulk calendar moves) is 403 or draft-only for an Editor; the same through a direct request with a forged body |
| Seats | At the cap, accept fails with the plain sentence; two accepts racing for the last seat admit one (run with real Postgres); disabled Editors do not count; role change and re-enable re-check; after a downgrade over the cap, new invites are refused and nothing is disabled |
| Invites | Editor token round trip; address required; a different address is refused; old tokens verify; the Editor email names the role |
| Capabilities | The type-level role check; each function against the table; the six former `!== 'USER'` sites; the rail and denied pages for Editor; the invite dialog copy; `title-case.test.ts` |
| Emote engine | Profile data parses; `planEmote` caps frames at 60 for Twitch at any fps; the ladder stops at the first fit and returns `emote_too_big` when none fits; start and end over 3 seconds refused; crop outside the picture refused |
| Emote worker | Real FFmpeg on the generated sample: three GIFs for Twitch, each under 512 KB with at most 60 frames (`ffprobe -count_frames`); a green-screen sample keyed to transparent corners (alpha at a corner pixel is 0); the still PNG under 25 KB; WebP and APNG for 7TV read back; a golden crop test (pixels at known points); reversal on a failed job |
| Emote web | The trim cannot pass 3 seconds; the crop stays square; the soft warning; chat preview renders at both ground colours; the files table states |
| Schedule pure | UTC to zone across a daylight saving change (a week that crosses it keeps true local times); a segment past midnight; a cancelled segment; two segments in a day and the "+1 more"; vacation; 404 to seven Off rows; blank title uses the category |
| Schedule engine | Zod accepts and refuses rows (eight rows, a long title); schema v2 designs upgrade untouched; layout, theme (contrast) and preset tests |
| Schedule API | Login validation; zone and week validation; the Twitch app-token call mocked at the HTTP layer; the cache (fresh, stale on error, 24 hour limit); throttle; the secret never appears in a log line (spy on the logger) |
| Browser | One spec per format: wizard to the editor to a PNG at the exact pixel size (see Module 16's e2e) |

```powershell
npx jest --config packages/entitlements/jest.config.js
npx jest --config packages/video-engine/jest.config.js emotes
npx jest --config packages/design-engine/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/common apps/api/src/modules/org apps/api/src/modules/posts apps/api/src/modules/clips/emotes apps/api/src/modules/studio
npx jest --config apps/worker/jest.config.js emote
npx jest --config apps/web/jest.config.js apps/web/src/components/clips/emote apps/web/src/components/studio apps/web/src/components/settings
```

## Done When

- An admin invites an Editor by email, the Editor accepts and lands on Clips Home, and the rail, the pages and the composer show only what the matrix allows.
- Every route is in `editor-access.json`; adding a route without an entry fails the test; every denied route returns 403 to an Editor, including by a direct request.
- An Editor can save and edit drafts and cannot schedule, publish, post now, or move a post from draft by any route.
- The last editor seat goes to one of two simultaneous accepts; a workspace over its cap after a downgrade keeps its Editors and cannot add more.
- A 3 second stretch of the sample becomes Twitch, 7TV and BetterTTV files, each under its cap and its frame limit, with the sizes shown; a stretch over 3 seconds cannot be exported; a green-screen sample exports with a transparent background; the chat preview shows the emote.
- `simstreamer` opens a Design Studio design with the week filled in, in any of the five themes, in both shapes; a hand edit sticks; the PNG is exactly 1080 by 1350 or 1920 by 1080; a zone change moves the times and a daylight saving week shows true local times; `simnoschedule` gives seven Off rows.
- No Twitch secret, token or schedule text appears in any log.
- All three parts' tests and `verify-change` pass.

## Hand Check

With the three simulation flags on, the demo admin and a second browser profile:

1. Team page, Invite: pick Editor. The seat line reads "0 of 1 editor seats used" on a Standard workspace (change the workspace's override in the operator screen to test other numbers). Send the invite, copy the link from the API console, accept it in the second profile with the invited address. The Editor lands on Clips Home.
2. As the Editor: the rail has no Channels, Analytics, SEO, Discover, Workflows or Billing. Type `/analytics` and the other addresses: the plain denied page. Open the composer: a draft saves; there is no schedule or Post Now. Try the same with the API (a request to `POST /posts/:group/schedule` through the browser console): 403.
3. As the admin, invite a second Editor on a one seat plan: "No editor seats left". Open the operator screen, raise the plan value, retry.
4. Clips, Creator Tools, Emote Maker: pick the sample, set a 2.4 second stretch, drag the crop over the face, watch it at 28, 56 and 112 px, open the chat preview and flip its ground. Try to stretch the window past 3 seconds: it stops.
5. Export For Twitch: three files with sizes under 512 KB, then Export For 7TV and Export For BTTV. Open a downloaded GIF and check it loops. Turn on Remove Background on the green-screen sample and export again.
6. Creator Tools, Schedule Maker: type `simstreamer`, pick Cool, Portrait. In the editor change a title, switch to 24 hour, change the zone to another continent and watch the times move. Export the PNG and check its size. Repeat with `simnoschedule` and the by-hand tab.
7. As the Editor, repeat step 6: it works.

## Handoff

Module 15 prices EMOTE jobs and the Editor seat in the cost table, reads `meta.by` to show who spent what, and uses `clips.queue_priority`. Module 16 adds the Editor, Emote and Schedule rows to the sweep and their e2e tests. Module 17 holds Editors Can Schedule with an approval step, model-based background removal, a Team activity tab and metering the schedule export. The real-test plan decides whether Editor seats are on and whether Twitch accepts the emote files.

**As built (2026-11-28).** `meta.by` is on every Clips charge; the AI credits ledger (`Credits`) has no user column, so Copilot and Studio AI spending cannot be split by person until Module 15 adds one. Any future route that re-enables a disabled membership must call `EditorSeatsService.assertRoom(orgId, tx)`. The Emote job's limit is 30 minutes (the worker keeps 10 of any limit for cleanup). Studio's export needs Playwright's own Chromium build (1234 for Playwright 1.62.1); this Mac has only 1255, so the local export fails until `npx playwright install chromium` is run (the hand check pointed the API at the installed build through `PLAYWRIGHT_BROWSERS_PATH`).
