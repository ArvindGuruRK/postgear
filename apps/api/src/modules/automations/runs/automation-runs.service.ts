/**
 * Workflow runs from the API side (Sprint 10, Module 07): start a test of
 * the whole draft or of one step, list a workflow's runs, show one run,
 * cancel it, and answer a Manual Review. The worker runs every step; the
 * API only writes rows and starts or signals `automationRunWorkflow`.
 *
 * - **A test is checked first, and only blocks on what would break it.**
 *   The saved draft goes through `validateGraph` with the workspace's
 *   connections and channels. Any error blocks, except a connection or
 *   channel problem on a step that will run dry (an outside effect or a
 *   publish, not switched to send for real): a dry run sends nothing, so
 *   it needs no working account. A step test only looks at that step.
 * - **Trigger data**: pinned on the trigger, else the newest run's, else
 *   Module 02's sample (or the one asked for). Manual trigger inputs are
 *   laid over it (`manual-inputs.ts`).
 * - **A step test seeds every step before it** (and the trigger) with its
 *   pinned output, else its output in the latest test run that has one,
 *   else a sample built from the seeds before it. The worker reads them
 *   from `AutomationRun.seedOutputs` and runs only that step.
 * - **The row comes first, the workflow second.** A failed start leaves the
 *   run QUEUED and the worker's reconcile starts it within 15 minutes.
 * - **Throttled per person**: three test runs a minute, counted only once
 *   a test passed its checks, so fixing a refused test never uses one up.
 * - **A review decision is written before the signal, and undone if the
 *   signal fails**, with a conditional write, so two people answering at
 *   once get one decision and one 409. It records who decided by name
 *   (`reviewedBy`) and a rejection's reason (Module 08).
 * - **Retry From Here** (Module 08) makes a new run that copies the steps
 *   finished before the failed one; **Run Now** (Module 09) makes a LIVE run
 *   of an active Manual workflow. Both are started like test runs.
 * - **A run a Schedule started has its own Temporal workflow id**
 *   (`temporalWorkflowId`); Cancel and the review signal use it.
 * - **Tenancy**: every read is scoped to the active workspace; another
 *   workspace's workflow, run or step is a 404, never a 403.
 */
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  buildIndex,
  type GraphIndex,
  type GraphNode,
  getDefinition,
  type IssueCode,
  LIMITS,
  NODE_KEY_PATTERN,
  type RunScope,
  redact,
  SAMPLE_RUN,
  stepSample,
  triggerSample,
  upgradeGraph,
  upstreamOf,
  type ValidationIssue,
  validateGraph,
} from '@postgear/automation';
import {
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepStatus,
  Prisma,
} from '@postgear/db';
import type {
  AutomationReviewOutput,
  AutomationRunOptions,
  AutomationTriggerData,
  ReviewDecision,
} from '@postgear/scheduling';
import { RedisService } from '../../redis/redis.service';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { AutomationContextService } from '../automation-context.service';
import { RUN_MESSAGES } from './automation-runs.messages';
import {
  AutomationRunsRepository,
  type ReviewStepRow,
  type RunSummaryRow,
  type TestableAutomation,
  type TriggerFacts,
} from './automation-runs.repository';
import {
  type ListRunsQuery,
  type ReviewDecisionInput,
  RUNS_PAGE_SIZE,
  type RunNowInput,
  type StartTestRunInput,
  type StepTestInput,
} from './dto/automation-runs.schema';
import { applyManualInputs } from './manual-inputs';
import {
  connectionValuesOf,
  PHRASED_TRIGGER_TYPES,
  type RunDetail,
  type RunSummary,
  TERMINAL_RUN_STATUSES,
  toRunDetail,
  toRunSummary,
  triggerFactsOf,
} from './run-views';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Redis key of one person's test run count; it lives one minute. */
export function testThrottleKey(userId: string): string {
  return `automation-test:${userId}`;
}

const THROTTLE_WINDOW_SECONDS = 60;

/** Problems a dry run does not care about: it reaches no outside account. */
const EXCUSED_WHEN_DRY: ReadonlySet<IssueCode> = new Set<IssueCode>([
  'node.connection_missing',
  'node.connection_broken',
  'node.channel_missing',
  'node.channel_wrong_platform',
]);

