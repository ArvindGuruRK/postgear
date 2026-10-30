# Module 09: Triggers, Activation And Versions

> **Sprint 10, Workflow Builder** | Status: Done | Size: L (one session)
> **Depends on**: [Module 08](module-08-test-runs-history-and-review.md) (and Module 07's engine through it)
> **Stories**: WF-6.1, WF-6.2, WF-6.3, WF-6.4, WF-7.1, WF-7.2, WF-7.3, WF-7.4, WF-12.1, WF-12.3, WF-1.4 (delete stops an active workflow)
> **Next**: Modules [10](module-10-postgear-and-social-steps.md), [11](module-11-ai-steps-and-credits.md), [12](module-12-notify-steps-and-simulation.md) (any order)

## Goal

Workflows go live. After this module:

- an admin turns a workflow on through a dialog that says, in one sentence, what it will do; activation stores an immutable version and pins it;
- **Post Published** and **Post Failed** start runs exactly once per event; **Schedule** fires on time in its time zone through Temporal Schedules; **Run Now** starts a Manual workflow with its inputs;
- editing an active workflow only changes the draft (**Unpublished Changes**), with **Activate Changes**, **Discard Changes**, and a **Versions** drawer with preview and **Restore As Draft**;
- Pause stops new runs at once; failed live runs notify the workspace (grouped); five failures in a row pause the workflow;
- runs older than 30 days are pruned.

## Read First

1. [`README.md`](README.md), [`00-ux-blueprint.md`](00-ux-blueprint.md) section 8 (activation, versions, safety) and 9 (list row menu).
2. Sprint doc: "Triggers", "Activation", "Limits"; user stories WF-6.x, WF-7.1 to 7.4, WF-12.1, WF-12.3 and section 5 rows on paused schedules and members.
3. Module 02: `describeWorkflow`, `riskSummary`, `toTemporalScheduleSpec`, `nextRuns`. Module 07: the contract and `finishRun`.
4. Skill: `temporal-workflow`.
5. Code: `apps/worker/src/activities/publish.activities.ts` (`writePublished` around its `prisma.$transaction` with `enqueueWebhookDeliveries(tx, { event: 'post.published' ... })`, and `markPublishFailed` with the same for `post.failed`), `apps/worker/src/lib/webhook-payload.ts` (the post payload shape and `createMany({ skipDuplicates })`), `apps/worker/src/lib/webhook-start.ts` (start after commit, best effort), `apps/worker/src/activities/maintenance.activities.ts`, `packages/scheduling/src/workflows.ts` (`PublishFailureReason`).
6. Temporal TypeScript SDK docs for **Schedules** (`client.schedule.create`, `getHandle`, `update`, `delete`, `ScheduleOverlapPolicy`, `catchupWindow`, `spec.timezone`). This is the first use of Schedules in this codebase: read the current docs, do not guess the API.

## Scope

**In**: event triggers in the worker, trigger filters, Schedule registration, Run Now, activation, pause, discard, versions, the activation dialog and the live-state UI in the builder and the list, failure notifications, auto-pause, run pruning, delete of an active workflow, the reconcile of missing schedules.

**Out**: the steps that act on PostGear, AI or outside apps (Modules 10 to 13); the Webhook trigger (Module 13).

## Design

### Event triggers: Post Published and Post Failed

In `publish.activities.ts`, inside the **same transaction** that calls `enqueueWebhookDeliveries`, call a new `enqueueAutomationRuns(tx, { event, organizationId, triggerEventId, payload })` (`apps/worker/src/lib/automation-enqueue.ts`), and after commit `startAutomationRuns(...)` next to `startWebhookDeliveries`, best effort (the reconcile from Module 07 starts anything left `QUEUED`).

`enqueueAutomationRuns`:

1. Finds `ACTIVE`, not deleted automations of the workspace whose active version's `triggerType` is `trigger.postPublished` or `trigger.postFailed` (index on `(organizationId, status)` plus `triggerType`).
2. Loads each active version's trigger node and applies its filters with `matchesTriggerFilters(triggerNode, event)` (add it to `packages/automation`): channel ids, tags (any of), failure reasons. Filters run against the event, not the draft.
3. Inserts `QUEUED` `LIVE` runs with `createMany({ skipDuplicates: true })` on the unique `(automationId, triggerEventId)`. A replayed or retried publish activity therefore inserts nothing new, exactly like webhook deliveries. Returns the new run ids.

**`triggerEventId`** (the dedupe key):

| Event | Key | Why |
|---|---|---|
| Post Published | `post.published:<rootPostId>` | a channel chain's root row publishes once; a repeating post spawns new root rows (`repeat.activities.ts`), so each occurrence gets its own key |
| Post Failed | `post.failed:<rootPostId>:<publishWorkflowRunId>` | a root can fail, be fixed and rescheduled, and fail again: each failure should alert. The Temporal **run id** of the publish workflow (`Context.current().info.workflowExecution.runId`) is stable across retries of `markPublishFailed` within one attempt chain (so replays dedupe) and new when the post is re-queued (a new execution). Do not use a timestamp: it changes between activity retries. |

**Payload** (the trigger's output, mirrored in the catalog's `outputShape` and samples): the same `post` object the webhook payload builds (id, rootId, state, publishAt, url, preview, channel `{ id, name, provider }`), plus `tags` (names), `publishedAt`, and a PostGear link to the post; for failures `error: { reason, reasonText, message, attempts }`. `reasonText` is the plain-words label:

| `PublishFailureReason` | Words shown in filters and messages |
|---|---|
| `needs_reconnect` | Channel needs reconnecting |
| `needs_permissions` | Channel is missing permissions |
| `rejected` | The platform refused the post |
| `retries_exhausted` | Gave up after several tries (often a rate limit) |
| `channel_unavailable` | Channel is unavailable |
| `interrupted` | Publishing was interrupted |
| `unexpected` | Something unexpected went wrong |

There is **no `rate_limited` reason** today: a post that keeps hitting 429 ends as `retries_exhausted`. The Failed Post Alert template's filter ("reason is not rate limited") therefore becomes "reason is not 'Gave up after several tries'". Check Module 02's template uses this and record it in the decision log.

### Schedule trigger (Temporal Schedules)

- On activate (or re-activate) of a workflow whose trigger is `trigger.schedule`: create or **replace** the schedule `automationScheduleId(id)` (`automation-schedule:<id>`, add the helper to `packages/scheduling`) with:
  - `spec`: `toTemporalScheduleSpec(config)` from Module 02, including `timezone` (the step's IANA zone);
  - `action`: start `automationRunWorkflow` on `SCHEDULING_TASK_QUEUE` with input `{ scheduled: { automationId, versionId }, organizationId }` and workflow id prefix `automation-scheduled:<id>` (Temporal appends the time);
  - `policies`: `overlap: SKIP` (never two scheduled runs of one workflow at once), `catchupWindow` of 1 minute (a short worker outage does not lose the run, but nothing piles up).
- The scheduled workflow's `loadRunPlan` (Module 07) sees `scheduled` and **creates the run row first** with `triggerEventId = schedule:<automationId>:<scheduledStartTime ISO>` (from the workflow's start info; idempotent if Temporal retries the start), then continues as a normal run. Store the Temporal workflow id on the run (`temporalWorkflowId String?`, small migration) so Cancel can find scheduled runs, which do not use `automationRunWorkflowId`.
- **Pause deletes the schedule; activate recreates it from the active version.** Deleting rather than `pause()` keeps one source of truth (the version) and guarantees no catch-up when turned back on, which is what the user stories promise ("Paused schedules do not catch up on missed runs"). The pause dialog says so.
- The AI frequency rule from Module 02 is enforced again on activate (server side).
- Reconcile (extend `maintenanceWorkflow`'s activity): every `ACTIVE` schedule workflow must have a schedule; recreate missing ones; delete schedules whose workflow is not `ACTIVE`.

### Run Now (Manual trigger)

`POST /automations/:id/runs` `{ inputs }` (members): only for `ACTIVE` workflows with a Manual trigger; inputs validated against the trigger's declared fields; creates a `LIVE` run (`triggerEventId` null) and starts it. The builder shows **Run Now** next to Test Workflow when it applies; a dialog asks for the inputs ("Enter your topic").

### Activation (`POST /automations/:id/activate`, `@Roles(Role.ADMIN)`)

Body `{ draftRevision, note?, acceptAutomaticPosting? }`.

1. Revision check (409 if stale): you activate exactly what you saw.
2. Full server validation: `validateGraph(draftGraph, ctx)` with `ctx` from the database (connections, channels, executable types). Any `error` issue: 422 with the issue list (the dialog shows it, each linking to its step).
3. `riskSummary`: if `publishesWithoutReview` and not `acceptAutomaticPosting`: 422 "Confirm that posts will go out automatically."
4. One transaction: insert `AutomationVersion { version: n + 1, graph: draftGraph, triggerType, note, createdById }`, set `activeVersionId`, `status: ACTIVE`, `hasUnpublishedChanges: false`, `consecutiveFailures: 0`.
5. After commit, register triggers (the schedule). If that fails, answer 200 with `warnings: ["The schedule is not set up yet. PostGear will retry within a minute."]` and let the reconcile finish it. Never roll back a version for a Temporal blip.

**Versions are immutable**: no route updates or deletes a version row; a spec asserts the repository has no such method. A run always runs its own `versionId` (Module 07 loads it by id), so a run started on v1 finishes on v1 after v2 is activated.

### Pause, discard, versions, delete

| Route | Who | Behaviour |
|---|---|---|
| `POST /automations/:id/pause` | admins | `status: PAUSED`, delete the schedule. Runs in progress finish (they can be cancelled from the Runs tab). |
| `POST /automations/:id/discard` | members | draft becomes the active version's graph, revision bumped, `hasUnpublishedChanges: false` |
| `GET /automations/:id/versions` | members | number, who, when, note, trigger, "Active" marker |
| `GET /automations/:id/versions/:version` | members | the graph, for a read-only preview |
| `POST /automations/:id/versions/:version/restore` | members | copies that graph into the draft (revision checked); never changes what is live |
| `DELETE /automations/:id` (from Module 03) | members, admins if active | now really stops it: delete the schedule, cancel running and waiting runs, then soft delete. A member deleting an **active** workflow gets 403 "Only workspace admins can delete an active workflow." |

### Failure notifications and auto-pause (in Module 07's `finishRun`, LIVE runs only)

- **Grouped notifications**: on a `FAILED` live run, write an in-app notification "{Workflow} failed at {step}: {reason}." (link to `?run=<runId>`, `meta: { automationId, count }`) unless one for this workflow was written in the last hour; then increment a counter and, at the end of that hour, the next failure writes "{Workflow} failed 4 more times since the last alert. Latest: at {step}: {reason}." `REJECTED` and `EXPIRED` are never failures.
- **Auto-pause** (addition): `consecutiveFailures` resets on any `SUCCEEDED` live run and increments on `FAILED`. At 5, the worker sets `status: PAUSED`, deletes the schedule (the worker has `deps.temporalClient`), and notifies: "{Workflow} was paused after 5 failed runs in a row. Fix it and turn it back on."

### Pruning

`pruneAutomationRuns` in `maintenance.activities.ts`: delete runs (steps cascade) whose `finishedAt` is older than 30 days, in batches of 500; never touch `QUEUED`, `RUNNING` or `WAITING` runs. Runs of soft-deleted workflows go after 30 days too.

### UI

- **Activate switch** in `PageActions` (admins; members see it disabled with "Only workspace admins can turn workflows on."). Off to on opens the **activation dialog** (blueprint section 8):
  - the issues list instead, if there are any errors;
  - otherwise the `describeWorkflow` sentence, the AI credits estimate when `aiCreditsPerRun > 0` ("Uses about 12 AI credits per run"), next three run times for schedules, an optional "Version note" field ("Enter your note"), and the tick "I understand posts will go out automatically." when `publishesWithoutReview`;
  - Turn On (primary), Cancel. Success toast "Workflow turned on."
- On to off opens the pause dialog; for schedules it adds "Missed runs will not be caught up when you turn it back on."
- Status badge: **Draft**, **Active v3**, **Paused**, and **Unpublished Changes** (amber) with **Activate Changes** and **Discard Changes** (confirm) next to it.
- **Versions drawer** from the menu: rows with number, author, time, note; click previews the graph read-only on the canvas with a banner "Viewing version 2. Restore As Draft or Close."
- **Run Now** button and inputs dialog for Manual workflows.
- **List page**: row menu Activate or Pause (admins), status sticker, last run sticker with the failure reason on hover.

## Tasks

- [x] `matchesTriggerFilters` and reason labels in `packages/automation`; `automationScheduleId` in `packages/scheduling`.
- [x] `automation-enqueue.ts` (`enqueueAutomationRuns`, `startAutomationRuns`) wired into both transactions in `publish.activities.ts`.
- [x] `AutomationRun.temporalWorkflowId` migration; scheduled runs create their row in `loadRunPlan`.
- [x] Schedule service (API side for activate and pause, worker side for auto-pause), reconcile of schedules.
- [x] Activate, pause, discard, versions, restore, Run Now routes; delete now stops triggers and runs.
- [x] Grouped failure notifications and auto-pause in `finishRun`; `EXECUTABLE_TYPES` gains the three triggers.
- [x] `pruneAutomationRuns` in the maintenance workflow.
- [x] UI: Activate switch and dialog, pause dialog, badges, Activate Changes, Discard Changes, Versions drawer and preview, Run Now, list row menu.

## Tests

- `enqueueAutomationRuns`: calling it twice with the same event inserts one run per matching workflow; a paused workflow, a deleted workflow, a draft-only trigger and a non-matching channel or tag filter insert nothing; failure reason filters.
- Publish activity: replaying `markPublishFailed` in the same publish run id dedupes; a new publish run id after re-queue starts a new run.
- Activation: member 403 (API, whatever the UI shows); stale revision 409; validation errors 422 with issues; automatic posting without the tick 422; the version row is immutable (no update path); a run started on v1 still loads v1 after v2 is activated (worker test with the memory store).
- Schedules: activate creates the schedule with the right spec, time zone, overlap SKIP and catch-up window (mock the Temporal client); re-activate replaces it; pause deletes it; the reconcile recreates a missing one; the AI frequency rule refuses a 30-minute schedule with an AI step.
- Scheduled run: two starts with the same scheduled time create one run row.
- Failure notifications: three failures in an hour write one notification; the next after the hour writes the grouped sentence; `REJECTED` writes none; five failures in a row pause the workflow and delete its schedule.
- Prune: old finished runs and their steps go; waiting runs stay.
- Run Now: refused for drafts and non-Manual triggers; inputs validated.

## Done When

- `npm run validate` passes.
- With `PUBLISH_SIMULATION=true`, publishing a post starts exactly one run of an active Post Published workflow, visible in the Runs tab.

## Hand Check (manual test script)

1. `npm run dev` with `PUBLISH_SIMULATION=true`. Sign in as the demo admin.
2. Build: Post Published, In-App Notification "Published: [Post Link]". Turn it on: the dialog shows "When a post is published, this workflow will send a notification in PostGear." Confirm. The badge says **Active v1**.
3. Compose a post and **Publish Now**. Within seconds the bell shows the notification and the Runs tab shows one Live run, Succeeded.
4. Edit the message: the badge shows **Unpublished Changes**. Publish another post: the notification still uses the old text. Click **Activate Changes**: **Active v2**. Publish again: new text.
5. Open **Versions**, preview v1, **Restore As Draft**, then **Discard Changes**: the draft is v2 again.
6. Make a post fail with `[simulate:401]` in its text and a Post Failed workflow: one run per failure.
7. Schedule: set Every Day at two minutes from now, turn on, wait; one run appears. Pause, wait past the next time, resume: no catch-up run.
8. Sign in as `member@postgear.local`: the switch is disabled with the reason.

## Handoff

Update [`README.md`](README.md): progress row, decision log (the two `triggerEventId` formats; pause deletes the schedule; the `retries_exhausted` wording for the Failed Post Alert filter; the Schedules API calls you used and the SDK version), and the notification `type` values for later modules.
