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
 *   run QUEUED and the worker's reconcile starts it within a minute.
 * - **Throttled per person**: three test runs a minute, counted only once
 *   a test passed its checks, so fixing a refused test never uses one up.
 * - **A review decision is written before the signal, and undone if the
 *   signal fails**, with a conditional write, so two people answering at
 *   once get one decision and one 409.
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
import { AutomationRunStatus, AutomationStepStatus, Prisma } from '@postgear/db';
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
} from './automation-runs.repository';
import {
  type ListRunsQuery,
  type ReviewDecisionInput,
  RUNS_PAGE_SIZE,
  type StartTestRunInput,
  type StepTestInput,
} from './dto/automation-runs.schema';
import { applyManualInputs } from './manual-inputs';
import {
  connectionValuesOf,
  type RunDetail,
  type RunSummary,
  TERMINAL_RUN_STATUSES,
  toRunDetail,
  toRunSummary,
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
    return {
      runs: rows.map(toRunSummary),
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

    const outcome = await this.scheduling.cancelAutomationRun(runId);
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

    const output: AutomationReviewOutput = {
      decision: input.decision,
      decidedById: userId,
      decidedAt: new Date().toISOString(),
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

    const outcome = await this.scheduling.signalReviewDecision(runId, {
      nodeKey,
      decision: input.decision,
    });
    if (outcome !== 'signalled') {
      await this.repository.clearReview(orgId, step.id);
      throw engineUnavailable(RUN_MESSAGES.REVIEW_NOT_SENT);
    }

    return { nodeKey, decision: input.decision, decidedAt: output.decidedAt };
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
  private async start(orgId: string, run: RunSummaryRow): Promise<RunSummary> {
    // False is logged by the scheduler; the reconcile starts the run later.
    await this.scheduling.startAutomationRun(run.id, orgId);
    return toRunSummary(run);
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

    return { payload: triggerSample(trigger), source: 'sample' };
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
        output = key === trigger.key ? triggerSample(node) : stepSample(node, scope);
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

/** Whether an issue stops a test: every error, except account problems of dry steps. */
function blocks(issue: ValidationIssue, dry: ReadonlySet<string>): boolean {
  if (issue.severity !== 'error') return false;
  return !(issue.nodeKey && dry.has(issue.nodeKey) && EXCUSED_WHEN_DRY.has(issue.code));
}

/** `Automation.pinnedData` is `{ [nodeKey]: { output, pinnedAt, pinnedById } }`. */
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
