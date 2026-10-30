import type { RunStep } from '@/types/workflows';
import { failedStepKey, orderedSteps, STEP_BADGE, waitingReviewKey } from './run-detail-model';
import { makeStep } from './run-test-fixtures';

function stepsOf(list: RunStep[]): Record<string, RunStep> {
  return Object.fromEntries(list.map((step) => [step.nodeKey, step]));
}

describe('orderedSteps', () => {
  it('lists steps by start time, then the never-started ones in graph order', () => {
    const steps = stepsOf([
      makeStep({ nodeKey: 'c', startedAt: '2026-10-29T10:00:03.000Z' }),
      makeStep({ nodeKey: 'skipped', status: 'SKIPPED', startedAt: null }),
      makeStep({ nodeKey: 'a', startedAt: '2026-10-29T10:00:01.000Z' }),
      makeStep({ nodeKey: 'b', startedAt: '2026-10-29T10:00:02.000Z' }),
    ]);
    expect(orderedSteps({ steps, graph: null }).map((step) => step.nodeKey)).toEqual([
      'a',
      'b',
      'c',
      'skipped',
    ]);
  });
});

describe('steps the view jumps to', () => {
  it('finds the waiting Manual Review and the failed step', () => {
    const steps = stepsOf([
      makeStep({ nodeKey: 'draft', status: 'FAILED' }),
      makeStep({ nodeKey: 'review', nodeType: 'logic.manualReview', status: 'WAITING' }),
    ]);
    expect(waitingReviewKey({ steps, graph: null })).toBe('review');
    expect(failedStepKey({ steps, graph: null })).toBe('draft');
    expect(waitingReviewKey({ steps: {}, graph: null })).toBeNull();
  });
});

describe('STEP_BADGE', () => {
  it('never shows a handled error as green, and keeps skipped neutral', () => {
    expect(STEP_BADGE.handled).toBe('accent');
    expect(STEP_BADGE.failed).toBe('danger');
    expect(STEP_BADGE.skipped).toBe('outline');
  });
});