/** A run the workflow may still be working on. */
const OPEN_RUN_STATUSES = [
  AutomationRunStatus.QUEUED,
  AutomationRunStatus.RUNNING,
  AutomationRunStatus.WAITING,
];

const MANUAL_REVIEW_TYPE = 'logic.manualReview';
const MANUAL_TRIGGER_TYPE = 'trigger.manual';

/** Steps Retry From Here copies into the new run as finished: they left an output. */
const SEEDABLE_STEP_STATUSES: ReadonlySet<AutomationStepStatus> = new Set([
  AutomationStepStatus.SUCCEEDED,
  AutomationStepStatus.DRY_RUN,
  AutomationStepStatus.HANDLED_ERROR,
]);

export interface ReviewAnswer {
  nodeKey: string;
  decision: ReviewDecision;
  decidedAt: string;
}

@Injectable()
export class AutomationRunsService {
  private readonly logger = new Logger(AutomationRunsService.name);

  constructor(
    private readonly repository: AutomationRunsRepository,
    private readonly context: AutomationContextService,
    private readonly scheduling: SchedulingService,
    private readonly redis: RedisService,
  ) {}

  /** Test Workflow: a TEST run of the saved draft from its trigger. */
  async startTestRun(
    orgId: string,
    userId: string,
    automationId: string,
    input: StartTestRunInput = {},
  ): Promise<RunSummary> {
    const automation = await this.findAutomationOrThrow(orgId, automationId);
    const graph = upgradeGraph(automation.draftGraph);
    const index = buildIndex(graph);
    const trigger = index.triggers[0];
    if (!trigger) throw unprocessable(RUN_MESSAGES.NO_TRIGGER, 'no_trigger');

    const sendForReal = [...new Set(input.sendForReal ?? [])];
    if (sendForReal.some((key) => !index.nodes.has(key))) {
      throw unprocessable(RUN_MESSAGES.SEND_FOR_REAL_UNKNOWN, 'send_for_real_unknown');
    }

    const real = new Set(sendForReal);
    const dry = new Set(graph.nodes.filter((node) => runsDry(node, real)).map((node) => node.key));
    const issues = validateGraph(graph, await this.context.forOrg(orgId));
    const blocking = issues.filter((issue) => blocks(issue, dry));
    if (blocking.length > 0) throw testBlocked(RUN_MESSAGES.TEST_BLOCKED, blocking.length);

    let { payload, source } = await this.triggerData(orgId, automation, trigger, input.triggerData);
    if (input.inputs !== undefined) {
      if (trigger.type !== MANUAL_TRIGGER_TYPE) {
        throw unprocessable(RUN_MESSAGES.INPUTS_NEED_MANUAL, 'inputs_need_manual');
      }
      const applied = applyManualInputs(trigger.config, payload, input.inputs);
      if (!applied.ok) throw unprocessable(applied.message, 'invalid_inputs');
      payload = applied.payload;
    }

    await this.throttle(userId);

    const options: AutomationRunOptions = {
      scope: { kind: 'run' },
      sendForReal,
      triggerData: source,
    };
    const run = await this.repository.createRun(orgId, {
      automationId: automation.id,
      triggerType: trigger.type,
      triggerPayload: toJsonInput(capped(payload)),
      graphSnapshot: graph as unknown as Prisma.InputJsonValue,
      options: options as unknown as Prisma.InputJsonValue,
      startedById: userId,
    });
    return this.start(orgId, run);
  }

