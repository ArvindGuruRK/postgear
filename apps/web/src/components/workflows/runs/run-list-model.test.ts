import {
  appendPage,
  creditsText,
  filterQuery,
  patchRuns,
  RUN_FILTERS,
  runDuration,
  runRowView,
  triggerPhrase,
} from './run-list-model';
import { makeRun } from './run-test-fixtures';

const NOW = new Date('2026-10-29T14:07:00.000Z').getTime();

describe('run list filters', () => {
  it('offers All, Succeeded, Failed, Waiting and Test, in that order', () => {
    expect(RUN_FILTERS.map((filter) => filter.label)).toEqual([
      'All',
      'Succeeded',
      'Failed',
      'Waiting',
      'Test',
    ]);
  });

  it('asks the API for a status, or for test runs', () => {
    expect(filterQuery('all')).toEqual({});
    expect(filterQuery('succeeded')).toEqual({ status: 'SUCCEEDED' });
    expect(filterQuery('failed')).toEqual({ status: 'FAILED' });
    expect(filterQuery('waiting')).toEqual({ status: 'WAITING' });
    expect(filterQuery('test')).toEqual({ mode: 'TEST' });
  });
});

describe('runRowView', () => {
  it('reads a live run: status, Live, trigger phrase, started, duration and version', () => {
    const view = runRowView(makeRun(), null, NOW);
    expect(view.status).toEqual({ label: 'Succeeded', variant: 'success' });
    expect(view.mode).toBe('Live');
    expect(view.trigger).toBe('Post published on Instagram');
    expect(view.started).toBe('5 minutes ago');
    expect(view.startedExact).not.toBe('');
    expect(view.duration).toBe('3.1 s');
    expect(view.version).toBe('v3');
    expect(view.credits).toBeNull();
  });

  it('shows no version on a test run, and the credits when above zero', () => {
    const view = runRowView(makeRun({ mode: 'TEST', version: null, creditsUsed: 4 }), null, NOW);
    expect(view.mode).toBe('Test');
    expect(view.version).toBeNull();
    expect(view.credits).toBe('4 Credits');
  });

  it('keeps Rejected and Review Expired neutral, never red', () => {
    expect(runRowView(makeRun({ status: 'REJECTED' }), null, NOW).status).toEqual({
      label: 'Rejected',
      variant: 'outline',
    });
    expect(runRowView(makeRun({ status: 'EXPIRED' }), null, NOW).status).toEqual({
      label: 'Review Expired',
      variant: 'outline',
    });
    expect(runRowView(makeRun({ status: 'FAILED' }), null, NOW).status.variant).toBe('danger');
  });

  it('shows no duration while a run is still going', () => {
    expect(runDuration(makeRun({ status: 'RUNNING', finishedAt: null }))).toBe('');
  });
});

describe('triggerPhrase', () => {
  it('falls back to the catalog title, then the built-in title', () => {
    const run = makeRun({ triggerSummary: null, triggerType: 'trigger.schedule' });
    expect(
      triggerPhrase(run, {
        connectedPlatforms: [],
        steps: [{ type: 'trigger.schedule', title: 'Every Week' } as never],
      }),
    ).toBe('Every Week');
    expect(triggerPhrase(run, null)).toBe('Schedule');
  });
});

describe('creditsText', () => {
  it('is singular for one and nothing for zero', () => {
    expect(creditsText(0)).toBeNull();
    expect(creditsText(1)).toBe('1 Credit');
  });
});

describe('pages and live patches', () => {
  it('never shows a run twice when pages overlap', () => {
    const merged = appendPage(
      [makeRun({ id: 'a' }), makeRun({ id: 'b' })],
      [makeRun({ id: 'b' }), makeRun({ id: 'c' })],
    );
    expect(merged.map((run) => run.id)).toEqual(['a', 'b', 'c']);
  });

  it('updates the open run from the stream, but never back from finished', () => {
    const runs = [makeRun({ id: 'a', status: 'RUNNING', finishedAt: null })];
    const done = patchRuns(runs, {
      id: 'a',
      status: 'SUCCEEDED',
      startedAt: runs[0].startedAt,
      finishedAt: '2026-10-29T14:03:00.000Z',
    });
    expect(done[0].status).toBe('SUCCEEDED');
    const back = patchRuns(done, {
      id: 'a',
      status: 'RUNNING',
      startedAt: runs[0].startedAt,
      finishedAt: null,
    });
    expect(back[0].status).toBe('SUCCEEDED');
  });
});
