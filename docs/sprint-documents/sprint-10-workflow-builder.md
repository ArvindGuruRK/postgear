# Sprint 10: Workflow Builder (Visual Automations)

> **PRD Coverage**: new module, not in `prd.md` section 5 yet.
> **User stories**: [`../new-modules/user-stories-workflow-builder.md`](../new-modules/user-stories-workflow-builder.md) holds the journeys, acceptance criteria, UX rules and the completion checklist. They are part of this sprint's scope, including the few items they add beyond this document (canvas undo and redo, Discard Changes, a Connections page, failed-run notifications, next run times on schedules, Rejected reviews not counted as failures). This document decides *how* to build; the stories decide *what the user experiences*.
> **Depends on**: [Sprint 5](sprint-05-scheduling-and-publishing.md) (Temporal worker, publish outcomes), [Sprint 6](sprint-06-ai-content-engine.md) (content agent, image tool, credits), [Sprint 8](sprint-08-billing-notifications-api-launch.md) (webhook outbox pattern, notifications outbox, entitlements, SSRF-checked sender). [Sprint 9](sprint-09-design-studio.md) only for the P2 Render Design node.
> **Branch**: `sprint-10-workflow-builder`, cut from `ui-revamp` (or from Sprint 9's branch if that is not merged yet).
> **Reference**: **TriForms** (`D:\rk-personal-projects\TriForms`) is Arvind's own workflow builder, so its code may be studied and adapted freely (it is not AGPL like Postiz). Read `INTEGRATIONS.md`, `docs/analysis/workflow-audit-findings.md`, `docs/plan/workflow-builder-v2-plan.md`, `packages/trpc/src/lib/workflow-*.ts` and `apps/web/src/components/form-builder/workflow-*.tsx`. TriForms is tRPC and form-centric; PostGear is NestJS + Temporal and post-centric, so adapt the ideas to PostGear's structure rather than porting files. n8n, Make and Zapier are UX references only (n8n is under a Sustainable Use Licence: never copy its code).

## Sprint Goal

A user opens **Workflows** from the rail, builds an automation by dragging nodes onto a canvas and connecting them, configures each node in a side panel, test-runs it safely, and activates it. Example: *when a post is published, append a row to a Google Sheet and send a Slack message*. Or: *every Monday at 9:00, have AI write a post and an image, wait for my review, then add it to the queue*.

## Lessons Carried Over From TriForms

These are bugs TriForms already paid for. Design them out from the start:

1. **Stable node keys.** Every node gets a client-generated `key` (nanoid) that never changes, across edits and versions. Data tokens reference the key (`{{ nodes.k3f9.output.url }}`), never a name or a database row id. The display name is a label only.
2. **Versions are immutable snapshots, not recreated rows.** Activating stores the whole graph JSON as a new `AutomationVersion` row. Nothing deletes and recreates node rows (TriForms' `onDelete: SetNull` republish bug cannot happen).
3. **Client and server resolve tokens with the same code.** The token parser and resolver live in one pure package used by the web app (preview), the API (validation) and the worker (execution).
4. **No stale closures in config panels.** Panels that preview or test read current values through refs or derive them on each run (TriForms' condition-preview bug).

## Names And Placement

| Thing | Name |
|---|---|
| Rail label | Workflows |
| Top bar page name | Workflows |
| Routes | `/[orgId]/workflows` (list), `/[orgId]/workflows/[automationId]` (builder) |
| Rail position | after Studio, before SEO |
| Primary action | Create Workflow |

Internally the model is `Automation` (the word "workflow" already means a Temporal workflow everywhere in this codebase; mixing them in code would be confusing). The UI says Workflow.

## Screens

### Workflows List

- `PageActions`: Create Workflow, search, status filter (All, Active, Paused, Draft).
- Table: Name, Trigger, Status badge, Last Run (result + time), Runs (last 30 days), Updated. Row menu: Open, Duplicate, Pause or Activate, Delete (solid red, confirm).
- **Start From A Template** row of cards: Publishing Report, AI Weekly Post, Failed Post Alert (see Starter Templates).
- Empty state: "No workflows yet. Start from a template or build your own."

### Builder

```
┌ PageActions: Name (inline rename) | Saved state | Status badge | Test Workflow | Activate/Pause | menu ┐
├────────────────┬──────────────────────────────────────────────────────────────┬──────────────────────┤
│ Node library   │ Canvas (@xyflow/react): pan, zoom, fit, minimap,              │ Node settings        │
│ search +       │ drag to add, drag port to port to connect,                    │ name, connection,    │
│ categories     │ "+" on an output port opens the library filtered to fits,     │ fields with data     │
│                │ multi-select, duplicate, delete, live validation markers      │ tokens, output       │
│                │                                                              │ preview, Test Step   │
├────────────────┴──────────────────────────────────────────────────────────────┴──────────────────────┤
│ Run inspector drawer: runs list | selected run: per-node status, duration, input/output (redacted)   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Node library** categories: Triggers, PostGear, Social Channels, AI, Logic, Notify, Data. Each card: icon, Title Case name, one-line description, and a state badge: Ready, Needs Connection, or Coming Soon (Coming Soon nodes are visible but cannot be added). A node is never shown as connected unless a working connection exists.
- **Social Channels**: one card per platform (Instagram, Facebook, X, LinkedIn, YouTube, TikTok, Pinterest), each listing only the workspace's connected channels of that platform. Under the hood they are one node type, `postgear.publish`, with a provider filter: one engine path, platform-shaped UI.
- **Canvas look**: nodes are design-system cards (border-2, hard shadow, `rounded-xl`), a coloured category stripe, the node icon, name and a one-line summary of its config ("Every Monday at 09:00"). Ports are filled circles; incompatible ports dim while dragging a connection. Edges are solid ink lines with an arrow; a selected edge shows a delete button. Validation issues show a red corner marker with a tooltip. Check light, dark and Lilac.
- **Settings panel**: fields generated from each node's config schema (text, select, channel picker, connection picker, cron builder, condition builder). Text fields accept data tokens through an Insert Data button listing upstream nodes' outputs (only nodes upstream of this one, from the graph). "Enter your ..." placeholders. Test Step runs just this node with sample input in test mode.
- **Run inspector**: run list (status, trigger, started, duration, Test or Live badge); selecting a run paints node status on the canvas (queued, running, succeeded, failed, skipped, waiting) and lists steps with input and output. Secrets are already redacted server-side. Failed steps show the error in one sentence plus a Copy Details button. Retry From Here on a failed step (P1, only for steps marked safe to retry).
- **Manual review**: a run waiting at a Manual Review node shows in the inspector and as an in-app notification with Approve and Reject (and an edit of the generated text before approving, P1).
- Small screens: library and settings become `Sheet` drawers; the builder warns that it is best on a wider screen but stays usable.

## Node Catalog

Every node type declares: `type`, `version`, `category`, input and output ports, a Zod config schema, an output shape (for token suggestions and validation), `sideEffect` (does it change something outside PostGear?), `connection` kind if any, retry class, and `status` (ready or coming soon).

| Category | Node | Priority | Notes |
|---|---|---|---|
| Triggers | Post Published | P0 | optional channel and tag filters; output: post, channel, url, preview |
| | Post Failed | P0 | optional failure-reason filter (uses `PublishFailureReason`) |
| | Schedule | P0 | cron builder (every day, weekday, week, month, custom) in the workspace time zone; Temporal Schedule |
| | Manual | P0 | Run Now button; optional input fields |
| | Webhook | P1 | `POST` URL with a secret header; body as output |
| PostGear | Create Draft | P0 | content, media, channels; lands in Drafts |
| | Add To Queue | P1 | next free slot or a time; goes through the same validation as the composer |
| | Publish To Channel (one card per platform) | P1 | content, media; `sideEffect`, never automatic without the activation confirmation |
| | Get Post | P1 | by id from a trigger |
| AI | Generate Text | P0 | prompt with tokens, platform, tone (Personal or Company), research on or off; charges credits |
| | Generate Image | P1 | prompt; saves to Media; charges credits |
| | Generate Hashtags, Rewrite In Brand Voice | P1 | prompts over Generate Text |
| | Generate Video | Coming Soon | no video provider in `ai-engine` yet; the card says so |
| | Render Design (Studio) | P2 | fills a Studio preset's slots from AI text and exports the slides; the PostGear-only combination |
| Logic | If / Else | P0 | condition builder (field, operator, value; all or any); two outputs |
| | Filter | P0 | stops the branch when false (the step is "skipped", not "failed") |
| | Delay | P0 | minutes, hours, days, or until a time; durable Temporal timer |
| | Manual Review | P0 | waits for Approve or Reject (signal); expires after 7 days |
| | Set Fields | P0 | build an object from tokens and literals |
| | Merge | P1 | waits for all incoming branches that will run; defined semantics, tested |
| Notify | In-App Notification | P0 | writes a `Notifications` row, so the existing outbox also emails it |
| | Slack | P0 | incoming webhook URL connection; message with tokens |
| | Microsoft Teams | P1 | Teams Workflows webhook URL connection (the old Office 365 connector webhooks are being retired: verify the current Microsoft guidance when building) |
| | Email | P1 | to listed addresses through the API's mail path |
| | WhatsApp | P2 | WhatsApp Cloud API; needs Meta business verification and approved message templates. Coming Soon until then |
| | Discord | P1 | webhook URL, cheap to add |
| Data | Google Sheets: Append Row | P1 | Google OAuth connection; pick spreadsheet and sheet, map columns to tokens |
| | Excel: Append Row | P2 | Microsoft Graph OAuth |
| | HTTP Request | P1 | through the SSRF-checked sender used by webhooks; https only; no private addresses |

## Data Tokens

- Syntax: `{{ trigger.post.url }}`, `{{ nodes.<key>.output.text }}`, `{{ run.startedAt }}`, plus a few pure filters: `{{ nodes.k3f9.output.text | truncate: 200 }}`, `upper`, `lower`, `date: "yyyy-MM-dd"`, `default: "n/a"`, `json`.
- Resolved by a small parser in `packages/automation`. **Never `eval`, `new Function` or a JS sandbox**: path lookup and the fixed filter list only.
- Validation knows each node's output shape, so a token pointing at a missing node, a node that is not upstream, or an unknown field is a validation issue before activation.

## Execution

### Where things run

- **`packages/automation`** (new, pure like `packages/scheduling`: no Temporal, Prisma or Node built-ins): node catalog metadata and config schemas, graph schema, `validateGraph()`, topological ordering, branch planning, token parse/resolve, condition evaluation, redaction rules. Imported by web, API and worker (including Temporal's workflow sandbox).
- **`packages/scheduling`** gains the contract: `AUTOMATION_RUN_WORKFLOW`, `automationRunWorkflowId(runId)`, `REVIEW_DECISION_SIGNAL`, schedule id helper, the run retry policy.
- **API** (`apps/api/src/modules/automations`): CRUD, validation, versions, activation, connections, runs read, test runs, review decisions, webhook trigger. It writes rows and starts, signals or cancels workflows. It never calls Slack or Sheets itself.
- **Worker**: `automationRunWorkflow` interprets the pinned graph version; one activity per node execution does the actual work.

### The run workflow

1. Load the pinned version and the trigger payload (activity).
2. Walk nodes in dependency order (not canvas position). Branches from If / Else run; the other branch's nodes are marked `skipped`. Independent branches may run in parallel (limit 4).
3. Each node runs as `executeNodeActivity({ runId, nodeKey, attempt })`, which resolves tokens against stored outputs, runs the node, and writes the `AutomationRunStep` row (input and output redacted and capped at 64 KB).
4. Delay uses Temporal `sleep`; Manual Review waits on `REVIEW_DECISION_SIGNAL` with a 7-day timeout; Cancel uses the existing `CANCEL_SIGNAL` name.
5. Retries follow the node's retry class: network and 429/5xx are retryable with backoff; 4xx, validation and "not connected" are not. Side-effect nodes pass an idempotency key `${runId}:${nodeKey}` to every provider that supports one, and check their own step row before acting, so a retried activity cannot post twice.
6. Final status written: `SUCCEEDED`, `FAILED` (first failure stops its branch; other branches finish), or `CANCELLED`.

Limits (constants first, plan entitlements later): 50 nodes per workflow, 200 step executions per run, run timeout 30 days (Manual Review waits included), 10 concurrent runs per workspace, 3 test runs per minute per user.

### Triggers

- **Post Published / Post Failed**: in `apps/worker/src/activities/publish.activities.ts`, right where `enqueueWebhookDeliveries` runs inside the same transaction, call a new `enqueueAutomationRuns(tx, { event, organizationId, payload })` that inserts `QUEUED` run rows for every `ACTIVE` automation whose pinned trigger matches (and whose filters pass), and start their workflows after commit, exactly like `startWebhookDeliveries`. A unique `(automationId, triggerEventId)` with `triggerEventId = "post.published:<rootPostId>"` makes a replayed publish activity a no-op.
- **Schedule**: activation creates a Temporal Schedule (`automation-schedule-<id>`); pause deletes it; editing and reactivating replaces it. The scheduled action's first activity creates the run row.
- **Manual / Test**: the API creates the run row and starts the workflow.
- **Webhook (P1)**: `POST /v1/automations/:id/hook` is `@Public()`, compares a secret header against a stored hash with `safeCompare`, caps the body at 256 KB, and is rate limited.
- The maintenance workflow prunes runs older than 30 days (steps cascade).

### Test runs vs live runs

- **Test** (`mode: TEST`): starts from the Manual trigger or from sample trigger data (the last real event of that type, or a built-in sample). Side-effect nodes run **dry**: they validate, resolve tokens and return "would send: ..." as output, without calling the outside world. A per-node "Send for real in tests" switch exists for side effects, with a confirmation.
- **Live**: only from an `ACTIVE` version.
- **`AUTOMATION_SIMULATION=true`** (new, refused when `NODE_ENV=production`, documented in `.env.example`): every external provider (Slack, Teams, Sheets, HTTP, WhatsApp) is replaced by a stand-in that logs the request to the worker console and returns a realistic success, and `[simulate:429]`-style markers in the text force failures, the same convention as `PUBLISH_SIMULATION`. AI nodes follow `AI_SIMULATION`, PostGear publishing follows `PUBLISH_SIMULATION`.

### Activation

- Activate runs full validation; any issue blocks it with the list (each issue links to its node).
- The confirm dialog states what the workflow can do in plain words: "This workflow will publish to 2 channels and send Slack messages without asking you." Workflows with Publish To Channel and no Manual Review before it need an extra tick: "I understand posts will go out automatically."
- Activation stores a new `AutomationVersion` and pins it. Later edits change only the draft; the live version keeps running until the user activates again ("Unpublished changes" badge). A run always uses the version it started with.

## Validation Rules (`validateGraph`)

Exactly one trigger. Every node reachable from the trigger. No cycles (loops are not supported in v1). Every edge connects compatible port types. Required config filled. Every token resolves to an upstream node's known output. Every required connection exists and is healthy. Side-effect nodes have their required inputs (channel and content for publish). No Coming Soon or unknown node types or versions. Node count within the limit. Each issue carries `{ nodeKey?, edgeId?, code, message }`; the web app shows them live, the API refuses activation on any of them.

## Database (use the `prisma-change` skill)

| Model | Key fields | Notes |
|---|---|---|
| `Automation` | name, status (`DRAFT`, `ACTIVE`, `PAUSED`), draftGraph Json, draftRevision Int, activeVersionId?, hasUnpublishedChanges, createdById, deletedAt | the editable draft |
| `AutomationVersion` | automationId, version Int, graph Json, triggerType, createdById | immutable; `@@unique([automationId, version])` |
| `AutomationRun` | automationId, versionId, organizationId, mode (`TEST`, `LIVE`), status (`QUEUED`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`), triggerType, triggerEventId?, triggerPayload Json, startedAt, finishedAt, error? | `@@unique([automationId, triggerEventId])` |
| `AutomationRunStep` | runId, nodeKey, nodeType, status, attempt, input Json, output Json, error?, startedAt, finishedAt | `@@unique([runId, nodeKey, attempt])` |
| `AutomationConnection` | provider, name, credentials (encrypted with `encrypt()` from `@postgear/db`), status, lastCheckedAt, lastError?, createdById | the graph stores only the connection id |
| `AutomationWebhookSecret` (P1) | automationId, secretHash, createdAt, revokedAt | |

**Secrets never live in graph JSON**, never go to the browser (connection responses show provider, name, status and a masked hint like `hooks.slack.com/...a9F2`), and never land in step input or output (redaction removes connection values and any key matching token, secret, password, authorization or api key).

## API Routes

| Route | Who |
|---|---|
| `GET/POST /automations`, `GET/PATCH/DELETE /automations/:id` (PATCH carries `draftRevision`; 409 when stale), `POST /automations/:id/duplicate` | members |
| `POST /automations/:id/validate` | members |
| `POST /automations/:id/activate`, `POST /automations/:id/pause` | `@Roles(Role.ADMIN)`, like webhooks |
| `POST /automations/:id/test-runs`, `POST /automations/:id/steps/:nodeKey/test` | members, throttled |
| `GET /automations/:id/runs`, `GET /automation-runs/:runId` (with steps), `POST /automation-runs/:runId/cancel` | members |
| `POST /automation-runs/:runId/reviews/:nodeKey` `{ decision, editedText? }` | members |
| `GET/POST/PATCH/DELETE /automation-connections`, `POST /automation-connections/:id/check`, `GET /automation-connections/oauth/:provider/start` and `/callback` | admins |
| `GET /automations/catalog` | members; the node catalog with each node's live state for this workspace |
| `POST /v1/automations/:id/hook` (P1) | public, secret header |

All bodies through the Zod pipe with `.strict()` schemas; the graph schema comes from `packages/automation`.

## Starter Templates

Shipped as graph JSON in `packages/automation/src/templates/`, opened as a new draft:

1. **Publishing Report**: Post Published → Set Fields (date, channel, url, preview) → Google Sheets Append Row → Slack.
2. **AI Weekly Post**: Schedule (Monday 09:00) → Generate Text → Generate Image → Manual Review → Create Draft (or Add To Queue) → In-App Notification.
3. **Failed Post Alert**: Post Failed → Filter (reason is not "rate limited") → Slack → In-App Notification.

Each template validates clean in a unit test once its connections are filled.

## Task Breakdown

Ordered checklist; each phase ends with `verify-change`.

1. **Engine core (pure)**: `packages/automation` with the catalog, graph schema, `validateGraph`, ordering and branch planning, tokens, conditions, redaction, starter templates. Heavy unit tests here; this is the part everything trusts.
2. **Data and API**: models and migration, `automations` module (CRUD, revisions, validate, versions, catalog), connections with encryption and masking, seed one draft workflow.
3. **Builder UI**: list page, rail entry, builder with `@xyflow/react` 12 (MIT; the same major TriForms uses, so its canvas lessons transfer), library, settings panel generated from schemas, token picker, live validation, autosave with revision guard.
4. **Run engine**: contract in `packages/scheduling`, `automationRunWorkflow` and `executeNodeActivity`, logic nodes, In-App Notification, Manual trigger, test runs (dry side effects), run inspector, Manual Review signal, cancel. Workflow tests with Temporal's test environment, as the existing `*.workflow.test.ts` files do.
5. **Real triggers and activation**: Post Published and Post Failed hooks in `publish.activities.ts`, Schedule through Temporal Schedules, activate and pause with versions and the confirmation dialog, Create Draft node.
6. **Integrations and AI**: `AUTOMATION_SIMULATION`, Slack, Generate Text (credits through the existing ledger, refunded on failure, like the AI module), then the P1 list (Teams, Discord, Email, HTTP Request, Google Sheets OAuth, Generate Image, Add To Queue, Publish To Channel).
7. **P2**: Render Design (Studio), Webhook trigger hardening, WhatsApp, Excel, Merge if not done, plan quotas through `entitlements.service.ts`, Retry From Here.

**Creating posts from the worker**: today post creation and validation live in `apps/api/src/modules/posts/posts.service.ts`, and the worker only publishes. Before building Create Draft, read that path and pick one: extract the row-building and validation (the rules already live in `social-core/composer`) into a shared place both API and worker can use, or have the worker write drafts through a narrow shared function. Do not duplicate the validation by hand. Record the choice in this document's deviation table at close-out.

## Definition Of Done

Evidence for each line is in the [completion checklist](../sprint-completion-checklists/sprint-10-completion-checklist.md#definition-of-done-evidence).

- [x] Workflows is in the rail; workflows can be created, renamed, saved, reopened, duplicated and deleted. **Verified live**: the e2e spec creates, renames and deletes; duplicate is covered by the service spec.
- [x] Nodes are added from a searchable library and by the "+" on a port; incompatible ports cannot connect. **Verified live** in Module 05's browser pass (add from "+", loop refused).
- [x] Node settings persist; tokens can be inserted from upstream outputs only; secrets never appear in graph JSON or any API response. **Verified live**: the security sweep found no secret in 18 answers, the stored rows or the logs (84 of 84 checks, 2026-10-31).
- [x] Validation lists every issue with a link to its node, and activation is impossible while any remain. **Verified live**: a deleted earlier step, a disconnected channel and a 51st step each answered 422 `activation_blocked`.
- [x] A test run shows per-node status on the canvas and in the inspector, and side-effect nodes do not reach the outside world in test mode unless explicitly switched on. **Verified live**: e2e test 4 (Slack Dry Run) and the 2026-10-31 run with Send For Real on three steps.
- [x] Post Published and Post Failed start runs for active workflows exactly once per event, even when the publish activity retries. **In simulation** (`PUBLISH_SIMULATION`): replay tests for both triggers, and e2e test 8 (one live run per failed post).
- [x] Schedule triggers fire on time in the workspace time zone and stop when paused. **Verified live** in Module 09 (a Daily schedule fired once, pause deleted it); each step keeps its own IANA zone (see Deviations).
- [x] Manual Review pauses a run until Approve or Reject, survives a worker restart, and expires after 7 days. **Verified live** through a worker restart (Module 07); expiry by a time-skipping workflow test.
- [x] Editing an active workflow does not change running or future runs until it is activated again. **Verified** by the run store test (live runs read their version) and live in Module 09 and e2e test 6.
- [x] Slack and In-App Notification work end to end under simulation; Generate Text charges and refunds credits correctly. **In simulation**: Slack retried once and succeeded, 7 credits charged on the run and the ledger (2026-10-31); refunds and out of credits by specs.
- [x] Coming Soon nodes are visible and honest, and cannot be added. Generate Video, Render Design, Excel and WhatsApp, each with its reason.
- [x] The three starter templates open, validate and test-run. **Verified live**: all five templates opened, validated with 0 errors once filled, and test-ran to Succeeded (2026-10-31).
- [x] `npm run validate` passes; an e2e spec covers build, connect, validate, test run and activate. 43 of 43 tasks; `e2e/workflows.spec.ts` 8 passed.
- [ ] Every line of the user stories' completion checklist (section 6) is ticked. **Partly**: every product line is met; Journeys A to D by hand and the 10-minute first activation need the owner.

## Deviations

What changed from this document while building, with the reason. The full list of decisions is the Decision Log in [`workflow-implementation-docs/README.md`](../sprint-10/workflow-implementation-docs/README.md#decision-log).

| Planned | Built | Why |
|---|---|---|
| Creating posts from the worker: a shared post writer, or a narrow shared function | **An internal step gateway in the API** (`POST /internal/automation/*`, token `AUTOMATION_INTERNAL_TOKEN`, every call bound to a live run and its step). Create Draft, Add To Queue, Schedule Post, Publish, Get Post, every AI step and Email call it; the worker never writes posts itself | `PostsService` needs channels, media, tags, Temporal and the provider manager; one copy of the validation, no extraction |
| Generate Text charges "through the existing ledger" | The ledger **stays in the API** (`CreditsService`); AI steps reach it through the gateway. New ledger type `generate_snippet` (2 credits) for Hashtags and Rewrite; the run stores `creditsUsed` | No ledger code copied into the worker |
| Exactly-once by step rows and idempotency keys | Plus an effect ledger (`AutomationEffect`) on the API side, keyed by run and step, so a retried gateway call returns the first result | A step can retry after the API acted but before the worker heard back |
| Three starter templates | **Five**: also Repurpose For X and Blog To Draft | Research additions, listed in the README |
| Failed Post Alert filters out "rate limited" | Filters out `retries_exhausted` ("Gave up after several tries (often a rate limit)") | `PublishFailureReason` has no rate-limited reason |
| Schedule fires "in the workspace time zone" | Each Schedule (and Add To Queue) step stores its own IANA time zone, defaulted from the browser | PostGear has no workspace time zone; `User.timezone` is an offset and cannot follow daylight saving |
| Teams incoming webhook | Teams Workflows app link with an Adaptive Card; old `webhook.office.com` links are refused | Office 365 Connectors were switched off in May 2026 |
| Google Sheets OAuth (sensitive scope) | `drive.file` scope with the Google Picker; a simulated Google account for local testing | No sensitive-scope verification needed |
| One 120 s step timeout | Timeout classes: fast 30 s, slow 5 minutes with a 30 s heartbeat (AI) | Model calls can take over a minute |
| A 51st step is refused | It saves, and validation reports `graph.too_many_nodes` (activation refused); the request schema refuses past 100 | A paste never loses work |
| Live run view | The SSE endpoint polls the database every 750 ms; the web falls back to polling every 1.5 s | No Redis pub/sub in `RedisService` |
| Test mode: side effects dry | In-App Notification and Create Draft act for real, marked "(Test)"; AI steps run and charge credits (Use Sample Text Instead avoids it) | They stay inside PostGear; the user needs to see real output |
| A second review answer returns the first decision | 409 `review_answered`; the card says someone answered first | Module 07's code; the UI covers it |
| Activation warning "within a minute" | "PostGear will set it up within 15 minutes." | The maintenance reconcile runs every 15 minutes |
| P2: Retry From Here, Webhook trigger hardening | **Built** (Modules 08 and 13) | Fitted in the modules that owned them |
| P2: Render Design, WhatsApp, Excel, plan quotas, Generate Video | Visible as Coming Soon steps (or not started); parked in [Module 15](../sprint-10/workflow-implementation-docs/module-15-p2-backlog.md) | Only when the user decides |

## Risks

- **Duplicate side effects** on retries: step-row checks plus idempotency keys; covered by a workflow test that replays an activity.
- **Workflow sandbox determinism**: the interpreter must not read clocks, randomness or Prisma; it only orders and calls activities. Keep `packages/automation` pure and test it inside the Temporal test environment too.
- **Provider policy changes** (Teams webhooks, WhatsApp templates, Google sensitive scopes needing app verification): every external node sits behind a provider interface like TriForms' `WorkflowActionProvider`, and each is behind simulation until a real key is tested.
- **Google Sheets OAuth** uses a sensitive scope: fine in testing mode with listed test users; production needs Google's verification, plan time for it.
- **Runaway cost**: AI nodes in a schedule can drain credits; the credits check runs per node, a run stops with a clear error when the balance is out, and a schedule faster than hourly is refused for workflows that contain AI nodes.
