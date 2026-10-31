# Sprint 10: Completion Checklist & Test Guide

Companion to [sprint-10-workflow-builder.md](../sprint-documents/sprint-10-workflow-builder.md),
built through the fifteen module documents in
[`docs/sprint-10/workflow-implementation-docs/`](../sprint-10/workflow-implementation-docs/README.md)
(their README holds the Progress table and the full Decision Log).
Status as of **2026-10-31**. Branch `sprint-10-workflow-builder`, cut from
`sprint-9-design-studio` at the Sprint 9b commit (`fcf8025`). Modules 01 to 09 are
committed and pushed (`842b23e`, `06c955f`, `6c44664`, `9b3aa00` and two docs commits);
Modules 10 to 14 are **uncommitted**. Not merged.

Sprint 10 started from nothing for workflows: no `packages/automation`, no
`automations` module, no Workflows entry in the rail, no automation tables, and a
worker that only published posts, refreshed tokens, synced analytics, delivered
outbound webhooks and ran maintenance. Post creation lived only in the API's
`PostsService`; AI credits lived only in the API's `CreditsService`.

The **[Pre-existing]** things worth not re-testing: the publisher and its
`[simulate:...]` markers (Sprint 5, markers moved to `lib/simulation-markers.ts`
here), the AI engine and credits ledger (Sprint 6), outbound webhook signing and
`sendWebhook` (Sprint 8, now a thin wrapper over `safe-http.ts`), notifications and
the bell (Sprint 8), the composer rules in `social-core/composer` (Sprints 3 to 5),
media storage (Sprint 4), Studio (Sprints 9 and 9b), and the design-system
components.

