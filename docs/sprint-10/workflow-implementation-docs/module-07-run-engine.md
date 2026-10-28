# Module 07: Run Engine On Temporal

> **Sprint 10, Workflow Builder** | Status: Not started | Size: XL (may need a second session)
> **Depends on**: [Module 03](module-03-data-model-and-api.md) (and Modules 01, 02 through it). Independent of Modules 04 to 06 except for the connection reads, which degrade to "no connection" until Module 04 lands.
> **Stories**: WF-5.2 (engine side), WF-10.1, WF-12.2 (cancel), WF-7.4 (engine side), edge cases "worker restarts", "same event twice"
> **Next**: [Module 08](module-08-test-runs-history-and-review.md)

## Goal

A run of any valid graph executes on the worker, durably, exactly as the graph says. After this module:

- `packages/scheduling` holds the automation contract;
- `automationRunWorkflow` interprets a pinned graph with `planNext` from `@postgear/automation`, deterministically;
- `executeNodeActivity` resolves data, runs one step through an executor, and writes a redacted `AutomationRunStep`;
- the logic steps, the Manual trigger and In-App Notification run for real; external steps run dry in tests; `AUTOMATION_SIMULATION` exists;
- Delay sleeps durably, Manual Review waits for a signal for up to 7 days, Cancel stops a run, On Error and retries behave as declared;
- the API can start test runs, test one step, list runs, show a run, stream its progress, cancel it, and record a review decision.

The UI for all of this is Module 08.

## Read First

