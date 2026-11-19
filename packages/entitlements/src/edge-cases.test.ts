/**
 * Sprint 12, Module 20 section 2: the plan-limit rows of the stories' edge
 * cases (section 5 of `docs/new-modules/user-stories-clips.md`), with the
 * stories' own numbers, word for word. `messages.test.ts` reads most of them
 * with other numbers; this file pins the exact sentences the stories print,
 * and the row "An operator's override for my workspace has ended".
 */
import { refusalMessage } from './messages';
import { resolve } from './resolve';

const DEC_1 = new Date('2026-12-01T00:00:00Z');

describe('the plan-limit sentences, as the stories print them', () => {
  it.each([
    [
      'The video is longer than the plan allows',
      refusalMessage('clips_video_too_long', { n: 360 }),
      'This video is longer than your plan allows (360 minutes). Upgrade the plan to bring in longer videos.',
    ],
    [
      'The monthly import minutes are used up',
      refusalMessage('clips_minutes_used', { n: 900, date: DEC_1 }),
      'You have used all 900 import minutes for this month. They come back on 1 December, or you can upgrade the plan.',
    ],
    [
      'The video space is full',
      refusalMessage('clips_storage_full', { n: 15 }),
      'Your video space is full (15 GB). Delete a video you no longer need, or upgrade the plan.',
    ],
    [
      'The plan does not include Clips',
      refusalMessage('clips_not_in_plan'),
      "Clips is not part of this workspace's plan.",
    ],
    [
      "The plan's channel limit is reached",
      refusalMessage('channel_limit', { n: 3 }),
      'Your plan allows 3 channels. Remove one to add another.',
    ],
    [
      'The upload is over the size limit (the plan half)',
      refusalMessage('clips_upload_too_big', { n: 2 }),
      'Uploads can be up to 2 GB.',
    ],
    [
      'Not enough AI minutes',
      refusalMessage('clips_ai_minutes_used', { need: 56, n: 9, date: DEC_1 }),
      'This needs 56 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan.',
    ],
    [
      'A locked quality is picked',
      refusalMessage('clips_quality_requires_plan', { quality: '1080p' }),
      '1080p export needs a higher plan.',
    ],
    [
      "The day's downloads are used up",
      refusalMessage('clips_downloads_today', { n: 5 }),
      "You have reached today's limit of 5 downloads. It resets at midnight UTC.",
    ],
  ])('"%s"', (_row, actual, story) => {
    expect(actual).toBe(story);
  });
});

describe("An operator's override for my workspace has ended", () => {
  const NOW = new Date('2026-11-19T12:00:00Z');
  const ENDED = new Date('2026-11-18T00:00:00Z');
  const RUNNING = new Date('2026-11-30T00:00:00Z');

  it('the workspace quietly uses the plan value again', () => {
    const running = resolve('clips.upload_max_gb', {
      override: { value: 5, expiresAt: RUNNING },
      planValue: 2,
      now: NOW,
    });
    expect(running).toMatchObject({ value: 5, source: 'override' });

    const ended = resolve('clips.upload_max_gb', {
      override: { value: 5, expiresAt: ENDED },
      planValue: 2,
      now: NOW,
    });
    expect(ended).toEqual({
      key: 'clips.upload_max_gb',
      value: 2,
      source: 'plan',
      rejected: [],
    });
  });

  it('a sentence that needs the value names the plan value, not the old one', () => {
    const { value } = resolve('clips.upload_max_gb', {
      override: { value: 5, expiresAt: ENDED },
      planValue: 2,
      now: NOW,
    });
    expect(refusalMessage('clips_upload_too_big', { n: value as number })).toBe(
      'Uploads can be up to 2 GB.',
    );
  });
});
