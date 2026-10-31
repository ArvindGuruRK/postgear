/**
 * Module 14, "No secret anywhere": one sweeping spec. Slack, Teams, Discord,
 * HTTP (secret headers) and Google connections are made with recognisable
 * fake secrets through the real ConnectionsService. A workflow uses each of
 * them, and its runs carry those secrets in every place the worker could
 * have let one slip (step input, output and error, the trigger data, the
 * run's error sentence, the last run error on the workflow). Then every
 * read the API has for workflows, the catalog, connections, runs, run steps,
 * versions and the live events stream is called through the real services,
 * and none of the answers may hold any of the secret strings.
 *
 * The run repository reads the very ciphertexts the connections service
 * stored, so the redaction is checked against the real encrypt and decrypt.
 */
import type { ConfigService } from '@nestjs/config';
import {
  type AutomationGraph,
  emptyGraph,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  HIDDEN,
  type NodeType,
} from '@postgear/automation';
import {
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepStatus,
  type Prisma,
} from '@postgear/db';
import type { SseStream } from '../../common/sse';
import type { RedisService } from '../redis/redis.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import { AutomationContextService } from './automation-context.service';
import type { AutomationTriggers } from './automation-triggers';
import type {
  AutomationRow,
  AutomationsRepository,
  UsageGraphRow,
  VersionDetailRow,
} from './automations.repository';
import { AutomationsService } from './automations.service';
import type {
  ConnectionRow,
  ConnectionsRepository,
  ConnectionWithCredentials,
  ConnectionWrite,
} from './connections/connections.repository';
import { ConnectionsService } from './connections/connections.service';
import { AutomationRunEventsService } from './runs/automation-run-events.service';
import type {
  AutomationRunsRepository,
  LatestStep,
  RunDetailRow,
  RunSummaryRow,
} from './runs/automation-runs.repository';
import { AutomationRunsService } from './runs/automation-runs.service';

const ORG = 'org-sweep';
const USER = 'user-sweep';
const AUTOMATION_ID = '3a5c7d2e-1f4b-4c8a-9e6d-0b2a4c6e8f10';
const RUN_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const VERSION_ID = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const NOW = new Date('2026-10-31T09:00:00.000Z');

/** Recognisable fake secrets, one or two per app. */
const SECRET = {
  slack: 'SlackSecretZq81xLeakValue',
  teams: 'TeamsSigSecretWv27LeakValue',
  discord: 'DiscordTokenSecretKp44LeakValue',
  httpKey: 'HttpHeaderSecretMm55LeakValue',
  httpBearer: 'HttpBearerSecretNn66LeakValue',
  googleRefresh: 'GoogleRefreshSecretRr77LeakValue',
  googleAccess: 'GoogleAccessSecretAa88LeakValue',
} as const;

const SLACK_LINK = `https://hooks.slack.com/services/T0SWEEP1/B0SWEEP1/${SECRET.slack}`;
const TEAMS_LINK = `https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=${SECRET.teams}`;
const DISCORD_LINK = `https://discord.com/api/webhooks/123456789/${SECRET.discord}`;

/* ───────────────────────── connections store ───────────────────────── */

type StoredRow = ConnectionWithCredentials & { organizationId: string; deletedAt: Date | null };

function connectionsStore() {
  const rows: StoredRow[] = [];
  let next = 1;
  const live = (orgId: string, id: string) =>
    rows.find((row) => row.id === id && row.organizationId === orgId && !row.deletedAt);
  const safe = (row: StoredRow): ConnectionRow => {
    const { credentials: _c, organizationId: _o, deletedAt: _d, ...rest } = row;
    return rest;
  };
  return {
    rows,
    list: jest.fn(async (orgId: string) =>
      rows.filter((row) => row.organizationId === orgId && !row.deletedAt).map(safe),
    ),
    find: jest.fn(async (orgId: string, id: string) => {
      const row = live(orgId, id);
      return row ? safe(row) : null;
    }),
    findWithCredentials: jest.fn(async (orgId: string, id: string) => {
      const row = live(orgId, id);
      return row ? { ...safe(row), credentials: row.credentials } : null;
    }),
    count: jest.fn(
      async (orgId: string) => rows.filter((row) => row.organizationId === orgId).length,
    ),
    nameTaken: jest.fn(async () => false),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const row = {
        id: `00000000-0000-4000-8000-00000000000${next++}`,
        status: 'CONNECTED',
        lastCheckedAt: null,
        lastError: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        ...data,
      } as unknown as StoredRow;
      rows.push(row);
      return safe(row);
    }),
    update: jest.fn(
      async (orgId: string, id: string, _user: string | null, data: ConnectionWrite) => {
        const row = live(orgId, id);
        if (!row) return null;
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) (row as Record<string, unknown>)[key] = value;
        }
        return safe(row);
      },
    ),
    softDelete: jest.fn(async () => true),
  };
}