1. [`README.md`](README.md); Module 01 "Order and branch plan" and "Error policy"; Module 02 "Tokens" and "Redaction".
2. Sprint doc: "Execution" (all of it), "Test runs vs live runs", "Limits".
3. Skill: `temporal-workflow` (it describes this repo's conventions for contract, workflow, activities, API start and tests).
4. Code: `packages/scheduling/src/workflows.ts` and `retry-policy.ts`, `apps/worker/src/workflows/webhook-delivery.workflow.ts` and its test (the harness to copy), `apps/worker/src/activities/index.ts` and `deps.ts`, `apps/worker/src/lib/webhook-start.ts` (best-effort start after commit), `apps/worker/src/activities/maintenance.activities.ts` (`reconcileSchedules`), `apps/worker/src/activities/integration.activities.ts` (how the worker writes a `Notifications` row with `emailStatus: PENDING`), `apps/worker/src/config/env.ts`, `apps/api/src/config/env.ts`, `apps/api/src/common/sse.ts`, `apps/api/src/modules/redis/redis.service.ts`.

## Scope

**In**: the contract; the workflow; the activities; the executor registry with the logic executors, Manual trigger and In-App Notification; the provider interface and simulation flag (no real provider yet); dry runs; On Error and retries; idempotency; limits; the run API (test runs, step test, list, detail, events, cancel, reviews); the maintenance reconcile; workflow tests.

**Out**: real triggers, Schedule, activation and live runs started by events (Module 09); Slack and other providers (Module 12); AI, PostGear and data steps (Modules 10, 11, 13); every screen (Module 08).

## Design

### Contract (`packages/scheduling/src/automations.ts`)

```ts
export const AUTOMATION_RUN_WORKFLOW = 'automationRunWorkflow';
export function automationRunWorkflowId(runId: string) { return `automation-run:${runId}`; }
export const REVIEW_DECISION_SIGNAL = 'reviewDecision';   // payload { nodeKey, decision: 'approved' | 'rejected' }
// Cancel reuses CANCEL_SIGNAL from workflows.ts.

export interface AutomationRunInput { runId: string; organizationId: string; }

export const AUTOMATION_FAILURE_TYPES = {
  retryable: 'AutomationRetryable',       // network, 429, 5xx, timeouts
  permanent: 'AutomationPermanent',       // 4xx, validation, bad data
  notConnected: 'AutomationNotConnected', // missing or broken connection
  outOfCredits: 'AutomationOutOfCredits', // Module 11
  limit: 'AutomationLimit',               // step budget exhausted
} as const;
export const NON_RETRYABLE_AUTOMATION_FAILURES = [/* every type except retryable */];

export const AUTOMATION_STEP_RETRY_POLICY = {   // transient errors, before the node's own retries
  initialIntervalMs: 5_000, backoffCoefficient: 3, maximumIntervalMs: 5 * 60_000, maximumAttempts: 4,
} as const;
export const AUTOMATION_STEP_TIMEOUT_MS = 120_000;   // AI steps may override (Module 11)
```

Values are data so the API can describe them and the worker enforce them, the same as `WEBHOOK_DELIVERY_RETRY_POLICY`.

### The workflow (`apps/worker/src/workflows/automation-run.workflow.ts`)

Deterministic interpreter. It imports only pure code (`@postgear/automation`'s `planNext` and `LIMITS`, `@postgear/scheduling`) and activity **types**.

1. `loadRunPlan({ runId })` (activity) returns `{ graph, mode, scope, sendForReal: string[] }`. `graph` is the pinned version's graph for LIVE runs, `graphSnapshot` for TEST runs. It marks the run `RUNNING` and sets `startedAt`. If the run is not `QUEUED` (a duplicate start), it returns `{ skip: true }` and the workflow ends.
2. **Workspace concurrency**: `claimRunSlot` (activity) answers whether fewer than `LIMITS.maxConcurrentRunsPerWorkspace` LIVE runs are `RUNNING`. If not, the workflow `sleep`s 30 s and asks again (test runs skip this).
3. Loop: `planNext(graph, state)` gives `ready`, `skipped` and `finished`. Skipped steps are written in one `recordSkipped` activity call. Ready steps start in parallel, at most `LIMITS.maxParallelBranches` (4) at a time, each through `executeNodeActivity({ runId, nodeKey })`.
4. The workflow keeps only **small** state in history: per node `{ status, ports: PortId[] }`. Outputs stay in the database; activities read them. This keeps the event history small for 50-step graphs.
5. Blocking steps are handled in the workflow:
   - **Delay**: `prepareDelay({ runId, nodeKey })` (activity) resolves the config (it may contain data, for example "until {{ trigger.post.publishAt }}"), writes a `WAITING` step, returns `waitMs` (capped at the run timeout). The workflow `sleep(waitMs)`, then `completeStep`.
   - **Manual Review**: `openReview({ runId, nodeKey })` writes the `WAITING` step and an in-app notification ("Your {workflow} is ready for review.", linking to `?run=<runId>`), sets the run `WAITING`. The workflow waits with `condition(() => decisions.has(nodeKey), '7 days')`. Approved or rejected goes to `closeReview`, which writes the decision as the step output and picks the `approved` or `rejected` port. Timeout writes the run `EXPIRED` ("Review expired"). A `rejected` port with nothing attached ends the run `REJECTED`.
6. **Cancel**: a `CANCEL_SIGNAL` handler sets a flag; in-flight activities run in a `CancellationScope` that is cancelled; no new steps start; `finishRun` writes `CANCELLED` and marks running and queued steps `CANCELLED`.
7. **Budget**: more than `LIMITS.maxStepExecutionsPerRun` (200) step executions fails the run with "This run used more than 200 steps."
8. **Finish**: `finishRun({ runId, outcome })` writes the final status, `finishedAt`, `stepCount`, `creditsUsed`, `error` (the first failure's sentence), and the denormalised `lastRunAt`, `lastRunStatus`, `lastRunError` on `Automation` (and `consecutiveFailures` for LIVE runs; Module 09 acts on it).
9. Workflow options when started: id `automationRunWorkflowId(runId)`, `workflowExecutionTimeout` 30 days, `workflowIdReusePolicy` reject duplicate.

### Errors, retries and On Error

- The node's activity options come from its definition's retry class plus its `onError.retries`:
  - `transient`: `AUTOMATION_STEP_RETRY_POLICY`, with `maximumAttempts` raised by the node's own retries (max 5 extra);
  - `none`: one attempt;
  - `nonRetryableErrorTypes`: `NON_RETRYABLE_AUTOMATION_FAILURES`.
- Each Temporal attempt writes its own step row (`attempt` from `Context.current().info.attempt`), so "Succeeded after 2 attempts" is a fact in the database, not a guess.
- When the activity finally fails, the workflow applies the node's `onError`:
  - `stop`: the node is `FAILED`; `planNext` skips everything that only that node feeds; other branches finish; the run ends `FAILED`.
  - `continue`: the step is rewritten as `HANDLED_ERROR` with output `{ error: { message, code } }`, and the `out` port continues.
  - `branch`: the same, but the `error` port continues instead.
- `outOfCredits` and `notConnected` ignore `continue` and `branch`, and always stop the run: there is no sensible "carry on" for them (user stories: "the run stops before anything else happens").
- **Timeouts per step kind**: the definition carries a `timeoutClass` (`fast` 30 s start-to-close for logic, notify and data steps; `slow` 5 minutes with a 30 s heartbeat for AI and Render Design steps, whose model calls and image generation can take a minute or more). Long executors call `Context.current().heartbeat()` while they wait. Build the option mapping now so Modules 11 and 15 only set the class.

### `executeNodeActivity` (`apps/worker/src/activities/automation.activities.ts`)

1. Load the run, the node definition, prior step outputs (latest succeeded or handled attempt per node), pinned or seeded outputs for step tests, connections the step uses (decrypted here, never logged).
2. Build the scope `{ trigger, nodes, run, workspace }` and resolve every templated config field with `resolveTemplate` (Module 02). Missing required data fails the step with the sentence from Module 02.
3. **Idempotency**: for `sideEffect !== 'none'`, look for an existing `SUCCEEDED` or `DRY_RUN` step row for `(runId, nodeKey)` in any attempt. If found, return its stored output without acting (a replayed or retried activity cannot post twice). Pass `idempotencyKey = ${runId}:${nodeKey}` to every provider that accepts one.
4. **Dry run**: in `TEST` mode, a node with `sideEffect: 'external'` or `publishes: true` runs dry unless its key is in the run's `sendForReal`. Dry means: validate, resolve, build the request, and return `{ dryRun: true, wouldSend: <redacted request summary> }` with step status `DRY_RUN`. Internal side effects (In-App Notification, Create Draft) run for real in tests, with "(Test)" added to what they create.
5. Run the executor, then write the step row through `redact()` with the 64 KB cap, `durationMs`, and the chosen ports.
6. Throw `ApplicationFailure` with the right `AUTOMATION_FAILURE_TYPES` type on failure (the message is the one sentence the user sees; details go into the step's `error.details`).

### Executors and providers (`apps/worker/src/automation/`)

```ts
interface Executor<C> {
  type: NodeType;
  run(ctx: ExecContext<C>): Promise<ExecResult>;   // ctx: resolved config, scope, mode, dryRun, idempotencyKey, deps, log
}
type ExecResult = { output: unknown; ports?: PortId[]; status?: 'succeeded' | 'dryRun' | 'handledError' };

interface AutomationProvider<Req> {          // the TriForms WorkflowActionProvider idea, PostGear-shaped
  kind: ConnectionKind;
  build(config, ctx): Req;                   // pure: the request the step would send
  describe(req): string;                     // "Slack message to Marketing Slack: 'New post on ...'" (dry run text)
  send(req, credentials, opts: { idempotencyKey, signal }): Promise<ProviderResult>;
  simulate(req): Promise<ProviderResult>;    // AUTOMATION_SIMULATION stand-in
}
type ProviderResult =
  | { ok: true; output: unknown }
  | { ok: false; retryable: boolean; code: string; message: string; connectionBroken?: boolean };
```

- `executors/index.ts` is the registry. A unit test asserts it matches `EXECUTABLE_TYPES` from `packages/automation` exactly; add this module's types to `EXECUTABLE_TYPES` in the same commit.
- Executors shipped now: `trigger.manual` (returns the run's inputs), and the "trigger output" pass-through for every trigger (the trigger's payload becomes `trigger`), `logic.ifElse` (port `true` or `false`, output includes the rule details from `evaluateCondition` for the inspector), `logic.switch` (first matching case or `fallback`), `logic.filter` (passes, or ends the branch: status `SKIPPED` downstream, never `FAILED`), `logic.setFields`, `logic.merge` (output: the merged outputs of the branches that ran, keyed by step name), `notify.inApp` (a `Notifications` row with `type: 'automation'`, title and content resolved, link to the run, `emailStatus: PENDING` so the existing outbox emails it, the same way `integration.activities.ts` writes one). Delay and Manual Review are workflow-handled (above).
- **Simulation**: `AUTOMATION_SIMULATION` (boolean, default false) in both `apps/worker/src/config/env.ts` and `apps/api/src/config/env.ts`, refused at boot when `NODE_ENV=production`, documented in `.env.example` next to `PUBLISH_SIMULATION`. When true, every provider's `simulate()` is used instead of `send()`; it logs the request summary to the worker console and returns a realistic success. Markers in any resolved text force failures, the same convention as `PUBLISH_SIMULATION`: `[simulate:429]` retryable, `[simulate:500]` retryable, `[simulate:401]` connection broken, `[simulate:400]` permanent. Read how the publisher implements its markers (`apps/worker/src/lib/publisher.ts`) and share the parser.
- **A store interface** (`RunStore`: `loadRun`, `stepOutputs`, `findSucceededStep`, `writeStep`, `updateRun`) with a Prisma implementation and an in-memory one, so executor tests and the workflow tests share the real code (TriForms' `DryRunStore` idea).

### Run API (`apps/api/src/modules/automations/runs/`)

| Route | Who | Notes |
|---|---|---|
| `POST /automations/:id/test-runs` | members | body `{ sendForReal?: nodeKey[], triggerData?: 'last' or 'sample' or 'pinned' }`. Blocked when the draft has structural errors or `node.not_runnable`; connection issues on steps that will run dry do **not** block a test. Creates a `TEST` run with `graphSnapshot` and the chosen trigger data, then starts the workflow (best-effort, like `webhook-start.ts`). Throttled to 3 per minute per user with `RedisService.incrementWithTtl('automation-test:<userId>', 60)`: "Too many test runs. Try again in a minute." |
| `POST /automations/:id/steps/:nodeKey/test` | members | a `TEST` run with `scope: { kind: 'step', nodeKey }`: upstream outputs come from pinned data, else the last test run, else `sampleScope` (Module 02), stored on the run as seeded outputs. Same throttle. |
| `GET /automations/:id/runs?mode=&status=&cursor=` | members | newest first, 25 per page |
| `GET /automation-runs/:runId` | members | the run plus steps (latest attempt per node, with `attempts` count); redacted again on the way out |
| `GET /automation-runs/:runId/events` | members | SSE: `step` and `run` events until the run is terminal |
| `POST /automation-runs/:runId/cancel` | members | signals `CANCEL_SIGNAL`; 409 if already finished |
| `POST /automation-runs/:runId/reviews/:nodeKey` | members | `{ decision: 'approved' or 'rejected', editedText? }` (edit is P1). Checks the step is `WAITING`; records `decidedById` and the edited text on the step, then signals `REVIEW_DECISION_SIGNAL`. A second decision is a 409 "This review was already answered." |

Add `seedOutputs Json?` and `options Json?` (`{ scope, sendForReal, triggerData }`) to `AutomationRun` with the `prisma-change` skill (small migration).

**Live progress: poll the database, not Redis pub/sub.** The SSE handler polls `AutomationRunStep where runId and updatedAt > cursor` and the run's status every 750 ms, sends changes, and closes when the run is terminal (or after 30 minutes; the client reconnects). Why: the worker is a separate process, `RedisService` deliberately exposes only counters and keys and has an in-memory fallback that cannot cross processes, and the notifications bell already uses a poll for the same reason (`notifications.dispatcher.ts`). The database is the source of truth either way. One indexed query per open run view per 750 ms is cheap; Redis pub/sub can be added later behind the same SSE contract if it ever is not.

### Maintenance

Extend `reconcileSchedules` in `maintenance.activities.ts`: start any `QUEUED` run older than 60 s whose workflow is not running (the `webhook-start.ts` pattern), and mark `RUNNING` or `WAITING` runs whose workflow no longer exists as `FAILED` with "This run was interrupted." Pruning old runs is Module 09.

## Tasks

- [ ] Contract in `packages/scheduling` plus its unit test (ids, policy values).
- [ ] `AutomationRun.seedOutputs` and `options` migration.
- [ ] `RunStore` (Prisma and memory), executor registry, the shipped executors, `EXECUTABLE_TYPES` updated.
- [ ] Provider interface, simulation flag in both env schemas and `.env.example`, shared marker parser.
- [ ] `executeNodeActivity`, `loadRunPlan`, `claimRunSlot`, `recordSkipped`, `prepareDelay`, `openReview`, `closeReview`, `completeStep`, `finishRun`, registered in `activities/index.ts`.
- [ ] `automationRunWorkflow`, exported from `workflows/index.ts`.
- [ ] Run API routes, the SSE poller, the throttle.
- [ ] Maintenance reconcile.

## Tests

- **Workflow tests** with `TestWorkflowEnvironment.createTimeSkipping()` and mocked activities, copying `webhook-delivery.workflow.test.ts`:
  - linear success; If / Else with the false side skipped; Paths falling to Otherwise; Filter false skipping only its branch;
  - parallel fan-out capped at 4 (assert the maximum number of concurrent activity calls);
  - Delay of 3 days completes under time skipping;
  - Manual Review approved, rejected with and without a rejected edge (`REJECTED` outcome), and 7-day timeout (`EXPIRED`);
  - Cancel while a step runs and while waiting for review;
  - `onError` stop, continue (`HANDLED_ERROR`, run succeeds) and branch;
  - transient failure retried then succeeding (two attempts); permanent failure not retried; `notConnected` stopping the run even with `continue`;
  - the 200-step budget.
- **Replay**: run a recorded history through `Worker.runReplayHistory` to prove determinism.
- **Idempotency**: call `executeNodeActivity` twice for the same side-effect step with the memory store; the provider is called once and the second call returns the stored output.
- **Executors**: each logic executor with real `@postgear/automation` conditions; In-App Notification writes one row with `emailStatus: PENDING`; dry run writes `DRY_RUN` with a `wouldSend` text and never calls `send()` or `simulate()`.
- **API specs**: test-run throttle (fourth call in a minute is 429); tenancy 404 on runs and reviews; review on a non-waiting step is 409; run detail never contains a connection value (seed one in a step input and assert it comes back as `[hidden]`).
- Registry and `EXECUTABLE_TYPES` match exactly.

## Done When

- `npm run validate` passes, including the new workflow tests.
- With the worker running, `POST /automations/:id/test-runs` on a Manual, If / Else, Set Fields, In-App Notification graph finishes `SUCCEEDED`, and a notification appears in the bell.
- Stopping and restarting the worker during a Manual Review wait leaves the run `WAITING`; approving afterwards finishes it.

## Hand Check

1. Start everything (`npm run dev`), sign in as the demo admin.
2. Create a workflow through the API or the Module 05 canvas: Manual, Manual Review, In-App Notification. Start a test run with `curl` or the browser console.
3. The bell shows "ready for review". Restart the worker (`Ctrl+C`, `npm run dev:worker`). Approve with `POST /automation-runs/:runId/reviews/:nodeKey`. The run finishes and a second notification arrives.
4. Open Temporal UI (http://localhost:8233) and find `automation-run:<runId>`: the history is short and readable.

## Handoff

Update [`README.md`](README.md): progress row (routes, activities), decision log (database polling for live progress; the run status and step status rules; anything that changed in `planNext`'s contract), and list the exact SSE event shapes for Module 08.
