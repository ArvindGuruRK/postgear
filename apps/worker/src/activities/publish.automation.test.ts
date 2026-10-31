/**
 * Post events start workflow runs (Module 09): which workflows a Post
 * Published or Post Failed event starts, exactly once per event, and the
 * failed-publish activity replayed with the same and with a new publish run,
 * and the record-published activity replayed.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: {
      post: { findFirst: jest.fn(), findMany: jest.fn() },
      media: { findMany: jest.fn() },
      $transaction: jest.fn(),
    },
  };
});

import {
  type AutomationGraph,
  LIMITS,
  type PUBLISH_FAILURE_REASON_IDS,
} from '@postgear/automation';
import { prisma } from '@postgear/db';
import {
  AUTOMATION_RUN_WORKFLOW,
  type PublishFailureReason,
  postFailedTriggerEventId,
  postPublishedTriggerEventId,
  SCHEDULING_TASK_QUEUE,
} from '@postgear/scheduling';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { MockActivityEnvironment } from '@temporalio/testing';
import { graphOf, line, step } from '../automation/testing';
import {
  type AutomationEnqueueClient,
  enqueueAutomationRuns,
  postLink,
  startAutomationRuns,
} from '../lib/automation-enqueue';
import type { ActivityDeps } from './deps';
import { createPublishActivities } from './publish.activities';

// The trigger's reason list and the publish contract's reasons are one list.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const reasonsMatch: Same<(typeof PUBLISH_FAILURE_REASON_IDS)[number], PublishFailureReason> = true;

const ORG = 'org_1';

interface FakeAutomation {
  id: string;
  organizationId?: string;
  status?: 'ACTIVE' | 'PAUSED' | 'DRAFT';
  deletedAt?: Date | null;
  activeVersion?: { id: string; graph: unknown; triggerType: string } | null;
}

interface FakeRun {
  id: string;
  automationId: string;
  versionId: string;
  organizationId: string;
  mode: string;
  status: string;
  triggerType: string;
  triggerEventId: string;
  triggerPayload: unknown;
}

type AutomationWhere = {
  organizationId: string;
  status: string;
  deletedAt: null;
  activeVersion: { is: { triggerType: string } };
};
type RunWhere = {
  organizationId: string;
  automationId: { in: string[] };
  triggerEventId: string;
  status: string;
};

/** Workflows and runs in memory, with the database's unique (automationId, triggerEventId). */
function fakeDb(list: FakeAutomation[]) {
  const automations = list.map((automation) => ({
    organizationId: ORG,
    status: 'ACTIVE' as const,
    deletedAt: null,
    activeVersion: null,
    ...automation,
  }));
  const runs: FakeRun[] = [];
  const client = {
    automation: {
      findMany: jest.fn(async ({ where }: { where: AutomationWhere }) =>
        automations
          .filter(
            (automation) =>
              automation.organizationId === where.organizationId &&
              automation.status === where.status &&
              automation.deletedAt === null &&
              automation.activeVersion?.triggerType === where.activeVersion.is.triggerType,
          )
          .map((automation) => ({ id: automation.id, activeVersion: automation.activeVersion })),
      ),
    },
    automationRun: {
      createMany: jest.fn(
        async ({ data, skipDuplicates }: { data: FakeRun[]; skipDuplicates?: boolean }) => {
          let count = 0;
          for (const row of data) {
            const taken = runs.some(
              (run) =>
                run.automationId === row.automationId && run.triggerEventId === row.triggerEventId,
            );
            if (taken && !skipDuplicates) throw new Error('Unique constraint failed.');
            if (taken) continue;
            runs.push(structuredClone(row));
            count += 1;
          }
          return { count };
        },
      ),
      findMany: jest.fn(async ({ where }: { where: RunWhere }) =>
        runs
          .filter(
            (run) =>
              run.organizationId === where.organizationId &&
              where.automationId.in.includes(run.automationId) &&
              run.triggerEventId === where.triggerEventId &&
              run.status === where.status,
          )
          .map((run) => ({ id: run.id })),
      ),
    },
  };
  return { client: client as unknown as AutomationEnqueueClient, raw: client, runs };
}