  /** Test Step: a TEST run of one step, with the steps before it seeded. */
  async startStepTest(
    orgId: string,
    userId: string,
    automationId: string,
    nodeKey: string,
    input: StepTestInput = {},
  ): Promise<RunSummary> {
    const automation = await this.findAutomationOrThrow(orgId, automationId);
    const graph = NODE_KEY_PATTERN.test(nodeKey) ? upgradeGraph(automation.draftGraph) : null;
    const node = graph?.nodes.find((candidate) => candidate.key === nodeKey);
    if (!graph || !node) throw new NotFoundException(RUN_MESSAGES.STEP_NOT_FOUND);
    if (node.disabled) throw unprocessable(RUN_MESSAGES.STEP_TURNED_OFF, 'step_turned_off');

    const index = buildIndex(graph);
    const trigger = index.triggers[0];
    if (!trigger) throw unprocessable(RUN_MESSAGES.NO_TRIGGER, 'no_trigger');

    const sendForReal = input.sendForReal ? [nodeKey] : [];
    const dry = runsDry(node, new Set(sendForReal)) ? new Set([nodeKey]) : new Set<string>();
    const issues = validateGraph(graph, await this.context.forOrg(orgId));
    const blocking = issues.filter(
      (issue) =>
        (issue.nodeKey === nodeKey || issue.code === 'graph.check_failed') && blocks(issue, dry),
    );
    if (blocking.length > 0) throw testBlocked(RUN_MESSAGES.STEP_TEST_BLOCKED, blocking.length);

    const seeded = await this.seedOutputs(orgId, automation, index, trigger, nodeKey);

    await this.throttle(userId);

    const options: AutomationRunOptions = {
      scope: { kind: 'step', nodeKey },
      sendForReal,
      triggerData: seeded.triggerData,
    };
    const run = await this.repository.createRun(orgId, {
      automationId: automation.id,
      triggerType: trigger.type,
      triggerPayload: toJsonInput(seeded.outputs[trigger.key]),
      graphSnapshot: graph as unknown as Prisma.InputJsonValue,
      seedOutputs: seeded.outputs as Prisma.InputJsonValue,
      options: options as unknown as Prisma.InputJsonValue,
      startedById: userId,
    });
    return this.start(orgId, run);
  }

  /** A workflow's runs, newest first, 25 a page. */
  async listRuns(
    orgId: string,
    automationId: string,
    query: ListRunsQuery,
  ): Promise<{ runs: RunSummary[]; nextCursor: string | null }> {
    const exists =
      UUID_PATTERN.test(automationId) &&
      (await this.repository.automationExists(orgId, automationId));
    if (!exists) throw new NotFoundException(RUN_MESSAGES.WORKFLOW_NOT_FOUND);

    const page = await this.repository.listRuns(orgId, automationId, {
      mode: query.mode,
      status: query.status,
      cursor: query.cursor,
      take: RUNS_PAGE_SIZE,
    });
    const rows = page.slice(0, RUNS_PAGE_SIZE);
    const phrased = rows.filter((row) => PHRASED_TRIGGER_TYPES.has(row.triggerType));
    const [facts, connectionValues] = await Promise.all([
      this.repository.triggerFacts(
        orgId,
        phrased.map((row) => row.id),
      ),
      this.connectionValues(orgId),
    ]);
    return {
      runs: rows.map((row) => toRunSummary(row, facts.get(row.id), connectionValues)),
      nextCursor: page.length > RUNS_PAGE_SIZE ? rows[rows.length - 1].id : null,
    };
  }

  /** One run with the latest attempt of each step, redacted again on the way out. */
  async getRun(orgId: string, runId: string): Promise<RunDetail> {
    const run = UUID_PATTERN.test(runId) ? await this.repository.findRun(orgId, runId) : null;
    if (!run) throw new NotFoundException(RUN_MESSAGES.RUN_NOT_FOUND);

    const [steps, connectionValues] = await Promise.all([
      this.repository.latestSteps(orgId, runId),
      this.connectionValues(orgId),
    ]);
    return toRunDetail(run, steps, connectionValues);
  }

  /**
   * Stops a run. A running or waiting workflow is signalled and writes
   * CANCELLED itself. A run whose workflow cannot be signalled is closed
   * here: a QUEUED one (never started, or its start was lost; a workflow
   * started later skips a run that is not open), or any open one whose
   * workflow no longer exists.
   */
  async cancel(orgId: string, runId: string): Promise<RunSummary> {
    const run = await this.findRunOrThrow(orgId, runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) throw runFinished();

    const outcome = await this.scheduling.cancelAutomationRun(runId, run.temporalWorkflowId);
    if (outcome !== 'signalled') {
      const statuses = outcome === 'notFound' ? OPEN_RUN_STATUSES : [AutomationRunStatus.QUEUED];
      if (!(await this.repository.cancelRun(orgId, runId, statuses))) {
        const now = await this.repository.findRunSummary(orgId, runId);
        if (!now) throw new NotFoundException(RUN_MESSAGES.RUN_NOT_FOUND);
        if (TERMINAL_RUN_STATUSES.has(now.status)) throw runFinished();
        throw engineUnavailable(RUN_MESSAGES.ENGINE_UNAVAILABLE);
      }
    }

    return toRunSummary((await this.repository.findRunSummary(orgId, runId)) ?? run);
  }

