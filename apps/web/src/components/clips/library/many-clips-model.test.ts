import type { ClipJobView } from '@/types/clips';
import type { RecipeView } from '@/types/clips-recipes';
import {
  batchCounts,
  batchFromStart,
  chipLabel,
  countsLine,
  mergeBatchJob,
  noteLine,
  rowState,
  sharedRecipeQuality,
} from './export-all-model';
import {
  cleanTitleCard,
  MONTAGE_PICK_SHAPE,
  MONTAGE_TOO_FEW,
  MONTAGE_TOO_LONG,
  MONTAGE_TOO_MANY,
  montageProblem,
  montageShapes,
  montageTotalMs,
  moveClip,
} from './montage-model';
import { nextSelection } from './use-clip-selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];

describe('ticking clips', () => {
  it('ticks and unticks one clip', () => {
    const one = nextSelection(new Set(), ORDER, 'b', { range: false, anchor: null });
    expect([...one]).toEqual(['b']);
    expect([...nextSelection(one, ORDER, 'b', { range: false, anchor: 'b' })]).toEqual([]);
  });

  it('ticks the range from the last clicked clip on a Shift-click, either way', () => {
    const start = new Set(['b']);
    expect([...nextSelection(start, ORDER, 'd', { range: true, anchor: 'b' })].sort()).toEqual([
      'b',
      'c',
      'd',
    ]);
    expect([...nextSelection(start, ORDER, 'a', { range: true, anchor: 'c' })].sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('unticks the range when the clicked clip was ticked', () => {
    const all = new Set(ORDER);
    expect([...nextSelection(all, ORDER, 'd', { range: true, anchor: 'b' })].sort()).toEqual([
      'a',
      'e',
    ]);
  });

  it('ticks just the clip when the anchor left the list', () => {
    expect([...nextSelection(new Set(), ORDER, 'c', { range: true, anchor: 'gone' })]).toEqual([
      'c',
    ]);
  });
});

function job(overrides: Partial<ClipJobView> = {}): ClipJobView {
  return {
    id: 'job-1',
    kind: 'RENDER' as ClipJobView['kind'],
    status: 'RUNNING',
    stage: 'render',
    stageLabel: 'Exporting',
    progress: 40,
    etaSeconds: null,
    videoId: null,
    clipId: 'clip-1',
    error: null,
    result: null,
    createdAt: '2026-11-27T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe('Export All', () => {
  it('says what the batch did with each clip', () => {
    expect(noteLine('queued', '1080p')).toBeNull();
    expect(noteLine('lowered', '720p')).toBe('Exports at 720p, the best this plan allows.');
    expect(noteLine('current', '1080p')).toBe('Already exported, so it is left as it is.');
    expect(noteLine('running', '1080p')).toBe('Already exporting.');
    expect(noteLine('removed', '1080p')).toBe('One of the videos in this montage was removed.');
    expect(rowState({ note: 'removed', jobId: null, job: null })).toBe('removed');
    expect(
      batchCounts([
        { clipId: 'm', clipTitle: 'M', jobId: null, note: 'removed', quality: '1080p', job: null },
      ]),
    ).toEqual({ total: 1, done: 0, failed: 1, finished: true });
  });

  it('counts a skipped clip as done and a failure apart', () => {
    const rows = [
      { clipId: 'a', clipTitle: 'A', jobId: null, note: 'current', quality: '1080p', job: null },
      {
        clipId: 'b',
        clipTitle: 'B',
        jobId: 'job-b',
        note: 'queued',
        quality: '1080p',
        job: job({ id: 'job-b', status: 'FAILED' }),
      },
      {
        clipId: 'c',
        clipTitle: 'C',
        jobId: 'job-c',
        note: 'queued',
        quality: '1080p',
        job: job({ id: 'job-c' }),
      },
    ] as const;
    expect(rows.map(rowState)).toEqual(['skipped', 'failed', 'running']);
    const counts = batchCounts([...rows]);
    expect(counts).toEqual({ total: 3, done: 1, failed: 1, finished: false });
    expect(countsLine(counts)).toBe('1 of 3 done, 1 could not be exported');
    expect(countsLine({ total: 8, done: 3, failed: 0 })).toBe('3 of 8 done');
  });

  it('names the chip', () => {
    expect(chipLabel(8)).toBe('Exporting 8 Clips');
    expect(chipLabel(1)).toBe('Exporting 1 Clip');
  });

  it('puts a stream event in its row, and never runs a finished one again', () => {
    const view = batchFromStart(
      {
        batchId: 'b1',
        jobs: [{ clipId: 'clip-1', jobId: 'job-1', quality: '1080p', note: 'queued' }],
      },
      [{ id: 'clip-1', title: 'Team Talk' }],
    );
    expect(view.jobs[0]?.clipTitle).toBe('Team Talk');
    expect(view.finished).toBe(false);
    const done = mergeBatchJob(view, job({ status: 'DONE', progress: 100 }));
    expect(done.done).toBe(1);
    expect(done.finished).toBe(true);
    expect(mergeBatchJob(done, job({ status: 'RUNNING', progress: 50 })).jobs[0]?.job?.status).toBe(
      'DONE',
    );
    // A job of another batch changes nothing.
    expect(mergeBatchJob(view, job({ id: 'other' }))).toBe(view);
  });

  it('preselects the quality of a recipe every clip shares', () => {
    const recipes = [
      { id: 'r1', settings: { exportQuality: '720p60' } },
      { id: 'r2', settings: {} },
    ] as unknown as RecipeView[];
    expect(sharedRecipeQuality([{ recipeId: 'r1' }, { recipeId: 'r1' }], recipes)).toBe('720p60');
    expect(sharedRecipeQuality([{ recipeId: 'r1' }, { recipeId: 'r2' }], recipes)).toBeNull();
    expect(sharedRecipeQuality([{ recipeId: 'r2' }, { recipeId: 'r2' }], recipes)).toBeNull();
    expect(sharedRecipeQuality([{ recipeId: null }, {}], recipes)).toBeNull();
  });
});

describe('Create Montage', () => {
  const clip = (durationMs: number, ratio = '9:16') => ({ durationMs, ratio });

  it('adds the lengths up, 0.3 s shorter per Fade join', () => {
    const clips = [clip(10_000), clip(20_000), clip(5_000)];
    expect(montageTotalMs(clips, 'cut')).toBe(35_000);
    expect(montageTotalMs(clips, 'fade')).toBe(34_400);
  });

  it('knows when the shapes differ', () => {
    expect(montageShapes([clip(1, '9:16'), clip(1, '9:16')])).toEqual(['9:16']);
    expect(montageShapes([clip(1, '9:16'), clip(1, '1:1')])).toEqual(['9:16', '1:1']);
  });

  it('says why Create is off', () => {
    const base = { transition: 'cut' as const, needsShape: false, shape: null };
    expect(montageProblem({ ...base, clips: [clip(10_000)] })).toBe(MONTAGE_TOO_FEW);
    expect(montageProblem({ ...base, clips: Array.from({ length: 16 }, () => clip(1_000)) })).toBe(
      MONTAGE_TOO_MANY,
    );
    expect(montageProblem({ ...base, clips: [clip(700_000), clip(600_000)] })).toBe(
      MONTAGE_TOO_LONG,
    );
    expect(montageProblem({ ...base, needsShape: true, clips: [clip(1_000), clip(1_000)] })).toBe(
      MONTAGE_PICK_SHAPE,
    );
    expect(
      montageProblem({
        ...base,
        needsShape: true,
        shape: '9:16',
        clips: [clip(1_000), clip(1_000)],
      }),
    ).toBeNull();
  });

  it('moves a clip in the list', () => {
    expect(moveClip(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveClip(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveClip(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });

  it('cleans the title card line', () => {
    expect(cleanTitleCard('   ')).toBeNull();
    expect(cleanTitleCard('  Best   Of  The Week ')).toBe('Best Of The Week');
  });
});
