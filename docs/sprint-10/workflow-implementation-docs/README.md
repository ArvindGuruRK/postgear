# Sprint 10: Workflow Builder, Implementation Modules

This folder splits Sprint 10 (Workflow Builder) into **15 modules plus a UX blueprint**. Build them in order, **one module per Claude Code session**. Each module builds, verifies and stops so you can check it by hand before the next one starts.

| Document | What it decides |
|---|---|
| [`../../sprint-documents/sprint-10-workflow-builder.md`](../../sprint-documents/sprint-10-workflow-builder.md) | **How** to build: architecture, engine, data model, API routes, catalog |
| [`../../new-modules/user-stories-workflow-builder.md`](../../new-modules/user-stories-workflow-builder.md) | **What the user experiences**: journeys, acceptance criteria, UX rules, completion checklist |
| [`00-ux-blueprint.md`](00-ux-blueprint.md) | **How it looks and feels**: the n8n, Make and Zapier patterns adopted, in PostGear's style |
| `module-NN-*.md` (this folder) | **What to do in each session**: scope, design details, tasks, tests, done when, hand check |

If two documents disagree: user stories win on behaviour, the UX blueprint wins on look and interaction, the sprint doc wins on architecture. Record every such call in the decision log below.

---

## The North Star

> A builder that feels like n8n, Make and Zapier, the tools real people already know, wearing PostGear's neobrutalist look: visually clear, alive while it runs, safe by default, and never asking a beginner to read code.

**Reference products** (UX ideas only, never code; n8n is under the Sustainable Use Licence):

