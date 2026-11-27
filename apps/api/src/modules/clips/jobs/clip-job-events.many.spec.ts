/**
 * The batch's live stream (Sprint 13, Module 11): `streamMany` follows
 * several jobs with one read per poll, sends the single job stream's events
 * (one per job change, the view's id naming the job), drops a job that is
 * gone, and closes once every job has sent its last event.
 */
import type { ClipJob } from '@postgear/db';
import type { SseStream } from '../../../common/sse';
import { jobRow } from '../testing/rows';
import { ClipJobEventsService, type JobEventsClock } from './clip-job-events.service';
import type { ClipJobsRepository } from './clip-jobs.repository';
import type { ClipJobsService } from './clip-jobs.service';

const ORG = 'seed-demo-org';
const ONE = '99999999-9999-4999-8999-000000000001';
const TWO = '99999999-9999-4999-8999-000000000002';
const GONE = '99999999-9999-4999-8999-000000000003';

function render(id: string, overrides: Partial<ClipJob> = {}): ClipJob {
  return jobRow({ id, kind: 'RENDER', input: { proof: false } as never, ...overrides });
}

function fakeStream() {
  const sent: Array<{ type: string; id: string | undefined; status: string | undefined }> = [];
  const controller = new AbortController();
  const stream: SseStream = {
    send: (type, data) => {
      const view = data as { id?: string; status?: string };
      sent.push({ type, id: view.id, status: view.status });
    },
    close: () => undefined,
    signal: controller.signal,
    closed: false,
  };
  return { stream, sent };
}

describe('ClipJobEventsService.streamMany', () => {
  it('sends each job change and closes once every job ended', async () => {
    // What the rows read at each poll.
    const polls: ClipJob[][] = [
      [render(ONE, { status: 'RUNNING', progress: 10 }), render(TWO)],
      [render(ONE, { status: 'RUNNING', progress: 10 }), render(TWO)],
      [render(ONE, { status: 'DONE' }), render(TWO, { status: 'RUNNING', progress: 5 })],
      [render(TWO, { status: 'FAILED', error: { code: 'export_failed', message: 'x' } as never })],
    ];
    let poll = 0;
    const repository = {
      findMany: jest.fn(async (_org: string, ids: readonly string[]) =>
        (polls[Math.min(poll++, polls.length - 1)] as ClipJob[]).filter((job) =>
          ids.includes(job.id),
        ),
      ),
      recentDurations: jest.fn(async () => [60]),
    };
    let now = 0;
    const clock: JobEventsClock = {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    };
    const events = new ClipJobEventsService(
      {} as ClipJobsService,
      repository as unknown as ClipJobsRepository,
      clock,
    );
    const { stream, sent } = fakeStream();

    await events.streamMany(ORG, [ONE, TWO, GONE, ONE], stream);

    expect(sent).toEqual([
      { type: 'progress', id: ONE, status: 'RUNNING' },
      { type: 'progress', id: TWO, status: 'QUEUED' },
      { type: 'done', id: ONE, status: 'DONE' },
      { type: 'progress', id: TWO, status: 'RUNNING' },
      { type: 'failed', id: TWO, status: 'FAILED' },
    ]);
    // One read per poll, for the jobs still open only; the typical length read once.
    expect(repository.findMany).toHaveBeenCalledTimes(4);
    expect(repository.findMany.mock.calls[3]?.[1]).toEqual([TWO]);
    expect(repository.recentDurations).toHaveBeenCalledTimes(1);
  });

  it('closes at once for a batch with no job to follow', async () => {
    const repository = { findMany: jest.fn(async () => []), recentDurations: jest.fn() };
    const events = new ClipJobEventsService(
      {} as ClipJobsService,
      repository as unknown as ClipJobsRepository,
    );
    const { stream, sent } = fakeStream();
    await events.streamMany(ORG, [], stream);
    expect(sent).toEqual([]);
    expect(repository.findMany).not.toHaveBeenCalled();
  });
});