function published(config: { channels?: string[]; tags?: string[] } = {}): AutomationGraph {
  return graphOf(
    [
      step('trig1', 'trigger.postPublished', { config: { channels: [], tags: [], ...config } }),
      step('bell', 'notify.inApp'),
    ],
    [line('trig1', 'bell')],
  );
}

function failed(config: { channels?: string[]; reasons?: string[] } = {}): AutomationGraph {
  return graphOf(
    [
      step('trig1', 'trigger.postFailed', { config: { channels: [], reasons: [], ...config } }),
      step('bell', 'notify.inApp'),
    ],
    [line('trig1', 'bell')],
  );
}

function on(id: string, graph: AutomationGraph, extra: Partial<FakeAutomation> = {}) {
  const type = graph.nodes[0].type;
  return { id, activeVersion: { id: `${id}_v2`, graph, triggerType: type }, ...extra };
}

const publishedEvent = (filter: { channelId?: string; tagIds?: string[] }) => ({
  event: 'trigger.postPublished' as const,
  organizationId: ORG,
  triggerEventId: 'post.published:post_1',
  payload: { post: { id: 'grp_1' }, tags: ['Launch'] },
  filter,
});

describe('enqueueAutomationRuns', () => {
  it('inserts one QUEUED live run per matching workflow, once per event', async () => {
    const { client, runs } = fakeDb([on('any', published()), on('other', published())]);

    const first = await enqueueAutomationRuns(client, publishedEvent({ channelId: 'ch_1' }));
    const replay = await enqueueAutomationRuns(client, publishedEvent({ channelId: 'ch_1' }));

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      automationId: 'any',
      versionId: 'any_v2',
      organizationId: ORG,
      mode: 'LIVE',
      status: 'QUEUED',
      triggerType: 'trigger.postPublished',
      triggerEventId: 'post.published:post_1',
      triggerPayload: { post: { id: 'grp_1' }, tags: ['Launch'] },
    });
    // A replay starts what an earlier try may have missed, and nothing new.
    expect(replay.sort()).toEqual(first.sort());

    runs[0].status = 'RUNNING';
    await expect(
      enqueueAutomationRuns(client, publishedEvent({ channelId: 'ch_1' })),
    ).resolves.toEqual([runs[1].id]);

    // Another event is another run.
    await enqueueAutomationRuns(client, {
      ...publishedEvent({ channelId: 'ch_1' }),
      triggerEventId: 'post.published:post_2',
    });
    expect(runs).toHaveLength(4);
  });

  it('reads the channel and tag filters of the active version', async () => {
    const { client, runs } = fakeDb([
      on('any', published()),
      on('ch1', published({ channels: ['ch_1'] })),
      on('ch2', published({ channels: ['ch_2'] })),
      on('launch', published({ tags: ['t_launch'] })),
      on('ch1_sale', published({ channels: ['ch_1'], tags: ['t_sale'] })),
    ]);

    await enqueueAutomationRuns(
      client,
      publishedEvent({ channelId: 'ch_1', tagIds: ['t_launch'] }),
    );

    expect(runs.map((run) => run.automationId).sort()).toEqual(['any', 'ch1', 'launch']);
  });

  it('starts nothing for paused, deleted, draft or other-trigger workflows', async () => {
    const { client, runs } = fakeDb([
      on('paused', published(), { status: 'PAUSED' }),
      on('deleted', published(), { deletedAt: new Date() }),
      on('draft', published(), { status: 'DRAFT' }),
      on('never_on', published(), { activeVersion: null }),
      on('fails', failed()),
      on('broken', published(), {
        activeVersion: {
          id: 'broken_v1',
          graph: { nodes: 'no' },
          triggerType: 'trigger.postPublished',
        },
      }),
    ]);

    await expect(
      enqueueAutomationRuns(client, publishedEvent({ channelId: 'ch_1' })),
    ).resolves.toEqual([]);
    expect(runs).toHaveLength(0);
  });

  it('reads the failure reasons of a Post Failed trigger', async () => {
    const { client, runs } = fakeDb([
      on('any', failed()),
      on('reconnect', failed({ reasons: ['needs_reconnect'] })),
      on('gave_up', failed({ reasons: ['retries_exhausted'], channels: ['ch_1'] })),
    ]);

    await enqueueAutomationRuns(client, {
      event: 'trigger.postFailed',
      organizationId: ORG,
      triggerEventId: 'post.failed:post_1:pub_1',
      payload: {},
      filter: { channelId: 'ch_1', reason: 'retries_exhausted' },
    });

    expect(runs.map((run) => run.automationId).sort()).toEqual(['any', 'gave_up']);
  });

  it('keeps the reason lists in step at compile time', () => {
    expect(reasonsMatch).toBe(true);
  });
});

