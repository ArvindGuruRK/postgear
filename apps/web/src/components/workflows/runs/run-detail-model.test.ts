import { getDefinition } from '@postgear/automation';
import type { RunStep } from '@/types/workflows';
import {
  failedStepKey,
  orderedSteps,
  STEP_BADGE,
  stepCreditsText,
  waitingReviewKey,
} from './run-detail-model';
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

describe('stepCreditsText', () => {
  const write = { type: 'ai.generateText', typeVersion: 1, config: { withImage: false } };
  const estimate = (getDefinition('ai.generateText')?.credits?.(write.config as never) ??
    0) as number;

  it('shows what the step says it was charged', () => {
    const step = makeStep({ nodeType: 'ai.generateText', output: { text: 'Hi', credits: 7 } });
    expect(stepCreditsText(step, write, 12)).toBe('7 Credits');
    expect(stepCreditsText({ ...step, output: { creditsUsed: 1 } }, write, 12)).toBe('1 Credit');
  });

  it('falls back to the step estimate for a finished AI step, never above the run total', () => {
    const step = makeStep({ nodeType: 'ai.generateText', output: { text: 'Hi' } });
    expect(estimate).toBeGreaterThan(0);
    expect(stepCreditsText(step, write, 100)).toBe(
      estimate === 1 ? 'About 1 Credit' : `About ${estimate} Credits`,
    );
    expect(stepCreditsText(step, write, 1)).toBe('About 1 Credit');
  });

  it('shows nothing when the run used no credits, the step did not finish, or it is not AI', () => {
    const step = makeStep({ nodeType: 'ai.generateText', output: { text: 'Hi' } });
    expect(stepCreditsText(step, write, 0)).toBeNull();
    expect(stepCreditsText({ ...step, status: 'FAILED' }, write, 10)).toBeNull();
    expect(stepCreditsText(makeStep(), undefined, 10)).toBeNull();
  });
});
