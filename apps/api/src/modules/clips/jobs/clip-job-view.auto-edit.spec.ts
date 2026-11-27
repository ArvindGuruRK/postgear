/**
 * An AUTO_EDIT job as the video page reads it (Sprint 13, Module 10): its two
 * steps in words while it runs, and once DONE the clip to open with the parts
 * its recipe left out. A stage or output that is not the contract's never
 * reaches the page.
 */
import { jobRow } from '../testing/rows';
import { toJobView } from './clip-job-view';

const CLIP = '44444444-4444-4444-8444-444444444444';

describe('toJobView for AUTO_EDIT', () => {
  it('names its steps: listening, then applying the recipe', () => {
    const listening = toJobView(
      jobRow({ kind: 'AUTO_EDIT', status: 'RUNNING', stage: 'listening' }),
    );
    expect(listening.stageLabel).toBe('Listening to what is said');
    const applying = toJobView(jobRow({ kind: 'AUTO_EDIT', status: 'RUNNING', stage: 'applying' }));
    expect(applying.stageLabel).toBe('Applying your recipe');
    const odd = toJobView(jobRow({ kind: 'AUTO_EDIT', status: 'RUNNING', stage: 'scoring' }));
    expect(odd.stage).toBeNull();
  });

  it('answers the clip to open, what was skipped and whether anyone spoke, once DONE', () => {
    const view = toJobView(
      jobRow({
        kind: 'AUTO_EDIT',
        status: 'DONE',
        stage: 'applying',
        clipId: CLIP,
        output: {
          clipId: CLIP,
          skipped: [{ part: 'captions', reason: 'no_speech' }],
          noSpeech: true,
        },
      }),
    );
    expect(view.stageLabel).toBe('Done');
    expect(view.result).toEqual({
      clipId: CLIP,
      skipped: [{ part: 'captions', reason: 'no_speech' }],
      noSpeech: true,
    });
  });

  it('an output that does not read shows no result', () => {
    const view = toJobView(
      jobRow({ kind: 'AUTO_EDIT', status: 'DONE', output: { clipId: CLIP, key: 'clips/x' } }),
    );
    expect(view.result).toBeNull();
  });

  it('a failed listen reads the listening sentence', () => {
    const view = toJobView(
      jobRow({
        kind: 'AUTO_EDIT',
        status: 'FAILED',
        error: { code: 'transcribe_failed', message: 'anything' },
      }),
    );
    expect(view.error).toEqual({
      code: 'transcribe_failed',
      message: 'We could not finish listening to this video. Your AI minutes were given back.',
    });
  });
});
