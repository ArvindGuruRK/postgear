import type { ClipJobStatus } from '@postgear/db';
import { JobClosedError, type JobRowStore, jobProgress, REPORT_EVERY_MS } from './job-progress';

jest.mock('@postgear/db', () => ({
  ClipJobStatus: {
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  },
  prisma: {},
}));

/** An in-memory job row with the same conditional rules as the Prisma store. */
function fakeStore(initial: ClipJobStatus = 'QUEUED' as ClipJobStatus) {
  const row = {
    status: initial as string,
    stage: null as string | null,
    progress: 0,
    error: undefined as unknown,
    output: undefined as unknown,
  };
  const writes: Array<{ stage: string; progress: number }> = [];
  const open = () => row.status === 'QUEUED' || row.status === 'RUNNING';
  const store: JobRowStore = {
    async markRunning() {
      if (!open()) return false;
      row.status = 'RUNNING';
      return true;
    },
    async report(_id, stage, progress) {
      if (row.status !== 'RUNNING') return false;
      row.stage = stage;
      row.progress = progress;
      writes.push({ stage, progress });
      return true;
    },
    async finish(_id, status, data) {
      if (!open()) return false;
      row.status = status;
      row.output = data.output;
      row.error = data.error;
      return true;
    },
    async statusOf() {
      return row.status as ClipJobStatus;
    },
  };
  return { store, row, writes };
}

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('jobProgress', () => {
  it('moves a queued job to running and refuses a closed one', async () => {
    const open = fakeStore();
    await jobProgress('j', { store: open.store }).running();
    expect(open.row.status).toBe('RUNNING');

    const closed = fakeStore('CANCELLED' as ClipJobStatus);
    await expect(jobProgress('j', { store: closed.store }).running()).rejects.toBeInstanceOf(
      JobClosedError,
    );
  });

  it('writes a stage change at once and throttles the rest to one a second', async () => {
    const { store, writes } = fakeStore('RUNNING' as ClipJobStatus);
    const time = clock();
    const progress = jobProgress('j', { store, now: time.now });

    await progress.report({ stage: 'fetching', progress: 0 });
    await progress.report({ stage: 'fetching', progress: 10 });
    await progress.report({ stage: 'fetching', progress: 20 });
    expect(writes).toEqual([{ stage: 'fetching', progress: 0 }]);

    time.advance(REPORT_EVERY_MS);
    await progress.report({ stage: 'fetching', progress: 30 });
    expect(writes.at(-1)).toEqual({ stage: 'fetching', progress: 30 });

    await progress.report({ stage: 'preparing', progress: 72 });
    expect(writes.at(-1)).toEqual({ stage: 'preparing', progress: 72 });
  });

  it('never goes backwards within a stage, and clamps and rounds', async () => {
    const { store, writes } = fakeStore('RUNNING' as ClipJobStatus);
    const time = clock();
    const progress = jobProgress('j', { store, now: time.now });

    await progress.report({ stage: 'rendering', progress: 50.4 });
    time.advance(REPORT_EVERY_MS);
    await progress.report({ stage: 'rendering', progress: 40 });
    expect(writes).toEqual([{ stage: 'rendering', progress: 50 }]);

    time.advance(REPORT_EVERY_MS);
    await progress.report({ stage: 'rendering', progress: 250 });
    expect(writes.at(-1)).toEqual({ stage: 'rendering', progress: 100 });
  });

  it('flush writes the last throttled report', async () => {
    const { store, writes } = fakeStore('RUNNING' as ClipJobStatus);
    const progress = jobProgress('j', { store, now: clock().now });
    await progress.report({ stage: 'fetching', progress: 1 });
    await progress.report({ stage: 'fetching', progress: 5 });
    expect(writes).toHaveLength(1);
    await progress.flush();
    expect(writes.at(-1)).toEqual({ stage: 'fetching', progress: 5 });
  });

  it('a report on a closed job writes nothing and never throws', async () => {
    const { store, writes } = fakeStore('CANCELLED' as ClipJobStatus);
    await expect(
      jobProgress('j', { store }).report({ stage: 'fetching', progress: 5 }),
    ).resolves.toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  it('a database hiccup during a report is logged, not thrown', async () => {
    const failing = fakeStore('RUNNING' as ClipJobStatus);
    failing.store.report = async () => {
      throw new Error('connection reset');
    };
    const reasons: string[] = [];
    const progress = jobProgress('j', {
      store: failing.store,
      onWriteError: (r) => reasons.push(r),
    });
    await expect(progress.report({ stage: 'fetching', progress: 1 })).resolves.toBeUndefined();
    expect(reasons).toEqual(['connection reset']);
  });

  it('done, failed and cancelled close only an open job, and failed stores our sentence', async () => {
    const one = fakeStore('RUNNING' as ClipJobStatus);
    expect(await jobProgress('j', { store: one.store }).failed('upload_not_video')).toBe(true);
    expect(one.row.status).toBe('FAILED');
    expect(one.row.error).toEqual({
      code: 'upload_not_video',
      message: expect.stringContaining('not a video'),
    });
    // A late done never overwrites the failure.
    expect(await jobProgress('j', { store: one.store }).done({ x: 1 })).toBe(false);
    expect(one.row.status).toBe('FAILED');

    const two = fakeStore('RUNNING' as ClipJobStatus);
    expect(await jobProgress('j', { store: two.store }).cancelled()).toBe(true);
    expect(two.row.status).toBe('CANCELLED');
  });
});
