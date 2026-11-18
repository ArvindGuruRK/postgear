/**
 * Every refusal code has a sentence, the sentences read as the stories wrote
 * them, and a missing value never leaves a gap.
 */
import {
  formatResetDate,
  isRefusalCode,
  REFUSAL_CODES,
  REFUSAL_MESSAGES,
  refusalMessage,
} from './messages';
import { KEYS, refusalCodeOf } from './registry';

const DEC_1 = new Date('2026-12-01T00:00:00Z');

/** The two characters the project never writes, built from their code points, plus braces. */
const NEVER_SHOWN = new RegExp(`[${String.fromCharCode(0x2014, 0xb7)}{}]`);

describe('refusal sentences', () => {
  it('has one for every code a key raises, and for every listed code', () => {
    for (const key of KEYS) {
      const code = refusalCodeOf(key);
      if (code) expect([key, isRefusalCode(code)]).toEqual([key, true]);
    }
    for (const code of REFUSAL_CODES) {
      expect(REFUSAL_MESSAGES[code].template.length).toBeGreaterThan(0);
      expect(REFUSAL_MESSAGES[code].fallback).not.toMatch(/\{/);
    }
  });

  it('reads as the user stories wrote them', () => {
    expect(refusalMessage('clips_not_in_plan')).toBe("Clips is not part of this workspace's plan.");
    expect(refusalMessage('clips_video_too_long', { n: 60 })).toBe(
      'This video is longer than your plan allows (60 minutes). Upgrade the plan to bring in longer videos.',
    );
    expect(refusalMessage('clips_minutes_used', { n: 900, date: DEC_1 })).toBe(
      'You have used all 900 import minutes for this month. They come back on 1 December, or you can upgrade the plan.',
    );
    expect(refusalMessage('clips_storage_full', { n: 15 })).toBe(
      'Your video space is full (15 GB). Delete a video you no longer need, or upgrade the plan.',
    );
    expect(refusalMessage('clips_upload_too_big', { n: 2 })).toBe('Uploads can be up to 2 GB.');
    expect(refusalMessage('clips_quality_requires_plan', { quality: '1080p' })).toBe(
      '1080p export needs a higher plan.',
    );
    expect(refusalMessage('clips_ai_minutes_used', { need: 15, n: 9, date: DEC_1 })).toBe(
      'This needs 15 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan.',
    );
    expect(refusalMessage('clips_downloads_today', { n: 5 })).toBe(
      "You have reached today's limit of 5 downloads. It resets at midnight UTC.",
    );
    expect(refusalMessage('channel_limit', { n: 3 })).toBe(
      'Your plan allows 3 channels. Remove one to add another.',
    );
  });

  it('says 1 channel, not 1 channels', () => {
    expect(refusalMessage('channel_limit', { n: 1 })).toBe(
      'Your plan allows 1 channel. Remove one to add another.',
    );
    expect(refusalMessage('clips_ai_minutes_used', { need: 1, n: 0, date: DEC_1 })).toMatch(
      /^This needs 1 AI minute and you have 0 left\./,
    );
  });

  it('gives whole numbers: limits rounded down, needs rounded up, thousands grouped', () => {
    expect(refusalMessage('clips_video_too_long', { n: 1440 })).toContain('(1,440 minutes)');
    expect(refusalMessage('clips_storage_full', { n: 14.9 })).toContain('(14 GB)');
    expect(refusalMessage('clips_ai_minutes_used', { need: 14.2, n: 8.7, date: DEC_1 })).toMatch(
      /needs 15 AI minutes and you have 8 left/,
    );
    expect(refusalMessage('clips_downloads_today', { n: -4 })).toContain('limit of 0 downloads');
    for (const code of REFUSAL_CODES) {
      const text = refusalMessage(code, { n: 12.6, need: 3.2, date: DEC_1, quality: '1080p' });
      expect([code, /\d\.\d/.test(text)]).toEqual([code, false]);
    }
  });

  it('keeps one decimal for a limit under 1, so 0.5 GB never reads as 0 GB', () => {
    expect(refusalMessage('clips_upload_too_big', { n: 0.5 })).toBe('Uploads can be up to 0.5 GB.');
  });

  it('uses the fallback when a value is missing or unreadable, never a gap', () => {
    expect(refusalMessage('clips_minutes_used', { n: 900 })).toBe(
      REFUSAL_MESSAGES.clips_minutes_used.fallback,
    );
    expect(refusalMessage('clips_minutes_used', { n: 900, date: 'soon' })).toBe(
      REFUSAL_MESSAGES.clips_minutes_used.fallback,
    );
    expect(refusalMessage('clips_video_too_long', { n: Number.NaN })).toBe(
      REFUSAL_MESSAGES.clips_video_too_long.fallback,
    );
    expect(refusalMessage('clips_quality_requires_plan', { quality: '  ' })).toBe(
      'This export quality needs a higher plan.',
    );
    expect(refusalMessage('channel_limit')).toBe(REFUSAL_MESSAGES.channel_limit.fallback);
  });

  it('answers an unknown code with a plain plan sentence', () => {
    expect(refusalMessage('clips_whatever', { n: 3 })).toBe('This needs a higher plan.');
  });

  it('keeps every sentence a full sentence with nothing left unfilled', () => {
    for (const code of REFUSAL_CODES) {
      for (const text of [
        refusalMessage(code, { n: 3, need: 2, date: DEC_1, quality: '1080p' }),
        REFUSAL_MESSAGES[code].fallback,
      ]) {
        expect(text).not.toMatch(NEVER_SHOWN);
        expect(text).toMatch(/^[A-Z0-9].*\.$/);
      }
    }
  });
});

describe('formatResetDate', () => {
  it('reads like a person says it, in UTC', () => {
    expect(formatResetDate(DEC_1)).toBe('1 December');
    expect(formatResetDate('2027-02-28T23:59:59Z')).toBe('28 February');
    expect(formatResetDate(new Date('2026-12-01T00:00:00+05:30'))).toBe('30 November');
  });

  it('gives an empty string for a date it cannot read', () => {
    expect(formatResetDate('not a date')).toBe('');
    expect(formatResetDate(new Date(Number.NaN))).toBe('');
  });
});