  /**
   * Answers a waiting Manual Review. The decision (with who and when, and
   * the edited text) goes into the step's output first, only while the step
   * is still waiting and unanswered; then the workflow is told which way to
   * go. If it cannot be told, the decision is taken back so the person can
   * try again.
   */
  async review(
    orgId: string,
    userId: string,
    runId: string,
    nodeKey: string,
    input: ReviewDecisionInput,
  ): Promise<ReviewAnswer> {
    const run = await this.findRunOrThrow(orgId, runId);
    const step = NODE_KEY_PATTERN.test(nodeKey)
      ? await this.repository.latestAttempt(orgId, runId, nodeKey)
      : null;
    if (!step) throw new NotFoundException(RUN_MESSAGES.RUN_STEP_NOT_FOUND);
    if (isAnsweredReview(step)) throw reviewAnswered();
    if (
      step.nodeType !== MANUAL_REVIEW_TYPE ||
      step.status !== AutomationStepStatus.WAITING ||
      TERMINAL_RUN_STATUSES.has(run.status)
    ) {
      throw reviewNotWaiting();
    }

    const reviewedBy = await this.repository.userName(userId);
    const reason = input.reason?.trim();
    const output: AutomationReviewOutput = {
      decision: input.decision,
      decidedById: userId,
      decidedAt: new Date().toISOString(),
      ...(reviewedBy ? { reviewedBy } : {}),
      ...(reason ? { reason } : {}),
      ...(input.editedText ? { editedText: input.editedText } : {}),
    };
    const recorded = await this.repository.recordReview(
      orgId,
      step.id,
      output as unknown as Prisma.InputJsonValue,
    );
    if (!recorded) {
      const now = await this.repository.latestAttempt(orgId, runId, nodeKey);
      throw now && isAnsweredReview(now) ? reviewAnswered() : reviewNotWaiting();
    }

    const outcome = await this.scheduling.signalReviewDecision(
      runId,
      { nodeKey, decision: input.decision },
      run.temporalWorkflowId,
    );
    if (outcome !== 'signalled') {
      await this.repository.clearReview(orgId, step.id);
      throw engineUnavailable(RUN_MESSAGES.REVIEW_NOT_SENT);
    }

    return { nodeKey, decision: input.decision, decidedAt: output.decidedAt };
  }

