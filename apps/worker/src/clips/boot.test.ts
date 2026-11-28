import {
  MEDIA_QUICK_TASK_QUEUE,
  MEDIA_TASK_QUEUE,
  RENDER_TASK_QUEUE,
  SCHEDULING_TASK_QUEUE,
} from '@postgear/scheduling';
import {
  CLIP_HEARTBEAT_THROTTLE,
  mediaSlotShortfall,
  PUBLISHING_ACTIVITY_SLOTS,
  workerPlan,
} from './boot';

const base = { WORKER_MEDIA_CONCURRENCY: 2, RENDER_CONCURRENCY: 1 };

describe('workerPlan', () => {
  it('publishing only: the original worker, nothing that needs FFmpeg', () => {
    const plan = workerPlan({ ...base, WORKER_ROLES: ['publishing'] });
    expect(plan).toEqual([
      expect.objectContaining({
        role: 'publishing',
        taskQueue: SCHEDULING_TASK_QUEUE,
        activities: 'publishing',
        maxConcurrentActivityTaskExecutions: PUBLISHING_ACTIVITY_SLOTS,
      }),
    ]);
    expect(plan[0].maxHeartbeatThrottleInterval).toBeUndefined();
  });

  it('the default three roles: four queues, each once', () => {
    const plan = workerPlan({ ...base, WORKER_ROLES: ['publishing', 'media', 'render'] });
    expect(plan.map((worker) => worker.taskQueue)).toEqual([
      SCHEDULING_TASK_QUEUE,
      MEDIA_TASK_QUEUE,
      MEDIA_QUICK_TASK_QUEUE,
      RENDER_TASK_QUEUE,
    ]);
    const render = plan.find((worker) => worker.taskQueue === RENDER_TASK_QUEUE);
    expect(render).toMatchObject({
      role: 'render',
      activities: 'clips',
      maxConcurrentActivityTaskExecutions: 1,
    });
  });

  it('media only: the media queue with its slots and the quick queue, clip activities on both', () => {
    const plan = workerPlan({ ...base, WORKER_MEDIA_CONCURRENCY: 3, WORKER_ROLES: ['media'] });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      role: 'media',
      taskQueue: MEDIA_TASK_QUEUE,
      activities: 'clips',
      maxConcurrentActivityTaskExecutions: 3,
      maxHeartbeatThrottleInterval: CLIP_HEARTBEAT_THROTTLE,
    });
    expect(plan[1]).toMatchObject({
      role: 'media',
      taskQueue: MEDIA_QUICK_TASK_QUEUE,
      activities: 'clips',
    });
  });

  it('a role listed twice still gives one worker per queue', () => {
    const plan = workerPlan({ ...base, WORKER_ROLES: ['render', 'render'] });
    expect(plan.map((worker) => worker.taskQueue)).toEqual([RENDER_TASK_QUEUE]);
  });
});

describe('mediaSlotShortfall (Module 15)', () => {
  const slots = { CLIPS_MEDIA_SLOTS: 4, CLIPS_MEDIA_PY_SLOTS: 2 };

  it('is zero when the media slots cover every job the scheduler may start', () => {
    expect(
      mediaSlotShortfall({ ...slots, WORKER_ROLES: ['media'], WORKER_MEDIA_CONCURRENCY: 6 }),
    ).toBe(0);
    expect(
      mediaSlotShortfall({ ...slots, WORKER_ROLES: ['media'], WORKER_MEDIA_CONCURRENCY: 8 }),
    ).toBe(0);
  });

  it('counts the missing slots, so a waiting Find Clips run cannot block its own listening', () => {
    expect(
      mediaSlotShortfall({ ...slots, WORKER_ROLES: ['media'], WORKER_MEDIA_CONCURRENCY: 2 }),
    ).toBe(4);
  });

  it('is zero for a worker without the media role', () => {
    expect(
      mediaSlotShortfall({ ...slots, WORKER_ROLES: ['render'], WORKER_MEDIA_CONCURRENCY: 1 }),
    ).toBe(0);
  });
});
