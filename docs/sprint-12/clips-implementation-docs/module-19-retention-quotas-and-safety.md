# Module 19: Retention, Quotas, Safety And The Operator Screens

> **Sprint 12, Clips** | Status: Done with gaps (2026-11-19) | Size: XL (two sessions: **Part A** retention, quotas, abuse, rights and Media posters; **Part B** the operator screens and the library screen)
> **Depends on**: [Module 04](module-04-import-pipeline.md), [Module 12](module-12-stickers-and-gifs.md) and [Module 14](module-14-sound.md) (the catalogue the Library screen manages), [Module 15](module-15-export.md); Module 01's entitlement foundation
> **Stories**: CL-13.1, CL-13.2, CL-13.3 (the checks), CL-13.4 (the checks), CL-13.5; CL-13.6 (The Operator Edits Plans And Limits), CL-13.7 (The Operator Looks After The Sound And Sticker Library)
> **Next**: [Module 20](module-20-hardening-e2e-worker-image-closeout.md)

## Goal

After Part A Clips looks after itself. Videos are removed when their time is up, with a notice three days before. Every limit refuses with its sentence in every place it applies, and every number it reads comes from the entitlement resolver. Nothing a workspace stores is left behind or uncounted. An operator can remove a video after a rights request and it cannot be brought back in. Videos in the Media library, old and new, show a picture and their length.

After Part B an **operator** (a platform administrator, never a workspace member) can change what each plan allows without a deploy, give one workspace a custom deal with an end date, correct a usage meter, read a change log of all of it, and look after the open sound and sticker catalogue: review what an ingest staged, publish it, hide or remove an item, keep a deny list and see the credits page that is generated from it. Decisions D12-07, D12-09, D12-10 and D12-16 land here.

## Read First