  /**
   * Retry From Here (Module 08): a new run of the same graph and trigger
   * data that starts at a failed step. Every step that finished before it
   * (and does not come after it) is copied into the new run as it ended,
   * its output in `seedOutputs` and its ports in `options.retry.ports`, so
   * the worker never runs it again; the failed step and everything after it
   * run normally.
   *
   * Refused while the run is still going, for a step that did not fail, for
   * a step that is not safe to repeat (publishing steps never are), and for
   * a live run of a version that is no longer live. A test retry counts
   * against the test-run throttle.
   */
  async retry(
    orgId: string,
    userId: string,
    runId: string,
    fromNodeKey: string,
  ): Promise<RunSummary> {
    const run = UUID_PATTERN.test(runId)
      ? await this.repository.findRetrySource(orgId, runId)
      : null;
    if (!run) throw new NotFoundException(RUN_MESSAGES.RUN_NOT_FOUND);
    if (!TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new ConflictException({
        message: RUN_MESSAGES.RUN_NOT_FINISHED,
        code: 'run_not_finished',
      });
    }

    const live = run.mode === AutomationRunMode.LIVE;
    const stored = live ? (run.version?.graph ?? null) : run.graphSnapshot;
    const graph = stored === null ? null : upgradeGraph(stored);
    const node = graph?.nodes.find((candidate) => candidate.key === fromNodeKey);
    const steps = node ? await this.repository.latestSteps(orgId, runId) : [];
    const failed = steps.find((entry) => entry.step.nodeKey === fromNodeKey);
    if (!graph || !node || failed?.step.status !== AutomationStepStatus.FAILED) {
      throw unprocessable(RUN_MESSAGES.RETRY_STEP_NOT_FAILED, 'retry_step_not_failed');
    }

    const definition = getDefinition(node.type, node.typeVersion);
    if (definition?.publishes) {
      throw unprocessable(RUN_MESSAGES.RETRY_PUBLISH_NOT_SAFE, 'retry_not_safe');
    }
    if (definition?.retry !== 'safe') {
      throw unprocessable(RUN_MESSAGES.RETRY_NOT_SAFE, 'retry_not_safe');
    }
    if (live && (!run.versionId || run.versionId !== run.automation.activeVersionId)) {
      throw unprocessable(RUN_MESSAGES.RETRY_OLD_VERSION, 'retry_old_version');
    }

    if (!live) await this.throttle(userId);

    const index = buildIndex(graph);
    const after = reachableFrom(index, fromNodeKey);
    const seeded = steps
      .map((entry) => entry.step)
      .filter(
        (step) =>
          SEEDABLE_STEP_STATUSES.has(step.status) &&
          index.nodes.has(step.nodeKey) &&
          !after.has(step.nodeKey),
      );

    // A step test's retry still needs the seeds its tested step started from.
    const previous = (run.options as AutomationRunOptions | null) ?? null;
    const baseSeeds =
      previous?.scope.kind === 'step' && isRecord(run.seedOutputs) ? run.seedOutputs : {};
    const seedOutputs: Record<string, unknown> = { ...baseSeeds };
    const ports: Record<string, string[]> = {};
    for (const step of seeded) {
      seedOutputs[step.nodeKey] = step.output;
      ports[step.nodeKey] = [...step.ports];
    }

    const options: AutomationRunOptions = {
      ...(previous ?? { scope: { kind: 'run' }, sendForReal: [], triggerData: 'last' }),
      retry: { of: run.id, fromNodeKey, ports },
    };
    const created = await this.repository.createRetryRun(
      orgId,
      {
        automationId: run.automationId,
        mode: run.mode,
        versionId: run.versionId,
        triggerType: run.triggerType,
        triggerPayload: toJsonInput(run.triggerPayload),
        ...(run.graphSnapshot === null
          ? {}
          : { graphSnapshot: run.graphSnapshot as Prisma.InputJsonValue }),
        seedOutputs: seedOutputs as Prisma.InputJsonValue,
        options: options as unknown as Prisma.InputJsonValue,
        startedById: userId,
      },
      seeded.map((step) => ({
        nodeKey: step.nodeKey,
        nodeType: step.nodeType,
        nodeName: step.nodeName,
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error,
        ports: step.ports,
        truncated: step.truncated,
        durationMs: step.durationMs,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
      })),
    );
    return this.start(orgId, created, triggerFactsOf(run.triggerPayload));
  }

  /**
   * Run Now (Module 09): a LIVE run of a workflow that is on and starts with
   * a Manual trigger, on its live version, with the inputs checked against
   * that version's fields. Started like a test run: the row first, then the
   * workflow, best-effort.
   */
  async runNow(
    orgId: string,
    userId: string,
    automationId: string,
    input: RunNowInput = {},
  ): Promise<RunSummary> {
    const automation = UUID_PATTERN.test(automationId)
      ? await this.repository.findLiveAutomation(orgId, automationId)
      : null;
    if (!automation) throw new NotFoundException(RUN_MESSAGES.WORKFLOW_NOT_FOUND);

    const version = automation.activeVersion;
    const trigger =
      automation.status === AutomationStatus.ACTIVE && version?.triggerType === MANUAL_TRIGGER_TYPE
        ? buildIndex(upgradeGraph(version.graph)).triggers[0]
        : undefined;
    if (!version || trigger?.type !== MANUAL_TRIGGER_TYPE) {
      throw unprocessable(RUN_MESSAGES.RUN_NOW_UNAVAILABLE, 'run_now_unavailable');
    }

    const applied = applyManualInputs(trigger.config, {}, input.inputs ?? {});
    if (!applied.ok) throw unprocessable(applied.message, 'invalid_inputs');

    const run = await this.repository.createRun(orgId, {
      automationId: automation.id,
      mode: AutomationRunMode.LIVE,
      versionId: version.id,
      triggerType: trigger.type,
      triggerPayload: toJsonInput(capped(applied.payload)),
      startedById: userId,
    });
    return this.start(orgId, run);
  }

