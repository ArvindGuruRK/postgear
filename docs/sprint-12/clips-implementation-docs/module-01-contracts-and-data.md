# Module 01: Contracts And Data

> **Sprint 12, Clips** | Status: Not started | Size: L (one full session, may need a second: the entitlement foundation is Part B, see Tasks)
> **Depends on**: nothing (first module; creates the branch)
> **Stories**: foundations for every story; CL-1.1 (the rail entry, the tabs, the small-screen sentence); the tables behind CL-1.7 (channels), CL-7.5 and CL-9.4 (favourites), CL-13.6 and CL-13.7 (operator editing and the library)
> **Next**: [Module 02](module-02-media-runtime.md) (Media Runtime)

## Goal

After this module the shapes everything else agrees on exist: the pure engine package with the clip document and its time map; the **entitlement foundation** (a registry of limits in code, plan values, workspace overrides and a usage ledger in the database, a resolver and a usage service, and one route the browser reads); the Clips tables, the sound and sticker library tables and the channel tables; the queue and workflow names; the env flags; and a Clips entry in the rail that opens a page with four empty tabs. No outside program runs yet, the worker is untouched, and nothing can be imported.

This is the module that makes decisions D12-07 and D12-11 real. Every later module reads its limits and charges its meters through what is built here. Nothing about Clips limits lives as a field on `Plan` any more.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names).
- Sprint doc: Names And Placement, The Clip Document, Database, the limits section, Simulation.
- [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 2 and 12.
- User stories: CL-1.1; section 4.
- Research: [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), sections 4 to 11 and 13 (**the main source of the second half of this module**); [`10-open-source-sound-and-sticker-libraries.md`](../research/10-open-source-sound-and-sticker-libraries.md), sections 6 and 7 (the library tables and the search columns); [`11-channel-browser.md`](../research/11-channel-browser.md), section 6.1 (the channel tables); [`08-approach-on-postgear.md`](../research/08-approach-on-postgear.md) sections 2 and 3; [`05-editor-and-render.md`](../research/05-editor-and-render.md), the section on the project file and its two timebases.
- Code: `packages/design-engine/` (`package.json`, `tsconfig.json`, `jest.config.js`, `src/index.ts`, `src/schema.ts` for `schemaVersion` and `upgrade()`, `src/history.ts`); `packages/scheduling/src/workflows.ts` and `automations.ts` (how names, ids and timeouts are written as data); `apps/api/src/config/env.ts` and `apps/worker/src/config/env.ts` (the Discover and automation flags and their production refusals); `apps/api/src/modules/billing/plans.ts`, `entitlements.service.ts` (the existing class keeps its name) and the Stripe webhook handler; `apps/api/src/modules/ai/credits/credits.policy.ts`, `credits.service.ts` and `credits.repository.ts` (`chargeOnce`, the Serializable retry); `apps/api/src/common/filters/http-exception.filter.ts` and `apps/api/src/modules/studio/studio.premium.ts` (the 402 with a `code`); `apps/api/src/modules/redis/redis.service.ts`; `apps/web/src/components/navigation/dashboard-shell.tsx` (`RAIL`, `TITLES`); `apps/web/src/app/(dashboard)/[orgId]/discover/page.tsx` (a page with `?tab=`); `.claude/skills/prisma-change/SKILL.md`, `.claude/skills/new-page/SKILL.md`, `.claude/skills/new-api-module/SKILL.md`.

## Branch

Create `sprint-12-clips` from `instagram-direct-and-threads` (decision D12-02), the branch the tree is on. It is pushed but not merged, so this sprint's pull request carries its commits unless it is merged first; if it is merged before this module starts, cut from `master` instead. Write the branch and the commit it was cut from into the Names table of the README.

## Design

### 1. The Engine Package (`packages/video-engine`)

Scaffold it as a copy of `packages/design-engine`'s shape: `@postgear/video-engine`, `main: src/index.ts`, the shared jest preset, a `tsconfig.json` on the base, and a `paths` entry in the root tsconfig and in `apps/api`, `apps/worker` and `apps/web`. It must stay pure: no Node built-ins, no other `@postgear/*` import. Add a test that fails if `src/` imports anything starting with `node:` or `@postgear/`.

| File | Holds |
|---|---|
| `src/document/schema.ts` | `clipDocumentSchema` (Zod, every object `.strict()`), the `ClipDocument` type and its parts exactly as in the sprint doc: `canvas`, `sources`, `segments`, `layout.areas` (crop as an array of `{ at, rect }`), `zooms`, `tracks` (`overlay`, `audio`, and the reserved `captions`); item schemas `TextItem`, `StickerItem`, `AudioItem` with `id`, `start`, `duration`, `anchor` (`'moment'` or `'clip'`), and for visual items a `transform` (`x`, `y`, `scale`, `rotation`, `opacity`, all relative to the canvas) |
| `src/document/upgrade.ts` | `CURRENT_SCHEMA_VERSION = 1`, `upgrade(raw)` with an empty step chain, and `parseClipDocument(raw)` (upgrade, then validate) |
| `src/document/create.ts` | `createClipDocument({ videoId, fromMs, toMs, ratio })`: one source, one segment at speed 1, the Fullscreen layout, no tracks |
| `src/document/limits.ts` | `CLIP_MIN_MS = 3_000`, `CLIP_MAX_MS = 1_800_000` (30 minutes, raised from 10 so **Edit Whole Video** works, story CL-3.4), `SEGMENT_MIN_MS = 200`, `MAX_SEGMENTS = 50`, `MAX_ITEMS = 100`, `MAX_AREAS = 4` (the Four layout), `TEXT_MAX = 280`, `SPEEDS`, `HANDLE_MS = 30_000` |
| `src/canvas.ts` | `CANVASES`: `'9:16'` 1080 by 1920, `'16:9'` 1920 by 1080, `'1:1'` 1080 by 1080, `'4:5'` 1080 by 1350; `RATIOS` |
| `src/time/time-map.ts` | `outputDuration(doc)`, `toOutput(doc, sourceId, sourceMs)` (null when cut out), `toSource(doc, outputMs)` (`{ segmentId, sourceId, sourceMs }`), `segmentAt(doc, outputMs)`, `msToFrame(ms, fps)`, `frameToMs(frame, fps)` |
| `src/time/edits.ts` | Pure edits that return a new document: `trimSegment`, `splitAt(doc, outputMs)`, `removeSegment`, `setSpeed`. Each one ends with `replaceItems(before, after)`: every item with `anchor: 'moment'` is put back on the video moment it started on (or at the cut, when that moment was removed), `anchor: 'clip'` items do not move, and an item past the new end is shortened, never deleted |
| `src/render/` | **Empty on purpose.** A folder with a `README.md` that says: "Module 05 fills this folder: `frameState`, `buildRenderPlan`, `compileFfmpeg` and `buildAss`. They stay pure (no Node built-ins), so the browser preview and the compiler tests share them." Nothing else lands here in this module, and nothing draws a frame yet |
| `src/time/format.ts` | `formatVideoLength(ms)` ("3 h 42 min", "58 min"), `formatClipLength(ms)` ("0:42"), `formatTimecode(ms)` ("0:12.4") |
| `src/geometry.ts` | `Rect`, `Point`, `clampRect`, `fitRect(aspect, into)`, `rectAspect` |
| `src/jobs.ts` | `CLIP_JOB_KINDS`, `CLIP_JOB_STAGES` (per kind, as in the README Names table), and a Zod schema for each kind's `input` and `output`; the job input carries `quality`, `watermark` and `priority` copied by the API (the worker never resolves entitlements) |
| `src/links/types.ts` | `LinkInfo`, `LinkRef`, `LinkFormat`, `ClipPlatformId`, `LinkKind` (types only; recognition is Module 03) |
| `src/signals/types.ts` | `SignalTrack` (`{ name, version, sampleRateHz, values }`), `TrackName` with the reserved names, `HighlightRange` (the scorer is Module 16) |
| `src/transcript.ts` | The reserved `Transcript` type for Sprint 13 (`language`, `segments[{ start, end, text, words[{ start, end, word }] }]`), exported and unused |
| `src/pricing.ts` | `aiMinutesCost(kind, ms)`, the one place AI Minutes prices live. Kinds and rates: `signals` 0.25 per video minute (charged only for a run that only looks at sound and picture; in Sprint 13 a run that also listens includes signals free), `listen` 1.0 (at least 2), `read` 0.25, `action` 0.5, `translate` 0.25 per clip minute, `voice` 1 per 1,000 characters (for `voice` the number given is characters, not milliseconds). Price is `ceil(minutes x rate)`, never below 1. Following the speaker and Detect Camera are free and have no kind. A stretch is charged once per step (the idempotency key does that, see section 3). Sprint 13 only audits this file |

Rules the schema enforces: at least one segment; `sourceIn < sourceOut`; `(sourceOut - sourceIn) / speed` is the segment's length in the clip, and that one identity is asserted after every edit in the tests (round once per gesture and derive the other side by subtraction, so two halves of a split never drift apart); every segment's `source` exists; whole milliseconds everywhere; `outputDuration` between `CLIP_MIN_MS` and `CLIP_MAX_MS`; counts inside the limits. A `captions` track parses (so Sprint 13 documents are valid) but nothing in Sprint 12 writes one.

Tests: the schema accepts the created document and refuses unknown keys; `toOutput` and `toSource` are inverse on every kept moment for random documents (a seeded loop is enough); a split keeps the total length; a removed middle shortens it and leaves crops and zooms untouched; a 2x segment halves its part; after a deleted middle a `moment` sticker is still on its moment and a `clip` item has not moved; nothing is ever deleted by an edit; `aiMinutesCost` per kind (rounding up, the minimum of 1, the minimum of 2 for `listen`, `voice` by characters); the formatters.

### 2. The Entitlement Package (`packages/entitlements`, pure)

The registry and its rules, shared by the API and the web. Scaffold it like `video-engine` (same purity test, a `paths` entry in the root tsconfig, `apps/api`, `apps/worker` and `apps/web`, a Jest mapping, `transpilePackages` if the build needs it). Decision D12-07 and research 12 sections 5 to 7 are the design; this is the build list.

| File | Holds |
|---|---|
| `src/registry.ts` | `EntitlementDef` (types `boolean`, `number`, `enum`, `meter`; `scope` plan, org or both; unit; default; min and max; `allowUnlimited`; `reserved` enum members; `refusalCode`), the `REGISTRY` map and `Key` type. The default is always the safest value, the Free one, so a missing row can never grant more than Free |
| `src/keys/clips.ts` | The Clips keys and their defaults (below), including `clips.browse_channels` |
| `src/seed.ts` | `TIER_SEED`: the values per tier. It is the data the migration inserts and the data the `ENTITLEMENTS_SOURCE=seed` kill switch answers from |
| `src/validate.ts` | `validateValue(def, value)`: wrong JSON type, a number outside `min` and `max`, `null` where unlimited is not allowed, an enum member not in `options` or reserved (4k), an unknown key, a tier not in `PLAN_ORDER`, an override on a `plan` scope key, an override end date in the past or more than 366 days ahead, a reason shorter than 10 characters |
| `src/resolve.ts` | `resolve(key, { override, planValue })`: override that has not expired, then the plan value, then the registry default; a stored value that no longer validates is ignored and the next layer answers |
| `src/cycle.ts` | `cycleFor(anchor, now)` **moved here** from `apps/api/src/modules/ai/credits/credits.policy.ts`, which re-exports it so every credits test keeps passing; `dayWindow(now)` for the daily meter |
| `src/units.ts` | `MILLI = 1000`, `toMilli(x) = Math.ceil(x * 1000)`, display helpers (used rounds up, remaining and limit round down) |
| `src/messages.ts` | The refusal sentence templates (`{n}`, `{date}`, `{need}`): the sentences of research 12 section 13, in plain words, one per `refusalCode` |

The Clips keys (placeholders the operator edits; `clips.downloads_per_day` is a **daily meter**, the others as typed):

| Key | Type | Free | Standard | Pro | Team | Ultimate |
|---|---|---|---|---|---|---|
| `clips.enabled` | boolean | true | true | true | true | true |
| `clips.max_video_minutes` | number, minutes, 1 to 1,440 | 60 | 180 | 360 | 360 | 360 |
| `clips.import_minutes_per_month` | meter, cycle | 180 | 900 | 2,400 | 7,200 | 18,000 |
| `clips.storage_gb` | number (a gauge) | 3 | 15 | 50 | 150 | 400 |
| `clips.retention_days` | number | 7 | 14 | 30 | 30 | 60 |
| `clips.export_max_quality` | enum `720p, 720p60, 1080p, 1080p60, 4k` (4k reserved, cannot be stored) | 720p | 1080p | 1080p60 | 1080p60 | 1080p60 |
| `clips.export_watermark` | boolean | true | false | false | false | false |
| `clips.ai_minutes_per_month` | meter, cycle | 30 | 300 | 900 | 3,000 | 10,000 |
| `clips.concurrent_imports` | number | 1 | 2 | 2 | 3 | 4 |
| `clips.upload_max_gb` | number | 2 | 2 | 2 | 2 | 2 |
| `clips.downloads_per_day` | meter, day | 5 | 20 | 20 | 50 | 100 |
| `clips.queue_priority` | enum `low, normal, high` | low | normal | normal | high | high |
| `clips.browse_channels` | number (channels a workspace may add) | 1 | 3 | 5 | 10 | 20 |

Refusal codes are fixed here so every module uses the same ones: `clips_not_in_plan`, `clips_video_too_long`, `clips_minutes_used` (renamed from `clips_hours_used`), `clips_storage_full`, `clips_upload_too_big`, `clips_quality_requires_plan`, `clips_ai_minutes_used`, `clips_downloads_today`, `clips_channel_limit`.

Tests: `validateValue` per type and edge; resolve order including an expired override and a stored value that fails validation; `toMilli` and the display rounding; `cycleFor` with its old tests; every message gives whole numbers; a **registry and seed agreement** test (every key has all five tiers, every seed value passes `validateValue`, no key in the seed is missing in code).

### 3. The Entitlement Tables, Service And Route (`apps/api/src/modules/entitlements`)

**Tables** (use the `prisma-change` skill; one migration `entitlements_and_usage`, tables exactly as research 12 section 4): `PlanEntitlement` (tier, key, value as JSON, `@@unique([tier, key])`), `OrgEntitlementOverride` (an end date is required, `@@unique([organizationId, key])`), `EntitlementChange` (append only, no relations, so it outlives workspaces and operators), `UsageEntry` (the ledger: `units` in thousandths, `kind` CHARGE, REVERSAL or ADJUSTMENT, `@@unique([organizationId, idempotencyKey])`, `cycleStart`, `reversesId`). `Organization` gains the two back-relations. The migration then inserts the seed with `INSERT ... ON CONFLICT (tier, key) DO NOTHING` and one `EntitlementChange` row per cell ("Seed"): 13 keys by 5 tiers, **65 rows** (research 12 counts 60 because it was written before `clips.browse_channels` was added). The SQL is literal, so it is reviewable and never overwrites an operator edit.

**The module** (`EntitlementsModule`, imports `BillingModule` for the tier, exports both classes; the existing `EntitlementsService` in billing keeps its name):

- `EntitlementResolver`: `get`, `getMany`, `assert(orgId, key, predicate)` (throws the typed 402), `meter(orgId, key)` (`{ used, limit, remaining, cycleStart, cycleEnd }`), `previewTier(tier, keys)`, `snapshot(orgId)`. The tier comes from `resolveEntitlement(subscription, now).tier` (a trial is PRO, an expired trial and no subscription are FREE). Order: override, plan row, registry default.
- Caching: the whole plan table in process for 15 seconds, per-workspace overrides and tier likewise, plus a Redis stamp (`ent:plans`, `ent:org:<orgId>`) that an edit, a subscription change and the expiry step rewrite, so every instance drops its cache within about a second. A cache fill that raced a write is discarded. The Stripe webhook (and the simulation that calls the same handler) writes the org stamp through `RedisService` directly after its transaction commits, so `BillingModule` never imports this module.
- `UsageService`: `consume(orgId, meter, units, { idempotencyKey, refId, meta })`, `reverse(entryId, { units? })`, `adjust(orgId, meter, units, { reason, actorId })`. `consume` is one Serializable transaction on the pattern of `CreditsRepository.chargeOnce`: look for the key (found means `duplicate: true`, nothing charged), sum the cycle, refuse with the typed 402 when `used + units` passes the limit, else insert; a unique-index race returns the existing row; `P2034` retries three times. Units are stored as thousandths (`toMilli`, rounding up). `reverse` inserts a negative row with the same `cycleStart`, refuses to exceed the original or to reverse a reversal, and is idempotent through the key `rev:<entryId>`. A database error fails closed (503, "We could not check your allowance. Please try again in a minute."); a charge is never skipped.
- `EntitlementRefusedException` (402): body `{ message, code, details: { limit, used, needed? } }`, whole numbers only, so the existing exception filter passes it without change. This is the pattern of `PremiumLookRequiredException`.
- `GET /entitlements/me` (`@Roles(ADMIN, USER)`, workspace from the cookie): `{ tier, status, trialEndsAt, values, meters }`, with `Cache-Control: private, max-age=15` and an ETag. The server never trusts a value sent back; every route re-resolves.
- Kill switch: `ENTITLEMENTS_SOURCE=db` (default) or `seed`; with `seed` the resolver answers from `TIER_SEED` and ignores the tables (for an incident where a bad edit locks workspaces out; needs a restart).
- `GET /billing/plans` gains an `entitlements` object per plan from `previewTier`, so plan cards and the change plan dialog read their Clips lines from the same source as every gate.

Idempotency keys every later module uses (fixed here): import minutes `clips.import:<jobId>`, AI steps `clips.ai:<step>:<jobId>` (translate and voice: `clips.ai:<step>:<clipId>:<revision>:<hash>`), downloads `clips.download:<downloadJobId>`, reversals `rev:<entryId>`. The `ClipJob` id is created before the charge, so a double click or a replayed activity carries the same key.

Tests: the fake-store unit tests of research 12 section 12 (cache hit, stamp invalidation, a fill discarded, stale on error; `consume` charge, refuse, duplicate; `reverse` full, partial, twice, of a reversal, across cycles; `adjust` writes both rows); a Postgres integration test (two parallel `consume` calls with room for one, twenty parallel duplicates give one row, a `P2034` retry); the migration seed passes `validateValue`; `/entitlements/me` never shows another workspace; a simulated plan change moves the snapshot; the kill switch answers from the seed.

### 4. The Contract (`packages/scheduling/src/clips.ts`)

Pure data, exported from the package index: the three queue names, the six workflow names, `clipJobWorkflowId(jobId)`, `clipProbeWorkflowId(hash)`, the cancel signal name (reuse `CANCEL_SIGNAL`), timeouts per kind as data (import 6 h, segment 30 min, highlights 1 h, render 1 h, download 2 h; heartbeat 1 minute), `CLIP_RETRY_POLICY` (2 attempts, 1 minute apart) and `CLIP_FAILURE_TYPES` with the non-retryable list (`link_private`, `link_not_found`, `link_live`, `upload_not_video`, `cancelled`). `ClipJob.priority` and its three values (`low`, `normal`, `high`) are part of the contract. No workflow code yet.

### 5. The Clips Tables

Use the `prisma-change` skill. A second migration adds the enums and models from the sprint doc's Database section (`ClipVideo`, `ClipAsset`, `ClipJob`, `Clip`, `ClipPost`, `ClipHighlightRun`, and the rest), a relation list on `Organization`, and `durationMs`, `fps` and `origin` on `Media`. Add the "Sprint 12 additions" entry to `packages/db/prisma/SCHEMA_NOTES.md`: why `ClipVideo` keeps its row after deletion (the rights record), why sizes are `BigInt`, why Exported and Scheduled are not columns, and that `brandKitId`, `presetId` and the `captions` track are reserved for Sprint 13. Seeds: nothing in this migration.

### 6. The Library And Channel Tables

A third migration, from research 10 section 6 and research 11 section 6.1 (Module 12 and Module 14 build the screens and the ingest; this module only creates the shapes):

- **Library**: enums `ClipSoundKind` (SFX, MUSIC), `ClipStickerKind` (STATIC, ANIMATED), `ClipLibraryStatus` (STAGED, ACTIVE, HIDDEN, REMOVED); models `ClipLibrarySource`, `ClipSound`, `ClipSticker`, `ClipFavourite` (per workspace; the migration adds a `CHECK` that exactly one of `soundId` and `stickerId` is set), `ClipLibraryRun`, `ClipLibraryDeny`, `ClipLibraryMiss`. A sound or sticker row carries its licence evidence (licence code, licence address, author, origin, origin id, source address, retrieved date, checksum).
- **Search columns**, written as raw SQL in the migration (Prisma cannot declare them): a generated `tsvector` named `search` on `ClipSound` and `ClipSticker` from `name` (weight A), `tags` (B) and `category` (C) with the `simple` configuration, a GIN index on each, and an optional `pg_trgm` index on `name`. The Prisma field is `Unsupported("tsvector")?`.
- **Channels**: `ClipChannel` (platform, handle, external id, display name, avatar address, uploads list id, broadcaster type, `lastSyncedAt`, `error`, `@@unique([organizationId, platform, externalId])`) and `ClipChannelHidden` (ids only, never titles). No list of videos is ever stored.
- User uploads of sounds and stickers stay out of these tables: they are `ClipAsset` rows of kind `AUDIO` or `STICKER` in the private space.
- Seeds: nothing here. The first catalogue arrives from Module 14 and Module 12's ingest.

### 7. Env Flags

- API (`apps/api/src/config/env.ts`): `CLIPS_SIMULATION` (the same enum shape as `DISCOVER_SIMULATION`, refused in production), `CLIPS_PLATFORMS` (a comma list, default `youtube,twitch,kick`, each value checked), `CLIPS_URL_SECRET` (optional in development; required when `NODE_ENV=production`), `OPERATOR_EMAILS` (a comma list; required in production for the operator screen to open, ignored for the check in development; Module 19 uses it), `ENTITLEMENTS_SOURCE` (`db` or `seed`, default `db`).
- Worker (`apps/worker/src/config/env.ts`): `CLIPS_SIMULATION` with the same refusal, `WORKER_ROLES` (default `publishing,media,render`), `CLIPS_PLATFORMS`, `CLIPS_LIBRARY_INGEST` (default false; the operator's ingest scripts refuse to start unless it is true in that shell). The tool paths arrive in Module 02, the Twitch keys in Module 03.
- Not added, on purpose: no render licence key (FFmpeg needs none) and no outside GIF provider key.
- `.env.example`: a "Clips" block that documents every variable in the README Names table, most of them commented until their module.

### 8. AI Minutes, And What Leaves `plans.ts`

- `apps/api/src/modules/billing/plans.ts`: **remove** the `clips` object on `Plan`, `clipLimitsFor`, and `CLIP_UPLOAD_MAX_BYTES` (they never get built). `Plan` keeps price, channels, `aiCredits`, members and its copy.
- `credits.policy.ts`: nothing is added to `AI_LEDGER_TYPES`. There is no `clip_highlights` credit type and no `clipHighlightsCost`; the existing AI credits stay for text and image AI (Copilot, Create Post) exactly as they are. Clips AI is paid in the AI Minutes meter, `clips.ai_minutes_per_month`, priced by `aiMinutesCost`.
- The billing page's plan cards list their Clips lines (one line each, sentence case) from the `entitlements` on `GET /billing/plans` (`previewTier`), so an operator edit changes the card. Keep the existing layout.

### 9. The Page

- `RAIL`: add `{ segment: 'clips', label: 'Clips', icon: ... }` after Studio, with the clapperboard animated icon if `@animateicons/react/lucide/` has one (else the film or scissors icon); `TITLES.clips = 'Clips'`.
- `apps/web/src/app/(dashboard)/[orgId]/clips/page.tsx`: a server page with typed `PageProps`, `await searchParams` for `tab`; renders `<ClipsView orgId initialTab />`.
- `components/clips/clips-view.tsx`: `PageActions` (empty for now) and `Tabs` with **Create**, **Videos**, **Clips**, **Downloads**, the open tab in `?tab=`; each tab shows an `EmptyState` with "Arrives in a later step of this sprint." until its module lands.
- `components/clips/desktop-only.tsx`: `ClipsDesktopOnly` wraps every Clips route; below 1366 px it shows the one sentence from the blueprint and nothing else (a CSS breakpoint, so there is no flash).
- `apps/web/src/lib/entitlements.ts` and a small store: reads `GET /entitlements/me`, refetches after any 402 whose `code` is one of the codes above. Later modules use it to lock tiles and draw chips.
- `apps/web/src/types/clips.ts`: re-export the engine's types the web needs (the web may import `@postgear/video-engine` and `@postgear/entitlements` because both are pure).

## Scope

**In**: the branch, the engine package with schema, time map, edits, formatters, pricing and tests, the entitlement package, tables, service and `GET /entitlements/me`, the scheduling contract, the three migrations, env flags, the plan card lines, the rail entry, the page with empty tabs, the small-screen sentence.
**Out**: any outside program, storage changes and the worker (02), link recognition and probing (03), every route under `/clips` (04 onward), the render compiler (05, which fills `src/render/`), the preview package (08), the operator screens (19), the ingest scripts and the library screens (12, 14, 19), the full-window editor route (08).

## Tasks

Part A (first session):

- [ ] Branch `sprint-12-clips`; note it in the README.
- [ ] `packages/video-engine` scaffold, tsconfig paths, the purity test, the empty `src/render/` with its README note.
- [ ] Document schema, `upgrade`, `createClipDocument`, limits (`CLIP_MAX_MS` 30 minutes), canvases.
- [ ] Time map, edits, formatters, geometry, `aiMinutesCost`, with tests.
- [ ] Job, link, signal and transcript types.
- [ ] `packages/scheduling/src/clips.ts` and its export.
- [ ] Clips tables migration, generate, SCHEMA_NOTES.
- [ ] Library and channel tables migration with the raw search SQL.
- [ ] Env flags in the API and the worker with production refusals; `.env.example`.
- [ ] Rail entry, title, the page with four tabs, `ClipsDesktopOnly`; title-case test green.

Part B (the entitlement foundation, a second session if the first is full):

- [ ] `packages/entitlements`: registry, Clips keys, seed, validate, resolve, cycle (moved, re-exported), units, messages, with tests.
- [ ] Entitlement tables migration with the 65 seed rows; the registry and seed agreement test.
- [ ] `EntitlementsModule`: resolver, usage service, the refusal exception, the cache and stamps, `GET /entitlements/me`, the kill switch.
- [ ] The webhook writes the org stamp; `GET /billing/plans` gains `entitlements`; plan cards read their Clips lines from it.
- [ ] Remove the `clips` object, `clipLimitsFor` and the upload constant from `plans.ts`.
- [ ] `lib/entitlements.ts` and its store on the web.
- [ ] `verify-change`; update the Progress table and the Decision Log.

## Tests

```powershell
npx jest --config packages/video-engine/jest.config.js
npx jest --config packages/entitlements/jest.config.js
npx jest --config packages/scheduling/jest.config.js
npx jest --config apps/api/jest.config.js apps/api/src/config apps/api/src/modules/billing apps/api/src/modules/entitlements apps/api/src/modules/ai/credits
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
npm run typecheck
```

## Done When

- `@postgear/video-engine` and `@postgear/entitlements` build, are imported by a test in the API, the worker and the web app, and both purity tests pass.
- A created document validates; the time map round trip holds; split, remove and speed behave as the tests say; `aiMinutesCost` matches the rates.
- The three migrations are applied, the new models are in the generated client, and the plan table holds 65 seed rows that all pass `validateValue`.
- `GET /entitlements/me` answers for the demo workspace with its tier's values; editing a plan row by SQL and rewriting the stamp changes the answer within about a second; `ENTITLEMENTS_SOURCE=seed` answers from the constants.
- A `consume` past the limit answers 402 with a `code` and whole-number `details`; the same key twice charges once; a `reverse` gives the minutes back once.
- The API and the worker refuse to boot with `CLIPS_SIMULATION=true` and `NODE_ENV=production`.
- Clips is in the rail after Studio; the page shows the four tabs with their placeholder; below 1366 px it shows the one sentence.
- Existing AI credits behave exactly as before (the credits tests are green, `cycleFor` unchanged for them).
- `npm run validate` is as green as it was before the module.

## Hand Check

With the demo admin, at a window 1366 px wide or more:

1. The rail shows Clips after Studio; the top bar says Clips.
2. The four tabs switch and the address keeps `?tab=`; a reload keeps the tab.
3. Narrow the window below 1366 px: only "Clips is made for a bigger screen. Open it on a laptop or desktop." shows.
4. Settings, Billing: each plan card lists its Clips lines (videos up to N minutes, N AI minutes a month, and so on).
5. In the browser console, `GET /entitlements/me` shows the Clips values and the two meters at zero.
6. In psql, change one plan value (for example `clips.storage_gb` for FREE) and reload the billing page after a few seconds: the card shows the new number.
7. Light, dark and Lilac all look right.

## Handoff

Module 02 needs the queue names, the `ClipJob` model and the env flags. Module 03 fills `links/` and reads `clips.browse_channels`. Module 04 reads every import limit through the resolver and charges `clips.import_minutes_per_month`. Module 05 fills `src/render/` and needs `createClipDocument`, the canvases and the time map. Module 08 needs the edits and the `history.ts` pattern from `design-engine` (copy it into `video-engine` there, or lift it to a shared place if that is cleaner; say which in the Decision Log). Modules 12, 14 and 19 build on the library tables, Module 19 on the entitlement tables and `UsageService.adjust`.