- **n8n**: the left-to-right canvas, the node picker on "+", the node detail view with Input, Settings and Output, pinned test data, the executions list, Debug In Editor, per-step On Error.
- **Zapier**: the beginner path: Setup, Configure, Test tabs per step, Insert Data with sample values, Human In The Loop approvals, versions with rollback, Replay from the failed step.
- **Make**: the delight: data flowing along the lines while a run plays, a result bubble on every step, filters on the connection line, Auto-align, notes on steps.
- **TriForms** (the user's own app): **engine lessons only** (stable keys, immutable versions, one token resolver, no stale closures, its known bugs). Do not copy its UI.

---

## Module Map

| # | Module | Size | Depends on | Stories | Status |
|---|---|---|---|---|---|
| 00 | [UX Blueprint](00-ux-blueprint.md) (read, do not build) | - | - | all UI stories | Reference |
| 01 | [Engine Core: Graph And Node Catalog](module-01-engine-graph-and-catalog.md) | L | - | WF-2.x foundations | Done |
| 02 | [Engine Data: Tokens, Conditions, Schedules, Templates](module-02-engine-data-tokens-conditions.md) | L | 01 | WF-3.2, 3.3, 7.3 | Done |
| 03 | [Data Model And Automations API](module-03-data-model-and-api.md) | M | 01, 02 | WF-1.3, 1.4, 2.7 | Done |
| 04 | [Connections](module-04-connections.md) | M | 03 | WF-4.1, 4.2, 4.3 | Not started |
| 05 | [List, Templates And The Canvas](module-05-list-templates-and-canvas.md) | XL | 03 | WF-1.x, 2.x | Not started |
| 06 | [Step Panel, Data Mapping And Live Checks](module-06-step-panel-and-data-mapping.md) | XL | 04, 05 | WF-3.x, 5.1 | Not started |
| 07 | [Run Engine On Temporal](module-07-run-engine.md) | XL | 03 | WF-5.2, 10.1, 12.2 | Not started |
| 08 | [Test, Live Run View, Run History And Review](module-08-test-runs-history-and-review.md) | L | 06, 07 | WF-3.4, 5.2, 5.3, 10.1 | Not started |
| 09 | [Triggers, Activation And Versions](module-09-triggers-activation-versions.md) | L | 08 | WF-6.x, 7.1 to 7.4, 12.1, 12.3 | Not started |
| 10 | [PostGear And Social Steps](module-10-postgear-and-social-steps.md) | M | 09 | WF-8.1, 8.2 | Not started |
| 11 | [AI Steps And Credits](module-11-ai-steps-and-credits.md) | M | 10 (gateway) | WF-9.x | Not started |
| 12 | [Notify Steps And Simulation](module-12-notify-steps-and-simulation.md) | M | 10 (gateway, for Email) | WF-11.1 to 11.3 | Not started |
| 13 | [Google Sheets, HTTP Request And Webhook Trigger](module-13-sheets-http-and-webhook.md) | L | 12 | WF-7.5, 11.4, 11.5 | Not started |
| 14 | [Hardening, E2E And Sprint Close-Out](module-14-hardening-e2e-closeout.md) | M | 01 to 13 | section 6 checklist | Not started |
| 15 | [P2 Backlog (only when you decide)](module-15-p2-backlog.md) | - | 14 | WF-11.6 and extras | Parked |

```
01 ─> 02 ─> 03 ─┬─> 04 ──────────┐
                ├─> 05 ──────────┴─> 06 ─┐
                └─> 07 ──────────────────┴─> 08 ─> 09 ─> 10 ─┬─> 11
                                                             └─> 12 ─> 13 ─> 14 ─> (15)
```

05 and 07 are independent of each other, and so are 11 and 12 (both need Module 10's internal gateway). Keep the numbered order anyway unless you want to run two sessions on separate worktrees.

Size guide: M fits one session easily, L fills one, XL may need a second session ("continue Module NN"). Each module lists its tasks as checkboxes so a second session can pick up exactly where the first stopped.

---

## How To Run A Module

1. Docker services up (`docker compose up -d`), on branch `sprint-10-workflow-builder`, working tree clean (commit the previous module first; see below).
2. Open a fresh Claude Code session in the repo and paste the **Kickstart Prompt** below with the module number filled in.
3. When it finishes: do the module's **Hand Check**, then ask it to commit (`Module NN: <title>` as the subject line).
4. The session updates the **Progress** table and the **Decision Log** in this README before it stops. That is the memory the next session reads.

### Kickstart Prompt (copy, set the module number, paste)

```text
We are building Sprint 10, the Workflow Builder, module by module.

Read, in this order:
1. CLAUDE.md
2. docs/sprint-10/workflow-implementation-docs/README.md (rules, progress, decision log)
3. docs/sprint-10/workflow-implementation-docs/module-NN-*.md (this session's module, in full)
4. Whatever that module's "Read First" section lists (the UX blueprint sections, the sprint doc sections, the user stories, the code files).

We are doing Module NN only. Before writing code:
- Check the Progress table and the Decision Log, and confirm the modules this one depends on are Done. If one is not, stop and tell me.
- Check the branch is sprint-10-workflow-builder (Module 01 creates it from sprint-9-design-studio) and the tree is clean.
- Give me a short plan (10 lines or fewer): what you will build, in what order, and anything in the module doc you think is wrong or risky. Then start building without waiting, unless something blocks you.

While building:
- Follow the module's Design and Tasks. Tick each task checkbox in the module doc as you finish it.
- Use the project skills the module names (prisma-change, new-api-module, new-page, temporal-workflow, verify-change).
- UX follows docs/sprint-10/workflow-implementation-docs/00-ux-blueprint.md (n8n, Make and Zapier patterns in PostGear's look). Never copy n8n or Postiz code.
- If the module doc and the code disagree, trust the code, make the smallest sensible choice, and write it in the Decision Log.

Before you stop:
- Run the verify-change skill for the touched workspaces.
- Update the module's Status line, the Progress table and the Decision Log in the README.
- Tell me what to check by hand (the module's Hand Check), what is not done and why, and suggest the commit message. Do not commit or push unless I ask.
```

To continue an XL module in a second session, use the same prompt and add: `Module NN is partly done. Its unticked task boxes are what is left.`

---

## Rules For Every Module

**Project rules** (from `CLAUDE.md`, repeated because they are easy to forget):

- No em dash and no middle dot anywhere (code, comments, docs, commits). A hook blocks them.
- Names in Title Case ("Test Workflow", "Add A Trigger"); sentences in sentence case. No all-caps.
- No in-page titles or taglines; pages open with a `PageActions` row.
- Placeholders read "Enter your ...".
- Clickable icons are animated (`MotionIcon`); decorative and state icons stay lucide.
- Warnings and failures use the design-system `Alert`; deletes are solid red with a confirm.
- Big surfaces use `bg-chrome`; check light, dark and the Lilac theme.
- Validation with the Zod pipe and `.strict()` schemas; every route authenticated unless `@Public()`; tenancy through `@CurrentOrg()`.
- Run migrations and `db:generate` yourself in development.

**Module rules**:

- `packages/automation` and `packages/scheduling` stay **pure** (no Node built-ins, Prisma or Temporal).
- The UI says **Workflow** and **Step**; the code says `Automation` and `node` (Temporal already owns "workflow" in this codebase).
- No jargon in the UI: never "payload", "JSON path", "cron", "node", "execution", "webhook payload". Say "data", "step", "run", "schedule".
- Secrets never live in graph JSON, never reach the browser, never land in run steps.
- Everything outside PostGear is a dry run in tests, and runs under `AUTOMATION_SIMULATION=true` locally. No paid or real external call is made without the user's explicit OK.
- Small UI tweaks: the user checks by hand, so skip Playwright for those. Bigger flows (the canvas, a full test run): use Playwright once, save screenshots to `screenshots/` (never committed).

---

## Names Everyone Uses

| Thing | Name |
|---|---|
| Branch | `sprint-10-workflow-builder`, cut from `sprint-9-design-studio` |
| Package | `@postgear/automation` at `packages/automation` |
| API module | `apps/api/src/modules/automations` |
| Worker files | `apps/worker/src/workflows/automation-run.workflow.ts`, `apps/worker/src/activities/automation.activities.ts`, `apps/worker/src/automation/` (executors and providers) |
| Web routes | `/[orgId]/workflows`, `/[orgId]/workflows/[automationId]`, `/[orgId]/workflows/connections` |
| Web components | `apps/web/src/components/workflows/` |
| Models | `Automation`, `AutomationVersion`, `AutomationRun`, `AutomationRunStep`, `AutomationConnection`, `AutomationWebhookSecret` |
| Temporal | `AUTOMATION_RUN_WORKFLOW = 'automationRunWorkflow'`, `automationRunWorkflowId(runId) = 'automation-run:<runId>'`, `REVIEW_DECISION_SIGNAL`, `automationScheduleId(id) = 'automation-schedule:<id>'` |
| Env flags | `AUTOMATION_SIMULATION` (refused when `NODE_ENV=production`), `AUTOMATION_INTERNAL_TOKEN` (worker to API gateway), Google: `GOOGLE_AUTOMATION_CLIENT_ID`, `GOOGLE_AUTOMATION_CLIENT_SECRET` (optional, fall back to `GOOGLE_CLIENT_ID`), `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_APP_ID` |
| Internal gateway | `/internal/automation/*` on the API: the worker calls it for steps that need API services (posts, AI, mail); each call carries `{ runId, nodeKey, organizationId }` checked against a live run (Module 10) |
| Effect ledger | `AutomationEffect` model: one row per side effect, unique idempotency key `${runId}:${nodeKey}`, PENDING, DONE or FAILED (Module 10) |
| Safe HTTP | `apps/worker/src/lib/safe-http.ts`: `safeHttpRequest`, extracted from `webhook-sender.ts` (address check, pinned DNS, timeout, size cap) for Slack, Teams, Discord, HTTP Request and Sheets (Module 12) |
| Credit type | `generate_snippet` (2 credits) for Generate Hashtags and Rewrite In Brand Voice (Module 11) |
| Shared types | `MediaRef` (media passed between steps), `CreationMethod.AUTOMATION` (posts made by workflows) |
| Node type ids | `trigger.*`, `postgear.*`, `ai.*`, `studio.*`, `logic.*`, `notify.*`, `data.*` (full list in Module 01) |

---

## Additions Beyond The Sprint Doc

These come from the n8n, Make and Zapier research and are part of this plan. Each is marked in its module. Strike one out here if you do not want it.

| Addition | Module | Inspired by |
|---|---|---|
| Paths step (ordered cases plus Otherwise) | 01, 07 | Zapier Paths, Make Router |
| Per-step On Error: stop, continue, or an error branch, plus retries | 01, 07 | n8n On Error, Make error handlers |
| Turn a step off (skipped, passes data through) | 01, 05 | n8n Deactivate |
| Sticky notes on the canvas | 01, 05 | n8n, Make notes |
| Tidy Up (auto layout) | 05 | n8n Tidy Up, Make Auto-align |
| Copy and paste steps as JSON across workflows | 05 | n8n |
| Command palette (Ctrl/Cmd+K) and a shortcuts sheet | 05 | n8n |
| Expanded step view: Input, Settings, Output side by side | 06 | n8n node detail view |
| Pinned test data per step | 06, 08 | n8n Pin Data |
| Live run animation and a result badge on every step | 08 | Make bubbles, n8n states |
| Open any past run on the canvas, Debug In Editor | 08 | n8n executions |
| Version history with preview and Restore As Draft | 09 | n8n history, Zapier versions |
| Auto-pause after repeated failures | 09 | Zapier, n8n |
| Finish Setup checklist when a template opens | 05 | Zapier and Make template setup |
| Repurpose For X and Blog To Draft templates | 02 | - |
| Describe Your Workflow (AI drafts a graph for review) | 15 | Zapier Copilot, Make Maia |

---

## Progress

Each session updates its row. Status: Not started, In progress, Done, Done with gaps (say which).

| # | Status | Date | Commit | Notes (exports, endpoints, gaps) |
|---|---|---|---|---|
| 01 | Done | 2026-10-29 | `842b23e` | `packages/automation` (`@postgear/automation`, Zod only, 199 tests; `src/plan` and `src/validate` 100% lines). 31 catalog types, 4 Coming Soon. Exports listed below. Not imported by any app yet (Modules 03, 05, 07 wire it in) |
| 02 | Done | 2026-10-29 | uncommitted | Tokens, conditions, schedules, redaction, plain-words summaries, samples, 5 templates, all in `@postgear/automation` (still Zod only, no date library). 459 tests in the package; lines covered: tokens 95.8%, conditions 98.0%, schedule 100%, redact 98.1%. 10 new issue codes. Exports listed below |
| 03 | Done | 2026-10-29 | uncommitted | Migration `20261029120000_sprint10_workflow_builder` (4 tables, 4 enums, additive). `apps/api/src/modules/automations`: all 13 routes below, 45 specs. Seed: "Publishing Report" draft on `seed-demo-org`. Checked live with curl as the demo admin and the member. No web page yet (Module 05) |
| 04 | Not started | | | |
| 05 | Not started | | | |
| 06 | Not started | | | |
| 07 | Not started | | | |
| 08 | Not started | | | |
| 09 | Not started | | | |
| 10 | Not started | | | |
| 11 | Not started | | | |
| 12 | Not started | | | |
| 13 | Not started | | | |
| 14 | Not started | | | |
| 15 | Parked | | | |

### `@postgear/automation` Public API (Module 01)

Import from the package root only. Each line is one export (types in italics).

- **Graph**: `automationGraphSchema`, `graphNodeSchema`, `graphEdgeSchema`, `stickyNoteSchema`, `onErrorPolicySchema`, `portIdSchema`, `isPortId`, `GRAPH_SCHEMA_VERSION`, `NODE_KEY_PATTERN`, `CASE_ID_PATTERN`, `NOTE_COLOURS`, `edgeId(source, port, target)`, `emptyGraph()`, `upgradeGraph(json)` (validates; throws on a newer format), `uniqueNodeName(base, graph)`; *`AutomationGraph`, `GraphNode`, `GraphEdge`, `StickyNote`, `NoteColour`, `OnErrorPolicy`, `PortId`, `InputPortId`*
- **Limits**: `LIMITS` (the doc's list), `GRAPH_HARD_CAPS` (schema caps, 2x nodes and edges, notes 30)
- **Catalog**: `NODE_CATALOG`, `NODE_TYPES`, `ICON_KEYS`, `getDefinition(type, version?)`, `listDefinitions({ category?, status? })`, `isNodeType`, `isTriggerType`, `outputPortsOf(node)` (adds `error` for On Error branch), `outputFieldsOf(node)` (adds `error.*` for continue and branch), `hasErrorBranch`, `parseNodeConfig(node)`, `nodeTitle(type, config?)` ("Publish To Instagram"), `describeNode(node, ctx)` (never throws), `EXECUTABLE_TYPES` (empty), `AI_STEP_CREDITS`; *`NodeDefinition`, `NodeType`, `NodeCategory`, `ColourFamily`, `IconKey`, `PortSpec`, `OutputField`, `FieldType`, `RequiredField`, `ConnectionUse`, `ConnectionKind`, `SummaryContext`*
- **Shared data**: `PUBLISH_PLATFORMS`, `PUBLISH_PLATFORM_IDS`, `platformById`, `PUBLISH_FAILURE_REASONS` (with plain labels), `PUBLISH_FAILURE_REASON_IDS`, `CONNECTION_KINDS`, `connectionKindInfo`; *`PublishPlatform`, `PublishPlatformId`, `PublishFailureReasonId`, `ConnectionKindInfo`*
- **Config shapes**: `conditionGroupSchema`, `conditionRuleSchema`, `CONDITION_OPERATORS`, `MAX_CONDITION_RULES`, `emptyConditionGroup()`, `scheduleConfigSchema`, `timeZoneSchema`, `SCHEDULE_FREQUENCIES`, `WEEKDAYS`, `TIME_OF_DAY_PATTERN`; *`ConditionGroup`, `ConditionRule`, `ConditionOperator`, `ScheduleConfig`, `ScheduleFrequency`, `Weekday`*
- **Connecting**: `canConnect(graph, { source, sourcePort, target, targetPort? })` returns `{ ok: true } | { ok: false, reason }`, `CONNECT_REASONS`; *`ProposedEdge`, `ConnectCheck`*
- **Planning**: `buildIndex(graph)`, `edgesFrom(index, key, port)`, `topologicalOrder(graph)`, `upstreamOf(graph, key)` (run order), `branchConditions(graph)`, `areExclusive(graph, edgeA, edgeB)`, `exclusiveGroups(graph)`, `planNext(graph, state)`; *`GraphIndex`, `GraphInput` (a graph or an index), `BranchConditions`, `ExclusiveGroup`, `RunPlanState`, `PlanStepState`, `PlanStepStatus`, `PlanResult`, `PlanOutcome`, `SkippedStep`, `SkipReason`*
- **Validation**: `validateGraph(graph, ctx?, rules?)`, `hasBlockingIssues(issues)`, `VALIDATION_RULES` (Module 02 appends); *`ValidationIssue`, `IssueCode`, `ValidationContext`, `ConnectionState`, `ChannelState`, `ValidationRule`*

### `@postgear/automation` Public API (Module 02)

- **Data tokens**: `parseTemplate(text)` (lossless: segments keep `raw`), `serializeSegments(segments)` (exact round trip), `formatToken`, `sameSegments`, `tokensIn(text)`, `singleToken(segments)`, `tokenSource(path)` (`{ root, nodeKey?, field, wellFormed }`), `nodeTokenPath(key, field)`, `TOKEN_ROOTS`, `MAX_TOKENS_PER_FIELD` (50), `MAX_FIELD_DEPTH` (8); *`Segment`, `TextSegment`, `TokenSegment`, `TokenFilter`, `TokenSource`*
- **Filling tokens in**: `resolveTemplate(text, scope, { timeZone? })` returns `{ value, missing, unknownFilters }`, `resolveConfig(config, scope)` (missing listed per config field), `resolveValue(path, scope)` (own fields only), `isEmptyValue`, `toText`, `toNumber` (strict), `toEpoch`; *`RunScope`, `Resolved`, `ResolvedConfig`*
- **Data formats**: `TOKEN_FILTERS` (name, label, description, argument), `FILTER_NAMES`, `isKnownFilter`, `applyFilter`. Final list: `truncate: n` (Shorten), `upper` (Upper Case), `lower` (Lower Case), `trim` (Trim Spaces), `date: "pattern"` (Date Format), `default: "text"` (If Empty Use), `json` (As JSON), `join: "sep"` (Join List), `first` (First Item), `count` (Count), `urlencode` (For A Link)
- **Insert Data**: `availableData(graph, nodeKey, { scope? })` (upstream groups then Run and Workspace, each with `turnedOff`, `maybeEmpty`, a field tree of at most 3 levels and samples), `sourceFields`, `lookupField`, `tokenLabeler(graph)`, `RUN_FIELDS`, `WORKSPACE_FIELDS`, `renameNodesInText`, `renameNodesInConfig`; *`DataGroup`, `DataField`*
- **Conditions**: `evaluateCondition(group, scope, { now?, timeZone? })` returns `{ result, details }`, `describeCondition(group, { tokenLabel? })`, `describeRule`, `OPERATORS`, `OPERATORS_BY_TYPE`, `operatorsFor(type)`, `conditionTypeOf`, `operatorFamily`; *`ConditionType`, `RuleResult`, `ConditionResult`*
- **Schedules**: `nextRuns(config, fromIso, count = 3)` (DST-correct, strictly after `from`), `describeSchedule(config, { timeZone? })`, `scheduleNotes`, `toTemporalScheduleSpec(config)`, `scheduleIntervalMinutes`, `HOURLY_STEPS`; *`ScheduleSpecShape`, `CalendarSpecShape`, `SpecRange`*
- **Secrets**: `redact(value, { connectionValues?, capBytes? })` returns `{ value, truncated, hidden }`, `HIDDEN`, `findSecretLikeValues(graph)`, `SECRET_REFUSED_MESSAGE` (Module 03's save refusal), `isSecretKey`; *`SecretFinding`, `Redacted`*
- **Plain words**: `describeWorkflow(graph, ctx)` (the activation sentence), `riskSummary(graph)` (`{ external, publishes, publishesWithoutReview, aiCreditsPerRun }`); *`NodeRef`, `RiskSummary`*
- **Samples**: `triggerSample`, `stepSample`, `sampleScope(graph, workspaceName?)`, `SAMPLE_RUN`
- **Templates**: `TEMPLATES` (Publishing Report, AI Weekly Post, Failed Post Alert, Repurpose For X, Blog To Draft), `getTemplate`, `listTemplates`, `instantiateTemplate(template, makeKey, { timeZone? })`; *`AutomationTemplate`, `TemplateSummary`, `TemplateNeed`*
- **Graph and plan**: `rekeyGraph(graph, makeKey)` (Duplicate and templates; rewrites lines and tokens), `certainBefore(graph, key)` (steps that surely ran before this one)
- **Time helpers**: `isValidTimeZone`, `zonedTime`, `zonedToEpoch`, `offsetMinutes`, `formatDate(ms, pattern, zone)`, `parseIsoDate`, `toIsoString`
- **Validation**: `VALIDATION_RULES` now also runs `tokensResolve`, `conditionsComplete`, `scheduleFitsAi`; `aiScheduleLimit(minutes)` builds the AI rule for another limit. Issues gain `token` (the chip's raw text, so the UI paints the exact chip)

### Automations API (Module 03)

Migration `20261029120000_sprint10_workflow_builder`. Models `Automation`, `AutomationVersion`, `AutomationRun`, `AutomationRunStep`; enums `AutomationStatus`, `AutomationRunMode`, `AutomationRunStatus`, `AutomationStepStatus` (all re-exported from `@postgear/db`). Notes in `packages/db/prisma/SCHEMA_NOTES.md`, "Sprint 10 additions".

| Route | Who | Answers |
|---|---|---|
| `GET /automations?search=&status=&cursor=` | members | `{ automations, nextCursor }`; rows carry `runs30d` (one grouped query); `status` is `DRAFT`, `ACTIVE` or `PAUSED`; pages of 50 by cursor, a search is one page |
| `GET /automations/catalog` | members | `{ steps, connectedPlatforms }`; each step has `state` (`ready`, `needsConnection`, `comingSoon`), `runnable`, `reason` |
| `GET /automations/templates` | members | `{ templates }` (`listTemplates()`, no graphs) |
| `POST /automations` | members | body `{ name?, templateId?, timeZone? }`, 201 `{ automation }` |
| `GET /automations/:id` | members | `{ automation }` with `draftGraph`, `draftRevision`, `pinned: { nodeKey, pinnedAt }[]`, `activeVersion` (number or null) |
| `PATCH /automations/:id` | members | body `{ draftRevision, name?, draftGraph? }`, `{ automation: { id, name, draftRevision, triggerType, hasUnpublishedChanges, updatedAt } }`; 409 `code: automation_conflict, details: { currentRevision }`; 422 `unknown_step` or `secret_in_step` |
| `DELETE /automations/:id` | members | soft delete; calls `AutomationTriggers.stop()` first when active |
| `POST /automations/:id/duplicate` | members | 201 `{ automation }`, "{name} (Copy)" |
| `POST /automations/:id/validate` | members | `{ issues, blocking }` for the saved draft |
| `PUT /automations/:id/pinned/:nodeKey` | members | body `{ output }`, `{ pinned }`; 422 `pinned_too_large` past 64 KB; 404 when the step is not in the draft |
| `DELETE /automations/:id/pinned/:nodeKey` | members | `{ message }` |
| `POST /automations/:id/activate`, `/pause` | admins | 501 "Turning workflows on arrives in a later step of this sprint." |

For later modules: `AutomationsModule` exports `AutomationContextService` (`forOrg(orgId)` builds the `ValidationContext`; Module 04 fills `connections`) and `AutomationTriggers` (`stop(orgId, id)`, Module 09 fills it in). Server step keys come from `freshKeyMaker()` in `automation-keys.ts` (10 characters, a letter first).

`planNext` contract for Module 07: state is `{ [nodeKey]: { status, ports? } }` with status `running`, `succeeded`, `handled` (On Error continue or branch; ports `['out']` or `['error']`), `failed` (On Error stop), `skipped`, `off`. Omitted ports mean `['out']`; a Filter that does not pass reports `ports: []`; Manual Review reports `['approved']` or `['rejected']`. It returns `{ ready, skipped: { key, reason: 'branchNotTaken' | 'upstreamFailed' }[], bypassed, finished, outcome? }`. Record `skipped` as skipped and `bypassed` (turned-off steps) as `off`; both are only reported once they are missing from the state.

## Decision Log

Every choice a session made that a later session must know. Newest last. One or two lines each.

| Date | Module | Decision | Why |
|---|---|---|---|
| 2026-10-29 | plan | UX follows n8n, Make and Zapier; TriForms only for engine lessons | The user's call: proven tools real users already know |
| 2026-10-29 | plan | Branch cut from `sprint-9-design-studio`, not `ui-revamp` | Sprint 9 and 9b are not merged; Render Design needs Studio |
| 2026-10-29 | plan | The Schedule step stores its own IANA time zone (defaulted from the browser) | PostGear has no workspace time zone; `User.timezone` is an Int offset and cannot handle daylight saving |
| 2026-10-29 | plan | Microsoft Teams uses the Teams Workflows app URL with an Adaptive Card | Office 365 Connectors were switched off in May 2026 |
| 2026-10-29 | plan | Google Sheets uses the `drive.file` scope with the Google Picker | Avoids Google's sensitive-scope verification; users pick or create the sheet |
| 2026-10-29 | plan (03) | Steps without a worker executor stay addable on drafts but are flagged `runnable: false` (issue `node.not_runnable`) | Lets the canvas (05) be built before the run engine (07) |
| 2026-10-29 | plan (03) | Saving accepts graphs with issues; it always refuses schema violations, unknown types and secret-looking values | Drafts may be unfinished; secrets must never be stored |
| 2026-10-29 | plan (03) | Rejected and Review Expired are run outcomes, not failures; only Failed counts for alerts and auto-pause | User stories WF-10.1 |
| 2026-10-29 | plan (04) | Connection usage ("Used by N workflows") is computed by scanning draft and active graphs, no join table | Autosave would keep a join table drifting |
| 2026-10-29 | plan (04) | Slack, Discord and Teams links show "Saved, not checked" until a real send | They cannot be checked without posting a message |
| 2026-10-29 | plan (04) | Every connection write, reconnect included, is admin only; OAuth state single use, 10 minutes, in Redis | n8n CVE-2026-45732 lesson |
| 2026-10-29 | plan (07) | Live run progress: the API's SSE endpoint polls the database every 750 ms (no Redis pub/sub) | `RedisService` has no pub/sub and its memory fallback cannot reach the worker; the bell already polls |
| 2026-10-29 | plan (07) | Out of credits and "not connected" always stop the run, whatever the step's On Error says | Continuing would hide a problem the user must fix |
| 2026-10-29 | plan (07) | In tests, In-App Notification and Create Draft act for real, marked "(Test)" | They stay inside PostGear; only outside effects are dry |
| 2026-10-29 | plan (09) | Trigger dedupe keys: `post.published:<rootPostId>` and `post.failed:<rootPostId>:<publish runId>` | A fixed and re-failed post alerts again; activity retries never do |
| 2026-10-29 | plan (09) | Failed Post Alert filters out `retries_exhausted` ("Gave up after several tries") | `PublishFailureReason` has no rate-limited reason |
| 2026-10-29 | plan (09) | Pause deletes the Temporal Schedule; activate recreates it from the active version (overlap SKIP, 1 minute catch-up) | Guarantees no catch-up of missed runs |
| 2026-10-29 | plan (09) | Failure alerts at most once per workflow per hour, then grouped; auto-pause after 5 failed live runs in a row | Grouped alerts (WF-12.1), addition from Zapier and n8n |
| 2026-10-29 | plan (10) | Recommended: steps that need API services (Create Draft, Add To Queue, Publish, AI, Email) go through an internal API gateway, not a shared post-writer package. Module 10's session confirms this by reading `posts.service.ts` first | Reuses `PostsService.create` unchanged, the same path as the composer and the copilot's `draft_post` |
| 2026-10-29 | plan (10) | Publish To Channel creates a queued post with publish-now and lets `postPublishWorkflow` publish it | One publishing path; never calls a platform from a workflow step |
| 2026-10-29 | plan (10) | Add To Queue stores its own IANA time zone; a new pure `nextFreeSlot` reads `Integration.postingTimes` | No server-side next-slot code exists and posting times carry no zone |
| 2026-10-29 | plan (11) | AI steps run in tests and charge real credits; the Test tab says so and offers Use Sample Text Instead (pins sample output) | They stay inside PostGear, but cost money |
| 2026-10-29 | plan (11) | The catalog's credit estimates are tested to equal `AI_CREDIT_COSTS`; out of credits uses `tryCharge` and stops the run | One source of truth for prices |
| 2026-10-29 | plan (12) | Slack, Discord and HTTP text is escaped so user content cannot add mentions or links; Teams refuses old `webhook.office.com` links | Safety, and the May 2026 connector shutdown |
| 2026-10-29 | plan (12) | Email goes through the gateway to the API's mail service, max 10 recipients per step and 200 workflow emails per workspace per day | Reuses the console fallback without SMTP; limits abuse |
| 2026-10-29 | plan (13) | Sheets appends with `RAW` (no formula injection); HTTP Request never follows redirects; webhook trigger accepts an `Idempotency-Key` header as the event id | Security and exactly-once |
| 2026-10-29 | plan (07) | Steps carry a timeout class: fast (30 s) or slow (5 minutes with heartbeats, for AI and Render Design) | Model calls can take over a minute |
| 2026-10-29 | 01 | Config schemas accept empty fields (so `defaultConfig` parses); "filled in" is a `required` list per definition and a new `node.required_missing` issue (with `field`), checked only once the config parses | The module asked for both "defaults pass the schema" and "required config filled" |
| 2026-10-29 | 01 | The graph schema caps at 2x the limits (100 steps, 240 lines; notes 30); `graph.too_many_nodes` and a new `graph.too_many_edges` report past 50 and 120 | An over-full paste must still save, never lose work |
| 2026-10-29 | 01 | The schema (not validation) refuses duplicate step keys, a line id that is not `${source}:${port}->${target}`, dangling lines, duplicate note ids | A correct canvas never makes these; they mean a bug |
| 2026-10-29 | 01 | Mutually exclusive is computed along whole paths ("branch conditions": each step leaves through one port per run), so True to A to C plus False to B to C needs no Merge; an On Error step's `out` and `error` also exclude each other | The doc's "edges of one If / Else" alone would flag every normal rejoin |
| 2026-10-29 | 01 | `planNext`: a stop failure skips everything that depends on it, Merges included (`upstreamFailed`); run outcome is failed, then rejected, then succeeded; handled errors and Filter stops are not failures; turned-off steps come back as `bypassed` | Defines Merge after a failed branch, which the doc left open; contract written above |
| 2026-10-29 | 01 | Add To Queue is `publishes: true` (as well as Publish) | A queued post goes out on its own: dry in tests (Module 10 wants that) and counted by the activation tick |
| 2026-10-29 | 01 | Definition shape: `connection` is `{ kind, field, optional? }` (HTTP's secret headers connection is optional); added `channels: 'act' or 'filter'`, `canHandleErrors`, `required`, `titleFor` | The flat `connection?: ConnectionKind` could not say which field or that HTTP's is optional |
| 2026-10-29 | 01 | Channels: posting steps need each channel present and `active` (`node.channel_missing`), Publish needs its platform (`node.channel_wrong_platform`); a removed channel in a trigger filter is only a warning (`node.filter_channel_missing`) and one needing a reconnect is fine | Alerting on a channel that needs reconnecting is the point of Post Failed |
| 2026-10-29 | 01 | Turned-off steps skip the required, connection, channel and not-runnable checks (their config schema is still checked); On Error on a trigger or Manual Review, and Turn Off on a step that cannot, are `node.config_invalid` with `field` `onError` or `disabled` | They never run; no extra codes needed |
| 2026-10-29 | 01 | `validateGraph(graph, ctx?)` never throws (a broken rule becomes one `graph.check_failed`); ctx connections carry `name` and the DB status strings (`CONNECTED`, `NEEDS_RECONNECT`, `ERROR`); channels are `{ id, provider, name, status: active, disabled or needsReconnect }` | Messages need names; the API can pass rows nearly as they are |
| 2026-10-29 | 01 | Condition and schedule shapes live in `src/conditions/schema.ts` and `src/schedule/schema.ts` for Module 02 to build on: a group may hold 0 rules (empty is Module 02's `condition.empty`), operator ids are listed; the schedule is one flat object with a refinement (switching frequency keeps the other fields), days `mon` to `sun` | The catalog needed both config schemas now |
| 2026-10-29 | 01 | Packages never import each other, so provider ids and failure reasons are copied in `catalog/platforms.ts`; Module 09 should add a worker test that they equal social-core's identifiers and `PublishFailureReason`. The LinkedIn card covers `linkedin` and `linkedin-page` | Keeps the package free of other workspace packages (a purity test enforces it) |
| 2026-10-29 | 01 | Set Fields names and Manual field keys are identifiers (letters, numbers, `_`) | They become token paths |
| 2026-10-29 | 01 | `EXECUTABLE_TYPES` (empty) already exists at `src/catalog/executable.ts`, as Module 03 planned; `node.not_runnable` keeps the message "{Title} cannot run yet in this version of PostGear." | The rule needed it |
| 2026-10-29 | 01 | `node.disabled_output_used` finds tokens with its own narrow pattern; Module 02 should switch it to `parseTemplate` | Tokens arrive in Module 02 |
| 2026-10-29 | 01 | Generate Video is priority P2 (the doc said "-"); Render Design is category `ai` (id `studio.renderDesign`); Merge's `outputShape` is empty (its output is keyed by step at run time, Module 07 decides) | Smallest choices that fit the types |
| 2026-10-29 | 01 | Summaries are short literal lines now ("Every Monday at 09:00", "Message to Marketing Slack"); Module 02 replaces schedule and condition ones with `describeSchedule` and `describeCondition` | Module 02 owns the full sentences |
| 2026-10-29 | 02 | No date library: time is hand-rolled (`src/time`), with zone offsets read from `Intl.DateTimeFormat` and cached per zone. A time that falls in a daylight saving gap moves forward to the first real minute; a time that happens twice takes the first one | `@date-fns/tz` is pure but the package stays Zod only; tested on London and New York changes and Kolkata |
| 2026-10-29 | 02 | Time zones: the Schedule step's own IANA zone is the only zone. Token `date` formats and "within the last N days" use the zone passed in (`timeZone` option), else UTC | Same call as the plan row; no workspace zone yet |
| 2026-10-29 | 02 | Filters are the doc's 11, unchanged (list in the API section). `truncate` keeps at most n characters including the "…"; `default` also counts a filled-in value as not missing | Fixed list, nothing to evaluate |
| 2026-10-29 | 02 | Hourly runs every 1, 2, 3, 4, 6, 8 or 12 hours (`HOURLY_STEPS`), not any of 1 to 12 | Temporal's hour step restarts at midnight, so "every 5 hours" would leave a 4 hour gap each night |
| 2026-10-29 | 02 | Temporal has no "last day": days 29 to 31 and `last` become one calendar per month, February lists the 28th and 29th and a skip drops the 28th in leap years (2028 to 2096). A test runs the spec through a small evaluator and checks it equals `nextRuns` | Keeps Module 09 a straight pass-through |
| 2026-10-29 | 02 | Escaping: `\{{` is literal braces; a run of backslashes before `{{` halves. Segments keep `raw`, so `serializeSegments(parseTemplate(x)) === x` for any text; edited segments fall back to canonical spelling | Exact round trip as asked, even for odd hand-typed text |
| 2026-10-29 | 02 | Token paths: `trigger.<field>`, `nodes.<key>.output.<field>`, `run.id`, `run.startedAt`, `run.mode` (`test` or `live`), `workspace.name`. Only own fields are read; `__proto__`, `constructor` and `prototype` never resolve | No path can reach JavaScript internals |
| 2026-10-29 | 02 | "May be empty" means the source step is not certain to run before this one (`certainBefore`: through the trigger, single-port steps, ports fixed by the branch, or a step whose every port leads here). A token with a `default` format, or from a turned-off step, gets no `maybe_empty` warning | The doc's rejoin case, without flagging every step after a Filter's only output |
| 2026-10-29 | 02 | Extra issue codes: `token.too_many` (over 50 chips in one field), `condition.missing_value` is also used for "Enter a whole number.", `condition.type_mismatch` also says "This check does not fit this kind of data." and "Enter a date like 2026-11-03." (warnings) | Small gaps in the doc's table |
| 2026-10-29 | 02 | A group with no rules is `condition.empty` (error) and, if it ever ran, "all" matches and "any" does not. "Does not equal" with an empty or non-number side is false too | Every number comparison with a non-number is false, as the doc says |
| 2026-10-29 | 02 | Redaction: secret-named keys keep numbers, yes/no, null and empty text (`maxTokens: 500`); `{ name, value }` pairs count by their name (HTTP headers); connection values under 8 characters are not matched inside text; a link with a secret in its query keeps `scheme://host/[hidden]`. The 64 KB cap cuts long text first (16 KB, 4 KB, 1 KB, 256, 64 characters), then lists (100, 20, 5 items) | Hides what matters without hiding counts and settings |
| 2026-10-29 | 02 | Two secret checks: `redact` is generous (also hides `key`, `code`, `auth` query values); `findSecretLikeValues` (Module 03's save refusal) only flags typed text in secret-named fields and clear secret shapes (bearer, Slack and Discord webhooks, `sk-`, Stripe, GitHub, Google, AWS keys, JWTs), and scans configs, step names and notes. Data chips are never flagged | Saving must not refuse normal text like "code: SPRING10" |
| 2026-10-29 | 02 | The trigger summary is `describeSchedule` without the zone (the panel shows the zone); condition summaries get step names through a new optional `SummaryContext.tokenLabel` | Short canvas cards; the full sentence still has the zone |
| 2026-10-29 | 02 | Templates use real catalog types and fill only what they know; connections, channels and the sheet are left for the setup panel. `instantiateTemplate` sets the browser zone on Schedule and Add To Queue steps. Failed Post Alert runs Slack and In-App in parallel after the Filter | A template must validate with zero errors once its connections are picked (tested) |
| 2026-10-29 | 02 | Samples use a made-up workspace "Bloom Bakery" and a sample image link for media fields; Set Fields samples are resolved against the samples before them | Hover previews and Test Step read like a real run |
| 2026-10-29 | 02 | `node.disabled_output_used` now finds chips with `parseTemplate` (the narrow pattern is gone). The purity test also bans `vm.` and `require(` | Closes the Module 01 handoff; the doc's no-sandbox guard |
| 2026-10-29 | 03 | Model field changes from the doc: `createdById`, `updatedById` (Automation), `createdById` (Version) and `startedById` (Run) are nullable foreign keys to `User` with `ON DELETE SET NULL`, as in Studio; `AutomationRun` also relates to `Organization` and `AutomationVersion`. No field was renamed | A workflow belongs to the workspace; deleting a user must not take it or be blocked by it |
| 2026-10-29 | 03 | The secret refusal is `findSecretLikeValues` (Module 02, strict mode): secret-named fields holding typed text (`password`, `token`, `apiKey`, `secret`, `authorization`, `cookie`, `signature`, `client_secret` and kin, also as `{ name, value }` pairs), and text shaped like a bearer or basic token, a Slack or Discord webhook, a Teams or Logic Apps `sig` link, an `sk-` key, Stripe `sk_`/`rk_` keys, `xox` Slack tokens, GitHub tokens, Google `AIza` keys, AWS `AKIA` keys or a JWT, in configs, step names, step notes and sticky notes. Answers 422 `secret_in_step` | The rule "secrets never live in graph JSON", without refusing ordinary text |
| 2026-10-29 | 03 | 51 steps save (validation reports `graph.too_many_nodes`); the request schema refuses past the hard cap of 100 | The doc's test said 51 is refused; Module 01's code saves it so a paste never loses work. Trusted the code |
| 2026-10-29 | 03 | The global exception filter now passes `details` on a coded refusal, whole numbers only (so the 409 can say `currentRevision`). No text can pass through it | The filter dropped every field but `error`, `statusCode` and `code` |
| 2026-10-29 | 03 | `POST /automations` also takes `timeZone` (IANA, checked), handed to `instantiateTemplate` for Schedule and Add To Queue steps | AI Weekly Post has a Schedule; the server has no zone of its own |
| 2026-10-29 | 03 | The catalog adds `connectedPlatforms`; Publish (one definition for every platform) is `needsConnection` only when no platform has an active channel. A channel that needs reconnecting, is half connected or turned off does not count | One card per platform needs the list; the single definition cannot carry a per-platform state |
| 2026-10-29 | 03 | Pinned data: refused past 64 KB (not cut), redacted, written with `jsonb_set` one key at a time; pinning never bumps `draftRevision` or `updatedAt`; pins of deleted steps stay in the row but are not listed | Cut test data would test something else; pinning is not an edit and must not conflict with autosave |
| 2026-10-29 | 03 | `hasUnpublishedChanges` compares graphs ignoring key order (`sameJson`) | Postgres JSONB reorders keys, so a plain string compare would always say "changed" |
| 2026-10-29 | 03 | Activate and pause still look the workflow up first (404 for a foreign id) before answering 501 | Keeps tenancy answers the same on every route |
| 2026-10-29 | 03 | The seed loads `@postgear/automation` with `require` at run time (as the Studio seed loads the design engine) and keeps the template's own step keys; the seeded workflow has a fixed UUID id | `packages/db` does not depend on the package; the API treats non-UUID ids as not found |
