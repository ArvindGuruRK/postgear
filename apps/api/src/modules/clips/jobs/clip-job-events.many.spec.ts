/**
 * The batch's live stream (Sprint 13, Module 11): `streamMany` follows
 * several jobs with one read per poll, sends the single job stream's events
 * (one per job change, the view's id naming the job), drops a job that is
 * gone, and closes once every job has sent its last event. Module 15: a
 * job waiting for its turn carries `waiting`, asked once for the whole batch
 * every few seconds, and a change in it is sent.
 */
import type { ClipJob } from '@postgear/db';
import type { SseStream } from '../../../common/sse';
import { jobRow } from '../testing/rows';
import type { ClipJobWaiting } from './clip-job-view';
import {
  ClipJobEventsService,
  type JobEventsClock,
  WAITING_REFRESH_MS,
} from './clip-job-events.service';
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
  const waits: Array<ClipJobWaiting | null | undefined> = [];
  const controller = new AbortController();
  const stream: SseStream = {
    send: (type, data) => {
      const view = data as { id?: string; status?: string; waiting?: ClipJobWaiting | null };
      sent.push({ type, id: view.id, status: view.status });
      waits.push(view.waiting);
    },
    close: () => undefined,
    signal: controller.signal,
    closed: false,
  };
  return { stream, sent, waits };
}

/** The jobs service's `waitingFor`, answering each job with the next value given. */
function waitingJobs(...answers: ClipJobWaiting[]) {
  let call = 0;
  const waitingFor = jest.fn(async (rows: readonly ClipJob[]) => {
    const answer = answers[Math.min(call++, answers.length - 1)] as ClipJobWaiting;
    return new Map(rows.map((row) => [row.id, answer]));
  });
  return { waitingFor };
}

const SOON: ClipJobWaiting = { aboutSeconds: 120, position: 1, lowPriority: false };

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
    const jobs = waitingJobs(SOON);
    const events = new ClipJobEventsService(
      jobs as unknown as ClipJobsService,
      repository as unknown as ClipJobsRepository,
      clock,
    );
    const { stream, sent, waits } = fakeStream();

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
    // Only the waiting job carries its place, asked once for the batch (the next poll is sooner).
    expect(waits).toEqual([null, SOON, null, null, null]);
    expect(jobs.waitingFor).toHaveBeenCalledTimes(1);
    expect(jobs.waitingFor.mock.calls[0]?.[0].map((row) => row.id)).toEqual([TWO]);
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

describe('ClipJobEventsService.stream: a waiting job', () => {
  it('sends its place, asks again every few seconds, and sends again when it moves', async () => {
    const queued = render(ONE);
    let reads = 0;
    const repository = {
      find: jest.fn(async () => {
        reads += 1;
        return reads < 12 ? queued : render(ONE, { status: 'DONE' });
      }),
      recentDurations: jest.fn(async () => []),
    };
    let now = 0;
    const clock: JobEventsClock = {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    };
    const later: ClipJobWaiting = { aboutSeconds: 60, position: 0, lowPriority: false };
    const jobs = waitingJobs(SOON, later);
    const events = new ClipJobEventsService(
      jobs as unknown as ClipJobsService,
      repository as unknown as ClipJobsRepository,
      clock,
    );
    const { stream, sent, waits } = fakeStream();

    await events.stream(ORG, ONE, stream);

    expect(sent.map((event) => event.type)).toEqual(['progress', 'progress', 'done']);
    expect(waits).toEqual([SOON, later, null]);
    // 11 polls 750 ms apart span 7.5 s: asked at 0 and again past `WAITING_REFRESH_MS`.
    expect(WAITING_REFRESH_MS).toBe(5_000);
    expect(jobs.waitingFor).toHaveBeenCalledTimes(2);
  });
});
