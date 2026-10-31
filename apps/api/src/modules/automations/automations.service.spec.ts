/**
 * The workflows service against a fake repository and the real
 * `@postgear/automation` package: creating blank and from a template, the
 * revision guard, tenancy as 404s, Duplicate, soft delete, the refusals a
 * save always makes (unknown steps, secrets, schema violations), the
 * catalog states and pinned data. Module 09: turning on (the revision
 * check, what blocks it, the automatic posting tick, the version written,
 * the schedule), turning off, Discard Changes, versions read but never
 * changed, Restore As Draft, and who may delete what.
 *
 * `validateGraph` is the real one, wrapped so a test can stand in for a
 * rule the shipped limits cannot reach today (an AI step on a schedule more
 * often than hourly) or for steps the worker cannot run yet.
 */
import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AutomationGraph,
  emptyGraph,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  getTemplate,
  instantiateTemplate,
  type NodeType,
  SECRET_REFUSED_MESSAGE,
  tokensIn,
  validateGraph,
} from '@postgear/automation';
import { AutomationStatus, Role } from '@postgear/db';
import { AutomationContextService, toChannelState } from './automation-context.service';
import type { AutomationTriggers } from './automation-triggers';
import type {
  AutomationRow,
  AutomationsRepository,
  VersionDetailRow,
} from './automations.repository';
import { AutomationsService, copyName, sameJson } from './automations.service';
import type { ConnectionsRepository } from './connections/connections.repository';
import {
  activateAutomationSchema,
  restoreVersionSchema,
  updateAutomationSchema,
} from './dto/automations.schema';

jest.mock('@postgear/automation', () => {
  const actual = jest.requireActual('@postgear/automation');
  return { ...actual, validateGraph: jest.fn(actual.validateGraph) };
});

const validateGraphMock = validateGraph as jest.MockedFunction<typeof validateGraph>;

const ORG = 'org_1';
const USER = 'user_1';
const ID = '3a5c7d2e-1f4b-4c8a-9e6d-0b2a4c6e8f10';
const OTHER_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const NOW = new Date('2026-10-29T09:00:00.000Z');

/** The Publishing Report starter, with the template's own keys. */
function reportGraph(): AutomationGraph {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  return instantiateTemplate(template, (key) => key);
}

function row(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: ID,
    name: 'Publishing Report',
    status: AutomationStatus.DRAFT,
    triggerType: 'trigger.postPublished',
    hasUnpublishedChanges: false,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    templateId: 'publishing-report',
    createdAt: NOW,
    updatedAt: NOW,
    draftGraph: reportGraph() as unknown as AutomationRow['draftGraph'],
    draftRevision: 3,
    pinnedData: {},
    activeVersion: null,
    ...overrides,
  };
}

/** The same value with every object's keys in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reversedKeys(item)]),
  );
}

function node(key: string, type: NodeType, config: Record<string, unknown> = {}): GraphNode {
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

function edge(source: string, target: string): GraphEdge {
  return { id: `${source}:out->${target}`, source, sourcePort: 'out', target, targetPort: 'in' };
}

/** Steps in a chain, top to bottom. */
function chain(...nodes: GraphNode[]): AutomationGraph {
  return {
    ...emptyGraph(),
    nodes: nodes.map((item, i) => ({ ...item, position: { x: 0, y: i * 100 } })),
    edges: nodes.slice(1).map((item, i) => edge(nodes[i].key, item.key)),
  };
}

/** Manual, then an In-App Notification: nothing blocks turning it on. */
function cleanGraph(): AutomationGraph {
  return chain(
    node('trig01', 'trigger.manual'),
    node('bell01', 'notify.inApp', { title: 'Hello', message: 'World' }),
  );
}

/** Every day at 08:00, then an In-App Notification. */
function scheduledGraph(): AutomationGraph {
  return chain(
    node('trig01', 'trigger.schedule', { frequency: 'daily', time: '08:00', timeZone: 'UTC' }),
    node('bell01', 'notify.inApp', { title: 'Hello', message: 'World' }),
  );
}

/** Manual, then Publish with no Manual Review before it. */
function publishGraph(): AutomationGraph {
  return chain(node('trig01', 'trigger.manual'), node('post01', 'postgear.publish'));
}

const VERSION_ID = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const OLD_VERSION_ID = '6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b';

function versionRow(overrides: Partial<VersionDetailRow> = {}): VersionDetailRow {
  return {
    id: VERSION_ID,
    version: 4,
    note: 'Weekly copy',
    triggerType: 'trigger.manual',
    createdAt: NOW,
    createdBy: { id: USER, name: 'Priya', lastName: 'Shah', email: 'priya@example.test' },
    graph: cleanGraph() as unknown as VersionDetailRow['graph'],
    ...overrides,
  };
}

/** Sets one Set Fields value, the place a user would paste a secret. */
function withFieldValue(name: string, value: string): AutomationGraph {
  const graph = reportGraph();
  const fields = graph.nodes.find((node) => node.key === 'fields');
  if (!fields) throw new Error('missing step');
  fields.config = { fields: [{ name, type: 'text', value }] };
  return graph;
}

