/**
 * The layering: an unexpired override, then the plan value, then the default,
 * with a stored value that no longer validates skipped.
 */
import { overrideActive, resolve, resolveValue } from './resolve';

const NOW = new Date('2026-11-18T12:00:00Z');
const LATER = '2026-12-31T00:00:00Z';
const EARLIER = '2026-11-01T00:00:00Z';

describe('resolve', () => {
  it('answers with the override while it runs, even when it is lower than the plan', () => {
    expect(
      resolve('clips.storage_gb', {
        override: { value: 1, expiresAt: LATER },
        planValue: 50,
        now: NOW,
      }),
    ).toEqual({ key: 'clips.storage_gb', value: 1, source: 'override', rejected: [] });
  });

  it('ignores an override that has ended, and one ending exactly now', () => {
    expect(
      resolve('clips.storage_gb', {
        override: { value: 500, expiresAt: EARLIER },
        planValue: 50,
        now: NOW,
      }),
    ).toMatchObject({ value: 50, source: 'plan', rejected: [] });
    expect(
      resolve('clips.storage_gb', {
        override: { value: 500, expiresAt: NOW },
        planValue: 50,
        now: NOW,
      }).source,
    ).toBe('plan');
  });

  it('falls back to the default when there is no row', () => {
    expect(resolve('clips.max_video_minutes', { now: NOW })).toEqual({
      key: 'clips.max_video_minutes',
      value: 60,
      source: 'default',
      rejected: [],
    });
    expect(resolve('clips.export_max_quality', { planValue: undefined, now: NOW }).value).toBe(
      '720p',
    );
  });

  it('treats a stored null as unlimited where the key allows it, and as invalid where not', () => {
    expect(resolve('clips.ai_minutes_per_month', { planValue: null, now: NOW })).toMatchObject({
      value: null,
      source: 'plan',
    });
    expect(resolve('clips.storage_gb', { planValue: null, now: NOW })).toEqual({
      key: 'clips.storage_gb',
      value: 3,
      source: 'default',
      rejected: [{ source: 'plan', code: 'value_required' }],
    });
  });

  it('skips an override that no longer validates and lets the plan answer', () => {
    expect(
      resolve('clips.export_max_quality', {
        override: { value: '4k', expiresAt: LATER },
        planValue: '1080p',
        now: NOW,
      }),
    ).toEqual({
      key: 'clips.export_max_quality',
      value: '1080p',
      source: 'plan',
      rejected: [{ source: 'override', code: 'reserved_option' }],
    });
  });

  it('skips both bad layers and answers with the default', () => {
    expect(
      resolve('clips.max_video_minutes', {
        override: { value: 99_999, expiresAt: LATER },
        planValue: 'sixty',
        now: NOW,
      }),
    ).toEqual({
      key: 'clips.max_video_minutes',
      value: 60,
      source: 'default',
      rejected: [
        { source: 'override', code: 'above_max' },
        { source: 'plan', code: 'wrong_type' },
      ],
    });
  });

  it('treats an override with an unreadable end date as ended', () => {
    expect(
      resolve('clips.retention_days', {
        override: { value: 90, expiresAt: 'whenever' },
        planValue: 30,
        now: NOW,
      }).source,
    ).toBe('plan');
    expect(overrideActive({ value: 1, expiresAt: LATER }, new Date(Number.NaN))).toBe(false);
  });

  it('gives just the value when asked', () => {
    expect(resolveValue('clips.export_watermark', { planValue: false, now: NOW })).toBe(false);
  });
});