- `CLAUDE.md`, then the README in this folder (rules, names, notification types).
- User stories: CL-13.1 to CL-13.7; section 5 (the limit rows, the removed row).
- Sprint doc: the limits section; Database (`ClipVideo.expiresAt`, `lastUsedAt`, `removedReason`, `ClipAsset`, the library tables).
- Research: [`12-plans-entitlements-and-usage.md`](../research/12-plans-entitlements-and-usage.md), **sections 8 to 13 (the main source of Part B)**; [`10-open-source-sound-and-sticker-libraries.md`](../research/10-open-source-sound-and-sticker-libraries.md), sections 8, 10, 12 and 13 (the ingest, the credits page, the takedown path, the search API: the source of the Library screen); [`07-legal-limits-cost-and-risks.md`](../research/07-legal-limits-cost-and-risks.md): the retention options table, the takedown path, the abuse and security section, the cost per stored hour, the risks register.
- Code: `apps/worker/src/workflows/maintenance.workflow.ts` and its activities (the 15 minute loop, Module 02's `reconcileClipJobs`); Module 04's `ClipLimitsGuard`; Module 01's `apps/api/src/modules/entitlements/` and `packages/entitlements`; Module 02's `PrivateStorage.deletePrefix`; `apps/api/src/modules/admin/` (empty today, holds only `.gitkeep`); `apps/api/src/common/guards/roles.guard.ts` and `apps/api/src/modules/health/health.controller.ts:60` (the existing inline `isSuperAdmin` check); `apps/api/src/modules/notifications/`; `apps/api/src/modules/media/media.service.ts` and the web's `media-tile.tsx`, `library-tile.tsx`, `media-viewer.tsx`; `apps/api/src/modules/billing/` (`plans.ts` and the views that list plan features); `apps/web/src/components/navigation/dashboard-shell.tsx` (`immersion()`, the account menu); `packages/ui` (`DataTable`, `Tabs`, `Dialog`, `Alert`); `apps/web/src/lib/title-case.test.ts`; `packages/db/package.json` (the script entries; the `scripts` folder is new).

## Design

The design has two parts, built in two sessions. Part A is the housekeeping of videos, quotas and safety; Part B is the operator.

### Part A: Retention, Quotas And Safety

#### 1. Keeping And Removing Videos

- **The clock**: `expiresAt = lastUsedAt + retentionDays`, where `retentionDays` is read through the resolver (`clips.retention_days`). `lastUsedAt` moves forward when the video page is opened, a clip is made from it, a clip of it is opened in the editor, or one is exported; written at most once a day per video (`touchVideo`).
- **The notice**: three days before `expiresAt`, once (`ClipVideo.expiryNoticeAt`, a new nullable column), a `clip_video_expiring` notification to the workspace's admins and the person who brought it in: "{Title} will be removed in 3 days. Open it to keep it longer."
- **Removal** (`removeVideo(videoId, reason)`, one function used by expiry, by a user's delete and by an operator): delete the video's prefix in the private space, delete its `ClipAsset` rows, delete its clips that are not exported, keep exported clips' `Media` rows untouched, mark their `Clip` rows removed too (a clip cannot be edited without its video), set `status: REMOVED`, `removedReason`, `deletedAt`. The `ClipVideo` row stays, because it holds the rights record. Removal never reverses an import minutes charge (Module 04).
- Changing plan or editing the plan's `clips.retention_days` changes it from then on; **nothing already scheduled is shortened below three days from now**, so a downgrade or an operator edit never removes a video without the notice.
- The Videos tab shows "Kept until 28 Nov", and in the warning colour "Removed in 2 days" when under three days.

#### 2. Cleanup (Maintenance Workflow)

A new activity, `sweepClips`, runs in the existing maintenance loop, each part in small batches with its own try and catch so one failure does not stop the rest:

| Part | What |
|---|---|
| Expiry notices | Videos whose `expiresAt` is within three days and `expiryNoticeAt` is null |
| Expired videos | `removeVideo(id, 'expired')`, then a `clip_video_removed` notification: "{Title} was removed because nobody opened it for {N} days." |
| Expired downloads | DOWNLOAD jobs past `expiresAt`: delete the file and its asset row |
| Abandoned uploads | Uploads started but not completed in 24 hours: abort the storage upload, remove the row |
| Stale sharp ranges | SEGMENT assets of clips not opened for 14 days, when the platform copy is still marked available (they can be fetched again); never an upload's ORIGINAL |
| Unused library files | Workspace stickers and sounds no clip refers to, older than 30 days |
| Failed imports | FAILED videos older than 7 days and their leftovers |
| Meter charges with no job | Any `UsageEntry` of an import or AI step older than an hour whose `refId` job does not exist is reversed (`UsageService.reverse`, key `rev:<entryId>`): the backstop for a request that died between the charge and the job row |
| Orphans (daily) | Storage objects under `clips/` with no `ClipAsset` row, and rows with no object: logged as a count, the objects deleted after they have been orphans for 24 hours |

On worker boot with the `media` or `render` role: delete any scratch folders left by a crash.

#### 3. Limits Everywhere

`ClipLimitsGuard` (Module 04) reading `EntitlementResolver` and `UsageService` (Module 01) is the single authority. There is no second copy of any number. Make sure each of these calls it and shows its sentence from research 12 section 13 (most exist; this task is the audit, one test per row):

| Where | Checks (key, refusal code) |
|---|---|
| The whole feature | `clips.enabled`, `clips_not_in_plan`, on every Clips route through one guard |
| Probe and import | Longest video `clips.max_video_minutes` (`clips_video_too_long`), import minutes `clips.import_minutes_per_month` (`clips_minutes_used`), video space `clips.storage_gb` (`clips_storage_full`) |
| Upload start and complete | Upload size `clips.upload_max_gb` (`clips_upload_too_big`), video space |
| Download | Longest video, import minutes, `clips.downloads_per_day` (`clips_downloads_today`) |
| Find Clips and the Sprint 13 steps | AI minutes `clips.ai_minutes_per_month` (`clips_ai_minutes_used`) |
| Sound and sticker uploads | Video space |
| Export | Best quality `clips.export_max_quality` (`clips_quality_requires_plan`), the mark `clips.export_watermark` (copied into the job, never in the document) |
| More video (a wider sharp range) | Video space |
| Channels added | `clips.browse_channels` (`channel_limit`) |
| Concurrency and order | `clips.concurrent_imports` and `clips.queue_priority`: no refusal, the job waits ("Waiting for its turn") |

- **A downgrade never deletes.** When the video space is over the new plan's limit, new imports, uploads and wider ranges are refused with `clips_storage_full` ("Your videos use {used} GB, over your plan's {limit} GB. Delete some, or upgrade, to bring in more."); existing clips still export. A `clips.storage_over_limit` notification goes to the workspace's admins when a downgrade lands (and when an operator lowers a plan value that pushes a workspace over), and the Clips page shows an `Alert variant="warning"` until the workspace is under the limit. Quality and the mark apply from the next export; a running render keeps its snapshot.
- The storage meter's tooltip gains a **See What Uses Space** link that sorts the Videos tab by size (`GET /clips/videos?sort=size`), so "delete a video you no longer need" is one click away.
- `GET /clips/status` `usage` gains `byKind` (videos, downloads, library) for the tooltip.
- The billing page's plan cards read their Clips lines from `previewTier` (Module 01); check each against the plan table.

#### 4. Abuse Limits

- Per workspace: imports running at once come from `clips.concurrent_imports` (others wait as QUEUED and the card says "Waiting for its turn"); three exports queued and the probe, search and download throttles from earlier modules are fixed safety caps, not plan values.
- Per signed-in user: the create routes (`POST /clips/videos`, `/clips`, `/clips/:id/exports`, `/clips/downloads`) get a throttle of 30 a minute.
- Global: the disk guard before every job (Module 02), a ceiling on total queued jobs after which new ones are refused with "Clips is very busy right now. Try again in a few minutes." (503 `clips_busy`).
- Every job has an execution timeout from the contract; a job past it is cancelled and marked FAILED with "This took too long and was stopped. Try again."

#### 5. Rights Requests

- A small model `ClipBlockedVideo { id, platform, externalId, reason, createdAt }` (unique on platform and id), added with `prisma-change`. Probe and import refuse a blocked video with "This video was removed after a request from its owner."
- `DELETE /operator/clips/videos/:videoId` `{ reason }` in the admin module, guarded by `PlatformAdminGuard` (section 7, built first in Part A as a skeleton so this route is protected from the start): `removeVideo(id, 'rights_request')`, a `ClipBlockedVideo` row when the video came from a link, and a `clip_video_removed` notification to the workspace's admins: "A video was removed after a request from its owner."
- A script for operators who only have a link: `npm run clips:remove -- --url <link>` finds every workspace's copy of that video and removes each.
- A public page, `/legal/copyright` (follow the existing legal pages' layout if there are any; otherwise a minimal page in the auth layout): what to send (the link, proof of ownership, a contact) and the address `copyright@rkay.in` (decision D12-16). Plain words, no legal claims beyond "we remove it and tell the workspace". Link it from the rights tick box's help icon. The same page says how to report a sound or sticker (the library takedown path of Part B).

#### 6. Posters And Lengths In Media

Video in the Media library has no picture and no length today.

- New uploads: after a video is uploaded to Media, the API starts `mediaVideoFactsWorkflow` (`postgear-media`): fetch the file to scratch, `probeFile`, a poster at one second as WebP, write `thumbnail`, `durationMs`, `fps`, `width`, `height`. The upload itself does not wait for it.
- Old rows: the same activity over videos with no `thumbnail`, twenty per maintenance pass, until none are left.
- Web: `media-tile.tsx` and `library-tile.tsx` show the poster (falling back to the first frame as today) and the length in a corner ("0:42"); the viewer shows the length in its details.
- The composer's `videoFit` (Module 17) now has facts for these videos too.

### Part B: The Operator Screens

#### 7. Who Is An Operator, And Where They Work (Research 12, Section 8.1)

| Question | Answer |
|---|---|
| Who | `User.isSuperAdmin` is the only flag; the workspace role `SUPERADMIN` is the same flag seen through `RolesGuard` and is never invitable. Nothing in the app sets it today. |
| The guard | A new `@PlatformAdmin()` decorator and `PlatformAdminGuard` in `apps/api/src/common/guards/`. `RolesGuard` demands a workspace cookie, so it cannot guard these routes: the new guard checks `request.user.isSuperAdmin` only and answers 403 with `AUTH_MESSAGES.FORBIDDEN`. The org cookie is never trusted on an operator route. |
| Production allowlist | In production, `isSuperAdmin` is honoured only when the address is in `OPERATOR_EMAILS` (a comma list in the API env, added in Module 01), so a stray database edit alone cannot open the screen. In development and staging the flag alone is enough. |
| Granting | `npm run operator:grant -- --email <address>` and `npm run operator:revoke -- --email <address>` in a new `packages/db/scripts/` folder; each writes one log line with who ran it. Production never runs the seed, so the seeded `demo@postgear.local` superadmin exists in staging only. |
| Workspace in the path | The operator routes take the workspace id as a path parameter and ignore the org cookie, so an operator never acts on the wrong workspace by accident. |
| Where | `apps/api/src/modules/admin/` becomes `AdminModule` (the existing `.gitkeep` folder). On the web, `apps/web/src/app/(operator)/operator/page.tsx` with its own layout: full window, no workspace rail, a back button, like Workflows and Studio (`DashboardShell` `immersion()`); **desktop only, 1366 px and up**. A non-operator gets the 404 page, so the screen does not announce itself. The only entry is an **Operator** item in the account menu, drawn only when `isSuperAdmin` is true. |

All operator writes are throttled, need a `reason`, and send one mail to `OWNER_EMAIL` per save.

#### 8. The Entitlement Screens (CL-13.6)

One page, `Tabs`, a `PageActions` row first, no in-page title (the top bar says "Operator"). Tables use `DataTable`, edits and confirmations use `Dialog`, warnings use `Alert`, read-only blocks use `bg-inset`. Names are Title Case; sentences are sentence case.

| Tab | Content |
|---|---|
| **Plans** | Rows are keys grouped by module (a group header "Clips"), columns Free, Standard, Pro, Team, Ultimate, all read from the registry and the stored values. A cell shows its value; click to edit in place with a control by type (switch, number with its unit, select). Edited cells are marked and counted in the action row. A cell equal to the seed shows nothing; a different one shows a small "Seed 180" hint. Row menu: **Reset To Seed**. 4K is listed in the quality select as reserved and cannot be chosen |
| **Workspace Overrides** | A search box (workspace name, id or admin email), a result list, then that workspace's tier, status and a table of its overrides (setting, value, ends on, reason, who). **Add Override** opens a dialog; **Remove Override** is a row action |
| **Usage** | Pick a workspace; one card per meter this cycle (used, limit, remaining, reset date) and a table of its last 50 ledger entries (time, meter, units, kind, reference, note). **Adjust Usage** opens a dialog |
| **Change Log** | Newest first, filter by scope, key, workspace and actor; columns When, Who, Scope, Key, Old, New, Reason. Append only, no edit and no delete |

**The exact copy** (placeholders in the form "Enter your ..."; sentences stay sentences):

| Where | Text |
|---|---|
| Top bar, tabs | Operator. Plans, Workspace Overrides, Usage, Change Log, Library |
| Plans action row | Button **Review Changes** (disabled until a cell changes), "3 changes waiting" |
| Plans banner (`Alert`, info) | These values apply to every workspace on a plan, within a few seconds of saving. Edits to a plan never delete anything a workspace already has. |
| Review dialog | Title **Review Changes**. Each line reads "Clips Storage, Pro: 50 GB to 60 GB". Label "Reason for this change", placeholder "Enter your reason", help "At least 10 characters. It goes in the Change Log." Buttons **Save Changes**, **Cancel** |
| Inline errors | "Enter a whole number from 1 to 1,440." / "This plan value cannot be empty." / "4K is reserved and cannot be saved yet." |
| Toasts | Saved 3 changes. They are live now. / (conflict, `Alert` warning) Someone else changed these values while you were editing. Reload to see them, then edit again. |
| Add Override dialog | Title **Add Override**. "Workspace" (read only), "Setting", "Value", "Ends on" (help "Required. At most 366 days from today."), "Reason" (placeholder "Enter your reason"). Buttons **Add Override**, **Cancel** |
| Remove dialog | Title **Remove Override**. "This workspace goes back to the value of its plan, now." Buttons **Remove Override**, **Cancel** |
| Search and empty states | Placeholder "Enter your workspace name, id or admin email"; "No workspace matches that." / "This workspace has no overrides. It uses the values of its plan." / "No usage this cycle." / "Nothing has been changed yet." |
| Adjust Usage dialog | Title **Adjust Usage**. "Setting", "Minutes to add or take back" (negative gives minutes back), "Reason" (placeholder "Enter your reason"). `Alert` (warning): "This writes a permanent ledger entry and a Change Log entry. It cannot be edited, only reversed with another adjustment." Buttons **Adjust Usage**, **Cancel** |
| Plans warnings (`Alert`, warning) | "2 overrides end within 7 days." (links to that tab); "Pro now has less than Standard for Clips Storage. Check this is on purpose." |

**Routes** (all `@PlatformAdmin()`, `.strict()` Zod bodies generated from the registry, throttled):

| Route | What |
|---|---|
| `GET /operator/entitlements/plans` | The registry and every stored plan value with its `updatedAt` |
| `PUT /operator/entitlements/plans` | Save the edited cells (see "Order of writes") |
| `GET /operator/workspaces?q=` | Search workspaces |
| `GET /operator/workspaces/:orgId/entitlements` | Tier, status, resolved values and where each came from (override, plan, default), the overrides |
| `PUT /operator/workspaces/:orgId/overrides/:key`, `DELETE` the same path | Add or change, and remove, an override (an end date is required, at most 366 days ahead) |
| `GET /operator/workspaces/:orgId/usage` | The meters this cycle and the last 50 entries |
| `POST /operator/workspaces/:orgId/usage/adjust` | A ledger `ADJUSTMENT` plus a Change Log row; the dialog makes the idempotency key once per open |
| `GET /operator/changes` | The Change Log with filters |
| `DELETE /operator/clips/videos/:videoId` | The rights request removal of section 5 |

**Order of writes.** Saving in Plans is one transaction: validate every cell with `validateValue`, upsert the `PlanEntitlement` rows, insert one `EntitlementChange` row per cell (old and new, actor id and email), then after the commit set the Redis stamp (`ent:plans`) and log. The request carries each cell's `updatedAt`; a mismatch is a 409 with the conflict sentence. Overrides and adjustments follow the same shape (stamp `ent:org:<id>`). When a saved value pushes workspaces over a limit (a lower storage limit), the `clips.storage_over_limit` notice of Part A is sent by the next sweep, not inline.

**Daily upkeep** (a part of `sweepClips`, once a day): write an `EXPIRE` Change Log row for each override past its end date and remove its effect (the stamp), list the overrides ending in 7 days for the Plans warning, and write the reconcile report (charges with no job, reversals with no original) to the log for the operator. `entitlement.refused`, `entitlement.changed` events and the counters of research 12 section 12 go to `securityLogger`.

**Abuse and safety**: reason on every write, an append-only log with the email snapshot, the production allowlist, throttled writes, a mail to `OWNER_EMAIL` per save; a stored value that no longer validates is ignored and logged, so a bad cell can never lock a workspace out (and `ENTITLEMENTS_SOURCE=seed` is the escape hatch from Module 01).

#### 9. The Library Screen (CL-13.7)

The fifth tab of the operator page, **Library**, is where an operator looks after the sound and sticker catalogue that the ingest scripts (Modules 12 and 14, run on the media worker box) fill. **No route accepts a source address and nothing here fetches anything**: ingest is a script, gated by `CLIPS_LIBRARY_INGEST`; this screen reviews what it staged and manages what is live. It calls the same library service the scripts use.

- **Runs**: a table of `ClipLibraryRun` (origin, started, accepted, rejected, the rejection reasons as small counts such as "licence not allowed 41, brand name 6", and **Download Report**, a signed address for the licence report in the private bucket). A run with STAGED items shows **Review Items** and **Publish Run**. Openverse and OpenGameArt runs carry a "Needs review" badge and can never be auto-published; the dialog for **Publish Run** reads "Publish 120 items from this run? They become visible to every workspace." and has a checkbox "I listened to a sample and checked the licences." that must be ticked.
- **Items**: `Tabs` for **Sounds** and **Stickers**; filters for status (Staged, Active, Hidden, Removed), kind, category, source and a search box (the same Postgres search as the product, over name, tags and category). A row shows a play button or the preview, the name, the licence code, the author (a link to the source page), the status and the run. Actions: **Hide Item** (leaves search at once; clips already using it keep working), **Restore Item**, **Remove Item** (a red confirm; deletes the files from the public bucket, adds the checksum and the origin id to the deny list, keeps the row and its evidence), **Publish Item** for a staged one. Hide and remove need a reason and write `statusReason`, `statusById` and `statusAt`.
- **Takedown view**: opening an item shows "{N} clips use this item" (a JSON containment query over clip documents) so the editor's "This sound was removed" notice and the export prompt are expected, not a surprise. The takedown path of research 10 section 12 reads: hide within the hour, decide, remove if needed, the deny list keeps it from coming back.
- **Deny list**: a table of `ClipLibraryDeny` (checksum or origin id, reason, date), read only.
- **Gaps**: the top 50 searches with no result (`ClipLibraryMiss`: term, kind, count, last seen), to decide what the next ingest run should add.
- **Credits page**: a **Preview Credits Page** button opens `/credits/clips`, which is generated from `ClipLibrarySource` joined with the count of ACTIVE items (groups: Attribution Required for stickers only, Notices, Public Domain And CC0, PostGear's Own). A source with ACTIVE items but a missing credit line (when it requires one) shows an `Alert variant="warning"` here: "This source needs a credit line before its items are published." and its items cannot be published until it has one. The public route `GET /clips/library/credits` (`@Public()`) and the page `/credits/clips` are built here if Modules 12 and 14 did not already (check first); the page is linked from the Elements and Audio panels, the app footer and the export panel.
- **Licence guard at publish**: the service refuses to publish or restore an item whose licence code is not on the allow-list for its kind (sounds never accept CC BY), whatever the UI sends, and refuses any source other than the five adapters.

**Routes** (all `@PlatformAdmin()`): `GET /operator/library/runs`, `GET /operator/library/runs/:id`, `POST /operator/library/runs/:id/publish` `{ reviewed: true }`, `GET /operator/library/items?type&status&kind&category&q&runId&page`, `GET /operator/library/items/:type/:id` (with its usage count), `POST /operator/library/items/:type/:id/publish|hide|restore|remove` `{ reason }`, `GET /operator/library/deny`, `GET /operator/library/misses`, `GET /operator/library/sources`, `PATCH /operator/library/sources/:id` (credit line, change note, notice text only).

#### 10. Tests

- API Part A: `touchVideo` (once a day), `removeVideo` (each reason; exported media kept; the row kept), the limits audit (one test per row of the table, through a fake resolver and a fake usage service), the downgrade rule (new imports refused, exports still work, nothing deleted, the notification sent once), abuse limits, the blocked video refusal, tenancy on everything: a member of another workspace gets 404 for videos, clips, jobs, downloads, layouts, sounds, stickers and channels, and a signed address made for one workspace cannot be reused after expiry; the meter backstop reverses an orphan charge once.
- API Part B (research 12 section 12): operator routes: 401 no session, 403 ADMIN and USER, 403 a superadmin outside `OPERATOR_EMAILS` in production mode, 200 an operator; the operator routes ignore the org cookie; Plans save is one transaction with one Change Log row per cell, a stale `updatedAt` gives 409; an override needs an end date and a reason and is capped at 366 days; an expired override stops applying and gets its `EXPIRE` row; `adjust` writes the ledger row and the Change Log row; the Change Log has no update or delete route; the library routes: publish refuses a non-allow-listed licence, remove writes the deny list and deletes the files (fake storage), hide keeps clips working, a staged item never appears in the product search.
- Worker: each part of `sweepClips` with fake rows and a fake storage (notice once, removal, downloads, uploads, stale ranges keep uploads' originals, orphans wait 24 hours, the charge backstop), the daily override step, scratch cleanup on boot, `mediaVideoFactsWorkflow`.
- Web: "Kept until" and "Removed in 2 days", the sort by size, the waiting card, Media tiles with a poster and a length; the Plans editor (edit, count, review dialog, inline errors, the 409 sentence, Reset To Seed), the overrides tab, the usage adjust dialog, the Change Log filters, the Library tab (runs, publish needs the tick, hide, remove confirm, deny list, gaps), the 404 page for a non-operator, `title-case.test.ts` over every new string; `e2e/operator.spec.ts` is written in Module 20.

## Scope

**In (Part A)**: the retention clock, notices and removal, the sweep, the limits audit through the resolver, abuse limits, the downgrade rule, the blocked list, the operator removal route and script, the copyright page, posters and lengths for Media.
**In (Part B)**: `PlatformAdminGuard`, `OPERATOR_EMAILS`, `operator:grant` and `operator:revoke`, the operator page with Plans, Workspace Overrides, Usage and Change Log, the daily override and reconcile step, the Library screen with its routes and the credits page generator.
**Out**: per-workspace storage add-ons and their billing (Module 21), legal hold, exporting a workspace's data, an automatic ingest from a web request (ingest stays a script), richer plan tooling than a table editor, moving AI credits onto the ledger (a later task named in research 12 section 4.2).

## Tasks

Part A:

- [x] The `PlatformAdminGuard` skeleton and `AdminModule` (so section 5's route is protected).
- [x] `touchVideo`, `expiryNoticeAt`, `removeVideo` used by every delete path; retention read through the resolver.
- [x] `sweepClips` with all its parts including the charge backstop; scratch cleanup on boot.
- [x] The limits audit and its tests; the downgrade rule, the `clips.storage_over_limit` notification and `Alert`; `usage.byKind`; sort by size; See What Uses Space.
- [x] Abuse limits and the busy refusal; timeouts' sentence.
- [x] `ClipBlockedVideo`, the refusal, the operator route, `clips:remove`, the copyright page and its link.
- [x] `mediaVideoFactsWorkflow`, the backfill, Media tiles with poster and length.
- [x] The tenancy and signed-address tests.

Part B:

- [x] `operator:grant` and `operator:revoke`; the production allowlist; the **Operator** item in the account menu; the `(operator)` layout (immersive, desktop only) and the 404 for others.
- [x] The operator routes for plans, overrides, usage and the Change Log, with transactions, the 409 check, the Redis stamps and the owner mail.
- [x] The Plans, Workspace Overrides, Usage and Change Log tabs with the exact copy above.
- [x] The daily upkeep step (expiry rows, the 7 day list, the reconcile report) and the `securityLogger` events. (The 7 day list is worked out when the Plans tab is read, not stored by the sweep.)
- [x] The Library tab: runs, items, takedown view, deny list, gaps, the credits page and its warning; the library routes and the allow-list guard at publish.
- [x] Title-case test green.
- [x] `verify-change`; update the Progress table and the Decision Log. (`npm run validate` green on 2026-11-19, 71 of 71 tasks.)

## Tests

```powershell
npx jest --config apps/api/jest.config.js apps/api/src/modules/clips apps/api/src/modules/admin apps/api/src/modules/entitlements apps/api/src/modules/media
npx jest --config apps/worker/jest.config.js clips maintenance
npx jest --config apps/web/jest.config.js apps/web/src/components/clips apps/web/src/components/media apps/web/src/components/operator
npx jest --config apps/web/jest.config.js apps/web/src/lib/title-case
```

## Done When

Part A:

- A video whose time is up is removed by the sweep, its exported clips stay in Media, and the notices were sent three days before and on removal.
- Opening a video moves its date forward.
- Every row of the limits table refuses with its sentence, from the resolver, and a plan value changed in the database changes the refusal at once.
- A downgrade below current use leaves everything in place, refuses new imports with `clips_storage_full` and shows the Alert.
- A video removed by an operator cannot be imported again by anyone.
- Another workspace's member gets "not found" for every Clips address.
- Uploading a video to Media gives it a picture and a length within a minute, and older videos gain theirs over the next passes.
- A day after a forced orphan, the object is gone and the log has the count. An orphan meter charge is reversed once.

Part B:

- An operator (and only an operator, and in production only one in `OPERATOR_EMAILS`) opens `/operator`; a member sees the 404 page; the API answers 403.
- Editing a plan value and saving with a reason changes what `GET /entitlements/me` returns for a workspace on that plan within a few seconds, and adds one Change Log row with the old and new value. Two operators saving the same cell: the second gets the conflict sentence.
- An override with an end date changes one workspace and nothing else; after its end date the plan's value applies again and the log shows it.
- An adjustment changes the meter and writes both rows; nothing in the log can be edited.
- A staged item is invisible in the product's search until its run is published; hide removes it from search at once; remove deletes its files and a second ingest of the same file is refused as denied; the credits page lists only sources with ACTIVE items.

## Hand Check

With `CLIPS_SIMULATION=true` and the demo admin (the seeded superadmin on staging or local):

1. In the database set one video's `expiresAt` to two days from now and wait a maintenance pass (or run the activity by hand): the bell has the "removed in 3 days" notice; the card says "Removed in 2 days".
2. Open that video: its date moves forward.
3. Set another video's `expiresAt` to yesterday and run the pass: it is gone, its exported clip is still in Media, the bell says why.
4. On the Free workspace, try to bring in a video over the limit, and fill the space with uploads: each sentence appears, and See What Uses Space sorts by size.
5. Sign in to the second workspace and paste the first workspace's video, clip and job addresses: not found each time.
6. Call the operator removal route on a video; then paste its link again: "This video was removed after a request from its owner."
7. Upload a short MP4 to Media: after a moment its tile has a picture and "0:12".
8. Account menu, **Operator**. Plans: change Clips Storage for Free from 3 to 4, Review Changes, give a reason, Save Changes. Open the Clips page of a Free workspace: its meter now says 4 GB. Change Log: the row is there. Edit the same cell in a second browser window and save the first: the conflict sentence.
9. Workspace Overrides: search the Free workspace, Add Override for Clips AI Minutes a Month, 100, ending in a week, with a reason. Its chip now says "of 100 AI minutes left". Remove Override: back to the plan's number.
10. Usage: Adjust Usage by 10 minutes; the card changes and the log has an entry.
11. Library (after an ingest from Module 12 or 14 has staged items): open a run, tick the box, Publish Run. Search the product's sound panel: the items appear. Hide one: gone from search. Remove one: gone, and it shows in the deny list. Preview Credits Page.
12. Sign in as a normal member and open `/operator`: the 404 page.

## Handoff

Module 20 runs the full security sweep (operator routes, entitlement writes, the meter, the library licence guard) and the e2e suite over all of this, and adds `e2e/operator.spec.ts`. The real-test plan's R-50 to R-55 repeat these checks with real videos. Sprint 13's transcripts and face positions are assets like any other, so `removeVideo` already deletes them, and Sprint 13's Module 15 only audits AI minute prices and reads `clips.queue_priority`.