  /** The workspace's connection values, decrypted only to hide them in run data. */
  async connectionValues(orgId: string): Promise<string[]> {
    const { values, unreadable } = connectionValuesOf(
      await this.repository.connectionCredentials(orgId),
    );
    if (unreadable > 0) {
      this.logger.warn(
        JSON.stringify({ event: 'automation.connections.unreadable', orgId, count: unreadable }),
      );
    }
    return values;
  }

  /** Starts the workflow for a new run, best-effort, and answers with the run. */
  private async start(
    orgId: string,
    run: RunSummaryRow,
    facts?: TriggerFacts,
  ): Promise<RunSummary> {
    // False is logged by the scheduler; the reconcile starts the run later.
    await this.scheduling.startAutomationRun(run.id, orgId);
    return toRunSummary(run, facts);
  }

  /** Three test runs a minute per person (`LIMITS.testRunsPerMinutePerUser`). */
  private async throttle(userId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      testThrottleKey(userId),
      THROTTLE_WINDOW_SECONDS,
    );
    if (count > LIMITS.testRunsPerMinutePerUser) {
      throw new HttpException(
        { message: RUN_MESSAGES.TOO_MANY_TESTS, code: 'test_runs_throttled' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * A test run's trigger data: the one asked for, or pinned, else the
   * newest run's (same trigger type, test or live), else the sample.
   */
  private async triggerData(
    orgId: string,
    automation: TestableAutomation,
    trigger: GraphNode,
    requested: AutomationTriggerData | undefined,
  ): Promise<{ payload: unknown; source: AutomationTriggerData }> {
    const pinned = pinnedOutputs(automation.pinnedData);
    if (requested === 'pinned' || (requested === undefined && pinned.has(trigger.key))) {
      if (!pinned.has(trigger.key))
        throw unprocessable(RUN_MESSAGES.NO_PINNED_DATA, 'no_pinned_data');
      return { payload: pinned.get(trigger.key), source: 'pinned' };
    }

    if (requested !== 'sample') {
      const last = await this.repository.latestTriggerPayload(orgId, automation.id, trigger.type);
      if (last) return { payload: last.payload, source: 'last' };
      if (requested === 'last') throw unprocessable(RUN_MESSAGES.NO_LAST_RUN, 'no_last_run');
    }

    return { payload: sampleTriggerOutput(automation, trigger), source: 'sample' };
  }

  /**
   * The outputs a step test starts from: the trigger and every step before
   * the tested one (turned-off steps give nothing, as in a real run), in run
   * order, each from its pin, else the latest test run that has it, else a
   * sample built on the seeds before it. `triggerData` says where the
   * trigger's came from.
   */
  private async seedOutputs(
    orgId: string,
    automation: TestableAutomation,
    index: GraphIndex,
    trigger: GraphNode,
    nodeKey: string,
  ): Promise<{ outputs: Record<string, unknown>; triggerData: AutomationTriggerData }> {
    const wanted = new Set([trigger.key, ...upstreamOf(index, nodeKey)]);
    const keys = [...index.order, ...index.cyclic].filter(
      (key) => wanted.has(key) && !index.nodes.get(key)?.disabled,
    );

    const pinned = pinnedOutputs(automation.pinnedData);
    const last = await this.repository.latestTestOutputs(
      orgId,
      automation.id,
      keys.filter((key) => !pinned.has(key)),
    );

    const nodes: Record<string, { output: unknown }> = {};
    const scope: RunScope = {
      nodes,
      run: { ...SAMPLE_RUN },
      workspace: { name: automation.organization.name },
    };
    const outputs: Record<string, unknown> = {};
    let triggerData: AutomationTriggerData = 'sample';

    for (const key of keys) {
      const node = index.nodes.get(key);
      if (!node) continue;

      let output: unknown;
      let source: AutomationTriggerData;
      if (pinned.has(key)) {
        output = pinned.get(key);
        source = 'pinned';
      } else if (last.has(key)) {
        output = last.get(key);
        source = 'last';
      } else {
        output =
          key === trigger.key ? sampleTriggerOutput(automation, node) : stepSample(node, scope);
        source = 'sample';
      }

      output = capped(output);
      outputs[key] = output;
      if (key === trigger.key) {
        scope.trigger = output;
        triggerData = source;
      } else {
        nodes[key] = { output };
      }
    }

    return { outputs, triggerData };
  }

  private async findAutomationOrThrow(orgId: string, id: string): Promise<TestableAutomation> {
    const row = UUID_PATTERN.test(id) ? await this.repository.findAutomation(orgId, id) : null;
    if (!row) throw new NotFoundException(RUN_MESSAGES.WORKFLOW_NOT_FOUND);
    return row;
  }

  private async findRunOrThrow(orgId: string, runId: string): Promise<RunSummaryRow> {
    const row = UUID_PATTERN.test(runId)
      ? await this.repository.findRunSummary(orgId, runId)
      : null;
    if (!row) throw new NotFoundException(RUN_MESSAGES.RUN_NOT_FOUND);
    return row;
  }
}

/** True when a test runs this step dry: an outside effect or a publish, not sent for real. */
export function runsDry(node: GraphNode, sendForReal: ReadonlySet<string>): boolean {
  const definition = getDefinition(node.type, node.typeVersion);
  if (!definition || sendForReal.has(node.key)) return false;
  return definition.sideEffect === 'external' || definition.publishes === true;
}

/**
 * `from` and every step its lines lead to: what a retry from `from` runs
 * again. (`reaches` in `@postgear/automation` answers one pair at a time and
 * is not exported from the package root.)
 */
export function reachableFrom(index: GraphIndex, from: string): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const edge of index.outgoing.get(key) ?? []) stack.push(edge.target);
  }
  return seen;
}