describe('startAutomationRuns', () => {
  it('starts each run under its own id, and treats an existing one as started', async () => {
    const start = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new WorkflowExecutionAlreadyStartedError('started', 'automation-run:run_b', 'x'),
      );
    const log = jest.fn();

    await startAutomationRuns(
      async () => ({ workflow: { start } }) as unknown as Client,
      ORG,
      ['run_a', 'run_b'],
      log,
    );

    expect(start).toHaveBeenCalledWith(AUTOMATION_RUN_WORKFLOW, {
      workflowId: 'automation-run:run_a',
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [{ runId: 'run_a', organizationId: ORG }],
      workflowExecutionTimeout: `${LIMITS.runTimeoutDays} days`,
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('leaves the runs to the reconcile when Temporal is unreachable', async () => {
    const log = jest.fn();
    await startAutomationRuns(
      async () => {
        throw new Error('down');
      },
      ORG,
      ['run_a'],
      log,
    );
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('markPublishFailed starts Post Failed workflows', () => {
  const mocked = prisma as unknown as {
    post: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  const root = {
    id: 'post_1',
    parentPostId: null,
    content: '<p>Fresh rye today</p>',
    image: null,
    settings: null,
    state: 'QUEUE',
    releaseId: null,
    releaseURL: null,
    error: null,
    group: 'grp_1',
    publishDate: new Date('2026-11-03T09:00:00.000Z'),
    integrationId: 'ch_1',
    integration: {
      id: 'ch_1',
      internalId: 'x-1',
      rootInternalId: 'x-1',
      providerIdentifier: 'x',
      name: 'Bloom On X',
      profile: 'bloom',
      token: 'secret',
      additionalSettings: '[]',
      deletedAt: null,
      disabled: false,
      inBetweenSteps: false,
      refreshNeeded: false,
    },
  };

  function setup() {
    const db = fakeDb([
      on('alert', failed()),
      on('reconnect', failed({ reasons: ['needs_reconnect'] })),
    ]);
    const notifications: unknown[] = [];
    const tx = {
      post: { updateMany: jest.fn(), update: jest.fn() },
      errors: { create: jest.fn() },
      notifications: { create: jest.fn(async (args: unknown) => notifications.push(args)) },
      integration: { updateMany: jest.fn() },
      webhooks: { findMany: jest.fn(async () => []) },
      tagsPosts: {
        findMany: jest.fn(async () => [{ tag: { id: 't_launch', name: 'Launch' } }]),
      },
      ...db.raw,
    };
    mocked.post.findFirst.mockResolvedValue(root);
    mocked.post.findMany.mockResolvedValue([root]);
    mocked.$transaction.mockImplementation(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    );
    const start = jest.fn(async () => undefined);
    const deps = {
      env: { WEB_URL: 'http://localhost:3000/' },
      publicUrl: (key: string) => `http://media.test/${key}`,
      temporalClient: async () => ({ workflow: { start } }) as unknown as Client,
    } as unknown as ActivityDeps;
    const activities = createPublishActivities(deps);
    const fail = (publishRunId: string) =>
      new MockActivityEnvironment({
        workflowExecution: { workflowId: 'post-publish:post_1', runId: publishRunId },
      }).run(activities.markPublishFailed, {
        postId: 'post_1',
        organizationId: ORG,
        reason: 'retries_exhausted' as const,
        message: 'X kept timing out.',
        attempts: 5,
      });
    return { runs: db.runs, start, fail };
  }

  it('starts one run per matching workflow, and a replay starts none', async () => {
    const { runs, start, fail } = setup();

    await fail('pub_run_1');
    await fail('pub_run_1');

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      automationId: 'alert',
      triggerEventId: postFailedTriggerEventId('post_1', 'pub_run_1'),
      triggerPayload: {
        post: { id: 'grp_1', rootId: 'post_1', state: 'ERROR', channel: { id: 'ch_1' } },
        tags: ['Launch'],
        link: postLink('http://localhost:3000', ORG, 'grp_1'),
        error: {
          reason: 'retries_exhausted',
          message: 'X kept timing out.',
          attempts: 5,
          reasonText: 'Gave up after several tries',
        },
      },
    });
    expect(runs[0].triggerPayload).toMatchObject({
      link: 'http://localhost:3000/org_1/composer?group=grp_1',
    });
    // The replay found the run still QUEUED and started it again (Temporal dedupes by id).
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      expect.objectContaining({ workflowId: `automation-run:${runs[0].id}` }),
      expect.objectContaining({ workflowId: `automation-run:${runs[0].id}` }),
    ]);
  });

  it('a post that fails again on a new publish run alerts again', async () => {
    const { runs, fail } = setup();

    await fail('pub_run_1');
    await fail('pub_run_2');

    expect(runs.map((run) => run.triggerEventId)).toEqual([
      'post.failed:post_1:pub_run_1',
      'post.failed:post_1:pub_run_2',
    ]);
  });
});

describe('recordPublished starts Post Published workflows', () => {
  const mocked = prisma as unknown as {
    post: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  const root = {
    id: 'post_1',
    parentPostId: null,
    content: '<p>Fresh rye today</p>',
    image: null,
    settings: null,
    state: 'QUEUE',
    releaseId: null,
    releaseURL: null,
    error: null,
    group: 'grp_1',
    publishDate: new Date('2026-11-03T09:00:00.000Z'),
    integrationId: 'ch_1',
    integration: {
      id: 'ch_1',
      internalId: 'x-1',
      rootInternalId: 'x-1',
      providerIdentifier: 'x',
      name: 'Bloom On X',
      profile: 'bloom',
      token: 'secret',
      additionalSettings: '[]',
      deletedAt: null,
      disabled: false,
      inBetweenSteps: false,
      refreshNeeded: false,
    },
  };

  it('starts one run for the post, however often the activity is replayed', async () => {
    const db = fakeDb([
      on('cheer', published()),
      on('other_channel', published({ channels: ['ch_9'] })),
    ]);
    const tx = {
      post: { updateMany: jest.fn() },
      notifications: { create: jest.fn() },
      webhooks: { findMany: jest.fn(async () => []) },
      tagsPosts: {
        findMany: jest.fn(async () => [{ tag: { id: 't_launch', name: 'Launch' } }]),
      },
      ...db.raw,
    };
    mocked.post.findFirst.mockResolvedValue(root);
    mocked.post.findMany.mockResolvedValue([root]);
    mocked.$transaction.mockImplementation(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    );
    const start = jest.fn(async () => undefined);
    const deps = {
      env: { WEB_URL: 'http://localhost:3000' },
      publicUrl: (key: string) => `http://media.test/${key}`,
      temporalClient: async () => ({ workflow: { start } }) as unknown as Client,
    } as unknown as ActivityDeps;
    const activities = createPublishActivities(deps);
    const record = () =>
      new MockActivityEnvironment().run(activities.recordPublished, {
        postId: 'post_1',
        organizationId: ORG,
        results: [{ id: 'post_1', postId: 'x_99', releaseURL: 'https://x.com/bloom/status/99' }],
      });

    await record();
    await record();
    await record();

    expect(db.runs).toHaveLength(1);
    expect(db.runs[0]).toMatchObject({
      automationId: 'cheer',
      triggerType: 'trigger.postPublished',
      triggerEventId: postPublishedTriggerEventId('post_1'),
      triggerPayload: {
        post: { id: 'grp_1', rootId: 'post_1', state: 'PUBLISHED', channel: { id: 'ch_1' } },
        tags: ['Launch'],
      },
    });
    // Each replay may start the still-QUEUED run again; Temporal dedupes by its id.
    expect(start).toHaveBeenCalledTimes(3);
    for (const call of start.mock.calls) {
      expect((call as unknown[])[1]).toMatchObject({
        workflowId: `automation-run:${db.runs[0].id}`,
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    }
  });
});
