/**
 * The waiting estimate (Sprint 13, Module 15): a job's size in minutes of
 * work, the rolling pace per kind kept in (a fake) Redis, the wait laid
 * onto the class's slots, and the view's `waiting` while a job waits.
 */
import type { ClipJob } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { RedisService } from '../../redis/redis.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { jobRow, TEST_ORG } from '../testing/rows';
import type { ClipJobsRepository, QueueRow, QueueSnapshot } from './clip-jobs.repository';
import { ClipJobsService } from './clip-jobs.service';
import {
  nextPace,
  PRIOR_SECONDS_PER_MINUTE,
  paceSample,
  roundToMinutes,
  waitSeconds,
  workMinutes,
} from './clip-queue.rules';
import { ClipQueueService } from './clip-queue.service';

const NONE = { videoMs: null, clipMs: null };
const MINUTE = 60_000;
const T0 = new Date('2026-11-28T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('workMinutes', () => {
  it('sizes each kind by the video it works on', () => {
    expect(workMinutes({ kind: 'IMPORT' }, { videoMs: 10 * MINUTE, clipMs: null })).toBe(10);
    expect(workMinutes({ kind: 'IMPORT', output: { durationMs: 4 * MINUTE } }, NONE)).toBe(4);
    expect(workMinutes({ kind: 'HIGHLIGHTS' }, { videoMs: 30 * MINUTE, clipMs: null })).toBe(30);
    expect(workMinutes({ kind: 'RENDER' }, { videoMs: null, clipMs: MINUTE })).toBe(1);
    expect(workMinutes({ kind: 'SEGMENT', input: { fromMs: 0, toMs: 2 * MINUTE } }, NONE)).toBe(2);
    expect(
      workMinutes(
        {
          kind: 'TRANSCRIBE',
          input: {
            ranges: [
              { fromMs: 0, toMs: MINUTE },
              { fromMs: 2 * MINUTE, toMs: 4 * MINUTE },
            ],
          },
        },
        NONE,
      ),
    ).toBe(3);
    expect(
      workMinutes({ kind: 'AUTO_EDIT', input: { range: { fromMs: 0, toMs: 5 * MINUTE } } }, NONE),
    ).toBe(5);
    expect(workMinutes({ kind: 'DOWNLOAD', input: { durationMs: 6 * MINUTE } }, NONE)).toBe(6);
    expect(workMinutes({ kind: 'SPEECH', input: { text: 'a'.repeat(450) } }, NONE)).toBe(0.5);
  });

  it('counts a three second emote as its small floor, never as nothing', () => {
    expect(workMinutes({ kind: 'EMOTE', input: { startMs: 0, endMs: 3_000 } }, NONE)).toBe(0.05);
  });

  it('answers null when the length is not known yet', () => {
    expect(workMinutes({ kind: 'IMPORT' }, NONE)).toBeNull();
    expect(workMinutes({ kind: 'FACES', input: {} }, NONE)).toBeNull();
  });
});

describe('the rolling pace', () => {
  it('starts at the first sample, averages the first five, then follows at a fifth a sample', () => {
    let pace = nextPace(null, 60);
    expect(pace).toEqual({ secondsPerMinute: 60, samples: 1 });
    pace = nextPace(pace, 30);
    expect(pace).toEqual({ secondsPerMinute: 45, samples: 2 });
    for (let index = 0; index < 10; index += 1) pace = nextPace(pace, 30);
    expect(pace.samples).toBe(12);
    const before = pace.secondsPerMinute;
    expect(nextPace(pace, 130).secondsPerMinute).toBeCloseTo(before + (130 - before) * 0.2);
  });

  it('skips a job with no length, no time, or a stuck one', () => {
    expect(paceSample(120, 2)).toBe(60);
    expect(paceSample(120, null)).toBeNull();
    expect(paceSample(0, 2)).toBeNull();
    expect(paceSample(13 * 60 * 60, 2)).toBeNull();
  });
});

describe('waitSeconds', () => {
  it('is nothing when a slot is free and no one is ahead', () => {
    expect(waitSeconds({ ahead: [], running: [300], ownFull: null, slots: 2 })).toBe(0);
  });

  it('lays the jobs ahead onto the slots as they free up', () => {
    // Two slots ending at 60 and 120 s; ahead 100 and 30: 60+100, 120+30, so our turn at 150.
    expect(waitSeconds({ ahead: [100, 30], running: [60, 120], ownFull: null, slots: 2 })).toBe(
      150,
    );
  });

  it('counts only the slots there are when more run than the slots allow', () => {
    // One slot, three running: it frees when the last of them ends.
    expect(waitSeconds({ ahead: [], running: [10, 50, 90], ownFull: null, slots: 1 })).toBe(90);
  });

  it("waits for the workspace's own job when its count is full", () => {
    expect(waitSeconds({ ahead: [], running: [], ownFull: [240, 400], slots: 2 })).toBe(240);
  });

  it('has no honest number when a job in the way has none', () => {
    expect(waitSeconds({ ahead: [null], running: [], ownFull: null, slots: 2 })).toBeNull();
    expect(waitSeconds({ ahead: [], running: [null], ownFull: null, slots: 1 })).toBeNull();
  });

  it('rounds to whole minutes, under 30 seconds to none', () => {
    expect(roundToMinutes(29)).toBe(0);
    expect(roundToMinutes(31)).toBe(60);
    expect(roundToMinutes(239)).toBe(240);
  });
});