describe('AutomationsService', () => {
  let repository: jest.Mocked<AutomationsRepository>;
  let triggers: {
    start: jest.Mock<Promise<boolean>>;
    stop: jest.Mock<Promise<boolean>>;
    stopRuns: jest.Mock<Promise<void>>;
  };
  let service: AutomationsService;
  let connectionRows: jest.Mock;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([]),
      search: jest.fn().mockResolvedValue([]),
      liveRunCounts: jest.fn().mockResolvedValue(new Map()),
      find: jest
        .fn()
        .mockImplementation(async (_org: string, id: string) => (id === ID ? row() : null)),
      findSaveState: jest
        .fn()
        .mockImplementation(async (_org: string, id: string) =>
          id === ID
            ? { status: AutomationStatus.DRAFT, draftRevision: 3, activeVersion: null }
            : null,
        ),
      create: jest.fn().mockImplementation(async (_org: string, data) =>
        row({
          id: OTHER_ID,
          name: data.name,
          draftGraph: data.draftGraph,
          triggerType: data.triggerType,
          templateId: data.templateId,
          draftRevision: 1,
        }),
      ),
      update: jest
        .fn()
        .mockImplementation(async (_org: string, _id: string, revision: number, data) =>
          row({ ...data, draftRevision: revision + 1 }),
        ),
      softDelete: jest.fn().mockResolvedValue(true),
      setPinned: jest.fn().mockResolvedValue(true),
      removePinned: jest.fn().mockResolvedValue(true),
      channels: jest.fn().mockResolvedValue([]),
      activate: jest
        .fn()
        .mockImplementation(async () => ({ outcome: 'activated', version: versionRow() })),
      pause: jest.fn().mockResolvedValue(true),
      discard: jest.fn().mockResolvedValue({ outcome: 'no_active_version' }),
      listVersions: jest.fn().mockResolvedValue([]),
      findVersion: jest.fn().mockResolvedValue(null),
      openRuns: jest.fn().mockResolvedValue([]),
      closeRun: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AutomationsRepository>;
    connectionRows = jest.fn().mockResolvedValue([]);
    triggers = {
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn().mockResolvedValue(true),
      stopRuns: jest.fn().mockResolvedValue(undefined),
    };
    service = new AutomationsService(
      repository,
      new AutomationContextService(repository, {
        list: connectionRows,
      } as unknown as ConnectionsRepository),
      triggers as unknown as AutomationTriggers,
    );
  });

  describe('create', () => {
    it('creates a blank draft with an empty graph', async () => {
      const created = await service.create(ORG, USER, {});

      expect(repository.create).toHaveBeenCalledWith(ORG, {
        name: 'Untitled Workflow',
        draftGraph: emptyGraph(),
        triggerType: null,
        templateId: null,
        createdById: USER,
      });
      expect(created).toMatchObject({
        name: 'Untitled Workflow',
        status: 'DRAFT',
        draftRevision: 1,
      });
    });

    it('creates from a template with fresh server-made keys and the caller zone', async () => {
      const created = await service.create(ORG, USER, {
        templateId: 'ai-weekly-post',
        timeZone: 'Asia/Kolkata',
      });

      const graph = created.draftGraph;
      const template = getTemplate('ai-weekly-post');
      const templateKeys = new Set(template?.graph.nodes.map((node) => node.key));
      expect(created.name).toBe('AI Weekly Post');
      expect(created.templateId).toBe('ai-weekly-post');
      expect(created.triggerType).toBe('trigger.schedule');
      expect(graph.nodes).toHaveLength(template?.graph.nodes.length ?? 0);
      for (const node of graph.nodes) {
        expect(node.key).toMatch(/^[a-z][a-z0-9]{9}$/);
        expect(templateKeys.has(node.key)).toBe(false);
      }
      const schedule = graph.nodes.find((node) => node.type === 'trigger.schedule');
      expect(schedule?.config).toMatchObject({ timeZone: 'Asia/Kolkata' });
    });

    it('keeps a name the caller gave and refuses an unknown template', async () => {
      await expect(
        service.create(ORG, USER, { templateId: 'publishing-report', name: 'Daily Log' }),
      ).resolves.toMatchObject({ name: 'Daily Log' });
      await expect(service.create(ORG, USER, { templateId: 'nope' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('saving', () => {
    it('bumps the revision and stores the trigger type', async () => {
      const graph = reportGraph();
      const saved = await service.update(ORG, USER, ID, { draftRevision: 3, draftGraph: graph });

      expect(repository.update).toHaveBeenCalledWith(ORG, ID, 3, {
        updatedById: USER,
        draftGraph: graph,
        triggerType: 'trigger.postPublished',
        hasUnpublishedChanges: false,
      });
      expect(saved.draftRevision).toBe(4);
    });

    it('answers a stale revision with 409 and the current revision', async () => {
      const error = await service
        .update(ORG, USER, ID, { draftRevision: 2, name: 'Renamed' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'automation_conflict',
        details: { currentRevision: 3 },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('answers a save that lost the race in the write itself with 409 too', async () => {
      repository.update.mockResolvedValueOnce(null);
      repository.findSaveState
        .mockResolvedValueOnce({
          status: AutomationStatus.DRAFT,
          draftRevision: 3,
          activeVersion: null,
        })
        .mockResolvedValueOnce({
          status: AutomationStatus.DRAFT,
          draftRevision: 4,
          activeVersion: null,
        });

      const error = await service
        .update(ORG, USER, ID, { draftRevision: 3, name: 'Renamed' })
        .catch((caught: unknown) => caught);

      expect((error as ConflictException).getResponse()).toMatchObject({
        details: { currentRevision: 4 },
      });
    });

    it('flips hasUnpublishedChanges only for active or paused workflows', async () => {
      const graph = reportGraph();
      // Postgres hands JSON back with its keys reordered; that is not a change.
      const stored = reversedKeys(graph) as AutomationGraph;
      const changed = withFieldValue('date', 'today');

      for (const status of [AutomationStatus.ACTIVE, AutomationStatus.PAUSED]) {
        repository.findSaveState.mockResolvedValue({
          status,
          draftRevision: 3,
          activeVersion: { graph: graph as never },
        });
        await service.update(ORG, USER, ID, { draftRevision: 3, draftGraph: stored });
        expect(repository.update.mock.lastCall?.[3].hasUnpublishedChanges).toBe(false);
        await service.update(ORG, USER, ID, { draftRevision: 3, draftGraph: changed });
        expect(repository.update.mock.lastCall?.[3].hasUnpublishedChanges).toBe(true);
      }

      repository.findSaveState.mockResolvedValue({
        status: AutomationStatus.DRAFT,
        draftRevision: 3,
        activeVersion: null,
      });
      await service.update(ORG, USER, ID, { draftRevision: 3, draftGraph: changed });
      expect(repository.update.mock.lastCall?.[3].hasUnpublishedChanges).toBe(false);
    });

    it('leaves hasUnpublishedChanges alone when only the name changes', async () => {
      await service.update(ORG, USER, ID, { draftRevision: 3, name: 'Renamed' });
      expect(repository.update.mock.lastCall?.[3]).toEqual({ updatedById: USER, name: 'Renamed' });
    });

    it('accepts a graph with validation issues: drafts may be unfinished', async () => {
      const graph = reportGraph();
      graph.edges = [];
      await expect(
        service.update(ORG, USER, ID, { draftRevision: 3, draftGraph: graph }),
      ).resolves.toMatchObject({ draftRevision: 4 });
    });
  });

  describe('secret refusal', () => {
    const refused = async (graph: AutomationGraph) => {
      const error = await service
        .update(ORG, USER, ID, { draftRevision: 3, draftGraph: graph })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        message: SECRET_REFUSED_MESSAGE,
        code: 'secret_in_step',
      });
    };

    it('refuses a Slack webhook link in a Set Fields value', async () => {
      await refused(
        withFieldValue(
          'hook',
          'https://hooks.slack.com/services/T0001/B0002/abcdefghijklmnopqrstuvwx',
        ),
      );
    });

    it('refuses a field named password', async () => {
      await refused(withFieldValue('password', 'hunter2hunter2'));
    });

    it('refuses a bearer token', async () => {
      await refused(withFieldValue('auth', 'Bearer abcdefghijklmnopqrstuvwxyz0123456789'));
    });

    it('accepts a harmless link', async () => {
      await expect(
        service.update(ORG, USER, ID, {
          draftRevision: 3,
          draftGraph: withFieldValue('link', 'https://bloombakery.example/menu?day=monday'),
        }),
      ).resolves.toMatchObject({ draftRevision: 4 });
    });
  });

  describe('graph refusal', () => {
    it('refuses an unknown step type or version', async () => {
      for (const change of [{ type: 'notify.carrierPigeon' }, { typeVersion: 99 }]) {
        const graph = reportGraph();
        Object.assign(graph.nodes[1], change);
        const error = await service
          .update(ORG, USER, ID, { draftRevision: 3, draftGraph: graph })
          .catch((caught: unknown) => caught);
        expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
          code: 'unknown_step',
        });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses an unknown key on a step at the door (the request schema)', () => {
      const graph = reportGraph() as unknown as { nodes: Record<string, unknown>[] };
      graph.nodes[0].secretSauce = true;
      expect(
        updateAutomationSchema.safeParse({ draftRevision: 3, draftGraph: graph }).success,
      ).toBe(false);
    });

    it('saves 51 steps (validation reports it) but refuses past the hard cap of 100', () => {
      const withSteps = (count: number) => {
        const graph = reportGraph();
        const base = graph.nodes[1];
        graph.nodes = [
          graph.nodes[0],
          ...Array.from({ length: count - 1 }, (_, i) => ({
            ...base,
            key: `step${String(i).padStart(3, '0')}`,
            name: `Set Fields ${i}`,
          })),
        ];
        graph.edges = [];
        return { draftRevision: 3, draftGraph: graph };
      };
      expect(updateAutomationSchema.safeParse(withSteps(51)).success).toBe(true);
      expect(updateAutomationSchema.safeParse(withSteps(101)).success).toBe(false);
    });
  });

  describe('tenancy', () => {
    it('answers 404 for another workspace on every route', async () => {
      const calls: Array<() => Promise<unknown>> = [
        () => service.get(ORG, OTHER_ID),
        () => service.update(ORG, USER, OTHER_ID, { draftRevision: 1, name: 'x' }),
        () => service.remove(ORG, Role.ADMIN, OTHER_ID),
        () => service.duplicate(ORG, USER, OTHER_ID),
        () => service.validate(ORG, OTHER_ID),
        () => service.pin(ORG, USER, OTHER_ID, 'fields', { a: 1 }),
        () => service.activate(ORG, USER, OTHER_ID, { draftRevision: 3 }),
        () => service.pause(ORG, OTHER_ID),
        () => service.versions(ORG, OTHER_ID),
        () => service.version(ORG, OTHER_ID, '1'),
        () => service.restore(ORG, USER, OTHER_ID, '1', { draftRevision: 3 }),
      ];
      for (const call of calls) await expect(call()).rejects.toBeInstanceOf(NotFoundException);

      repository.removePinned.mockResolvedValueOnce(false);
      await expect(service.unpin(ORG, OTHER_ID, 'fields')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.find).toHaveBeenCalledWith(ORG, OTHER_ID);
    });

    it('treats a malformed id as not found without querying', async () => {
      await expect(service.get(ORG, "x'; DROP")).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.update(ORG, USER, 'nope', { draftRevision: 1, name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.find).not.toHaveBeenCalled();
      expect(repository.findSaveState).not.toHaveBeenCalled();
    });
  });

  describe('duplicate and delete', () => {
    it('duplicates as a draft named (Copy) with fresh keys and working data chips', async () => {
      repository.find.mockResolvedValueOnce(
        row({
          status: AutomationStatus.ACTIVE,
          pinnedData: { fields: { output: {}, pinnedAt: 'x' } },
        }),
      );

      const copy = await service.duplicate(ORG, USER, ID);

      expect(copy.name).toBe('Publishing Report (Copy)');
      expect(copy.status).toBe('DRAFT');
      expect(copy.pinned).toEqual([]);
      const keys = new Set(copy.draftGraph.nodes.map((node) => node.key));
      expect(keys.has('fields')).toBe(false);
      for (const edge of copy.draftGraph.edges) {
        expect(keys.has(edge.source) && keys.has(edge.target)).toBe(true);
      }
      const slack = copy.draftGraph.nodes.find((node) => node.type === 'notify.slack');
      if (!slack) throw new Error('missing Slack step');
      const chips = tokensIn(String((slack.config as { message: string }).message));
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) expect(keys.has(chip.path.split('.')[1])).toBe(true);
    });

    it('cuts a long name so "(Copy)" still fits', () => {
      const copied = copyName('A'.repeat(80));
      expect(copied).toHaveLength(80);
      expect(copied.endsWith(' (Copy)')).toBe(true);
    });

    it('lets a member delete a draft: no schedule to delete, open test runs cancelled', async () => {
      await service.remove(ORG, Role.USER, ID);

      expect(triggers.stop).not.toHaveBeenCalled();
      expect(triggers.stopRuns).toHaveBeenCalledWith(ORG, ID);
      expect(repository.softDelete).toHaveBeenCalledWith(ORG, ID);
    });

    it('stops an active workflow first: schedule, then open runs, then the soft delete', async () => {
      const order: string[] = [];
      triggers.stop.mockImplementation(async () => {
        order.push('schedule');
        return true;
      });
      triggers.stopRuns.mockImplementation(async () => {
        order.push('runs');
      });
      repository.softDelete.mockImplementation(async () => {
        order.push('delete');
        return true;
      });
      repository.find.mockResolvedValueOnce(row({ status: AutomationStatus.ACTIVE }));

      await service.remove(ORG, Role.ADMIN, ID);

      expect(triggers.stop).toHaveBeenCalledWith(ORG, ID);
      expect(triggers.stopRuns).toHaveBeenCalledWith(ORG, ID);
      expect(order).toEqual(['schedule', 'runs', 'delete']);
    });

    it('refuses a member deleting an active workflow with 403, but not a paused one', async () => {
      repository.find.mockResolvedValueOnce(row({ status: AutomationStatus.ACTIVE }));
      const error = await service.remove(ORG, Role.USER, ID).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'Only workspace admins can delete an active workflow.',
      );
      expect(triggers.stop).not.toHaveBeenCalled();
      expect(triggers.stopRuns).not.toHaveBeenCalled();
      expect(repository.softDelete).not.toHaveBeenCalled();

      repository.find.mockResolvedValueOnce(row({ status: AutomationStatus.PAUSED }));
      await service.remove(ORG, Role.USER, ID);
      // A paused workflow should have no schedule; deleting it again costs nothing.
      expect(triggers.stop).toHaveBeenCalledWith(ORG, ID);
      expect(repository.softDelete).toHaveBeenCalledWith(ORG, ID);
    });
  });

  describe('list', () => {
    const listRow = (id: string, name: string) => ({ ...row({ id, name }) });

    it('adds live run counts from one grouped query and pages by cursor', async () => {
      const rows = Array.from({ length: 51 }, (_, i) =>
        listRow(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `Flow ${i}`),
      );
      repository.list.mockResolvedValueOnce(rows);
      repository.liveRunCounts.mockResolvedValueOnce(new Map([[rows[0].id, 12]]));

      const page = await service.list(ORG, {});

      expect(page.automations).toHaveLength(50);
      expect(page.automations[0].runs30d).toBe(12);
      expect(page.automations[1].runs30d).toBe(0);
      expect(page.nextCursor).toBe(rows[49].id);
      expect(repository.liveRunCounts).toHaveBeenCalledTimes(1);
      expect(repository.liveRunCounts.mock.lastCall?.[1]).toHaveLength(50);
    });

    it('searches by every word, case-insensitively, with no cursor', async () => {
      repository.search.mockResolvedValueOnce([
        listRow(ID, 'Weekly Report For Slack'),
        listRow(OTHER_ID, 'Weekly Digest'),
      ]);

      const page = await service.list(ORG, { search: 'report weekly' });

      expect(repository.search).toHaveBeenCalledWith(ORG, 'report', {
        status: undefined,
        limit: 200,
      });
      expect(page.automations.map((item) => item.name)).toEqual(['Weekly Report For Slack']);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('validate and catalog', () => {
    it('reports no node.not_runnable once every step has an executor (Modules 10 to 13)', async () => {
      const result = await service.validate(ORG, ID);
      const notRunnable = result.issues.filter((issue) => issue.code === 'node.not_runnable');
      expect(notRunnable).toEqual([]);
      // Slack and Sheets still have no connection picked.
      expect(result.blocking).toBe(true);
    });

    it('marks steps ready and runnable, Slack as needing a connection, Video as coming soon', async () => {
      const { steps, connectedPlatforms } = await service.catalog(ORG);
      const byType = new Map(steps.map((step) => [step.type, step]));

      expect(byType.get('logic.setFields')).toMatchObject({ state: 'ready', runnable: true });
      expect(byType.get('postgear.createDraft')).toMatchObject({
        state: 'ready',
        runnable: true,
        reason: null,
      });
      expect(byType.get('notify.slack')).toMatchObject({
        state: 'needsConnection',
        runnable: true,
        reason: 'Connect Slack first.',
      });
      expect(byType.get('data.googleSheetsAppendRow')).toMatchObject({ state: 'needsConnection' });
      expect(byType.get('data.httpRequest')).toMatchObject({ state: 'ready' });
      expect(byType.get('ai.generateVideo')).toMatchObject({
        state: 'comingSoon',
        reason: 'Video generation is coming soon.',
      });
      expect(byType.get('postgear.publish')).toMatchObject({
        state: 'needsConnection',
        reason: 'Connect a channel first.',
      });
      expect(connectedPlatforms).toEqual([]);
    });

    it('marks Slack ready once a working Slack connection exists, not a broken one', async () => {
      const slack = { id: 'c1', provider: 'slack', name: 'Marketing Slack' };
      connectionRows.mockResolvedValueOnce([{ ...slack, status: 'NEEDS_RECONNECT' }]);
      const broken = await service.catalog(ORG);
      expect(broken.steps.find((step) => step.type === 'notify.slack')?.state).toBe(
        'needsConnection',
      );

      connectionRows.mockResolvedValueOnce([{ ...slack, status: 'CONNECTED' }]);
      const working = await service.catalog(ORG);
      expect(working.steps.find((step) => step.type === 'notify.slack')).toMatchObject({
        state: 'ready',
        runnable: true,
        reason: null,
      });
    });

    it('marks Publish ready once a channel is active, and lists its platform', async () => {
      repository.channels.mockResolvedValueOnce([
        {
          id: 'ch1',
          name: 'Acme Page',
          providerIdentifier: 'linkedin-page',
          disabled: false,
          refreshNeeded: false,
          inBetweenSteps: false,
        },
      ]);
      const { steps, connectedPlatforms } = await service.catalog(ORG);
      expect(steps.find((step) => step.type === 'postgear.publish')?.state).toBe('ready');
      expect(connectedPlatforms).toEqual(['linkedin']);
    });

    it('maps channel rows to the states validation knows', () => {
      const base = {
        id: 'c',
        name: 'C',
        providerIdentifier: 'x',
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      };
      expect(toChannelState(base).status).toBe('active');
      expect(toChannelState({ ...base, refreshNeeded: true }).status).toBe('needsReconnect');
      expect(toChannelState({ ...base, inBetweenSteps: true }).status).toBe('needsReconnect');
      expect(toChannelState({ ...base, disabled: true, refreshNeeded: true }).status).toBe(
        'disabled',
      );
    });

    it('lists templates without their graphs', () => {
      const templates = service.templates();
      expect(templates.map((template) => template.id)).toContain('publishing-report');
      for (const template of templates) expect(template).not.toHaveProperty('graph');
    });
  });

  describe('pinned data', () => {
    it('redacts on the way in and lists the pin on the workflow', async () => {
      const pinned = await service.pin(ORG, USER, ID, 'fields', {
        link: 'https://x.example',
        apiKey: 'abc123secretvalue',
      });

      const entry = repository.setPinned.mock.lastCall?.[3] as { output: Record<string, unknown> };
      expect(entry.output).toEqual({ link: 'https://x.example', apiKey: '[hidden]' });
      expect(pinned.nodeKey).toBe('fields');
      expect(pinned.output).toEqual(entry.output);

      repository.find.mockResolvedValueOnce(
        row({
          pinnedData: {
            fields: { output: { link: 'https://x.example' }, pinnedAt: pinned.pinnedAt },
            gone: { output: {}, pinnedAt: pinned.pinnedAt },
          },
        }),
      );
      expect((await service.get(ORG, ID)).pinned).toEqual([
        { nodeKey: 'fields', pinnedAt: pinned.pinnedAt, output: { link: 'https://x.example' } },
      ]);
    });

    it('refuses data past 64 KB and a step that is not in the draft', async () => {
      await expect(
        service.pin(ORG, USER, ID, 'fields', { text: 'x'.repeat(70_000) }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(service.pin(ORG, USER, ID, 'nope', { a: 1 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.pin(ORG, USER, ID, '../x', { a: 1 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.setPinned).not.toHaveBeenCalled();
    });
  });

  describe('turning on (Module 09)', () => {
    /** The draft the admin is looking at, at revision 3. */
    function draft(graph: AutomationGraph, overrides: Partial<AutomationRow> = {}) {
      repository.find.mockResolvedValue(
        row({ draftGraph: graph as unknown as AutomationRow['draftGraph'], ...overrides }),
      );
    }

    it('writes the next version, makes it live and sets up its trigger', async () => {
      draft(cleanGraph());

      const result = await service.activate(ORG, USER, ID, {
        draftRevision: 3,
        note: 'Weekly copy',
      });

      expect(repository.activate).toHaveBeenCalledWith(ORG, ID, {
        expectedRevision: 3,
        graph: cleanGraph(),
        triggerType: 'trigger.manual',
        note: 'Weekly copy',
        createdById: USER,
      });
      expect(triggers.start).toHaveBeenCalledWith(ORG, ID, {
        id: VERSION_ID,
        graph: cleanGraph(),
      });
      expect(result.version).toEqual({
        version: 4,
        note: 'Weekly copy',
        triggerType: 'trigger.manual',
        createdAt: NOW.toISOString(),
        createdBy: { id: USER, name: 'Priya Shah' },
        active: true,
      });
      expect(result.warnings).toEqual([]);
      expect(result.automation.id).toBe(ID);
    });

    it('stores an empty note as no note', async () => {
      draft(cleanGraph());
      await service.activate(ORG, USER, ID, { draftRevision: 3, note: '' });
      expect(repository.activate.mock.lastCall?.[2].note).toBeNull();
    });

    it('still turns on, with a warning, when the schedule cannot be set up yet', async () => {
      draft(scheduledGraph());
      triggers.start.mockResolvedValue(false);

      const result = await service.activate(ORG, USER, ID, { draftRevision: 3 });

      expect(repository.activate.mock.lastCall?.[2].triggerType).toBe('trigger.schedule');
      expect(result.warnings).toEqual([
        'The schedule is not set up yet. PostGear will set it up within 15 minutes.',
      ]);
    });

    it('answers a stale revision with 409 before anything is written', async () => {
      draft(cleanGraph());
      const error = await service
        .activate(ORG, USER, ID, { draftRevision: 2 })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'automation_conflict',
        details: { currentRevision: 3 },
      });
      expect(repository.activate).not.toHaveBeenCalled();
      expect(triggers.start).not.toHaveBeenCalled();
    });

    it('answers 409 when the draft changed inside the write itself', async () => {
      draft(cleanGraph());
      repository.activate.mockResolvedValueOnce({ outcome: 'conflict', currentRevision: 4 });

      await expect(service.activate(ORG, USER, ID, { draftRevision: 3 })).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { code: 'automation_conflict', details: { currentRevision: 4 } },
      });
      expect(triggers.start).not.toHaveBeenCalled();
    });

    it('is blocked by every error, a missing connection included', async () => {
      // No Slack connection is chosen.
      const graph = chain(
        node('trig01', 'trigger.manual'),
        node('slack1', 'notify.slack', { connectionId: '', message: 'Hi', footer: true }),
      );
      draft(graph);
      const context = await new AutomationContextService(repository, {
        list: connectionRows,
      } as unknown as ConnectionsRepository).forOrg(ORG);
      const errors = validateGraph(graph, context).filter((issue) => issue.severity === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.map((issue) => issue.code)).not.toContain('node.not_runnable');

      await expect(service.activate(ORG, USER, ID, { draftRevision: 3 })).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: {
          code: 'activation_blocked',
          message: 'Fix the problems in this workflow before you turn it on.',
          details: { issues: errors.length },
        },
      });
      expect(repository.activate).not.toHaveBeenCalled();
    });

    it('says when an AI schedule is the only problem, and blocks when there are others', async () => {
      draft(scheduledGraph());
      const tooOften = {
        severity: 'error' as const,
        code: 'schedule.too_frequent_for_ai' as const,
        message: 'Workflows with AI steps can run at most every 2 hours.',
        nodeKey: 'trig01',
      };
      validateGraphMock.mockReturnValueOnce([tooOften]);

      await expect(service.activate(ORG, USER, ID, { draftRevision: 3 })).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: {
          code: 'schedule_too_frequent',
          message: 'Workflows with AI steps can run at most every 2 hours.',
        },
      });

      validateGraphMock.mockReturnValueOnce([
        tooOften,
        { severity: 'error', code: 'node.not_runnable', message: 'x', nodeKey: 'bell01' },
        { severity: 'warning', code: 'node.not_runnable', message: 'y', nodeKey: 'bell01' },
      ] as ReturnType<typeof validateGraph>);
      await expect(service.activate(ORG, USER, ID, { draftRevision: 3 })).rejects.toMatchObject({
        response: { code: 'activation_blocked', details: { issues: 2 } },
      });
      expect(repository.activate).not.toHaveBeenCalled();
    });

    it('needs the automatic posting tick when a post can go out unreviewed', async () => {
      // Publish cannot run yet either; this test is about the tick alone.
      draft(publishGraph());
      validateGraphMock.mockReturnValueOnce([]);

      await expect(service.activate(ORG, USER, ID, { draftRevision: 3 })).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: {
          code: 'confirm_automatic_posting',
          message: 'Confirm that posts will go out automatically.',
        },
      });
      expect(repository.activate).not.toHaveBeenCalled();

      validateGraphMock.mockReturnValueOnce([]);
      await service.activate(ORG, USER, ID, { draftRevision: 3, acceptAutomaticPosting: true });
      expect(repository.activate).toHaveBeenCalledTimes(1);
    });

    it('takes a strict body with a short, clean note', () => {
      expect(activateAutomationSchema.safeParse({ draftRevision: 3 }).success).toBe(true);
      expect(activateAutomationSchema.safeParse({ draftRevision: 0 }).success).toBe(false);
      expect(activateAutomationSchema.safeParse({ draftRevision: 3, force: true }).success).toBe(
        false,
      );
      expect(
        activateAutomationSchema.safeParse({ draftRevision: 3, acceptAutomaticPosting: 'yes' })
          .success,
      ).toBe(false);
      expect(
        activateAutomationSchema.safeParse({ draftRevision: 3, note: 'x'.repeat(281) }).success,
      ).toBe(false);
      expect(
        activateAutomationSchema.safeParse({ draftRevision: 3, note: '  New\u0000   copy ' }),
      ).toEqual({ success: true, data: { draftRevision: 3, note: 'New copy' } });
    });
  });

  describe('turning off and discarding (Module 09)', () => {
    it('pauses, then deletes the schedule', async () => {
      repository.find.mockResolvedValue(row({ status: AutomationStatus.ACTIVE }));
      const order: string[] = [];
      repository.pause.mockImplementation(async () => {
        order.push('pause');
        return true;
      });
      triggers.stop.mockImplementation(async () => {
        order.push('schedule');
        return true;
      });

      const automation = await service.pause(ORG, ID);

      expect(repository.pause).toHaveBeenCalledWith(ORG, ID);
      expect(triggers.stop).toHaveBeenCalledWith(ORG, ID);
      expect(order).toEqual(['pause', 'schedule']);
      expect(automation.id).toBe(ID);
    });

    it('is a 409 for a draft that was never turned on', async () => {
      await expect(service.pause(ORG, ID)).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { code: 'no_active_version' },
      });
      expect(repository.pause).not.toHaveBeenCalled();
      expect(triggers.stop).not.toHaveBeenCalled();
    });

    it('discards the draft back to the live version', async () => {
      repository.discard.mockResolvedValueOnce({
        outcome: 'discarded',
        row: row({ status: AutomationStatus.ACTIVE, draftRevision: 4 }),
      });

      const automation = await service.discard(ORG, USER, ID);

      expect(repository.discard).toHaveBeenCalledWith(ORG, ID, USER);
      expect(automation.draftRevision).toBe(4);
      // The live version is not touched, so nothing is scheduled again.
      expect(repository.activate).not.toHaveBeenCalled();
      expect(triggers.start).not.toHaveBeenCalled();
    });

    it('is a 409 with nothing live to go back to, and a 404 for another workspace', async () => {
      await expect(service.discard(ORG, USER, ID)).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: {
          code: 'no_active_version',
          message: 'This workflow has no live version to go back to.',
        },
      });

      repository.discard.mockResolvedValueOnce({ outcome: 'not_found' });
      await expect(service.discard(ORG, USER, OTHER_ID)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.discard(ORG, USER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.discard).toHaveBeenCalledTimes(2);
    });
  });

  describe('versions (Module 09)', () => {
    it('lists versions newest first with the live one marked and names shown', async () => {
      repository.find.mockResolvedValue(
        row({ status: AutomationStatus.ACTIVE, activeVersion: { id: VERSION_ID, version: 4 } }),
      );
      repository.listVersions.mockResolvedValueOnce([
        versionRow(),
        versionRow({
          id: OLD_VERSION_ID,
          version: 3,
          note: null,
          createdBy: { id: 'u2', name: null, lastName: null, email: 'sam@example.test' },
        }),
      ]);

      const versions = await service.versions(ORG, ID);

      expect(repository.listVersions).toHaveBeenCalledWith(ORG, ID);
      expect(versions).toEqual([
        {
          version: 4,
          note: 'Weekly copy',
          triggerType: 'trigger.manual',
          createdAt: NOW.toISOString(),
          createdBy: { id: USER, name: 'Priya Shah' },
          active: true,
        },
        {
          version: 3,
          note: null,
          triggerType: 'trigger.manual',
          createdAt: NOW.toISOString(),
          createdBy: { id: 'u2', name: 'sam@example.test' },
          active: false,
        },
      ]);
      // The list never carries graphs.
      expect(versions[0]).not.toHaveProperty('graph');
    });

    it('opens one version with its graph, and 404s a number that is not one', async () => {
      repository.findVersion.mockResolvedValueOnce(
        versionRow({ graph: scheduledGraph() as never }),
      );

      const found = await service.version(ORG, ID, '4');
      expect(repository.findVersion).toHaveBeenCalledWith(ORG, ID, 4);
      expect(found).toMatchObject({ version: 4, active: false, graph: scheduledGraph() });

      for (const bad of ['0', '04', '-1', '1.5', 'abc', '1e3', '9999999999']) {
        await expect(service.version(ORG, ID, bad)).rejects.toThrow('Version not found');
      }
      await expect(service.version(ORG, ID, '7')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findVersion).toHaveBeenCalledTimes(2);
    });

    it('restores a version as the draft, checked against the revision', async () => {
      repository.findVersion.mockResolvedValue(
        versionRow({ version: 2, graph: scheduledGraph() as never }),
      );

      const automation = await service.restore(ORG, USER, ID, '2', { draftRevision: 3 });

      expect(repository.findVersion).toHaveBeenCalledWith(ORG, ID, 2);
      expect(repository.update).toHaveBeenCalledWith(ORG, ID, 3, {
        updatedById: USER,
        draftGraph: scheduledGraph(),
        triggerType: 'trigger.schedule',
        hasUnpublishedChanges: false,
      });
      expect(automation.draftRevision).toBe(4);
      // Restoring writes the draft only: nothing goes live, no schedule changes.
      expect(repository.activate).not.toHaveBeenCalled();
      expect(triggers.start).not.toHaveBeenCalled();
      expect(triggers.stop).not.toHaveBeenCalled();
    });

    it('works out Unpublished Changes against the live version', async () => {
      const live = cleanGraph();
      repository.findSaveState.mockResolvedValue({
        status: AutomationStatus.ACTIVE,
        draftRevision: 3,
        activeVersion: { graph: live as never },
      });

      repository.findVersion.mockResolvedValueOnce(versionRow({ graph: live as never }));
      await service.restore(ORG, USER, ID, '4', { draftRevision: 3 });
      expect(repository.update.mock.lastCall?.[3].hasUnpublishedChanges).toBe(false);

      repository.findVersion.mockResolvedValueOnce(
        versionRow({ version: 2, graph: scheduledGraph() as never }),
      );
      await service.restore(ORG, USER, ID, '2', { draftRevision: 3 });
      expect(repository.update.mock.lastCall?.[3].hasUnpublishedChanges).toBe(true);
    });

    it('answers a stale revision or a lost race with 409, and an unknown version with 404', async () => {
      repository.findVersion.mockResolvedValue(versionRow());

      await expect(service.restore(ORG, USER, ID, '4', { draftRevision: 2 })).rejects.toMatchObject(
        {
          status: HttpStatus.CONFLICT,
          response: { code: 'automation_conflict', details: { currentRevision: 3 } },
        },
      );
      expect(repository.update).not.toHaveBeenCalled();

      repository.update.mockResolvedValueOnce(null);
      repository.findSaveState
        .mockResolvedValueOnce({
          status: AutomationStatus.DRAFT,
          draftRevision: 3,
          activeVersion: null,
        })
        .mockResolvedValueOnce({
          status: AutomationStatus.DRAFT,
          draftRevision: 5,
          activeVersion: null,
        });
      await expect(service.restore(ORG, USER, ID, '4', { draftRevision: 3 })).rejects.toMatchObject(
        { response: { details: { currentRevision: 5 } } },
      );

      repository.findVersion.mockResolvedValue(null);
      await expect(service.restore(ORG, USER, ID, '9', { draftRevision: 3 })).rejects.toThrow(
        'Version not found',
      );
      expect(restoreVersionSchema.safeParse({ draftRevision: 3, graph: {} }).success).toBe(false);
    });
  });

  describe('edge cases (Module 14)', () => {
    function draftOf(graph: AutomationGraph) {
      repository.find.mockResolvedValue(
        row({ draftGraph: graph as unknown as AutomationRow['draftGraph'] }),
      );
    }

    async function expectActivationBlocked() {
      await expect(service.activate(ORG, USER, ID, { draftRevision: 3 })).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: { code: 'activation_blocked' },
      });
      expect(repository.activate).not.toHaveBeenCalled();
    }

    it('marks a step whose channel is disconnected, and that blocks turning it on', async () => {
      repository.channels.mockResolvedValue([
        {
          id: 'ch1',
          name: 'Acme Page',
          providerIdentifier: 'linkedin-page',
          disabled: false,
          refreshNeeded: true,
          inBetweenSteps: false,
        },
      ]);
      draftOf(
        chain(
          node('trig01', 'trigger.manual'),
          node('drft01', 'postgear.createDraft', { channels: ['ch1'], text: 'Hello' }),
        ),
      );

      const { issues, blocking } = await service.validate(ORG, ID);
      expect(blocking).toBe(true);
      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'node.channel_missing',
          nodeKey: 'drft01',
          field: 'channels',
          message: 'Acme Page is disconnected. Reconnect it on the Channels page.',
        }),
      );
      await expectActivationBlocked();
    });

    it('marks data from a deleted earlier step, and refuses to turn the workflow on', async () => {
      draftOf(
        chain(
          node('trig01', 'trigger.manual'),
          node('bell01', 'notify.inApp', {
            title: 'Hello',
            message: 'Text: {{ nodes.gone01.output.text }}',
          }),
        ),
      );

      const { issues } = await service.validate(ORG, ID);
      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'token.unknown_node',
          nodeKey: 'bell01',
          message: 'This data is no longer available.',
        }),
      );
      await expectActivationBlocked();
    });

    it('refuses to turn on a 51st step', async () => {
      const bells = Array.from({ length: 50 }, (_, i) =>
        node(`bell${String(i).padStart(2, '0')}`, 'notify.inApp', {
          title: 'Hello',
          message: 'World',
        }),
      );
      const fifty = chain(node('trig01', 'trigger.manual'), ...bells.slice(1));
      const fiftyOne = chain(node('trig01', 'trigger.manual'), ...bells);
      expect(fifty.nodes).toHaveLength(50);
      expect(fiftyOne.nodes).toHaveLength(51);

      draftOf(fifty);
      const fine = await service.validate(ORG, ID);
      expect(fine.issues.map((issue) => issue.code)).not.toContain('graph.too_many_nodes');

      draftOf(fiftyOne);
      const { issues } = await service.validate(ORG, ID);
      expect(issues).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'graph.too_many_nodes',
          message: 'Workflows can have up to 50 steps.',
        }),
      );
      await expectActivationBlocked();
    });

    it('refuses an unknown key in the body, and a secret under an unknown settings key', async () => {
      expect(
        updateAutomationSchema.safeParse({ draftRevision: 3, name: 'x', status: 'ACTIVE' }).success,
      ).toBe(false);

      const graph = cleanGraph();
      graph.nodes[1].config = { ...graph.nodes[1].config, apiKey: 'abc123abc123abc123' };
      await expect(
        service.update(ORG, USER, ID, { draftRevision: 3, draftGraph: graph }),
      ).rejects.toMatchObject({ response: { code: 'secret_in_step' } });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('saves a harmless unknown settings key as a draft problem that blocks turning on', async () => {
      const graph = cleanGraph();
      graph.nodes[1].config = { ...graph.nodes[1].config, colour: 'blue' };
      await expect(
        service.update(ORG, USER, ID, { draftRevision: 3, draftGraph: graph }),
      ).resolves.toMatchObject({ draftRevision: 4 });

      draftOf(graph);
      const { issues } = await service.validate(ORG, ID);
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'node.config_invalid', nodeKey: 'bell01' }),
      );
      await expectActivationBlocked();
    });
  });
});

describe('sameJson', () => {
  it('ignores key order but not values', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameJson({ a: 1 }, null)).toBe(false);
  });
});
