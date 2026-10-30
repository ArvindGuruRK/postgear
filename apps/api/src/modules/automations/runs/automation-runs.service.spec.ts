/**
 * Workflow runs from the API side against a fake repository, a fake
 * scheduler and counter, and the real `@postgear/automation` package: what
 * blocks a test and what does not, the per-person throttle, trigger data and
 * Manual inputs, the seeds of a step test, tenancy as 404s, cancel, the
 * review rules, and connection values hidden on the way out. Module 08 and
 * 09 add Retry From Here (what is copied, what is refused), Run Now, review
 * reasons and names, and the version and trigger phrase on run summaries.
 */
import {
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AutomationGraph,
  EXECUTABLE_TYPES,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  HIDDEN,
  type NodeType,
  type ValidationContext,
} from '@postgear/automation';
import {
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepStatus,
  encrypt,
  Prisma,
} from '@postgear/db';
import type { RedisService } from '../../redis/redis.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { AutomationContextService } from '../automation-context.service';
import { RUN_MESSAGES } from './automation-runs.messages';
import type {
  AutomationRunsRepository,
  LatestStep,
  LiveAutomation,
  RetrySourceRow,
  RunDetailRow,
  RunSummaryRow,
  StepRow,
  TestableAutomation,
} from './automation-runs.repository';
import { AutomationRunsService, testThrottleKey } from './automation-runs.service';
import { retryRunSchema, reviewDecisionSchema, runNowSchema } from './dto/automation-runs.schema';

const ORG = 'org_1';
const USER = 'user_1';
const ID = '3a5c7d2e-1f4b-4c8a-9e6d-0b2a4c6e8f10';
const RUN_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const OTHER_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const NOW = new Date('2026-10-29T09:00:00.000Z');

/* ───────────────────────── graph builders ───────────────────────── */

function step(key: string, type: NodeType, config: Record<string, unknown> = {}): GraphNode {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`No definition for ${type}`);
  return {
    key,
    type,
    typeVersion: definition.typeVersion,
    name: key,
    position: { x: 0, y: 0 },
    config: { ...JSON.parse(JSON.stringify(definition.defaultConfig)), ...config },
  };
}

function line(source: string, target: string): GraphEdge {
  return { id: `${source}:out->${target}`, source, sourcePort: 'out', target, targetPort: 'in' };
}

/** Steps stacked top to bottom in the order given, which is also their run order. */
function graphOf(nodes: GraphNode[], edges: GraphEdge[]): AutomationGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: nodes.map((node, i) => ({ ...node, position: { x: 0, y: i * 100 } })),
    edges,
    notes: [],
  };
}

const MANUAL_FIELDS = [
  { key: 'topic', label: 'Topic', type: 'text', required: true },
  { key: 'count', label: 'Count', type: 'number' },
  { key: 'tone', label: 'Tone', type: 'choice', options: ['Warm', 'Plain'] },
];

/** Manual, then an In-App Notification: everything here can run. */
function simpleGraph(): AutomationGraph {
  return graphOf(
    [
      step('trig', 'trigger.manual', { fields: MANUAL_FIELDS }),
      step('bell', 'notify.inApp', { title: 'Hello', message: 'World' }),
    ],
    [line('trig', 'bell')],
  );
}

/** Manual, then Slack with no connection chosen. */
function slackGraph(): AutomationGraph {
  return graphOf(
    [
      step('trig', 'trigger.manual'),
      step('slack', 'notify.slack', { connectionId: '', message: 'Hi', footer: true }),
    ],
    [line('trig', 'slack')],
  );
}

function setFields(key: string, value: string): GraphNode {
  return step(key, 'logic.setFields', { fields: [{ name: 'note', type: 'text', value }] });
}

/** Manual, A, B, C (Set Fields), the tested Notification, then one more step after it. */
function chainGraph(): AutomationGraph {
  return graphOf(
    [
      step('trig', 'trigger.manual'),
      setFields('stepA', 'a'),
      setFields('stepB', 'b'),
      setFields('stepC', 'c'),
      step('bell', 'notify.inApp', { title: 'Hello', message: 'World' }),
      setFields('after', 'z'),
    ],
    [
      line('trig', 'stepA'),
      line('stepA', 'stepB'),
      line('stepB', 'stepC'),
      line('stepC', 'bell'),
      line('bell', 'after'),
    ],
  );
}

/* ───────────────────────── rows ───────────────────────── */

function automation(graph: AutomationGraph, pinnedData: unknown = {}): TestableAutomation {
  return {
    id: ID,
    name: 'Publishing Report',
    draftGraph: graph as unknown as Prisma.JsonValue,
    pinnedData: pinnedData as Prisma.JsonValue,
    organization: { name: 'Bloom Bakery' },
  };
}

function summaryRow(overrides: Partial<RunSummaryRow> = {}): RunSummaryRow {
  return {
    id: RUN_ID,
    automationId: ID,
    mode: AutomationRunMode.TEST,
    status: AutomationRunStatus.QUEUED,
    triggerType: 'trigger.manual',
    options: null,
    startedById: USER,
    stepCount: 0,
    creditsUsed: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    versionId: null,
    temporalWorkflowId: null,
    version: null,
    ...overrides,
  };
}

function stepRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    id: 'step_1',
    nodeKey: 'bell',
    nodeType: 'notify.inApp',
    nodeName: 'Notify',
    status: AutomationStepStatus.SUCCEEDED,
    attempt: 1,
    input: null,
    output: null,
    truncated: false,
    error: null,
    startedAt: NOW,
    finishedAt: NOW,
    durationMs: 12,
    ports: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A counter like Redis's: each call adds one to the key. */
function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    incrementWithTtl: jest.fn(async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    }),
  };
}

const RUNNABLE_CONTEXT: ValidationContext = {
  connections: [],
  channels: [],
  availableTypes: EXECUTABLE_TYPES,
};

/** Slack counts as runnable here, so the only problem left is its missing connection. */
const SLACK_RUNNABLE: ValidationContext = {
  ...RUNNABLE_CONTEXT,
  availableTypes: new Set<string>([...EXECUTABLE_TYPES, 'notify.slack']),
};

