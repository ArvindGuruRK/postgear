import type { StepPaint, StepPaintState } from '../runs/run-model';
import { badgeLabel, paintLook } from './step-paint';

function paint(state: StepPaintState, extra: Partial<StepPaint> = {}): StepPaint {
  return {
    state,
    attempt: 1,
    attempts: 1,
    durationMs: null,
    startedAt: null,
    dryRun: state === 'dryRun',
    ...extra,
  };
}

describe('paintLook', () => {
  it.each([
    ['queued', 'clock', 'neutral', 'Queued', 'border-dashed'],
    ['running', 'spinner', 'primary', 'Running', ''],
    ['waiting', 'pause', 'accent', 'Waiting For Review', ''],
    ['succeeded', 'check', 'success', 'Succeeded', ''],
    ['dryRun', 'check', 'success', 'Dry Run', ''],
    ['handled', 'alert', 'accent', 'Error Handled', ''],
    ['failed', 'cross', 'danger', 'Failed', 'border-actionDanger'],
    ['skipped', 'skip', 'neutral', 'Skipped', 'opacity-40'],
    ['cancelled', 'stop', 'neutral', 'Cancelled', 'opacity-60'],
  ] as const)('%s: %s icon, %s fill, "%s"', (state, icon, tone, words, card) => {
    const look = paintLook(paint(state));
    expect(look).toMatchObject({ state, icon, tone, words, card });
  });

  it('never paints a handled error green', () => {
    expect(paintLook(paint('handled')).tone).not.toBe('success');
  });

  it('says how many attempts a retried step took, with its duration', () => {
    const look = paintLook(paint('succeeded', { attempts: 2, durationMs: 3100 }));
    expect(look.words).toBe('Succeeded after 2 attempts');
    expect(look.duration).toBe('3.1 s');
  });

  it('marks running and waiting steps for their motion', () => {
    expect(paintLook(paint('running'))).toMatchObject({ running: true, waiting: false });
    expect(paintLook(paint('waiting', { waiting: true }))).toMatchObject({
      running: false,
      waiting: true,
    });
  });

  it('has no duration before the step has one', () => {
    expect(paintLook(paint('running')).duration).toBe('');
  });
});

describe('badgeLabel', () => {
  it('reads the state, the duration and what a click does', () => {
    const look = paintLook(paint('failed', { durationMs: 420 }));
    expect(badgeLabel(look, 'Slack')).toBe("Slack: Failed, 420 ms. Open this step's run data.");
  });
});
