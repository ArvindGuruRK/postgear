# Module 01: Engine Core, Graph And Node Catalog

> **Sprint 10, Workflow Builder** | Status: Done (2026-10-29, see the README decision log for the calls made) | Size: L (one session)
> **Depends on**: nothing (first module). Branch setup is part of this module.
> **Stories**: foundations for WF-2.1, WF-2.2, WF-2.4, WF-5.1, WF-9.3, WF-11.6
> **Next**: [Module 02](module-02-engine-data-tokens-conditions.md)

## Goal

A new pure package, `packages/automation`, that every other module trusts. After this module:

- the graph shape (nodes, ports, edges, sticky notes) is one Zod schema;
- every node type in the catalog is declared once, with its ports, config schema, output shape, side effect flag, retry class and status;
- `validateGraph()` returns every problem with a node key, a code and a plain-words message;
- the run order and branch plan of any valid graph can be computed without Temporal.

This is the part that the web app, the API and the worker (inside Temporal's sandbox) all import. Get it right and every later module is wiring.

## Read First

1. `CLAUDE.md`, then [`README.md`](README.md) in this folder (rules, names, decisions).
2. [`../../sprint-documents/sprint-10-workflow-builder.md`](../../sprint-documents/sprint-10-workflow-builder.md): "Lessons Carried Over From TriForms", "Node Catalog", "Validation Rules".
3. [`00-ux-blueprint.md`](00-ux-blueprint.md) sections 3 and 4 (node anatomy, ports) so the catalog carries what the UI needs (icon, colour family, summary).
4. `packages/scheduling` as the model for a pure package (package.json, jest.config.js, tsconfig, `paths` entry in the root `tsconfig.json`).

## Branch

Create `sprint-10-workflow-builder` from `sprint-9-design-studio` (Sprint 9 and 9b are not merged yet, and the P2 Render Design node needs Studio). Do not push until the user says so.

## Scope

**In**: package scaffold, graph schema, port model, node definition type, the full catalog (P0, P1, P2 and Coming Soon entries), `validateGraph` (structure rules; token and condition rules arrive in Module 02 and plug into the same function), topological order, branch planning, limits, a `describeNode()` summary hook per node.

**Out**: token parsing (Module 02), condition evaluation (Module 02), redaction (Module 02), templates (Module 02), anything that touches the network, Prisma, Temporal or the DOM.

## Design

### Package rules

- `packages/automation`, name `@postgear/automation`, `main: src/index.ts`, wired into the root `tsconfig.json` `paths` and the shared Jest preset exactly like `@postgear/scheduling`.
- **Pure**: no Node built-ins, no Prisma, no Temporal, no `Date.now()` or `Math.random()` (callers pass time and ids in). Only dependency: `zod` (same major as the rest of the repo). If a date library is needed later (schedules), it must be pure and tree-shakeable; decide in Module 02.
- Every export is deterministic. This is what lets the Temporal workflow import it.

### Graph shape (`src/graph/schema.ts`)

```ts
AutomationGraph = {
  schemaVersion: 1,
  nodes: GraphNode[],          // max 50 (LIMITS.maxNodes)
  edges: GraphEdge[],
  notes: StickyNote[],         // display only, the engine ignores them
}

GraphNode = {
  key: string,                 // nanoid(10) made by the client, never changes, never reused
  type: NodeType,              // e.g. 'notify.slack'
  typeVersion: number,         // starts at 1; bump when a config schema breaks
  name: string,                // display label, 1..60 chars, unique per graph (UI suffixes " 2")
  position: { x: number, y: number },
  config: Record<string, unknown>,   // validated per type, never holds a secret
  disabled?: boolean,          // skipped and passed through (see "Disabled nodes")
  onError?: OnErrorPolicy,     // see "Error policy"
  notes?: string,              // a short note shown under the node, max 280 chars
}

GraphEdge = {
  id: string,                  // `${source}:${sourcePort}->${target}`
  source: string, sourcePort: PortId,
  target: string, targetPort: 'in',
}

StickyNote = { id, position, size: { w, h }, text (max 2000), colour: 'yellow'|'blue'|'green'|'pink'|'violet' }
```

- All objects are `.strict()`. Unknown keys are refused, so a secret cannot ride along in an extra field.
- `schemaVersion` plus an `upgradeGraph()` function exist from day one (the Design Studio lesson: the upgrade path must exist before the first real row is saved).
- Pinned test data is **not** in the graph (it lives on the `Automation` row, Module 03), so versions never carry test data.

### Ports

Ports are named handles, not types. A node definition declares:

```ts
inputs: [] | ['in']                     // triggers have none
outputs: PortSpec[]                     // { id: PortId, label: string }
```

| Node | Outputs |
|---|---|
| Most nodes | `out` |
| If / Else | `true` ("True"), `false` ("False") |
| Switch (Paths, P1) | one per case `case:<caseId>` (label from the case name) + `fallback` ("Otherwise") |
| Manual Review | `approved` ("Approved"), `rejected` ("Rejected"); an unconnected `rejected` ends the run as Rejected |
| Any node with `onError.mode = 'branch'` | an extra `error` port ("On Error"), drawn red |
| Filter | `out` only: a false condition ends that branch as skipped |

Connection rules (enforced by `canConnect()`, used live by the canvas, and again by `validateGraph`):

1. Never into a trigger. Never a node to itself.
2. A connection that would create a cycle is refused: "Workflows cannot loop back to an earlier step."
3. One edge per (source, sourcePort, target). Fan-out from one port to many targets is allowed (parallel branches).
4. A target with more than one incoming edge must be a **Merge** node, unless every incoming edge comes from mutually exclusive branches (for example True and False of the same If / Else rejoining). Otherwise: "Two branches that both run need a Merge step to join." (Validation issue, not a connect refusal, so users can draw then fix.)

`canConnect(graph, proposedEdge): { ok: true } | { ok: false, reason }` is pure and cheap (runs on every drag move).

### Node definition (`src/catalog/types.ts`)

```ts
NodeDefinition<C> = {
  type: NodeType, typeVersion: number,
  category: 'trigger' | 'postgear' | 'social' | 'ai' | 'logic' | 'notify' | 'data',
  title: string,              // Title Case: "Post Published"
  description: string,        // sentence case, one line
  keywords: string[],         // search: ['excel', 'spreadsheet', 'log']
  icon: IconKey,              // a string key; the web app maps it to an icon component
  family: ColourFamily,       // drives the stripe colour (see the UX blueprint)
  status: 'ready' | 'comingSoon',
  comingSoonReason?: string,  // "WhatsApp is coming soon."
  priority: 'P0' | 'P1' | 'P2',
  inputs, outputs,
  configSchema: ZodType<C>,   // .strict(); defaults for every field the template does not set
  defaultConfig: C,
  outputShape: OutputField[], // { path, label, type, sample } used for Insert Data and validation
  sideEffect: 'none' | 'internal' | 'external', // internal = writes PostGear data; external = leaves PostGear
  publishes?: boolean,        // true for postgear.publish: drives the automatic-posting tick
  connection?: ConnectionKind,// 'slack' | 'teams' | 'discord' | 'google' | 'http' | ...
  retry: 'none' | 'transient' | 'safe',  // safe = idempotent, may Retry From Here
  timeoutClass: 'fast' | 'slow',         // fast 30 s; slow 5 min with heartbeats (AI, Render Design), see Module 07
  credits?: (config) => number,          // AI nodes: estimated credits per run
  blocking?: 'delay' | 'review',         // the interpreter waits here
  canDisable: boolean,        // false for triggers, If / Else, Switch, Manual Review, Merge
  summary: (config, ctx) => string,      // "Every Monday at 08:00", "Channel is Instagram"
}
```

`outputShape` may depend on config (for example Set Fields outputs the fields the user defined, Manual Trigger outputs its input fields). Make it `outputShape: OutputField[] | ((config) => OutputField[])`.

### The catalog (`src/catalog/*.ts`, one file per category)

Declare **every** row of the sprint doc's Node Catalog, plus the additions marked below. Coming Soon nodes are declared with `status: 'comingSoon'` so the library can show them honestly.

| Type id | Title | Pri | Status now | Notes |
|---|---|---|---|---|
| `trigger.postPublished` | Post Published | P0 | ready | filters: channels[], tags[] |
| `trigger.postFailed` | Post Failed | P0 | ready | filters: channels[], reasons[] (`PublishFailureReason`) |
| `trigger.schedule` | Schedule | P0 | ready | see Module 02 for the schedule config and next runs |
| `trigger.manual` | Manual | P0 | ready | inputs: up to 5 fields `{ key, label, type: text|number|choice }` |
| `trigger.webhook` | Webhook | P1 | ready | Module 13 |
| `postgear.createDraft` | Create Draft | P0 | ready | Module 10 |
| `postgear.addToQueue` | Add To Queue | P1 | ready | Module 10 |
| `postgear.publish` | Publish To {Platform} | P1 | ready | one type, `config.provider` fixes the card; `publishes: true` |
| `postgear.getPost` | Get Post | P1 | ready | |
| `ai.generateText` | Generate Text | P0 | ready | Module 11 |
| `ai.generateImage` | Generate Image | P1 | ready | |
| `ai.generateHashtags` | Generate Hashtags | P1 | ready | |
| `ai.rewriteInBrandVoice` | Rewrite In Brand Voice | P1 | ready | |
| `ai.generateVideo` | Generate Video | - | comingSoon | "Video generation is coming soon." |
| `studio.renderDesign` | Render Design | P2 | comingSoon until Module 15 | |
| `logic.ifElse` | If / Else | P0 | ready | |
| `logic.switch` | Paths | P1 | ready | **addition** (Zapier Paths, Make Router): ordered cases + Otherwise |
| `logic.filter` | Filter | P0 | ready | |
| `logic.delay` | Delay | P0 | ready | `blocking: 'delay'` |
| `logic.manualReview` | Manual Review | P0 | ready | `blocking: 'review'` |
| `logic.setFields` | Set Fields | P0 | ready | |
| `logic.merge` | Merge | P1 | ready | waits for every incoming branch that will run |
| `notify.inApp` | In-App Notification | P0 | ready | `sideEffect: 'internal'` |
| `notify.slack` | Slack | P0 | ready | |
| `notify.teams` | Microsoft Teams | P1 | ready | Adaptive Card through the Teams Workflows app |
| `notify.discord` | Discord | P1 | ready | |
| `notify.email` | Email | P1 | ready | |
| `notify.whatsapp` | WhatsApp | P2 | comingSoon | "WhatsApp is coming soon." |
| `data.googleSheetsAppendRow` | Google Sheets: Append Row | P1 | ready | |
| `data.excelAppendRow` | Excel: Append Row | P2 | comingSoon | |
| `data.httpRequest` | HTTP Request | P1 | ready | |

"Ready" in the catalog means the definition is complete. Whether the node can actually run is decided by the executor registry in the worker (Module 07); the catalog endpoint (Module 03) reports a node as Coming Soon if the worker has no executor for it yet, so nothing half-built is ever addable.

Social Channels in the library are **views** of `postgear.publish` (one card per platform with `config.provider` preset), not separate types.

### Error policy (addition, n8n's "On Error" and Make's error routes, simplified)

```ts
OnErrorPolicy = {
  mode: 'stop' | 'continue' | 'branch',   // default 'stop'
  retries?: { max: 0..5, waitSeconds: 5..600 }  // on top of the automatic transient retries
}
```

- `stop` (default): the step fails, its branch stops, the run ends Failed once other branches finish.
- `continue`: the step is recorded as Failed but the run continues; its output is `{ error: { message, code } }`.
- `branch`: the node gets an `error` output port; the error object flows down that branch. The run is not Failed if the error branch succeeds.
- Triggers have no error policy. Manual Review has none (it cannot fail, it can only be rejected or expire).

### Disabled nodes (addition, n8n)

A disabled node is skipped and passes its input through. Downstream tokens that point at its own output resolve to empty, so `validateGraph` warns: "Slack is turned off, so 'Message ID' will be empty." Nodes with `canDisable: false` cannot be disabled (the UI says why).

### `validateGraph(graph, ctx)` (`src/validate/validate-graph.ts`)

Returns `ValidationIssue[]`, never throws:

```ts
ValidationIssue = {
  severity: 'error' | 'warning',   // errors block activation, warnings do not
  code: IssueCode,                 // stable string, e.g. 'graph.no_trigger'
  message: string,                 // sentence case, plain words, no jargon
  nodeKey?: string, edgeId?: string, field?: string,  // field = config path to focus
}
```

`ctx` carries what the pure package cannot know: `{ connections: { id, kind, status }[], channels: { id, provider, status }[], availableTypes?: Set<NodeType> }`. The web app and the API fill it; the worker passes the pinned snapshot's context.

Rules in this module (Module 02 adds token, condition and schedule rules through the same rule list):

| Code | Severity | Message (example) |
|---|---|---|
| `graph.no_trigger` | error | "Add a trigger to choose what starts this workflow." |
| `graph.many_triggers` | error | "A workflow can have only one trigger." |
| `graph.unreachable` | error | "This step is not connected to the trigger." |
| `graph.cycle` | error | "Workflows cannot loop back to an earlier step." |
| `graph.bad_port` | error | edge uses a port the node does not have |
| `graph.needs_merge` | error | "Two branches that both run need a Merge step to join." |
| `graph.too_many_nodes` | error | "Workflows can have up to 50 steps." |
| `node.unknown_type` | error | "This step type is not available any more." |
| `node.coming_soon` | error | "{Title} is coming soon, so it cannot run yet." |
| `node.not_runnable` | error | "{Title} cannot run yet in this version of PostGear." (the type is ready in the catalog but not in `ctx.availableTypes`, the worker's `EXECUTABLE_TYPES`; drafts may hold it, tests and activation may not) |
| `node.config_invalid` | error | one issue per Zod issue, with `field` set |
| `node.connection_missing` | error | "Connect a {app} account to use this step." |
| `node.connection_broken` | error | "{connection} needs to be reconnected." |
| `node.channel_missing` | error | "This channel is disconnected." |
| `node.duplicate_name` | error | names must be unique (tokens show names) |
| `node.disabled_output_used` | warning | see Disabled nodes |
| `graph.dead_end_output` | warning | an If / Else output with nothing after it: "Nothing happens when this is False." |
| `graph.empty_note` | none | notes are never validated |

Every rule is a small function `(graph, index, ctx) => ValidationIssue[]` in its own file, registered in one list. Module 02 appends to that list.

### Order and branch plan (`src/plan/*.ts`)

- `buildIndex(graph)`: maps of nodes by key, incoming and outgoing edges by port, computed once and passed to every rule.
- `topologicalOrder(graph)`: Kahn's algorithm with a stable tie-break (canvas y, then x, then key), so the same graph always runs in the same order. Never the canvas position alone.
- `upstreamOf(graph, key)`: every ancestor (used by tokens in Module 02).
- `exclusiveGroups(graph)`: which edges are mutually exclusive (both sides of one If / Else, cases of one Paths, approved and rejected of one Manual Review). Used by the Merge rule and by the interpreter to know a branch will not run.
- `planNext(graph, state)`: given the statuses of finished nodes, returns which nodes are now ready, which become `skipped` (their only incoming branch was not taken), and whether the run is finished. This is the function the Temporal workflow calls in a loop (Module 07). It must be pure and fully unit tested.

### Limits (`src/limits.ts`)

`maxNodes 50`, `maxEdges 120`, `maxNotes 30`, `maxStepExecutionsPerRun 200`, `maxParallelBranches 4`, `runTimeoutDays 30`, `reviewTimeoutDays 7`, `maxConcurrentRunsPerWorkspace 10`, `testRunsPerMinutePerUser 3`, `stepIoCapBytes 65536`, `webhookBodyCapBytes 262144`, `minScheduleMinutesWithAi 60`. Constants now; Module 15 maps them to plan entitlements.

## Tasks

- [x] Branch `sprint-10-workflow-builder` from `sprint-9-design-studio`.
- [x] Scaffold `packages/automation` (package.json, tsconfig, jest.config.js, biome lint), add the `paths` entry, check `npm run typecheck` sees it.
- [x] `graph/schema.ts` with `upgradeGraph()` and `emptyGraph()`.
- [x] `catalog/types.ts`, then one file per category, then `catalog/index.ts` exporting `NODE_CATALOG`, `getDefinition(type, version)`, `listDefinitions()`.
- [x] `ports.ts` with `canConnect()`.
- [x] `plan/` with `buildIndex`, `topologicalOrder`, `upstreamOf`, `exclusiveGroups`, `planNext`.
- [x] `validate/` with the rule list above.
- [x] `limits.ts`.
- [x] `src/index.ts` exports a small, documented public surface (no deep imports from apps).
- [x] Header comment on `index.ts` in the style of `packages/scheduling/src/index.ts`, saying why the package is pure.

## Tests (heavy; this is the foundation)

- Schema: strict refusal of extra keys; `upgradeGraph` of a v1 graph is identity.
- Every catalog entry: `defaultConfig` passes its own `configSchema`; `title` is Title Case (reuse the rule in `apps/web/src/lib/title-case.test.ts` or a copy of its helper); `description` is sentence case; Coming Soon entries have a reason; no two types share an id.
- `canConnect`: into trigger, self, cycle (direct and three-node), duplicate edge, fan-out allowed.
- `validateGraph`: one test per issue code, plus a clean graph returning `[]`.
- `planNext`: linear; If / Else true path with the false side skipped (and everything only reachable through it); Paths with fallback; Filter false skips the rest of its branch only; Manual Review rejected with and without a rejected edge; parallel fan-out; Merge waits for both branches when both run and for one when the other was skipped; disabled node passes through; `onError: continue` and `branch`.
- `topologicalOrder` is stable across runs and independent of array order.

## Done When

- `npm run validate` passes for the new package and nothing else broke.
- Coverage of `src/plan` and `src/validate` is high (aim for 95% lines).
- The public API is listed in the README progress entry (one line per export).

## Hand Check

Nothing visual yet. Run `npm test --workspace=@postgear/automation` and read the test names: they should read like the rules in this document.

## Handoff

Update the progress table and the decision log in [`README.md`](README.md): exported names, any rule you changed and why, and any catalog entry you had to reshape.