describe('AutomationRunsService', () => {
  let repository: jest.Mocked<AutomationRunsRepository>;
  let context: { forOrg: jest.Mock };
  let scheduling: {
    startAutomationRun: jest.Mock;
    cancelAutomationRun: jest.Mock;
    signalReviewDecision: jest.Mock;
  };
  let redis: ReturnType<typeof fakeRedis>;
  let service: AutomationRunsService;
  let current: TestableAutomation | null;

  beforeEach(() => {
    current = automation(simpleGraph());
    repository = {
      findAutomation: jest.fn(async (_org: string, id: string) => (id === ID ? current : null)),
      automationExists: jest.fn(async (_org: string, id: string) => id === ID),
      latestTriggerPayload: jest.fn().mockResolvedValue(null),
      latestTestOutputs: jest.fn().mockResolvedValue(new Map()),
      createRun: jest.fn(async (_org: string, data) =>
        summaryRow({ triggerType: data.triggerType, options: data.options as Prisma.JsonValue }),
      ),
      listRuns: jest.fn().mockResolvedValue([]),
      findRun: jest.fn().mockResolvedValue(null),
      findRunSummary: jest.fn(async (_org: string, id: string) =>
        id === RUN_ID ? summaryRow({ status: AutomationRunStatus.WAITING }) : null,
      ),
      latestSteps: jest.fn().mockResolvedValue([]),
      stepsChangedSince: jest.fn().mockResolvedValue([]),
      latestAttempt: jest.fn().mockResolvedValue(null),
      recordReview: jest.fn().mockResolvedValue(true),
      clearReview: jest.fn().mockResolvedValue(undefined),
      cancelRun: jest.fn().mockResolvedValue(true),
      connectionCredentials: jest.fn().mockResolvedValue([]),
      userName: jest.fn().mockResolvedValue('Priya Shah'),
      findRetrySource: jest.fn().mockResolvedValue(null),
      createRetryRun: jest.fn(async (_org: string, data) =>
        summaryRow({
          id: OTHER_ID,
          mode: data.mode,
          versionId: data.versionId ?? null,
          triggerType: data.triggerType,
          options: data.options as Prisma.JsonValue,
        }),
      ),
      findLiveAutomation: jest.fn().mockResolvedValue(null),
      triggerFacts: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<AutomationRunsRepository>;
    context = { forOrg: jest.fn().mockResolvedValue(RUNNABLE_CONTEXT) };
    scheduling = {
      startAutomationRun: jest.fn().mockResolvedValue(true),
      cancelAutomationRun: jest.fn().mockResolvedValue('signalled'),
      signalReviewDecision: jest.fn().mockResolvedValue('signalled'),
    };
    redis = fakeRedis();
    service = new AutomationRunsService(
      repository,
      context as unknown as AutomationContextService,
      scheduling as unknown as SchedulingService,
      redis as unknown as RedisService,
    );
  });

  /** The data `createRun` was called with, by call. */
  function created(call = 0) {
    return repository.createRun.mock.calls[call][1];
  }

  describe('test runs', () => {
    it('creates a TEST run of the draft and starts its workflow', async () => {
      const run = await service.startTestRun(ORG, USER, ID, {});

      expect(repository.createRun).toHaveBeenCalledWith(ORG, expect.anything());
      expect(created()).toMatchObject({
        automationId: ID,
        triggerType: 'trigger.manual',
        startedById: USER,
        graphSnapshot: simpleGraph(),
        options: { scope: { kind: 'run' }, sendForReal: [], triggerData: 'sample' },
      });
      expect(created().seedOutputs).toBeUndefined();
      // The Manual trigger's sample fills every field.
      expect(created().triggerPayload).toEqual({
        inputs: { topic: 'Sample topic', count: 3, tone: 'Warm' },
      });
      expect(scheduling.startAutomationRun).toHaveBeenCalledWith(RUN_ID, ORG);
      expect(run).toMatchObject({ id: RUN_ID, status: AutomationRunStatus.QUEUED, mode: 'TEST' });
    });

    it('answers 201 with a QUEUED run when the workflow cannot be started yet', async () => {
      scheduling.startAutomationRun.mockResolvedValue(false);

      await expect(service.startTestRun(ORG, USER, ID, {})).resolves.toMatchObject({
        status: AutomationRunStatus.QUEUED,
      });
      expect(repository.createRun).toHaveBeenCalledTimes(1);
    });

    it('refuses the fourth test run in a minute with a 429', async () => {
      for (let i = 0; i < 3; i++) await service.startTestRun(ORG, USER, ID, {});

      const fourth = service.startTestRun(ORG, USER, ID, {});
      await expect(fourth).rejects.toBeInstanceOf(HttpException);
      await fourth.catch((error: HttpException) => {
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(error.getResponse()).toEqual({
          message: 'Too many test runs. Try again in a minute.',
          code: 'test_runs_throttled',
        });
      });
      expect(redis.incrementWithTtl).toHaveBeenCalledWith(testThrottleKey(USER), 60);
      expect(repository.createRun).toHaveBeenCalledTimes(3);
    });

    it('counts step tests against the same throttle', async () => {
      for (let i = 0; i < 2; i++) await service.startTestRun(ORG, USER, ID, {});
      await service.startStepTest(ORG, USER, ID, 'bell', {});

      await expect(service.startStepTest(ORG, USER, ID, 'bell', {})).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });

    it('does not count a test that was refused', async () => {
      current = automation(slackGraph());

      await expect(service.startTestRun(ORG, USER, ID, {})).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(redis.incrementWithTtl).not.toHaveBeenCalled();
    });

    it('is a 404 for another workspace, an unknown or a malformed workflow id', async () => {
      await expect(service.startTestRun(ORG, USER, OTHER_ID, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.startTestRun(ORG, USER, 'not-a-uuid', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.findAutomation).toHaveBeenCalledTimes(1);
      expect(repository.createRun).not.toHaveBeenCalled();
    });
  });

  describe('what blocks a test', () => {
    it('blocks a draft with a step that cannot run yet', async () => {
      // Slack has no executor yet (Module 12), so it is `node.not_runnable`.
      current = automation(slackGraph());

      const attempt = service.startTestRun(ORG, USER, ID, {});
      await expect(attempt).rejects.toBeInstanceOf(UnprocessableEntityException);
      await attempt.catch((error: UnprocessableEntityException) => {
        expect(error.getResponse()).toMatchObject({
          message: RUN_MESSAGES.TEST_BLOCKED,
          code: 'test_blocked',
        });
      });
      expect(repository.createRun).not.toHaveBeenCalled();
    });

    it('does not block on a connection problem of a step that runs dry', async () => {
      current = automation(slackGraph());
      context.forOrg.mockResolvedValue(SLACK_RUNNABLE);

      await expect(service.startTestRun(ORG, USER, ID, {})).resolves.toMatchObject({
        id: RUN_ID,
      });
    });

    it('blocks the same problem once the step is sent for real', async () => {
      current = automation(slackGraph());
      context.forOrg.mockResolvedValue(SLACK_RUNNABLE);

      await expect(
        service.startTestRun(ORG, USER, ID, { sendForReal: ['slack'] }),
      ).rejects.toMatchObject({ response: { code: 'test_blocked', details: { issues: 1 } } });
    });

    it('refuses to send a step for real that is not in the draft', async () => {
      await expect(
        service.startTestRun(ORG, USER, ID, { sendForReal: ['ghost1'] }),
      ).rejects.toMatchObject({ response: { code: 'send_for_real_unknown' } });
    });

    it('stores the steps sent for real on the run options', async () => {
      context.forOrg.mockResolvedValue({
        ...SLACK_RUNNABLE,
        connections: [{ id: 'conn_1', kind: 'slack', name: 'Marketing', status: 'CONNECTED' }],
      });
      const graph = slackGraph();
      graph.nodes[1].config.connectionId = 'conn_1';
      current = automation(graph);

      await service.startTestRun(ORG, USER, ID, { sendForReal: ['slack', 'slack'] });
      expect(created().options).toMatchObject({ sendForReal: ['slack'] });
    });
  });

  describe('trigger data', () => {
    it('prefers the pinned trigger data, then the last run, then the sample', async () => {
      repository.latestTriggerPayload.mockResolvedValue({ payload: { inputs: { topic: 'Last' } } });
      current = automation(simpleGraph(), {
        trig: { output: { inputs: { topic: 'Pinned' } }, pinnedAt: NOW.toISOString() },
      });
      await service.startTestRun(ORG, USER, ID, {});
      expect(created(0)).toMatchObject({
        triggerPayload: { inputs: { topic: 'Pinned' } },
        options: { triggerData: 'pinned' },
      });

      current = automation(simpleGraph());
      await service.startTestRun(ORG, USER, ID, {});
      expect(created(1)).toMatchObject({
        triggerPayload: { inputs: { topic: 'Last' } },
        options: { triggerData: 'last' },
      });
      expect(repository.latestTriggerPayload).toHaveBeenCalledWith(ORG, ID, 'trigger.manual');

      await service.startTestRun(ORG, USER, ID, { triggerData: 'sample' });
      expect(created(2)).toMatchObject({ options: { triggerData: 'sample' } });
    });

    it('refuses pinned or last data that is not there', async () => {
      await expect(
        service.startTestRun(ORG, USER, ID, { triggerData: 'pinned' }),
      ).rejects.toMatchObject({ response: { code: 'no_pinned_data' } });
      await expect(
        service.startTestRun(ORG, USER, ID, { triggerData: 'last' }),
      ).rejects.toMatchObject({ response: { code: 'no_last_run' } });
    });

    it('lays Manual inputs over the trigger data and checks them', async () => {
      await service.startTestRun(ORG, USER, ID, {
        inputs: { topic: '  Spring menu ', count: '4', tone: '' },
      });
      // `tone` was cleared, `count` became a number.
      expect(created().triggerPayload).toEqual({ inputs: { topic: 'Spring menu', count: 4 } });

      await expect(
        service.startTestRun(ORG, USER, ID, { inputs: { topic: '' } }),
      ).rejects.toMatchObject({
        response: { code: 'invalid_inputs', message: 'Fill in Topic.' },
      });
      await expect(
        service.startTestRun(ORG, USER, ID, { inputs: { count: 'many' } }),
      ).rejects.toMatchObject({ response: { message: 'Count must be a number.' } });
      await expect(
        service.startTestRun(ORG, USER, ID, { inputs: { tone: 'Loud' } }),
      ).rejects.toMatchObject({ response: { message: 'Choose one of the options for Tone.' } });
      await expect(
        service.startTestRun(ORG, USER, ID, { inputs: { colour: 'red' } }),
      ).rejects.toMatchObject({ response: { message: RUN_MESSAGES.UNKNOWN_INPUT } });
    });

    it('refuses inputs for a workflow that does not start with a Manual trigger', async () => {
      const graph = graphOf(
        [
          step('trig', 'trigger.webhook'),
          step('bell', 'notify.inApp', { title: 'Hello', message: 'World' }),
        ],
        [line('trig', 'bell')],
      );
      current = automation(graph);

      await expect(
        service.startTestRun(ORG, USER, ID, { inputs: { topic: 'x' } }),
      ).rejects.toMatchObject({ response: { code: 'inputs_need_manual' } });
    });
  });

  describe('step tests', () => {
    it('seeds every step before the tested one: pinned, else the last test, else a sample', async () => {
      current = automation(chainGraph(), {
        stepA: { output: { note: 'pinned A' }, pinnedAt: NOW.toISOString() },
      });
      repository.latestTestOutputs.mockResolvedValue(
        new Map<string, Prisma.JsonValue>([['stepB', { note: 'last B' }]]),
      );

      await service.startStepTest(ORG, USER, ID, 'bell', {});

      // Pinned steps are not looked up again.
      expect(repository.latestTestOutputs).toHaveBeenCalledWith(ORG, ID, [
        'trig',
        'stepB',
        'stepC',
      ]);
      const data = created();
      expect(Object.keys(data.seedOutputs as object)).toEqual(['trig', 'stepA', 'stepB', 'stepC']);
      expect(data.seedOutputs).toEqual({
        trig: { inputs: {} },
        stepA: { note: 'pinned A' },
        stepB: { note: 'last B' },
        stepC: { note: 'c' },
      });
      expect(data.triggerPayload).toEqual({ inputs: {} });
      expect(data.options).toEqual({
        scope: { kind: 'step', nodeKey: 'bell' },
        sendForReal: [],
        triggerData: 'sample',
      });
    });

    it('says where the trigger seed came from', async () => {
      repository.latestTestOutputs.mockResolvedValue(
        new Map<string, Prisma.JsonValue>([['trig', { inputs: { topic: 'Last' } }]]),
      );
      await service.startStepTest(ORG, USER, ID, 'bell', {});
      expect(created().options).toMatchObject({ triggerData: 'last' });
    });

    it('only checks the tested step', async () => {
      // The Slack step after the tested one cannot run, which does not matter here.
      const graph = graphOf(
        [
          step('trig', 'trigger.manual'),
          step('bell', 'notify.inApp', { title: 'Hello', message: 'World' }),
          step('slack', 'notify.slack', { connectionId: '', message: 'Hi', footer: true }),
        ],
        [line('trig', 'bell'), line('bell', 'slack')],
      );
      current = automation(graph);

      await expect(service.startStepTest(ORG, USER, ID, 'bell', {})).resolves.toMatchObject({
        id: RUN_ID,
      });
      await expect(service.startStepTest(ORG, USER, ID, 'slack', {})).rejects.toMatchObject({
        response: { code: 'test_blocked', message: RUN_MESSAGES.STEP_TEST_BLOCKED },
      });
    });

    it('sends the tested step for real only when asked', async () => {
      current = automation(slackGraph());
      context.forOrg.mockResolvedValue(SLACK_RUNNABLE);

      await service.startStepTest(ORG, USER, ID, 'slack', {});
      expect(created().options).toMatchObject({ sendForReal: [] });

      // Sent for real, its missing connection blocks it.
      await expect(
        service.startStepTest(ORG, USER, ID, 'slack', { sendForReal: true }),
      ).rejects.toMatchObject({ response: { code: 'test_blocked' } });
    });

    it('is a 404 for a step that is not in the draft and a 422 for a turned-off one', async () => {
      await expect(service.startStepTest(ORG, USER, ID, 'ghost1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.startStepTest(ORG, USER, ID, '../x', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );

      const graph = chainGraph();
      const stepB = graph.nodes.find((node) => node.key === 'stepB');
      if (stepB) stepB.disabled = true;
      current = automation(graph);
      await expect(service.startStepTest(ORG, USER, ID, 'stepB', {})).rejects.toMatchObject({
        response: { code: 'step_turned_off' },
      });

      // A turned-off step before the tested one is not seeded, as in a real run.
      await service.startStepTest(ORG, USER, ID, 'bell', {});
      expect(Object.keys(created().seedOutputs as object)).toEqual(['trig', 'stepA', 'stepC']);
    });
  });

  describe('run history and detail', () => {
    it('lists 25 runs a page with a cursor, and 404s another workspace', async () => {
      const page = Array.from({ length: 26 }, (_, i) =>
        summaryRow({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }),
      );
      repository.listRuns.mockResolvedValue(page);

      const result = await service.listRuns(ORG, ID, { mode: AutomationRunMode.TEST });
      expect(result.runs).toHaveLength(25);
      expect(result.nextCursor).toBe(page[24].id);
      expect(repository.listRuns).toHaveBeenCalledWith(ORG, ID, {
        mode: AutomationRunMode.TEST,
        status: undefined,
        cursor: undefined,
        take: 25,
      });

      await expect(service.listRuns(ORG, OTHER_ID, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 404 for another workspace or a malformed run id', async () => {
      await expect(service.getRun(ORG, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getRun(ORG, 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findRun).toHaveBeenCalledTimes(1);
    });

    it('never returns a connection value, even one that reached a step input', async () => {
      const previous = process.env.ENCRYPTION_KEY_AES256;
      process.env.ENCRYPTION_KEY_AES256 = 'c'.repeat(64);
      try {
        const link = 'https://hooks.example.test/services/T000/B000/abcdefghijklmnop';
        repository.connectionCredentials.mockResolvedValue([
          encrypt(JSON.stringify({ webhookUrl: link })),
          encrypt(JSON.stringify({ headers: [{ name: 'X-Api-Key', value: 'k3y-value-1234567' }] })),
          'not-encrypted',
        ]);
        const detail: RunDetailRow = {
          ...summaryRow({ status: AutomationRunStatus.SUCCEEDED }),
          triggerPayload: { inputs: { topic: `Post to ${link}` } },
          graphSnapshot: simpleGraph() as unknown as Prisma.JsonValue,
          version: null,
        };
        repository.findRun.mockResolvedValue(detail);
        const steps: LatestStep[] = [
          {
            step: stepRow({
              attempt: 2,
              input: { url: link, note: 'X-Api-Key stays readable' },
              output: { header: 'k3y-value-1234567' },
              error: { message: 'Failed', code: 'permanent', retryable: false, details: link },
            }),
            attempts: 2,
          },
        ];
        repository.latestSteps.mockResolvedValue(steps);

        const run = await service.getRun(ORG, RUN_ID);

        expect(JSON.stringify(run)).not.toContain('hooks.example.test');
        expect(JSON.stringify(run)).not.toContain('k3y-value-1234567');
        expect(run.steps[0]).toMatchObject({
          attempt: 2,
          attempts: 2,
          input: { url: HIDDEN, note: 'X-Api-Key stays readable' },
          output: { header: HIDDEN },
        });
        expect(run.triggerPayload).toEqual({ inputs: { topic: HIDDEN } });
        expect(run.graph).toEqual(simpleGraph());
        expect(repository.latestSteps).toHaveBeenCalledWith(ORG, RUN_ID);
      } finally {
        process.env.ENCRYPTION_KEY_AES256 = previous;
      }
    });
  });

  describe('cancel', () => {
    it('signals a run that is still going and lets the workflow write CANCELLED', async () => {
      await service.cancel(ORG, RUN_ID);

      expect(scheduling.cancelAutomationRun).toHaveBeenCalledWith(RUN_ID, null);
      expect(repository.cancelRun).not.toHaveBeenCalled();
    });

    it('is a 409 for a finished run and a 404 for another workspace', async () => {
      repository.findRunSummary.mockResolvedValue(
        summaryRow({ status: AutomationRunStatus.SUCCEEDED }),
      );
      await expect(service.cancel(ORG, RUN_ID)).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { message: 'This run has already finished.', code: 'run_finished' },
      });

      repository.findRunSummary.mockResolvedValue(null);
      await expect(service.cancel(ORG, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(scheduling.cancelAutomationRun).not.toHaveBeenCalled();
    });

    it('closes a QUEUED run directly when its workflow cannot be signalled', async () => {
      repository.findRunSummary.mockResolvedValue(summaryRow());
      scheduling.cancelAutomationRun.mockResolvedValue('unavailable');

      await service.cancel(ORG, RUN_ID);
      expect(repository.cancelRun).toHaveBeenCalledWith(ORG, RUN_ID, [AutomationRunStatus.QUEUED]);

      // No workflow at all: any open run is closed here, nothing else would.
      scheduling.cancelAutomationRun.mockResolvedValue('notFound');
      await service.cancel(ORG, RUN_ID);
      expect(repository.cancelRun).toHaveBeenLastCalledWith(ORG, RUN_ID, [
        AutomationRunStatus.QUEUED,
        AutomationRunStatus.RUNNING,
        AutomationRunStatus.WAITING,
      ]);
    });

    it('is a 503 for a running run when the run engine is unreachable', async () => {
      repository.findRunSummary.mockResolvedValue(
        summaryRow({ status: AutomationRunStatus.RUNNING }),
      );
      scheduling.cancelAutomationRun.mockResolvedValue('unavailable');
      repository.cancelRun.mockResolvedValue(false);

      await expect(service.cancel(ORG, RUN_ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('reviews', () => {
    const waiting = {
      id: 'step_review',
      nodeType: 'logic.manualReview',
      status: AutomationStepStatus.WAITING,
      output: null,
    };

    it('writes the decision on the step, then signals the run', async () => {
      repository.latestAttempt.mockResolvedValue(waiting);

      const answer = await service.review(ORG, USER, RUN_ID, 'review1', {
        decision: 'approved',
        editedText: 'Fresh bread today.',
      });

      expect(repository.latestAttempt).toHaveBeenCalledWith(ORG, RUN_ID, 'review1');
      expect(repository.recordReview).toHaveBeenCalledWith(ORG, 'step_review', {
        decision: 'approved',
        decidedById: USER,
        decidedAt: answer.decidedAt,
        reviewedBy: 'Priya Shah',
        editedText: 'Fresh bread today.',
      });
      expect(scheduling.signalReviewDecision).toHaveBeenCalledWith(
        RUN_ID,
        { nodeKey: 'review1', decision: 'approved' },
        null,
      );
      expect(answer).toMatchObject({ nodeKey: 'review1', decision: 'approved' });
    });

    it('is a 404 for another workspace, an unknown run or a step that has not run', async () => {
      await expect(
        service.review(ORG, USER, OTHER_ID, 'review1', { decision: 'approved' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.review(ORG, USER, RUN_ID, 'review1', { decision: 'approved' }),
      ).rejects.toThrow(RUN_MESSAGES.RUN_STEP_NOT_FOUND);
      expect(repository.recordReview).not.toHaveBeenCalled();
    });

    it('is a 409 for a step that is not waiting for a review', async () => {
      for (const step of [
        { ...waiting, status: AutomationStepStatus.SUCCEEDED },
        { ...waiting, status: AutomationStepStatus.CANCELLED },
        // A Delay waits too, but is not a review.
        { ...waiting, nodeType: 'logic.delay' },
      ]) {
        repository.latestAttempt.mockResolvedValue(step);
        await expect(
          service.review(ORG, USER, RUN_ID, 'review1', { decision: 'approved' }),
        ).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: {
            message: 'This step is not waiting for a review.',
            code: 'review_not_waiting',
          },
        });
      }
      expect(repository.recordReview).not.toHaveBeenCalled();
    });

    it('is a 409 for a second decision', async () => {
      const answered = { ...waiting, output: { decision: 'approved', decidedById: 'u2' } };
      repository.latestAttempt.mockResolvedValue(answered);
      await expect(
        service.review(ORG, USER, RUN_ID, 'review1', { decision: 'rejected' }),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { message: 'This review was already answered.', code: 'review_answered' },
      });

      // Two people at once: the conditional write lets only one through.
      repository.latestAttempt.mockResolvedValueOnce(waiting).mockResolvedValueOnce(answered);
      repository.recordReview.mockResolvedValue(false);
      await expect(
        service.review(ORG, USER, RUN_ID, 'review1', { decision: 'rejected' }),
      ).rejects.toMatchObject({ response: { code: 'review_answered' } });
      expect(scheduling.signalReviewDecision).not.toHaveBeenCalled();
    });

    it('takes the decision back and answers 503 when the run cannot be told', async () => {
      repository.latestAttempt.mockResolvedValue(waiting);
      scheduling.signalReviewDecision.mockResolvedValue('unavailable');

      await expect(
        service.review(ORG, USER, RUN_ID, 'review1', { decision: 'approved' }),
      ).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
        response: { code: 'engine_unavailable', message: RUN_MESSAGES.REVIEW_NOT_SENT },
      });
      expect(repository.clearReview).toHaveBeenCalledWith(ORG, 'step_review');
    });

    it('is a 409 when the run already ended', async () => {
      repository.findRunSummary.mockResolvedValue(
        summaryRow({ status: AutomationRunStatus.CANCELLED }),
      );
      repository.latestAttempt.mockResolvedValue(waiting);

      await expect(
        service.review(ORG, USER, RUN_ID, 'review1', { decision: 'approved' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('records a rejection with its reason and the reviewer name', async () => {
      repository.latestAttempt.mockResolvedValue(waiting);

      const answer = await service.review(ORG, USER, RUN_ID, 'review1', {
        decision: 'rejected',
        reason: '  Wrong photo.  ',
      });

      expect(repository.userName).toHaveBeenCalledWith(USER);
      expect(repository.recordReview).toHaveBeenCalledWith(ORG, 'step_review', {
        decision: 'rejected',
        decidedById: USER,
        decidedAt: answer.decidedAt,
        reviewedBy: 'Priya Shah',
        reason: 'Wrong photo.',
      });
    });

    it('takes a reason on rejections only, at most 500 characters, control characters stripped', () => {
      expect(
        reviewDecisionSchema.safeParse({ decision: 'approved', reason: 'Looks fine' }).success,
      ).toBe(false);
      expect(
        reviewDecisionSchema.safeParse({ decision: 'rejected', reason: 'x'.repeat(501) }).success,
      ).toBe(false);
      expect(
        reviewDecisionSchema.safeParse({ decision: 'rejected', reason: 'x'.repeat(500) }).success,
      ).toBe(true);
      expect(
        reviewDecisionSchema.safeParse({ decision: 'rejected', reason: 'Off\u0007 brand' }),
      ).toEqual({ success: true, data: { decision: 'rejected', reason: 'Off brand' } });
    });
  });

  describe('run summaries (Module 08)', () => {
    it('carries the version a live run used and a trigger phrase, null when there is none', async () => {
      const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
      repository.listRuns.mockResolvedValue([
        summaryRow({
          id: id(1),
          mode: AutomationRunMode.LIVE,
          triggerType: 'trigger.postPublished',
          version: { version: 3 },
        }),
        summaryRow({ id: id(2), triggerType: 'trigger.postFailed' }),
        summaryRow({ id: id(3), triggerType: 'trigger.schedule' }),
        summaryRow({ id: id(4) }),
        summaryRow({ id: id(5), triggerType: 'trigger.postPublished' }),
      ]);
      const none = { provider: null, scheduledFor: null, timeZone: null };
      repository.triggerFacts.mockResolvedValue(
        new Map([
          [id(1), { ...none, provider: 'linkedin-page' }],
          [id(2), { ...none, provider: 'instagram' }],
          [id(3), { ...none, scheduledFor: '2026-10-29T02:30:00.000Z', timeZone: 'Asia/Kolkata' }],
          [id(5), { ...none, provider: 'myspace' }],
        ]),
      );

      const { runs } = await service.listRuns(ORG, ID, {});

      expect(runs.map((run) => [run.version, run.triggerSummary])).toEqual([
        [3, 'Post published on LinkedIn'],
        [null, 'Post failed on Instagram'],
        [null, 'Scheduled for 08:00'],
        [null, null],
        [null, null],
      ]);
      // Only runs that can have a phrase are looked up, in one query; a Manual run is not.
      expect(repository.triggerFacts).toHaveBeenCalledTimes(1);
      expect(repository.triggerFacts).toHaveBeenCalledWith(ORG, [id(1), id(2), id(3), id(5)]);
    });

    it('makes the phrase from the full trigger data on the detail', async () => {
      repository.findRun.mockResolvedValue({
        ...summaryRow({ triggerType: 'trigger.schedule', status: AutomationRunStatus.SUCCEEDED }),
        triggerPayload: { scheduledFor: '2026-10-29T02:30:00.000Z', timeZone: 'Nowhere/Land' },
        graphSnapshot: simpleGraph() as unknown as Prisma.JsonValue,
        version: null,
      });

      // An unknown zone falls back to UTC.
      await expect(service.getRun(ORG, RUN_ID)).resolves.toMatchObject({
        triggerSummary: 'Scheduled for 02:30',
      });
      expect(repository.triggerFacts).not.toHaveBeenCalled();
    });

    it('lists the ports each step fired', async () => {
      repository.findRun.mockResolvedValue({
        ...summaryRow({ status: AutomationRunStatus.SUCCEEDED }),
        triggerPayload: {},
        graphSnapshot: simpleGraph() as unknown as Prisma.JsonValue,
        version: null,
      });
      repository.latestSteps.mockResolvedValue([
        { step: stepRow({ nodeKey: 'bell', ports: ['out'] }), attempts: 1 },
      ]);

      const run = await service.getRun(ORG, RUN_ID);
      expect(run.steps[0].ports).toEqual(['out']);
    });

    it('cancels and answers a run started by a Schedule through its own workflow id', async () => {
      const scheduledId = 'automation-scheduled-run-1';
      repository.findRunSummary.mockResolvedValue(
        summaryRow({ status: AutomationRunStatus.WAITING, temporalWorkflowId: scheduledId }),
      );
      repository.latestAttempt.mockResolvedValue({
        id: 'step_review',
        nodeType: 'logic.manualReview',
        status: AutomationStepStatus.WAITING,
        output: null,
      });

      await service.review(ORG, USER, RUN_ID, 'review1', { decision: 'approved' });
      expect(scheduling.signalReviewDecision).toHaveBeenCalledWith(
        RUN_ID,
        { nodeKey: 'review1', decision: 'approved' },
        scheduledId,
      );

      await service.cancel(ORG, RUN_ID);
      expect(scheduling.cancelAutomationRun).toHaveBeenCalledWith(RUN_ID, scheduledId);
    });
  });

  describe('retry from here (Module 08)', () => {
    /** Manual, A, the failed Notification, one more step after it, and a side branch. */
    function retryGraph(): AutomationGraph {
      return graphOf(
        [
          step('trig', 'trigger.manual'),
          setFields('stepA', 'a'),
          step('bell', 'notify.inApp', { title: 'Hello', message: 'World' }),
          setFields('after', 'z'),
          setFields('side', 's'),
        ],
        [line('trig', 'stepA'), line('stepA', 'bell'), line('bell', 'after'), line('trig', 'side')],
      );
    }

    function source(overrides: Partial<RetrySourceRow> = {}): RetrySourceRow {
      return {
        ...summaryRow({
          status: AutomationRunStatus.FAILED,
          options: {
            scope: { kind: 'run' },
            sendForReal: [],
            triggerData: 'sample',
          } as unknown as Prisma.JsonValue,
        }),
        triggerPayload: { inputs: { topic: 'Bread' } },
        graphSnapshot: retryGraph() as unknown as Prisma.JsonValue,
        version: null,
        seedOutputs: null,
        automation: { activeVersionId: null },
        ...overrides,
      };
    }

    function ran(nodeKey: string, status: AutomationStepStatus, extra: Partial<StepRow> = {}) {
      return {
        step: stepRow({
          id: `row_${nodeKey}`,
          nodeKey,
          nodeName: nodeKey,
          status,
          attempt: 2,
          input: { from: nodeKey },
          output: { done: nodeKey },
          ports: ['out'],
          ...extra,
        }),
        attempts: 2,
      };
    }

    const history = (): LatestStep[] => [
      ran('trig', AutomationStepStatus.SUCCEEDED),
      ran('stepA', AutomationStepStatus.SUCCEEDED),
      ran('side', AutomationStepStatus.HANDLED_ERROR, { ports: ['error'] }),
      ran('bell', AutomationStepStatus.FAILED, { output: null, ports: [] }),
      // Comes after the retried step, so it runs again rather than being copied.
      ran('after', AutomationStepStatus.SUCCEEDED),
    ];

    it('copies every step that finished before the failed one into a new run that starts there', async () => {
      repository.findRetrySource.mockResolvedValue(source());
      repository.latestSteps.mockResolvedValue(history());

      const run = await service.retry(ORG, USER, RUN_ID, 'bell');

      const [org, data, steps] = repository.createRetryRun.mock.calls[0];
      expect(org).toBe(ORG);
      expect(data).toEqual({
        automationId: ID,
        mode: AutomationRunMode.TEST,
        versionId: null,
        triggerType: 'trigger.manual',
        triggerPayload: { inputs: { topic: 'Bread' } },
        graphSnapshot: retryGraph(),
        seedOutputs: { trig: { done: 'trig' }, stepA: { done: 'stepA' }, side: { done: 'side' } },
        options: {
          scope: { kind: 'run' },
          sendForReal: [],
          triggerData: 'sample',
          retry: {
            of: RUN_ID,
            fromNodeKey: 'bell',
            ports: { trig: ['out'], stepA: ['out'], side: ['error'] },
          },
        },
        startedById: USER,
      });
      expect(steps.map((copy) => [copy.nodeKey, copy.status])).toEqual([
        ['trig', AutomationStepStatus.SUCCEEDED],
        ['stepA', AutomationStepStatus.SUCCEEDED],
        ['side', AutomationStepStatus.HANDLED_ERROR],
      ]);
      expect(steps[0]).toEqual({
        nodeKey: 'trig',
        nodeType: 'notify.inApp',
        nodeName: 'trig',
        status: AutomationStepStatus.SUCCEEDED,
        input: { from: 'trig' },
        output: { done: 'trig' },
        error: null,
        ports: ['out'],
        truncated: false,
        durationMs: 12,
        startedAt: NOW,
        finishedAt: NOW,
      });
      expect(scheduling.startAutomationRun).toHaveBeenCalledWith(OTHER_ID, ORG);
      expect(run).toMatchObject({ id: OTHER_ID, mode: AutomationRunMode.TEST });
      // A test retry counts against the test-run throttle.
      expect(redis.incrementWithTtl).toHaveBeenCalledWith(testThrottleKey(USER), 60);
    });

    it('keeps the seeds a step test started from', async () => {
      repository.findRetrySource.mockResolvedValue(
        source({
          options: {
            scope: { kind: 'step', nodeKey: 'bell' },
            sendForReal: [],
            triggerData: 'sample',
          } as unknown as Prisma.JsonValue,
          seedOutputs: { trig: { inputs: {} }, stepA: { note: 'pinned A' } },
        }),
      );
      repository.latestSteps.mockResolvedValue([ran('bell', AutomationStepStatus.FAILED)]);

      await service.retry(ORG, USER, RUN_ID, 'bell');

      const [, data, steps] = repository.createRetryRun.mock.calls[0];
      expect(data.seedOutputs).toEqual({ trig: { inputs: {} }, stepA: { note: 'pinned A' } });
      expect(data.options).toMatchObject({
        scope: { kind: 'step', nodeKey: 'bell' },
        retry: { of: RUN_ID, fromNodeKey: 'bell', ports: {} },
      });
      expect(steps).toEqual([]);
    });

    it('retries a live run on its own version, live, without the test throttle', async () => {
      repository.findRetrySource.mockResolvedValue(
        source({
          mode: AutomationRunMode.LIVE,
          options: null,
          versionId: 'ver_2',
          graphSnapshot: null,
          version: { version: 2, graph: retryGraph() as unknown as Prisma.JsonValue },
          automation: { activeVersionId: 'ver_2' },
        }),
      );
      repository.latestSteps.mockResolvedValue(history());

      await service.retry(ORG, USER, RUN_ID, 'bell');

      const [, data, steps] = repository.createRetryRun.mock.calls[0];
      expect(data).toMatchObject({
        mode: AutomationRunMode.LIVE,
        versionId: 'ver_2',
        options: { scope: { kind: 'run' }, sendForReal: [], triggerData: 'last' },
      });
      expect(data.graphSnapshot).toBeUndefined();
      expect(steps).toHaveLength(3);
      expect(redis.incrementWithTtl).not.toHaveBeenCalled();
    });

    it('is a 409 while the run is still going', async () => {
      repository.findRetrySource.mockResolvedValue(source({ status: AutomationRunStatus.WAITING }));
      await expect(service.retry(ORG, USER, RUN_ID, 'bell')).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { code: 'run_not_finished', message: RUN_MESSAGES.RUN_NOT_FINISHED },
      });
    });

    it('is a 422 for a step that did not fail or is not in the run', async () => {
      repository.findRetrySource.mockResolvedValue(source());
      repository.latestSteps.mockResolvedValue(history());

      for (const key of ['stepA', 'nostep1']) {
        await expect(service.retry(ORG, USER, RUN_ID, key)).rejects.toMatchObject({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          response: { code: 'retry_step_not_failed' },
        });
      }
      expect(repository.createRetryRun).not.toHaveBeenCalled();
    });

    it('is a 422 for a step that is not safe to repeat, publishing steps above all', async () => {
      const graph = graphOf(
        [
          step('trig', 'trigger.manual'),
          step('slack', 'notify.slack', { connectionId: '', message: 'Hi', footer: true }),
          step('post01', 'postgear.publish'),
        ],
        [line('trig', 'slack'), line('trig', 'post01')],
      );
      repository.findRetrySource.mockResolvedValue(
        source({ graphSnapshot: graph as unknown as Prisma.JsonValue }),
      );
      repository.latestSteps.mockResolvedValue([
        ran('trig', AutomationStepStatus.SUCCEEDED),
        ran('slack', AutomationStepStatus.FAILED),
        ran('post01', AutomationStepStatus.FAILED),
      ]);

      // Slack is only retried for brief outages, so it may already have sent.
      await expect(service.retry(ORG, USER, RUN_ID, 'slack')).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: {
          code: 'retry_not_safe',
          message: 'This step cannot be retried from here. Start a new run instead.',
        },
      });
      // Publish is 'safe' in the catalog, but a new run could post twice.
      await expect(service.retry(ORG, USER, RUN_ID, 'post01')).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: {
          code: 'retry_not_safe',
          message: 'Publishing steps cannot be retried from here. Start a new run instead.',
        },
      });
      expect(redis.incrementWithTtl).not.toHaveBeenCalled();
      expect(repository.createRetryRun).not.toHaveBeenCalled();
    });

    it('is a 422 for a live run of a version that is no longer live', async () => {
      repository.findRetrySource.mockResolvedValue(
        source({
          mode: AutomationRunMode.LIVE,
          versionId: 'ver_1',
          graphSnapshot: null,
          version: { version: 1, graph: retryGraph() as unknown as Prisma.JsonValue },
          automation: { activeVersionId: 'ver_2' },
        }),
      );
      repository.latestSteps.mockResolvedValue(history());

      await expect(service.retry(ORG, USER, RUN_ID, 'bell')).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: { code: 'retry_old_version', message: 'This run used an older version.' },
      });
    });

    it('is a 404 for another workspace or a malformed run id, and a 429 past the throttle', async () => {
      await expect(service.retry(ORG, USER, RUN_ID, 'bell')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.retry(ORG, USER, 'nope', 'bell')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.findRetrySource).toHaveBeenCalledTimes(1);

      repository.findRetrySource.mockResolvedValue(source());
      repository.latestSteps.mockResolvedValue(history());
      for (let i = 0; i < 3; i++) await service.retry(ORG, USER, RUN_ID, 'bell');
      await expect(service.retry(ORG, USER, RUN_ID, 'bell')).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        response: { code: 'test_runs_throttled' },
      });
    });

    it('validates the retry body strictly', () => {
      expect(retryRunSchema.safeParse({ fromNodeKey: 'bell' }).success).toBe(true);
      expect(retryRunSchema.safeParse({ fromNodeKey: '../x' }).success).toBe(false);
      expect(retryRunSchema.safeParse({ fromNodeKey: 'bell', extra: 1 }).success).toBe(false);
      expect(retryRunSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('run now (Module 09)', () => {
    function live(overrides: Partial<LiveAutomation> = {}): LiveAutomation {
      return {
        id: ID,
        status: AutomationStatus.ACTIVE,
        activeVersion: {
          id: 'ver_3',
          graph: simpleGraph() as unknown as Prisma.JsonValue,
          triggerType: 'trigger.manual',
        },
        ...overrides,
      };
    }

    it('starts a LIVE run of the active version with the inputs checked', async () => {
      repository.findLiveAutomation.mockResolvedValue(live());

      const run = await service.runNow(ORG, USER, ID, { inputs: { topic: ' Bread ', count: '3' } });

      expect(repository.findLiveAutomation).toHaveBeenCalledWith(ORG, ID);
      expect(repository.createRun).toHaveBeenCalledWith(ORG, {
        automationId: ID,
        mode: AutomationRunMode.LIVE,
        versionId: 'ver_3',
        triggerType: 'trigger.manual',
        triggerPayload: { inputs: { topic: 'Bread', count: 3 } },
        startedById: USER,
      });
      expect(scheduling.startAutomationRun).toHaveBeenCalledWith(RUN_ID, ORG);
      expect(run.id).toBe(RUN_ID);
      // Run Now is not a test, so it is not throttled like one.
      expect(redis.incrementWithTtl).not.toHaveBeenCalled();
    });

    it('refuses a draft, a paused workflow and one that does not start by hand', async () => {
      const scheduled = graphOf(
        [
          step('trig', 'trigger.schedule', { frequency: 'daily', time: '08:00', timeZone: 'UTC' }),
          step('bell', 'notify.inApp', { title: 'Hello', message: 'World' }),
        ],
        [line('trig', 'bell')],
      );
      for (const automation of [
        live({ status: AutomationStatus.DRAFT, activeVersion: null }),
        live({ status: AutomationStatus.PAUSED }),
        live({
          activeVersion: {
            id: 'ver_3',
            graph: scheduled as unknown as Prisma.JsonValue,
            triggerType: 'trigger.schedule',
          },
        }),
      ]) {
        repository.findLiveAutomation.mockResolvedValueOnce(automation);
        await expect(
          service.runNow(ORG, USER, ID, { inputs: { topic: 'Bread' } }),
        ).rejects.toMatchObject({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          response: { code: 'run_now_unavailable', message: RUN_MESSAGES.RUN_NOW_UNAVAILABLE },
        });
      }
      expect(repository.createRun).not.toHaveBeenCalled();
    });

    it('checks the inputs against the live version fields', async () => {
      repository.findLiveAutomation.mockResolvedValue(live());

      const cases: Array<[Record<string, string>, string]> = [
        [{}, 'Fill in Topic.'],
        [{ topic: 'Bread', count: 'many' }, 'Count must be a number.'],
        [{ topic: 'Bread', tone: 'Loud' }, 'Choose one of the options for Tone.'],
        [{ topic: 'Bread', colour: 'red' }, RUN_MESSAGES.UNKNOWN_INPUT],
      ];
      for (const [inputs, message] of cases) {
        await expect(service.runNow(ORG, USER, ID, { inputs })).rejects.toMatchObject({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          response: { code: 'invalid_inputs', message },
        });
      }
      expect(repository.createRun).not.toHaveBeenCalled();
    });

    it('is a 404 for another workspace or a malformed id', async () => {
      await expect(service.runNow(ORG, USER, OTHER_ID, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.runNow(ORG, USER, 'nope', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findLiveAutomation).toHaveBeenCalledTimes(1);
    });

    it('validates the Run Now body strictly', () => {
      expect(runNowSchema.safeParse(undefined).success).toBe(true);
      expect(runNowSchema.safeParse({ inputs: { topic: 'Bread' } }).success).toBe(true);
      expect(runNowSchema.safeParse({ inputs: { topic: 'Bread' }, mode: 'TEST' }).success).toBe(
        false,
      );
    });
  });
});