/** Whether an issue stops a test: every error, except account problems of dry steps. */
function blocks(issue: ValidationIssue, dry: ReadonlySet<string>): boolean {
  if (issue.severity !== 'error') return false;
  return !(issue.nodeKey && dry.has(issue.nodeKey) && EXCUSED_WHEN_DRY.has(issue.code));
}

/** `Automation.pinnedData` is `{ [nodeKey]: { output, pinnedAt, pinnedById } }`. */
/**
 * A trigger's sample data. For the Webhook trigger, the last body it
 * received (Module 13: saved even while the workflow is off, so the first
 * call from the other app becomes the test data); else the catalog sample.
 */
export function sampleTriggerOutput(
  automation: Pick<TestableAutomation, 'webhookSample' | 'webhookSampleAt'>,
  trigger: GraphNode,
): unknown {
  if (trigger.type === 'trigger.webhook' && isRecord(automation.webhookSample)) {
    return {
      body: automation.webhookSample,
      receivedAt: (automation.webhookSampleAt ?? new Date()).toISOString(),
      headers: { contentType: 'application/json' },
    };
  }
  return triggerSample(trigger);
}

function pinnedOutputs(pinnedData: unknown): Map<string, unknown> {
  const pins = new Map<string, unknown>();
  if (!isRecord(pinnedData)) return pins;
  for (const [key, entry] of Object.entries(pinnedData)) {
    if (isRecord(entry) && Object.hasOwn(entry, 'output')) pins.set(key, entry.output);
  }
  return pins;
}

function isAnsweredReview(step: ReviewStepRow): boolean {
  if (step.nodeType !== MANUAL_REVIEW_TYPE || !isRecord(step.output)) return false;
  return step.output.decision === 'approved' || step.output.decision === 'rejected';
}

/** Redacted and capped at 64 KB, as every stored run value is. */
function capped(value: unknown): unknown {
  return redact(value ?? null, { capBytes: LIMITS.stepIoCapBytes }).value;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unprocessable(message: string, code: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ message, code });
}

function testBlocked(message: string, issues: number): UnprocessableEntityException {
  return new UnprocessableEntityException({ message, code: 'test_blocked', details: { issues } });
}

function runFinished(): ConflictException {
  return new ConflictException({ message: RUN_MESSAGES.ALREADY_FINISHED, code: 'run_finished' });
}

function reviewNotWaiting(): ConflictException {
  return new ConflictException({ message: RUN_MESSAGES.NOT_WAITING, code: 'review_not_waiting' });
}

function reviewAnswered(): ConflictException {
  return new ConflictException({ message: RUN_MESSAGES.ALREADY_ANSWERED, code: 'review_answered' });
}

function engineUnavailable(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ message, code: 'engine_unavailable' });
}