**13 of the 14 Definition of Done items are met, two of them only in simulation**
(publishing triggers; Slack and AI credits under `AUTOMATION_SIMULATION` and
`AI_SIMULATION`). The fourteenth (every line of the user stories' section 6) is met
for every product line and waits on your two hand checks. Every edge case in the user stories' section 5 has a test, every
security item in Module 14 has a spec and a live sweep (84 of 84 checks), the e2e
spec passes 8 of 8, and `npm run validate` passes 43 of 43 tasks.

What has not run for real: no message was sent to a real Slack, Teams or Discord
channel, no real Google account was connected, no email went through SMTP, no HTTP
Request left the machine, no post was published to a platform from a workflow, and
no OpenAI call was made (all under `AUTOMATION_SIMULATION`, `PUBLISH_SIMULATION`
and `AI_SIMULATION`). The two human checks (Journeys A to D by hand, a first-time
user activating a template in under 10 minutes) need you (§8).

---

## Prerequisites

```powershell
docker compose up -d
npm install                 # new: @xyflow/react 12 (canvas), @dagrejs/dagre (Tidy Up); @postgear/automation is a new workspace
npm run db:generate
npm run db:migrate          # five additive migrations, below
npm run db:seed             # adds the "Publishing Report" draft workflow on seed-demo-org
npm run generate:keys       # prints AUTOMATION_INTERNAL_TOKEN; put the same value in the root .env
```

Migrations, in order: `20261029120000_sprint10_workflow_builder`,
`20261029130000_sprint10_automation_connections`,
`20261029140000_sprint10_automation_run_options`,
`20261029160000_sprint10_runs_ports_and_schedules`,
`20261030193031_sprint10_gateway_and_webhook`. All additive.

| Variable | Default | Meaning |
|---|---|---|
| `AUTOMATION_SIMULATION` | `"false"` | Slack, Teams, Discord, Google Sheets and HTTP Request use stand-ins; `[simulate:...]` markers apply; refused in production. **Set `true` locally** |
| `AUTOMATION_INTERNAL_TOKEN` | unset | 64 hex characters shared by the API and the worker for the internal step gateway (§5.1). Optional in the API outside production (the gateway then refuses everything), required by the worker. **Set locally** |
| `GOOGLE_AUTOMATION_CLIENT_ID`, `GOOGLE_AUTOMATION_CLIENT_SECRET` | empty | The Google OAuth client for Sheets; empty falls back to the sign-in `GOOGLE_CLIENT_ID` and `_SECRET`; the placeholders `google-client-id` and `google-client-secret` count as not set. **Not set locally** |
| `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_APP_ID` | empty | The Google Picker (choose a spreadsheet). **Not set locally** |
| `PUBLISH_SIMULATION`, `AI_SIMULATION`, `WEBHOOK_ALLOW_PRIVATE_URLS` | as before | Now also read by workflow steps. **All `true` locally** |

Restart the API and the worker after changing any of them. The full walk-through is
[local testing guide §5m and §5n](../local-testing-guide.md).

---

## 1. The engine: `packages/automation` (Modules 01, 02, 10, 13)

| # | Item | Status |
|---|---|---|
| 1.1 | **Graph and catalog** (`src/graph`, `src/catalog`): Zod graph schema (steps, lines, notes; caps at twice the limits), 31 step types in triggers, logic, PostGear, AI, notify and data, 27 runnable (`catalog/executable.ts`), 4 Coming Soon (Generate Video, Render Design, Excel, WhatsApp) | ✅ [New] |
| 1.2 | **`validateGraph`** (`src/validate`): one trigger, loops, ports, required fields, tokens from earlier steps only, channels, connections, secrets, limits (50 steps, 120 lines), AI schedule frequency; every issue has a code, a step and a field | ✅ [New] |
| 1.3 | **Planning** (`src/plan`): `planNext` orders steps, derives skips from fired ports, Merge after a failed branch | ✅ [New] |
| 1.4 | **Tokens, conditions, schedules, redaction, samples** (`src/tokens`, `src/conditions`, `src/schedule`, `src/redact`, `src/samples`): the 11 filters, no `eval` (`purity.test.ts`), IANA zones without a date library | ✅ [New] |
| 1.5 | **Templates** (`src/templates`): Publishing Report, AI Weekly Post, Failed Post Alert, Repurpose For X, Blog To Draft | ✅ [New]; all five test-run live (§DoD) |
| 1.6 | **`FormSpec`** (`catalog/form.ts`): the settings panel's field kinds, including Module 10 to 13's media, provider settings, spreadsheet, sheet tab, sheet columns, webhook link, time zone, and message previews | ✅ [New] |
| 1.7 | **`nextFreeSlot`** (`src/queue`): Add To Queue's next posting time, pooled across channels, DST safe, 366 days searched | ✅ [New] |
| 1.8 | **`MediaRef`** (`src/media`): media references between steps; the sample image is dropped by posting steps | ✅ [New] |

```powershell
npm test --workspace=@postgear/automation
```

Expect **696 passed** (26 suites): schema, catalog, validation, planning, tokens,
conditions, schedules, redaction, templates, forms, next free slot, purity.

## 2. Data model and the Automations API (Modules 03, 09)

| # | Item | Status |
|---|---|---|
| 2.1 | **Tables**: `Automation`, `AutomationVersion`, `AutomationRun`, `AutomationRunStep`, `AutomationConnection`, `AutomationEffect`, `AutomationWebhookSecret`; `CreationMethod.AUTOMATION`. Notes in `packages/db/prisma/SCHEMA_NOTES.md` (Sprint 10 additions) | ✅ [New] |
| 2.2 | **`apps/api/src/modules/automations`**: list, search, create (blank or template), get, save with a revision check (409), duplicate, delete, validate, catalog, templates, pins | ✅ [New] |
| 2.3 | **Activation and versions**: activate (admins; `confirm_automatic_posting`, `activation_blocked`, `schedule_too_frequent`), pause, discard, versions, version preview, restore as draft, Run Now | ✅ [New] |
| 2.4 | **Saving refuses** schema violations, unknown types and secret-looking values (422 `secret_in_step`); an unknown key inside a step's settings saves as a `node.config_invalid` problem that blocks testing and activation | ✅ [New] |
| 2.5 | **Roles**: every Workflows route read through the real `RolesGuard` (`automations.routes.spec.ts`); members are refused exactly on activate, pause, connection writes and checks, OAuth start and webhook secret | ✅ [New] |

```powershell
npm test --workspace=@postgear/api -- automations
```

Expect **349 passed** (27 suites) across automations, connections, runs, gateway and
webhook specs.

## 3. Connections (Modules 04, 12, 13)

| # | Item | Status |
|---|---|---|
| 3.1 | **Connections page** `/[orgId]/workflows/connections` (Settings, Connections redirects there): honest states (Connected, Saved Not Checked, Needs Reconnect, Simulated), Check Connection, rename, delete, "Used by N workflows" | ✅ [New] |
| 3.2 | **Webhook apps**: Slack, Teams (Workflows app links only; old `webhook.office.com` links refused with one sentence shared by API and worker), Discord; secret headers for HTTP Request. Values stored as `v1:` ciphertext, shown masked | ✅ [New]; **no real send** |
| 3.3 | **Google** (`google-oauth.plugin.ts`, `google-sheets.service.ts`, `google-http.ts`): `drive.file` scope, Picker token, create a spreadsheet, tabs and columns; single-use OAuth state in Redis; a simulated Google account under `AUTOMATION_SIMULATION` | ✅ [New]; **real Google not run** (no client set) |
| 3.4 | **Connect from inside the step**: the picker in the step panel; OAuth returns to `/workflows/<id>?step=<key>` | ✅ [New] |

## 4. The run engine on Temporal (Modules 07, 09)

| # | Item | Status |
|---|---|---|
| 4.1 | **Contract** `packages/scheduling/src/automations.ts`: workflow and signal names, ids (`automation-run:<id>`, `automation-schedule:<id>`), timeouts (fast 30 s, slow 5 minutes with heartbeats), `AUTOMATION_RUN_RETENTION_DAYS` 30 | ✅ [New] |
| 4.2 | **`automationRunWorkflow`** and its activities: steps in order, Delay, Manual Review (7 days), cancel, Retry From Here seeds, step rows per attempt ("Succeeded after 2 attempts") | ✅ [New] |
| 4.3 | **Triggers**: Post Published and Post Failed enqueued inside the publish transactions (`lib/automation-enqueue.ts`, dedupe keys), Schedules on Temporal Schedules (overlap SKIP, 60 s catch-up, deleted on pause), Manual with inputs, Webhook (§5.5) | ✅ [New]; publish triggers **in simulation** |
| 4.4 | **Alerts and pruning**: grouped failure alerts (one an hour), auto-pause after 5 failed live runs, run pruning after 30 days in maintenance | ✅ [New] |

```powershell
npm test --workspace=@postgear/worker
```

Expect **463 passed** (36 suites), including the run workflow on Temporal's test
server (replay, 7-day review expiry with time skipping), executors, providers,
`safe-http`, enqueue and schedules.

## 5. Steps that act: the gateway and the executors (Modules 10 to 13)

| # | Item | Status |
|---|---|---|
| 5.1 | **Internal step gateway** (`automations/gateway/`): `POST /internal/automation/*`, `InternalTokenGuard`, `GatewayBindingService.bind` (run Running or Waiting, step in its graph with that type), effect ledger `AutomationEffect` (Done returns the first result, fresh Pending 409, stale or failed taken over), answers `{ output, credits }`. Worker side `apps/worker/src/automation/gateway-client.ts` | ✅ [New] |
| 5.2 | **PostGear steps**: Create Draft (real in tests, "Draft created from a test run."), Add To Queue (next free slot), Schedule Post, Publish To Channel (one card per platform), Get Post; post group is a UUID v5 of run and step so a retry lands on the same post | ✅ [New]; publishing **in simulation** |
| 5.3 | **AI steps**: Generate Text (5), Generate Image (10, into Media), Generate Hashtags (2), Rewrite In Brand Voice (2); charged before the model runs, refunded on failure, credits on the run and on each AI step's output; out of credits stops the run with the reset date | ✅ [New]; **in simulation** (`AI_SIMULATION`) |
| 5.4 | **Notify steps**: In-App, Slack (escaped, `ok` only counts), Teams (Adaptive Card), Discord (`allowed_mentions` off), Email (10 recipients a step, 200 a day); Retry-After honoured; 401, 403, 404, 410 and dead-link codes mark Needs Reconnect | ✅ [New]; **in simulation**; Email printed to the API console |
| 5.5 | **Data and webhook**: Google Sheets Append Row (`RAW`, column mapping), HTTP Request (`safe-http`: pinned DNS, private addresses refused, redirects returned not followed, dry run with the body redacted), Webhook trigger (`pgwh_` secret hashed, 256 KB, 60 a minute, Idempotency-Key, saved sample used by tests and offered in Insert Data) | ✅ [New]; Sheets and HTTP **in simulation** |

### 5.6: why a gateway and not a shared post writer

The sprint document asked to pick between extracting post creation into a shared
place and a narrow shared function. Reading `posts.service.ts` showed it needs
channels, media, tags, Temporal and the provider manager. Moving that into the worker
would have copied half the API. The gateway keeps one copy of every rule: the worker
asks, the API does it. The same holds for the AI credits ledger and the mail service.
The cost is one more hop and a token to manage, both covered by specs (§7.1).

### 5.7: live check (2026-10-31)

A test run of Manual, Generate Text, Generate Hashtags, Create Draft, Add To Queue,
Slack with `[simulate:429x1]`, Google Sheets, HTTP Request and In-App, with Slack,
Sheets and Add To Queue sent for real: every step finished (Slack on attempt 2,
Sheets row 2 simulated, HTTP Request Dry Run), a real draft and a real queued post
(next free slot) were made, and the run and the credits ledger both moved by exactly
7. It found two bugs, fixed the same day: the gateway refused the seed workspace's
id because it is not a uuid, and the simulated model turned "Write about X" into
"bout X".

## 6. Screens (Modules 05, 06, 08, 09 and the web parts of 10 to 13)

| # | Item | Status |
|---|---|---|
| 6.1 | **Workflows list** `/[orgId]/workflows`: status, last run, search, filter, row menu (Run Now, Activate, Duplicate, Delete with a red confirm), template row | ✅ [New] |
| 6.2 | **Builder** `/[orgId]/workflows/[automationId]` on `@xyflow/react` 12: Add A Trigger, searchable library, "+" on ports, fitting ports highlighted, loops refused, minimap, grid, multi-select, undo and redo, notes, Tidy Up, copy and paste, Ctrl+K palette, shortcuts sheet, autosave with honest status and conflict warning, Finish Setup | ✅ [New] |
| 6.3 | **Step panel**: Setup, Configure and Test tabs, fields generated from `FormSpec`, Insert Data chips, condition builder, Expanded view (Input, Settings, Output), pinned data, issues popover, message previews, AI cost line and Use Sample Text Instead, Google connect dialog, Simulated sticker | ✅ [New] |
| 6.4 | **Runs**: live paint on the canvas over SSE (1.5 s polling fallback), run bar, Runs tab, run detail with per-step input and output, Copy Details, Cancel, Retry From Here, Debug In Editor, review card with Edit Then Approve, credits per run and per AI step | ✅ [New] |
| 6.5 | **Activation**: dialog with the plain-words sentence and the automatic-posting tick, Active vN badge, Unpublished Changes and Discard, Versions drawer with preview and Restore, member switch disabled with the reason | ✅ [New] |

```powershell
npx jest --config apps/web/jest.config.js apps/web/src/components/workflows apps/web/src/lib/title-case.test.ts
```

Expect **530 passed** (52 suites plus the title case test). The whole web workspace:
1321 passed (105 suites).

## 7. Hardening (Module 14)

| # | Item | Status |
|---|---|---|
| 7.1 | **Security specs**: `automations.security.spec.ts` (Slack, Teams, Discord, HTTP with two secret headers and Google tokens; 18 read endpoints including the events stream; ciphertext at rest), `automations.routes.spec.ts` (roles and public routes), tenancy 404 on every route, webhook 401, 413, 409 and throttling, gateway token and binding | ✅ [New] |
| 7.2 | **Live security sweep** (`live-security-sweep.mjs`, scratchpad): **84 of 84** checks against the running API on 2026-10-31: no secret in 18 answers, the stored step rows or the logs; 31 routes with another workspace's ids answer 404; member 403 on 8 routes; webhook and gateway refusals | ✅ [New] |
| 7.3 | **Edge cases** (user stories section 5): every row has a test, listed in the Definition of Done table below and in the Module 14 doc | ✅ [New]; two rows also need a manual check (§8) |
| 7.4 | **E2E** `e2e/workflows.spec.ts` (+ `e2e/helpers/workflows.ts`): Failed Post Alert from the template, connect Slack by paste, Insert Data, test on the sample (Slack Dry Run), activate (Active v1), Unpublished Changes and Discard, member disabled with the reason, a `[simulate:400]` publish starts a live run that succeeds. **8 passed** on four runs (27 to 33 s), the last on the final code | ✅ [New] |
| 7.5 | **Performance**: `validateGraph` on 50 steps median **1.19 ms** (p95 2.55 ms; target 20); Tidy Up median **28.5 ms** (target 300); runs list with 500 runs uses `AutomationRun_automationId_createdAt_idx`, **0.33 ms** first page; step cards now keep their node objects when unchanged (`reuseUnchanged`) so typing repaints one card | ✅ [New]; not profiled in the browser |
| 7.6 | **Accessibility and themes**: keyboard only (Tab to a step, Enter opens, Escape closes and returns focus), screen-reader words "step", "note" and "line" instead of React Flow's "node" and "edge"; Lilac, dark and 390 px screenshots `s10-40` to `s10-54`; no jargon in the web copy | ✅ [New]; see Known gaps for what was seen and left |

```powershell
npm run dev:api:e2e          # in its own terminal
npm run test:e2e -- e2e/workflows.spec.ts
```

---

## Definition of Done: evidence

| DoD item | Evidence |
|---|---|
| Workflows is in the rail; workflows can be created, renamed, saved, reopened, duplicated and deleted. | §6.1, §6.2; e2e test 1 creates and renames, cleanup deletes; duplicate in `automations.service.spec`; Module 05 Playwright pass |
| Nodes are added from a searchable library and by the "+" on a port; incompatible ports cannot connect. | §6.2; Module 05 web tests and browser pass (add from "+", loop refused) |
| Node settings persist; tokens can be inserted from upstream outputs only; secrets never appear in graph JSON or any API response. | §1.2, §2.4, §7.1, §7.2: the sweep found no secret in any answer, stored row or log |
| Validation lists every issue with a link to its node, and activation is impossible while any remain. | §1.2, §6.3; `automations.service.spec` "edge cases (Module 14)": deleted earlier step, disconnected channel and a 51st step all refuse activation; live 422 `activation_blocked` |
| A test run shows per-node status on the canvas and in the inspector, and side-effect nodes do not reach the outside world in test mode unless explicitly switched on. | §6.4; e2e test 4 (every badge final, Slack Dry Run); live check §5.7 with Send For Real on three steps |
| Post Published and Post Failed start runs for active workflows exactly once per event, even when the publish activity retries. | **In simulation.** `publish.automation.test.ts` (a replayed activity starts no second run, both triggers); e2e test 8 (a failed publish starts one live run) |
| Schedule triggers fire on time in the workspace time zone and stop when paused. | Each Schedule step keeps its own IANA zone (Deviations). Module 09 live: a Daily schedule two minutes ahead fired once, pause deleted it; `automation-schedules.test.ts` "pause then resume" (no catch-up) |
| Manual Review pauses a run until Approve or Reject, survives a worker restart, and expires after 7 days. | Module 07 live: a review stayed Waiting through a worker restart and finished after Approve; `automation-run.workflow.test.ts` "expires the run after 7 days without an answer" (time skipping) |
| Editing an active workflow does not change running or future runs until it is activated again. | `prisma-run-store.test.ts` (a live run reads its version, never the draft); Module 09 live and e2e test 6 (Unpublished Changes, Discard) |
| Slack and In-App Notification work end to end under simulation; Generate Text charges and refunds credits correctly. | **In simulation.** §5.7 (Slack retried once and succeeded, In-App sent, 7 credits charged); refunds in the API gateway specs and `executors/ai.test.ts`; out of credits in `automation-run.ai-credits.workflow.test.ts` |
| Coming Soon nodes are visible and honest, and cannot be added. | §1.1: Generate Video, Render Design, Excel, WhatsApp with a reason each; refused by the library and by validation |
| The three starter templates open, validate and test-run. | Five templates. Live on 2026-10-31 (`templates-check.mjs`): each opened from its template, validated with **0 errors** once its connections and channels were filled, and test-ran to **Succeeded** (AI Weekly Post 15 credits and Repurpose For X 2, both reviews approved through the API; Blog To Draft 5) |
| `npm run validate` passes; an e2e spec covers build, connect, validate, test run and activate. | 43 of 43 tasks on 2026-10-31; §7.4 |
| Every line of the user stories' completion checklist (section 6) is ticked. | **Partly.** Every product line is met (table below); the two human checks are yours (§8) |

### User stories, section 6

| Line | Status |
|---|---|
| WF-1.1 to 1.4: rail and mobile menu, templates with markers, list with status, search, filter, row menu, red delete, create, rename, duplicate, delete | ✅ [New] (§6.1) |
| WF-2.1 to 2.7: one trigger, library with badges, "+" with a filtered library, ports and loops, zoom, pan, fit, minimap, grid, multi-select, undo and redo, autosave with conflicts | ✅ [New] (§6.2) |
| WF-3.1 to 3.4: settings panel, Insert Data from earlier steps with broken-chip warnings, All Of and Any Of, Test Step | ✅ [New] (§6.3) |
| WF-4.1 to 4.3: connect inside the step, Connections page, admins only | ✅ [New] (§3); Google sign-in **not run for real** |
| WF-5.1 to 5.3: live markers and issues list, Test Workflow with dry runs and per-step send for real, run drawer without secrets with retries | ✅ [New] (§6.4, §7.2) |
| WF-6.1 to 6.4: activate only with no issues, pause and resume without catch-up, Unpublished Changes and Discard, admins only | ✅ [New] (§6.5, e2e 5 to 7) |
| WF-7.1 to 7.5: Post Published, Post Failed, Schedule, Manual with Run Now, Webhook with secret | ✅ [New]; publish triggers **in simulation** |
| WF-8.1, 8.2: Create Draft with composer rules, Add To Queue and Publish To Channel never twice | ✅ [New]; publish **in simulation** |
| WF-9.1 to 9.3: Generate Text with charge, refund and out-of-credits stop, Generate Image into Media, Generate Video Coming Soon | ✅ [New]; **in simulation** |
| WF-10.1: review notification, Approve, Reject, edit before approve, 7 days, survives restarts | ✅ [New] |
| WF-11.1 to 11.6: In-App, Slack, Teams, Discord, Email, Sheets, HTTP Request, WhatsApp and Excel Coming Soon | ✅ [New]; outside apps **in simulation** |
| WF-12.1 to 12.3: grouped failure notifications, Cancel and Retry From Here, 30-day history | ✅ [New] |
| Journeys A to D walked by hand | **Yours** (§8) |
| A first-time user activates a template in under 10 minutes | **Yours** (§8) |
| Every edge case in section 5 behaves as written | ✅ [New] (§7.3) |
| Every UX principle in section 4 on every Workflows screen | **Partly**: checked in the browser pass on the list, builder, panel, Runs and Connections; the small issues seen are in Known gaps |
| No jargon in the UI copy | ✅ [New] (§7.6); "JSON" stays in the HTTP Request's answer option and the As JSON format, where it is the thing itself |
| Light, dark and Lilac themes, and phone width | ✅ [New] (§7.6) |

---

## Deviations from the sprint document, and why

The full table is in the sprint document's
[Deviations](../sprint-documents/sprint-10-workflow-builder.md#deviations) section.
The ones that change how things work:

| The document said | What shipped | Why |
|---|---|---|
| Create posts from the worker through shared code | An internal step gateway in the API (§5.6) | One copy of the post, credit and mail rules |
| Generate Text through the existing ledger | The ledger stays in the API, reached through the gateway; new `generate_snippet` (2 credits) | Nothing copied into the worker |
| Three templates | Five | Research additions |
| Schedule in the workspace time zone | Each step stores its own IANA zone | PostGear has no workspace zone |
| A 51st step is refused | It saves; validation blocks testing and activation | A paste never loses work |
| Failed Post Alert filters "rate limited" | Filters `retries_exhausted` | No rate-limited reason exists |

## Review findings fixed before closing (2026-10-31)

| Finding | Fix |
|---|---|
| The gateway refused the seed workspace (`seed-demo-org` is not a uuid), so every AI, posting and Email step failed locally | `gateway.schema.ts`: `organizationId` is shape-checked only; `bind` does the real check |
| The simulated model wrote "bout X" for "Write about X" | `simulated-model-client.ts`: each optional word ends at a word boundary; 3 expectations added |
| A secret header saved as `Bearer <token>` was hidden only as a whole, so an app echoing the bare token would show it | `run-views.ts`: the token after Bearer, Basic, Token, Bot, Digest or ApiKey is a secret on its own |
| A run's error sentence and `lastRunError` skipped the API's second redaction | `run-views.ts` `hideText`, `automations.service.ts` `hideRunError` |
| The API's old-Teams-link sentence differed from the worker's | One sentence in both |
| Typing in one field repainted every step card | `flow-model.ts` `reuseUnchanged` |
| Escape dropped focus to the page; React Flow announced "node" and "edge"; on a phone the panel's Close was covered and Back To Runs collapsed | `builder-page.tsx`, `flow-model.ts` aria labels, `workflow-canvas.css`, `run-detail.tsx` |
| The webhook's saved sample was not offered in Insert Data | `panel-view-model.ts` `receivedWebhookData`, `insert-data.tsx` `withSampleFields` |

## Known gaps

1. **Nothing reached a real outside app.** Slack, Teams, Discord, Google Sheets,
   HTTP Request and SMTP ran only as stand-ins; publishing and AI only in
   simulation. Closing it is §8 steps 3 to 5.
2. **A published post can go out up to 15 minutes late** if the API stops between
   writing the post and signalling the publisher; the maintenance reconcile picks
   it up. Signalling again could publish rows already in Error twice.
3. **A replayed publish activity can show a second "Post published" bell.** Sprint 8
   code (`publish.activities.ts` `recordPublished`); runs and webhooks are deduped,
   that notification is not. Rare: only after a retry of an activity that already
   committed.
4. **Deep pages of the Runs list** walk earlier rows (Prisma's cursor is an OR);
   fine at 500 runs. An index on `(automationId, status, createdAt)` would help the
   status filter at scale.
5. **Seen in the browser, left as they are:** the Connections table scrolls
   sideways inside its card at phone width; the Runs filter buttons wrap at desktop
   width; the run canvas is low contrast in dark mode with many steps; React Flow's
   small credit shows on every canvas.
6. **Not run live:** the webhook sample in Insert Data (unit tested), a worker
   restart during a Delay (Module 07 checked it during a review), a step
   card profile in the browser, and the canvas and run paint with reduced motion
   turned on.
7. **Module 15 is parked** (Render Design, Describe Your Workflow, WhatsApp, Excel,
   plan quotas, version compare, presence, list view, Slack approvals, error
   workflow, loops): nothing there is built until you pick items.

## 8. What remains for you

1. **Walk Journeys A to D** from the user stories by hand, start to finish, and time
   a first activation from a template (target under 10 minutes). Tell me what felt
   slow or confusing.
2. **Two manual edge checks** ([local testing guide §5n](../local-testing-guide.md)):
   stop and restart `npm run dev:worker` while a run waits on a Delay and a review,
   then Approve; and pause a Daily schedule before its time, resume after it, and
   see that the missed time never runs.
3. **One real Slack message**: paste a real incoming webhook link, set
   `AUTOMATION_SIMULATION="false"`, restart, and test with Send For Real on.
4. **Google**: set up the testing-mode OAuth client (§5m), connect your account and
   append one row.
5. **Before production**: set `AUTOMATION_INTERNAL_TOKEN` on the API and the worker
   hosts, and decide on Google's app verification if Sheets should work for people
   outside the test-user list.
6. **Decide on Module 15** items, if any.
7. **Commit** Modules 10 to 14 (nothing is committed yet).

---

## Files changed in this pass

Modules 01 to 09 are in the commits listed at the top. Modules 10 to 14
(uncommitted):

**Added: database**
- `packages/db/prisma/migrations/20261030193031_sprint10_gateway_and_webhook/`

**Added: engine package**
- `packages/automation/src/{queue,media}/` (+ tests)

**Added: API**
- `apps/api/src/modules/automations/gateway/` (guard, binding, effect ledger, posts, AI and email routes and services, + specs)
- `apps/api/src/modules/automations/webhook/` (hook controller, secrets, throttler, + specs)
- `apps/api/src/modules/automations/connections/google/` (OAuth plugin, Sheets service, HTTP client, + specs)
- `apps/api/src/modules/automations/{automations.security,automations.routes}.spec.ts`

**Added: worker**
- `apps/worker/src/automation/gateway-client.ts`, `apps/worker/src/lib/safe-http.ts`
- `apps/worker/src/automation/executors/{posts,ai,notify,data}.ts`
- `apps/worker/src/automation/providers/` Slack, Teams, Discord, Google Sheets, HTTP (+ tests)
- `apps/worker/src/automation/prisma-run-store.test.ts`

**Added: e2e**
- `e2e/workflows.spec.ts`, `e2e/helpers/workflows.ts`

**Modified**
- `packages/automation`: catalog (all steps runnable but Coming Soon), `form.ts` field kinds and previews, samples, `resolve.ts` JSON mode, limits
- `packages/ai-engine`: `generateHashtags`, `rewriteInVoice`, research option, simulated model subject fix
- `packages/db`: schema, seed ledger list, SCHEMA_NOTES
- `apps/api`: env (`AUTOMATION_INTERNAL_TOKEN`, Google keys), AI credits (`generate_snippet`), `PostsService.create` options, connections (Google, simulated accounts, Teams sentence), runs (credits, redaction)
- `apps/worker`: env, engine credits, run store (`addRunCredits`, `loadChannels`, `saveConnectionCredentials`), activities, alerts (credit reset date), `webhook-sender.ts` on `safe-http`, maintenance (effect pruning)
- `apps/web`: workflows fields, panel, canvas, runs, connections, `lib/workflows-api.ts`, `types/workflows.ts`, `types/ai.ts`
- `.env.example`, `scripts/generate-keys.ts`, `docs/local-testing-guide.md` (§5m, §5n), the sprint document (Deviations, DoD), the module docs and README
