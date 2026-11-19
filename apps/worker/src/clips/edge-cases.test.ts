/**
 * Sprint 12, Module 20 section 2: the worker's share of the stories' edge
 * cases (section 5 of the user stories), with the forcing markers a hand
 * check uses under `CLIPS_SIMULATION=true`:
 *
 * - "The export fails": `[simulate:render-fail]` in a clip's name fails its
 *   export; the job and the bell read "We could not export this clip.
 *   Nothing was charged. Try again."
 * - "Preview Export fails": `[simulate:preview-fail]` fails only its Preview
 *   Export, with "We could not make the preview. Try again." and no bell.
 *
 * Both markers are ignored when simulation is off.
 */
import { createClipDocument, type RenderInput, type RenderPlan } from '@postgear/video-engine';
import { ClipStepError } from './failures';
import { failJob, type OutcomeDeps } from './job-outcomes';
import {
  forcedRenderFailure,
  PREVIEW_FAIL_MARKER,
  RENDER_FAIL_MARKER,
  type RenderRun,
  renderExecute,
} from './render/render.run';
import {
  CLIP_ID,
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from './testing/fakes';

const EXPORT_FAILED = 'We could not export this clip. Nothing was charged. Try again.';
const PREVIEW_FAILED = 'We could not make the preview. Try again.';

function renderInput(name: string, proof = false): RenderInput {
  return {
    clipId: CLIP_ID,
    videoId: VIDEO_ID,
    revision: 1,
    document: createClipDocument({ videoId: VIDEO_ID, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
    quality: '720p',
    proof,
    watermark: false,
    name,
  };
}

/** Enough of a run for `renderExecute` to reach (or pass) the marker check. */
function run(input: RenderInput, simulated: boolean) {
  const { reports, progress } = fakeProgress();
  const render = jest.fn(async () => {
    throw new Error('the render ran');
  });
  const value = {
    job: jobRow({ kind: 'RENDER', clipId: CLIP_ID, input }),
    input,
    dir: '/scratch/never-used',
    signal: new AbortController().signal,
    tools: { probe: jest.fn(), render, poster: jest.fn() },
    progress: { ...progress, done: async () => true },
    simulated,
    heartbeat: () => undefined,
  } as unknown as RenderRun;
  return { run: value, reports, render };
}

describe('the forcing markers in a clip name', () => {
  it('read the marker as typed, and as the file name spells it (the colon becomes a space)', () => {
    const typed = forcedRenderFailure({
      input: renderInput(`Best Moment ${RENDER_FAIL_MARKER}.mp4`),
      simulated: true,
    });
    expect(typed).toEqual(new ClipStepError('export_failed'));
    expect(typed?.retryable).toBe(false);
    const filed = forcedRenderFailure({
      input: renderInput('Best Moment [simulate render-fail].mp4'),
      simulated: true,
    });
    expect(filed?.code).toBe('export_failed');
  });

  it('fail only their own kind: render-fail an export, preview-fail a Preview Export', () => {
    const both = `Clip ${RENDER_FAIL_MARKER} ${PREVIEW_FAIL_MARKER}.mp4`;
    expect(forcedRenderFailure({ input: renderInput(both), simulated: true })?.code).toBe(
      'export_failed',
    );
    expect(forcedRenderFailure({ input: renderInput(both, true), simulated: true })?.code).toBe(
      'preview_failed',
    );
    expect(
      forcedRenderFailure({
        input: renderInput(`Clip ${PREVIEW_FAIL_MARKER}.mp4`),
        simulated: true,
      }),
    ).toBeNull();
    expect(
      forcedRenderFailure({
        input: renderInput(`Clip ${RENDER_FAIL_MARKER}.mp4`, true),
        simulated: true,
      }),
    ).toBeNull();
  });

  it('are ignored when simulation is off', () => {
    const both = `Clip ${RENDER_FAIL_MARKER} ${PREVIEW_FAIL_MARKER}.mp4`;
    expect(forcedRenderFailure({ input: renderInput(both), simulated: false })).toBeNull();
    expect(forcedRenderFailure({ input: renderInput(both, true), simulated: false })).toBeNull();
    expect(forcedRenderFailure({ input: renderInput(both) } as never)).toBeNull();
  });

  it('stop the render step at 10%, before FFmpeg is started', async () => {
    const forced = run(renderInput(`Best Moment ${RENDER_FAIL_MARKER}.mp4`), true);
    await expect(renderExecute(forced.run, {} as RenderPlan)).rejects.toEqual(
      new ClipStepError('export_failed'),
    );
    expect(forced.reports).toEqual([{ stage: 'rendering', progress: 10 }]);
    expect(forced.render).not.toHaveBeenCalled();

    const preview = run(renderInput(`Best Moment ${PREVIEW_FAIL_MARKER}.mp4`, true), true);
    await expect(renderExecute(preview.run, {} as RenderPlan)).rejects.toEqual(
      new ClipStepError('preview_failed'),
    );
    expect(preview.render).not.toHaveBeenCalled();
  });
});

describe('a failed export and a failed preview, as the person reads them', () => {
  function setup(input: RenderInput) {
    const rows = new FakeRows();
    rows.jobs.set(JOB_ID, jobRow({ kind: 'RENDER', clipId: CLIP_ID, input }));
    rows.videos.set(VIDEO_ID, videoRow());
    const deps: OutcomeDeps = {
      rows,
      privateStorage: new FakePrivateStorage(),
      storage: { delete: async () => undefined },
      internal: { reverseCharges: jest.fn(async () => ({ reversed: 0 })) },
      now: () => new Date('2026-11-19T12:00:00Z'),
    };
    return { rows, deps };
  }

  it('"The export fails": the job and the bell say the export sentence', async () => {
    const { rows, deps } = setup(renderInput(`Best Moment ${RENDER_FAIL_MARKER}.mp4`));
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'export_failed' });
    expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    expect(rows.closed.at(-1)?.error).toEqual({ code: 'export_failed', message: EXPORT_FAILED });
    expect(rows.notifications).toEqual([
      expect.objectContaining({
        type: 'clip_export_failed',
        content: `"Best Moment": ${EXPORT_FAILED}`,
      }),
    ]);
  });

  it('"Preview Export fails": the preview sentence, and no bell (the dialog says it)', async () => {
    const { rows, deps } = setup(renderInput(`Best Moment ${PREVIEW_FAIL_MARKER}.mp4`, true));
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'preview_failed' });
    expect(rows.closed.at(-1)?.error).toEqual({ code: 'preview_failed', message: PREVIEW_FAILED });
    expect(rows.notifications).toEqual([]);
  });
});
