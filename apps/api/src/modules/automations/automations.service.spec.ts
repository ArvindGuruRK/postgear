/**
 * The workflows service against a fake repository and the real
 * `@postgear/automation` package: creating blank and from a template, the
 * revision guard, tenancy as 404s, Duplicate, soft delete, the refusals a
 * save always makes (unknown steps, secrets, schema violations), the
 * catalog states, pinned data and the activation routes waiting for
 * Module 09.
 */
import {
  ConflictException,
  NotFoundException,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AutomationGraph,
  emptyGraph,
  getTemplate,
  instantiateTemplate,
  SECRET_REFUSED_MESSAGE,
  tokensIn,
} from '@postgear/automation';
import { AutomationStatus } from '@postgear/db';
import { AutomationContextService, toChannelState } from './automation-context.service';
import { AutomationTriggers } from './automation-triggers';
import type { AutomationRow, AutomationsRepository } from './automations.repository';
import { AutomationsService, copyName, sameJson } from './automations.service';
import { updateAutomationSchema } from './dto/automations.schema';

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
  let triggers: AutomationTriggers;
  let service: AutomationsService;

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
    } as unknown as jest.Mocked<AutomationsRepository>;
    triggers = new AutomationTriggers();
    jest.spyOn(triggers, 'stop');
    service = new AutomationsService(
      repository,
      new AutomationContextService(repository),
      triggers,
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
        () => service.remove(ORG, OTHER_ID),
        () => service.duplicate(ORG, USER, OTHER_ID),
        () => service.validate(ORG, OTHER_ID),
        () => service.pin(ORG, USER, OTHER_ID, 'fields', { a: 1 }),
        () => service.activate(ORG, OTHER_ID),
        () => service.pause(ORG, OTHER_ID),
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

    it('soft deletes, stopping the trigger of an active workflow first', async () => {
      await service.remove(ORG, ID);
      expect(triggers.stop).not.toHaveBeenCalled();
      expect(repository.softDelete).toHaveBeenCalledWith(ORG, ID);

      repository.find.mockResolvedValueOnce(row({ status: AutomationStatus.ACTIVE }));
      await service.remove(ORG, ID);
      expect(triggers.stop).toHaveBeenCalledWith(ORG, ID);
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
    it('reports node.not_runnable while the worker has no executors', async () => {
      const result = await service.validate(ORG, ID);
      const notRunnable = result.issues.filter((issue) => issue.code === 'node.not_runnable');
      expect(notRunnable.length).toBe(4);
      expect(result.blocking).toBe(true);
    });

    it('marks steps ready but not runnable, Slack as needing a connection, Video as coming soon', async () => {
      const { steps, connectedPlatforms } = await service.catalog(ORG);
      const byType = new Map(steps.map((step) => [step.type, step]));

      expect(byType.get('logic.setFields')).toMatchObject({
        state: 'ready',
        runnable: false,
        reason: 'Set Fields cannot run yet in this version of PostGear.',
      });
      expect(byType.get('notify.slack')).toMatchObject({
        state: 'needsConnection',
        runnable: false,
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

      repository.find.mockResolvedValueOnce(
        row({
          pinnedData: {
            fields: { output: {}, pinnedAt: pinned.pinnedAt },
            gone: { output: {}, pinnedAt: pinned.pinnedAt },
          },
        }),
      );
      expect((await service.get(ORG, ID)).pinned).toEqual([
        { nodeKey: 'fields', pinnedAt: pinned.pinnedAt },
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

  it('answers 501 for activate and pause until Module 09', async () => {
    await expect(service.activate(ORG, ID)).rejects.toBeInstanceOf(NotImplementedException);
    await expect(service.pause(ORG, ID)).rejects.toThrow(
      'Turning workflows on arrives in a later step of this sprint.',
    );
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