/* ───────────────────────── graph ───────────────────────── */

function node(key: string, type: NodeType, config: Record<string, unknown>): GraphNode {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`No definition for ${type}`);
  return {
    key,
    type,
    typeVersion: definition.typeVersion,
    name: definition.title,
    position: { x: 0, y: 0 },
    config: { ...JSON.parse(JSON.stringify(definition.defaultConfig)), ...config },
  };
}

function chain(...nodes: GraphNode[]): AutomationGraph {
  const edges: GraphEdge[] = nodes.slice(1).map((item, i) => ({
    id: `${nodes[i].key}:out->${item.key}`,
    source: nodes[i].key,
    sourcePort: 'out',
    target: item.key,
    targetPort: 'in',
  }));
  return {
    ...emptyGraph(),
    nodes: nodes.map((item, i) => ({ ...item, position: { x: 0, y: i * 100 } })),
    edges,
  };
}

/* ───────────────────────── the sweep ───────────────────────── */

describe('No secret anywhere (Module 14)', () => {
  let previousKey: string | undefined;

  beforeAll(() => {
    previousKey = process.env.ENCRYPTION_KEY_AES256;
    process.env.ENCRYPTION_KEY_AES256 = 'e'.repeat(64);
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY_AES256 = previousKey;
  });

  /** Fails with the secret's name and where it showed up. */
  function expectNoSecret(label: string, response: unknown) {
    const json = JSON.stringify(response) ?? '';
    for (const [name, secret] of Object.entries(SECRET)) {
      if (json.includes(secret)) {
        throw new Error(`${label} returned the ${name} secret: ${json.slice(0, 400)}`);
      }
    }
    expect(json).not.toContain('"credentials"');
  }

  it('never returns a connection secret from any read, write answer or event', async () => {
    /* Connections, through the real service. */
    const store = connectionsStore();
    let graph: AutomationGraph = emptyGraph();
    const usage = (): UsageGraphRow[] => [
      {
        id: AUTOMATION_ID,
        name: 'Every App',
        status: AutomationStatus.ACTIVE,
        draftGraph: graph as unknown as Prisma.JsonValue,
        activeVersion: { graph: graph as unknown as Prisma.JsonValue },
      } as unknown as UsageGraphRow,
    ];
    const automationsRepository = {
      usageGraphs: jest.fn(async () => usage()),
      channels: jest.fn(async () => []),
    } as unknown as jest.Mocked<AutomationsRepository>;
    const context = new AutomationContextService(
      automationsRepository,
      store as unknown as ConnectionsRepository,
    );
    const config = { get: () => 'true' } as unknown as ConfigService;
    const connections = new ConnectionsService(
      store as unknown as ConnectionsRepository,
      context,
      config as never,
    );

    const writes: unknown[] = [];
    const slack = await connections.create(ORG, USER, {
      provider: 'slack',
      name: 'Sweep Slack',
      credentials: { webhookUrl: SLACK_LINK },
    });
    const teams = await connections.create(ORG, USER, {
      provider: 'teams',
      name: 'Sweep Teams',
      credentials: { webhookUrl: TEAMS_LINK },
    });
    const discord = await connections.create(ORG, USER, {
      provider: 'discord',
      name: 'Sweep Discord',
      credentials: { webhookUrl: DISCORD_LINK },
    });
    const http = await connections.create(ORG, USER, {
      provider: 'http',
      name: 'Sweep Headers',
      credentials: {
        headers: [
          { name: 'X-Api-Key', value: SECRET.httpKey },
          { name: 'Authorization', value: `Bearer ${SECRET.httpBearer}` },
        ],
      },
    });
    const google = await connections.saveGrant(ORG, USER, 'google', {
      credentials: {
        accessToken: SECRET.googleAccess,
        refreshToken: SECRET.googleRefresh,
        expiresAt: NOW.getTime() + 3_600_000,
        scope: 'https://www.googleapis.com/auth/drive.file',
        email: 'sweep@gmail.com',
      },
      meta: { email: 'sweep@gmail.com' },
      name: 'sweep@gmail.com',
    });
    writes.push(slack, teams, discord, http, google);
    expect(store.rows).toHaveLength(5);
    // At rest only ciphertext.
    for (const row of store.rows) expectNoSecret(`stored ${row.provider}`, row.credentials);

    graph = chain(
      node('trig01', 'trigger.manual', {}),
      node('slack1', 'notify.slack', { connectionId: slack.id, message: 'Hi' }),
      node('teams1', 'notify.teams', { connectionId: teams.id, message: 'Hi' }),
      node('disc01', 'notify.discord', { connectionId: discord.id, message: 'Hi' }),
      node('http01', 'data.httpRequest', {
        method: 'POST',
        url: 'https://api.example.com/hooks/new-post',
        secretHeadersConnectionId: http.id,
        bodyType: 'json',
        body: '{"a": 1}',
      }),
      node('sheet1', 'data.googleSheetsAppendRow', { connectionId: google.id }),
    );

    /* Workflows, catalog, versions. */
    const workflow = (): AutomationRow => ({
      id: AUTOMATION_ID,
      name: 'Every App',
      status: AutomationStatus.ACTIVE,
      triggerType: 'trigger.manual',
      hasUnpublishedChanges: false,
      lastRunAt: NOW,
      lastRunStatus: AutomationRunStatus.FAILED,
      lastRunError: `Slack refused ${SLACK_LINK}`,
      templateId: null,
      createdAt: NOW,
      updatedAt: NOW,
      draftGraph: graph as unknown as AutomationRow['draftGraph'],
      draftRevision: 3,
      pinnedData: {},
      activeVersion: { id: VERSION_ID, version: 1 },
    });
    const version = (): VersionDetailRow => ({
      id: VERSION_ID,
      version: 1,
      note: null,
      triggerType: 'trigger.manual',
      createdAt: NOW,
      createdBy: { id: USER, name: 'Priya', lastName: 'Shah', email: 'priya@example.test' },
      graph: graph as unknown as VersionDetailRow['graph'],
    });
    Object.assign(automationsRepository, {
      list: jest.fn(async () => [workflow()]),
      search: jest.fn(async () => [workflow()]),
      liveRunCounts: jest.fn(async () => new Map([[AUTOMATION_ID, 1]])),
      find: jest.fn(async (_org: string, id: string) => (id === AUTOMATION_ID ? workflow() : null)),
      listVersions: jest.fn(async () => [version()]),
      findVersion: jest.fn(async () => version()),
    });
    const automations = new AutomationsService(automationsRepository, context, {
      start: jest.fn(),
      stop: jest.fn(),
      stopRuns: jest.fn(),
    } as unknown as AutomationTriggers);

    /* Runs: every secret slipped into the stored run data. */
    const summary = (overrides: Partial<RunSummaryRow> = {}): RunSummaryRow => ({
      id: RUN_ID,
      automationId: AUTOMATION_ID,
      mode: AutomationRunMode.TEST,
      status: AutomationRunStatus.FAILED,
      triggerType: 'trigger.manual',
      options: null,
      startedById: USER,
      stepCount: 6,
      creditsUsed: 0,
      error: `Teams said no to ${TEAMS_LINK}`,
      startedAt: NOW,
      finishedAt: NOW,
      createdAt: NOW,
      versionId: null,
      temporalWorkflowId: null,
      version: null,
      ...overrides,
    });
    const step = (
      nodeKey: string,
      nodeType: string,
      data: { input?: unknown; output?: unknown; error?: unknown },
    ): LatestStep => ({
      step: {
        id: `row_${nodeKey}`,
        nodeKey,
        nodeType,
        nodeName: nodeKey,
        status: data.error ? AutomationStepStatus.FAILED : AutomationStepStatus.SUCCEEDED,
        attempt: 1,
        input: (data.input ?? null) as Prisma.JsonValue,
        output: (data.output ?? null) as Prisma.JsonValue,
        truncated: false,
        error: (data.error ?? null) as Prisma.JsonValue,
        startedAt: NOW,
        finishedAt: NOW,
        durationMs: 5,
        ports: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      attempts: 1,
    });
    const steps: LatestStep[] = [
      step('slack1', 'notify.slack', {
        input: { link: SLACK_LINK },
        output: { sentTo: `Posted through ${SLACK_LINK}` },
      }),
      step('teams1', 'notify.teams', { input: { webhook: TEAMS_LINK } }),
      step('disc01', 'notify.discord', {
        error: { message: 'Failed', code: 'permanent', retryable: false, details: DISCORD_LINK },
      }),
      step('http01', 'data.httpRequest', {
        input: { headers: [{ name: 'X-Api-Key', value: SECRET.httpKey }] },
        output: {
          body: { echoed: `Bearer ${SECRET.httpBearer}`, key: SECRET.httpKey },
          // An app that answers with the bare token, without its "Bearer ".
          echo: SECRET.httpBearer,
          raw: `got ${SECRET.httpKey}`,
        },
      }),
      step('sheet1', 'data.googleSheetsAppendRow', {
        input: { refresh: SECRET.googleRefresh },
        output: { access: SECRET.googleAccess, note: `used ${SECRET.googleRefresh}` },
      }),
    ];
    const ciphertexts = async () => store.rows.map((row) => row.credentials);
    const detail = (): RunDetailRow => ({
      ...summary(),
      triggerPayload: {
        inputs: { topic: `Please post ${DISCORD_LINK}`, hint: SECRET.googleRefresh },
      },
      graphSnapshot: graph as unknown as Prisma.JsonValue,
      version: null,
    });
    const runsRepository = {
      automationExists: jest.fn(async () => true),
      listRuns: jest.fn(async () => [
        summary(),
        summary({ id: '8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', error: `Bad ${SECRET.httpKey}` }),
      ]),
      triggerFacts: jest.fn(async () => new Map()),
      findRun: jest.fn(async () => detail()),
      findRunSummary: jest.fn(async () => summary()),
      latestSteps: jest.fn(async () => steps),
      stepsChangedSince: jest.fn(async () =>
        steps.map((entry) => ({
          id: entry.step.id,
          nodeKey: entry.step.nodeKey,
          updatedAt: entry.step.updatedAt,
        })),
      ),
      connectionCredentials: jest.fn(ciphertexts),
    } as unknown as AutomationRunsRepository;
    const runs = new AutomationRunsService(
      runsRepository,
      context,
      {} as unknown as SchedulingService,
      {} as unknown as RedisService,
    );
    const events: { type: string; data: unknown }[] = [];
    let closed = false;
    const stream: SseStream = {
      send: (type, data) => {
        if (!closed) events.push({ type, data });
      },
      close: () => {
        closed = true;
      },
      signal: new AbortController().signal,
      get closed() {
        return closed;
      },
    };
    await new AutomationRunEventsService(runsRepository, {
      now: () => NOW.getTime(),
      sleep: async () => undefined,
    }).stream(ORG, RUN_ID, stream);

    /* Every read and every write answer. */
    const answers: Record<string, unknown> = {
      'connection writes': writes,
      'GET /automation-connections': await connections.list(ORG),
      'PATCH /automation-connections/:id (name)': await connections.update(ORG, USER, slack.id, {
        name: 'Sweep Slack 2',
      }),
      'PATCH /automation-connections/:id (new link)': await connections.update(
        ORG,
        USER,
        discord.id,
        { credentials: { webhookUrl: DISCORD_LINK } },
      ),
      'POST /automation-connections/:id/check (http)': await connections.check(ORG, USER, http.id),
      'GET /automations': await automations.list(ORG, {}),
      'GET /automations?search': await automations.list(ORG, { search: 'every app' }),
      'GET /automations/:id': await automations.get(ORG, AUTOMATION_ID),
      'GET /automations/catalog': await automations.catalog(ORG),
      'GET /automations/templates': automations.templates(),
      'POST /automations/:id/validate': await automations.validate(ORG, AUTOMATION_ID),
      'GET /automations/:id/versions': await automations.versions(ORG, AUTOMATION_ID),
      'GET /automations/:id/versions/:n': await automations.version(ORG, AUTOMATION_ID, '1'),
      'GET /automations/:id/runs': await runs.listRuns(ORG, AUTOMATION_ID, {}),
      'GET /automation-runs/:id': await runs.getRun(ORG, RUN_ID),
      'GET /automation-runs/:id/events': events,
    };
    for (const [label, answer] of Object.entries(answers)) expectNoSecret(label, answer);

    // The stream really sent the steps and the run, so the check above meant something.
    expect(events.map((event) => event.type)).toEqual([
      'step',
      'step',
      'step',
      'step',
      'step',
      'run',
    ]);
    // Hidden, not dropped: the run still reads.
    const run = answers['GET /automation-runs/:id'] as { error: string; steps: unknown[] };
    expect(run.steps).toHaveLength(5);
    expect(run.error).toBe(HIDDEN);
  });
});
