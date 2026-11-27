/**
 * Auto-Edit Video's Node half (Sprint 13, Module 10): it waits for the listen
 * job (heartbeating, `listening`), then asks the API to make the clip
 * (`applying`) and finishes DONE with the answer. A listen job that failed,
 * was cancelled or is gone fails it with `transcribe_failed` and the API is
 * never asked; a cancel stops the wait.
 */
import type { AutoEditInput } from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { FakeRows, jobRow, ORG } from '../testing/fakes';
import { type AutoEditRun, runAutoEdit } from './auto-edit.run';

const JOB_ID = '11111111-aaaa-4bbb-8ccc-000000000001';
const LISTEN_JOB = '11111111-aaaa-4bbb-8ccc-000000000002';
const CLIP_ID = '11111111-aaaa-4bbb-8ccc-000000000003';
const VIDEO_ID = '11111111-aaaa-4bbb-8ccc-000000000004';

const input = (overrides: Partial<AutoEditInput> = {}): AutoEditInput => ({
  videoId: VIDEO_ID,
  clipId: CLIP_ID,
  recipeId: 'starter-auto-edit-talking-video',
  range: { fromMs: 0, toMs: 600_000 },
  listenJobId: LISTEN_JOB,
  listenStarted: true,
  ...overrides,
});

const answer = {
  clipId: CLIP_ID,
  skipped: [{ part: 'hookTitle', reason: 'no_transcript' }],
  noSpeech: false,
};

function make(overrides: Partial<AutoEditRun> = {}) {
  const rows = new FakeRows();
  const reports: Array<{ stage: string; progress: number }> = [];
  const done = jest.fn(async () => true);
  const autoEdit = jest.fn(async () => answer);
  const heartbeat = jest.fn();
  const controller = new AbortController();
  const run: AutoEditRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input: input(),
    rows,
    internal: { autoEdit },
    progress: {
      report: async (update) => {
        reports.push(update);
      },
      flush: async () => undefined,
      done,
    },
    signal: controller.signal,
    heartbeat,
    sleep: async () => undefined,
    ...overrides,
  };
  return { run, rows, reports, done, autoEdit, heartbeat, controller };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('runAutoEdit', () => {
  it('waits for the listen job, then applies and finishes DONE with the answer', async () => {
    const { run, rows, reports, done, autoEdit, heartbeat } = make();
    rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'RUNNING' }));
    let looks = 0;
    run.sleep = async () => {
      looks += 1;
      if (looks === 2) {
        rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'DONE' }));
      }
    };
    const outcome = await runAutoEdit(run);
    expect(outcome).toEqual({ finished: true, output: answer });
    expect(looks).toBe(2);
    expect(heartbeat).toHaveBeenCalled();
    expect(reports[0]).toEqual({ stage: 'listening', progress: 0 });
    expect(reports.at(-1)).toEqual({ stage: 'applying', progress: 90 });
    expect(autoEdit).toHaveBeenCalledTimes(1);
    expect(autoEdit).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
    expect(done).toHaveBeenCalledWith(answer);
    // Ids and counts only.
    const logged = (console.log as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('clips.auto_edit.done');
  });

  it('applies at once when there is no listen job to wait for', async () => {
    const { run, reports, autoEdit } = make({ input: input({ listenJobId: null }) });
    await expect(runAutoEdit(run)).resolves.toMatchObject({ finished: true });
    expect(reports.map((report) => report.stage)).toEqual(['applying']);
    expect(autoEdit).toHaveBeenCalledTimes(1);
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'a %s listen job fails with transcribe_failed, never retried, and no clip is made',
    async (status) => {
      const { run, rows, autoEdit, done } = make();
      rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status }));
      const error = await runAutoEdit(run).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ClipStepError);
      expect((error as ClipStepError).code).toBe('transcribe_failed');
      expect((error as ClipStepError).retryable).toBe(false);
      expect(autoEdit).not.toHaveBeenCalled();
      expect(done).not.toHaveBeenCalled();
    },
  );

  it('a listen job that is gone, or another kind, fails the same way', async () => {
    const { run, rows, autoEdit } = make();
    await expect(runAutoEdit(run)).rejects.toMatchObject({ code: 'transcribe_failed' });
    rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'IMPORT', status: 'DONE' }));
    await expect(runAutoEdit(run)).rejects.toMatchObject({ code: 'transcribe_failed' });
    expect(autoEdit).not.toHaveBeenCalled();
  });

  it('a cancel stops the wait and the API is never asked', async () => {
    const { run, rows, autoEdit, controller } = make();
    rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'RUNNING' }));
    run.sleep = async () => controller.abort();
    await expect(runAutoEdit(run)).rejects.toMatchObject({ code: 'cancelled' });
    expect(autoEdit).not.toHaveBeenCalled();
  });

  it('a cancel that lands right after its listen job was cancelled reads as a cancel', async () => {
    const { run, rows, controller } = make();
    rows.jobs.set(LISTEN_JOB, jobRow({ id: LISTEN_JOB, kind: 'TRANSCRIBE', status: 'CANCELLED' }));
    run.sleep = async () => controller.abort();
    await expect(runAutoEdit(run)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('an answer for another clip, or one that does not read, fails the edit', async () => {
    const { run, done } = make({
      input: input({ listenJobId: null }),
      internal: { autoEdit: jest.fn(async () => ({ ...answer, clipId: VIDEO_ID })) },
    });
    await expect(runAutoEdit(run)).rejects.toMatchObject({ code: 'auto_edit_failed' });
    expect(done).not.toHaveBeenCalled();
  });

  it('a job closed meanwhile keeps nothing (finished false)', async () => {
    const { run } = make({ input: input({ listenJobId: null }) });
    run.progress.done = jest.fn(async () => false);
    await expect(runAutoEdit(run)).resolves.toEqual({ finished: false, output: null });
  });
});