/** The pieces of Redis the queue uses, kept in a map. */
class FakeRedis {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
}

function row(overrides: Partial<QueueRow> & { id: string }): QueueRow {
  return {
    organizationId: TEST_ORG,
    kind: 'RENDER',
    priority: 'normal',
    createdAt: T0,
    videoId: null,
    clipId: null,
    ...overrides,
  };
}

/** Clip lengths by id: ms in the test workspace, or `[workspace, ms]`. */
function queueWith(
  snapshot: Partial<QueueSnapshot>,
  clips: Record<string, number | [string, number]> = {},
) {
  const full: QueueSnapshot = {
    waiting: [],
    holding: [],
    lastServed: new Map(),
    clipped: false,
    ...snapshot,
  };
  const repository = {
    queueSnapshot: jest.fn(async () => full),
    inputsOf: jest.fn(async () => new Map()),
    lengths: jest.fn(async (_videos: string[], clipIds: string[]) => ({
      videos: new Map(),
      clips: new Map(
        clipIds
          .filter((id) => id in clips)
          .map((id) => {
            const value = clips[id] as number | [string, number];
            const [organizationId, durationMs] = Array.isArray(value) ? value : [TEST_ORG, value];
            return [id, { organizationId, durationMs }];
          }),
      ),
    })),
  };
  const resolver = { get: jest.fn(async () => 2) };
  const redis = new FakeRedis();
  const config = { get: jest.fn((key: string) => (key === 'CLIPS_RENDER_SLOTS' ? 1 : undefined)) };
  const queue = new ClipQueueService(
    repository as unknown as ClipJobsRepository,
    resolver as unknown as EntitlementResolver,
    redis as unknown as RedisService,
    config as never,
  );
  return { queue, repository, redis, full };
}

describe('ClipQueueService.estimate', () => {
  it('times the exports ahead and the running one with the prior before any has finished', async () => {
    const { queue } = queueWith(
      {
        waiting: [
          row({ id: 'ahead', clipId: 'clip-1', createdAt: at(1) }),
          row({ id: 'mine', clipId: 'clip-2', createdAt: at(2) }),
        ],
        holding: [
          {
            ...row({ id: 'running', clipId: 'clip-3', organizationId: 'org-b' }),
            status: 'RUNNING',
            progress: 50,
          },
        ],
      },
      { 'clip-1': 2 * MINUTE, 'clip-2': MINUTE, 'clip-3': ['org-b', 4 * MINUTE] },
    );
    // One render slot: the running one has 2 of its 4 prior minutes left, the one ahead takes 2.
    expect(PRIOR_SECONDS_PER_MINUTE.RENDER).toBe(60);
    await expect(
      queue.estimate('RENDER', TEST_ORG, { jobId: 'mine', now: at(60) }),
    ).resolves.toEqual({
      position: 1,
      aboutSeconds: 240,
    });
  });

  it('follows the rolling average once jobs have finished', async () => {
    const { queue, redis } = queueWith(
      { waiting: [row({ id: 'ahead', clipId: 'clip-1' }), row({ id: 'mine', createdAt: at(5) })] },
      { 'clip-1': 2 * MINUTE },
    );
    // A one minute export that held its slot 3 minutes: 180 seconds a minute from now on.
    await queue.recordDuration(
      jobRow({
        kind: 'RENDER',
        status: 'DONE',
        input: { proof: false } as unknown as ClipJob['input'],
        output: { durationMs: MINUTE } as unknown as ClipJob['output'],
        startedAt: at(0),
        finishedAt: at(180),
      }),
    );
    expect(JSON.parse(redis.values.get('clips:queue:pace:RENDER') as string)).toEqual({
      secondsPerMinute: 180,
      samples: 1,
    });
    await expect(
      queue.estimate('RENDER', TEST_ORG, { jobId: 'mine', now: at(60) }),
    ).resolves.toEqual({
      position: 1,
      aboutSeconds: 360,
    });
  });

  it('says where a job made now would stand, behind the ones waiting', async () => {
    const { queue } = queueWith(
      {
        waiting: [
          row({ id: 'a', clipId: 'clip-a' }),
          row({ id: 'b', clipId: 'clip-b', organizationId: 'org-b' }),
        ],
      },
      { 'clip-a': MINUTE, 'clip-b': ['org-b', MINUTE] },
    );
    await expect(queue.estimate('RENDER', TEST_ORG, { now: at(10) })).resolves.toEqual({
      position: 2,
      aboutSeconds: 120,
    });
  });

  it('has no honest number behind an import whose length is not known yet', async () => {
    const { queue } = queueWith({
      waiting: [
        row({ id: 'ahead', kind: 'IMPORT', videoId: 'video-unknown', organizationId: 'org-b' }),
        row({ id: 'mine', kind: 'IMPORT', createdAt: at(5) }),
      ],
    });
    const answer = await queue.estimate('IMPORT', TEST_ORG, { jobId: 'mine', now: at(10) });
    expect(answer).toEqual({ position: 1, aboutSeconds: null });
  });

  it('gives no time past a queue longer than one read', async () => {
    const { queue } = queueWith({ waiting: [row({ id: 'mine' })], clipped: true });
    await expect(queue.estimate('RENDER', TEST_ORG, { jobId: 'mine' })).resolves.toEqual({
      position: 0,
      aboutSeconds: null,
    });
  });

  it('answers nothing for a Preview Export and for a job no longer waiting', async () => {
    const { queue } = queueWith({ waiting: [] });
    await expect(queue.estimate('RENDER', TEST_ORG, { jobId: 'gone' })).resolves.toBeNull();
  });
});

describe('ClipQueueService.recordDuration', () => {
  it('counts only a finished job of the scheduler with both times', async () => {
    const { queue, redis } = queueWith({});
    const base = {
      kind: 'SEGMENT' as const,
      input: { fromMs: 0, toMs: 2 * MINUTE } as unknown as ClipJob['input'],
      startedAt: at(0),
      finishedAt: at(60),
    };
    await queue.recordDuration(jobRow({ ...base, status: 'FAILED' }));
    await queue.recordDuration(jobRow({ ...base, status: 'DONE', startedAt: null }));
    await queue.recordDuration(
      jobRow({
        kind: 'RENDER',
        status: 'DONE',
        input: { proof: true } as unknown as ClipJob['input'],
        startedAt: at(0),
        finishedAt: at(60),
      }),
    );
    expect(redis.values.size).toBe(0);
    await queue.recordDuration(jobRow({ ...base, status: 'DONE' }));
    expect(JSON.parse(redis.values.get('clips:queue:pace:SEGMENT') as string)).toEqual({
      secondsPerMinute: 30,
      samples: 1,
    });
  });
});

describe('the view of a waiting job', () => {
  function jobsWith(row: ClipJob) {
    const repository = { find: jest.fn(async () => row), recentDurations: jest.fn(async () => []) };
    const queue = {
      waitingFor: jest.fn(
        async (jobs: ClipJob[]) =>
          new Map(
            jobs.map((job) => [
              job.id,
              { aboutSeconds: 240, position: 1, lowPriority: job.priority === 'low' },
            ]),
          ),
      ),
    };
    const jobs = new ClipJobsService(
      repository as unknown as ClipJobsRepository,
      {} as SchedulingService,
      {} as EntitlementResolver,
      {} as UsageService,
      {} as PrivateStorage,
      undefined,
      undefined,
      undefined,
      queue as unknown as ClipQueueService,
    );
    return { jobs, queue };
  }

  const id = '33333333-3333-4333-8333-333333333333';

  it('carries its place and the low priority flag from the job, never the plan', async () => {
    const { jobs } = jobsWith(jobRow({ status: 'QUEUED', startedAt: null, priority: 'low' }));
    const view = await jobs.view(TEST_ORG, id);
    expect(view.stageLabel).toBe('Waiting for our turn');
    expect(view.waiting).toEqual({ aboutSeconds: 240, position: 1, lowPriority: true });
  });

  it('is null once claimed, while running, and for a Preview Export', async () => {
    for (const row of [
      jobRow({ status: 'QUEUED', startedAt: at(0) }),
      jobRow({ status: 'RUNNING', startedAt: at(0) }),
      jobRow({
        kind: 'RENDER',
        status: 'QUEUED',
        input: { proof: true } as unknown as ClipJob['input'],
      }),
    ]) {
      const { jobs, queue } = jobsWith(row);
      expect((await jobs.view(TEST_ORG, id)).waiting).toBeNull();
      expect(queue.waitingFor).not.toHaveBeenCalled();
    }
  });
});
