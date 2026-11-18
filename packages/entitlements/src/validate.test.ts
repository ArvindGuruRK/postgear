/**
 * Every write rule, per type and at each edge. Nothing here may throw: a bad
 * value from a request or a row is a typed refusal.
 */
import { type EntitlementDef, REGISTRY } from './registry';
import {
  OVERRIDE_MAX_DAYS,
  type ValidationResult,
  validateKey,
  validateOverride,
  validateOverrideEnd,
  validatePlanValue,
  validateReason,
  validateTier,
  validateValue,
} from './validate';

const def = (key: keyof typeof REGISTRY): EntitlementDef => REGISTRY[key];

function codesOf(result: ValidationResult<unknown>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

const NOW = new Date('2026-11-18T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('validateValue', () => {
  it('takes a boolean for a boolean key and nothing else', () => {
    expect(validateValue(def('clips.enabled'), false)).toEqual({ ok: true, value: false });
    expect(codesOf(validateValue(def('clips.enabled'), 'true'))).toEqual(['wrong_type']);
    expect(codesOf(validateValue(def('clips.enabled'), 1))).toEqual(['wrong_type']);
    expect(codesOf(validateValue(def('clips.enabled'), null))).toEqual(['value_required']);
  });

  it('keeps a number inside min and max, both ends included', () => {
    const minutes = def('clips.max_video_minutes');
    expect(validateValue(minutes, 1).ok).toBe(true);
    expect(validateValue(minutes, 1440).ok).toBe(true);
    expect(codesOf(validateValue(minutes, 0))).toEqual(['below_min']);
    expect(codesOf(validateValue(minutes, 1441))).toEqual(['above_max']);
    expect(validateValue(minutes, 1441)).toMatchObject({
      issues: [{ field: 'value', message: 'Enter a whole number from 1 to 1,440.' }],
    });
  });

  it('wants whole numbers where the key says so, and allows fractions where it does not', () => {
    expect(codesOf(validateValue(def('clips.max_video_minutes'), 60.5))).toEqual(['not_whole']);
    expect(validateValue(def('clips.upload_max_gb'), 0.5)).toEqual({ ok: true, value: 0.5 });
    expect(codesOf(validateValue(def('clips.upload_max_gb'), 0.05))).toEqual(['below_min']);
  });

  it('refuses numbers that are not real numbers, or not numbers at all', () => {
    const storage = def('clips.storage_gb');
    expect(codesOf(validateValue(storage, Number.NaN))).toEqual(['wrong_type']);
    expect(codesOf(validateValue(storage, Number.POSITIVE_INFINITY))).toEqual(['wrong_type']);
    expect(codesOf(validateValue(storage, '3'))).toEqual(['wrong_type']);
    expect(codesOf(validateValue(storage, undefined))).toEqual(['value_required']);
  });

  it('takes null (unlimited) only where the key allows it', () => {
    expect(validateValue(def('clips.import_minutes_per_month'), null)).toEqual({
      ok: true,
      value: null,
    });
    expect(validateValue(def('clips.storage_gb'), null)).toMatchObject({
      ok: false,
      issues: [{ code: 'value_required', message: 'This plan value cannot be empty.' }],
    });
    expect(codesOf(validateValue(def('clips.downloads_per_day'), null))).toEqual([
      'value_required',
    ]);
  });

  it('checks meter limits like numbers', () => {
    const ai = def('clips.ai_minutes_per_month');
    expect(validateValue(ai, 0).ok).toBe(true);
    expect(codesOf(validateValue(ai, -1))).toEqual(['below_min']);
    expect(codesOf(validateValue(ai, 1_000_001))).toEqual(['above_max']);
  });

  it('takes listed enum members, refuses reserved ones and strangers', () => {
    const quality = def('clips.export_max_quality');
    expect(validateValue(quality, '720p60')).toEqual({ ok: true, value: '720p60' });
    expect(validateValue(quality, '4k')).toMatchObject({
      ok: false,
      issues: [{ code: 'reserved_option', message: '4K is reserved and cannot be saved yet.' }],
    });
    expect(codesOf(validateValue(quality, '1440p'))).toEqual(['not_an_option']);
    expect(codesOf(validateValue(quality, 1080))).toEqual(['wrong_type']);
    expect(codesOf(validateValue(quality, null))).toEqual(['value_required']);
    expect(codesOf(validateValue(def('clips.queue_priority'), 'urgent'))).toEqual([
      'not_an_option',
    ]);
  });

  it('never throws, whatever it is handed', () => {
    for (const key of Object.keys(REGISTRY) as (keyof typeof REGISTRY)[]) {
      for (const value of [undefined, null, {}, [], 'x', -0, Symbol('s'), () => 1]) {
        expect(() => validateValue(def(key), value)).not.toThrow();
      }
    }
  });
});

describe('keys, tiers and reasons', () => {
  it('knows its keys', () => {
    expect(validateKey('clips.storage_gb')).toEqual({ ok: true, value: 'clips.storage_gb' });
    expect(codesOf(validateKey('clips.nope'))).toEqual(['unknown_key']);
    expect(codesOf(validateKey(undefined))).toEqual(['unknown_key']);
  });

  it('knows only the tiers of PLAN_ORDER', () => {
    expect(validateTier('TEAM')).toEqual({ ok: true, value: 'TEAM' });
    expect(codesOf(validateTier('team'))).toEqual(['unknown_tier']);
    expect(codesOf(validateTier('ENTERPRISE'))).toEqual(['unknown_tier']);
  });

  it('wants a reason of at least 10 characters, trimmed', () => {
    expect(validateReason('  Raised for a pilot  ')).toEqual({
      ok: true,
      value: 'Raised for a pilot',
    });
    expect(codesOf(validateReason('too short '))).toEqual(['reason_too_short']);
    expect(codesOf(validateReason('          x'))).toEqual(['reason_too_short']);
    expect(codesOf(validateReason(null))).toEqual(['reason_too_short']);
    expect(codesOf(validateReason('x'.repeat(501)))).toEqual(['reason_too_long']);
  });
});

describe('override end dates', () => {
  it('takes a date after now and up to 366 days ahead', () => {
    const end = new Date(NOW.getTime() + OVERRIDE_MAX_DAYS * DAY);
    expect(validateOverrideEnd(end, NOW)).toEqual({ ok: true, value: end });
    expect(validateOverrideEnd('2026-12-01T00:00:00Z', NOW).ok).toBe(true);
  });

  it('refuses the past, now itself, beyond 366 days, and anything unreadable', () => {
    expect(codesOf(validateOverrideEnd(new Date(NOW.getTime() - 1), NOW))).toEqual([
      'end_date_past',
    ]);
    expect(codesOf(validateOverrideEnd(NOW, NOW))).toEqual(['end_date_past']);
    expect(
      codesOf(validateOverrideEnd(new Date(NOW.getTime() + OVERRIDE_MAX_DAYS * DAY + 1), NOW)),
    ).toEqual(['end_date_too_far']);
    expect(codesOf(validateOverrideEnd('not a date', NOW))).toEqual(['end_date_invalid']);
    expect(codesOf(validateOverrideEnd(new Date(Number.NaN), NOW))).toEqual(['end_date_invalid']);
    expect(codesOf(validateOverrideEnd(undefined, NOW))).toEqual(['end_date_invalid']);
  });
});

describe('a plan cell', () => {
  it('passes with a known tier, key and value', () => {
    expect(validatePlanValue({ tier: 'FREE', key: 'clips.storage_gb', value: 4 })).toEqual({
      ok: true,
      value: { tier: 'FREE', key: 'clips.storage_gb', value: 4 },
    });
  });

  it('reports every issue at once', () => {
    expect(
      codesOf(validatePlanValue({ tier: 'GOLD', key: 'clips.storage_gb', value: -1 })),
    ).toEqual(['unknown_tier', 'below_min']);
    expect(codesOf(validatePlanValue({ tier: 'GOLD', key: 'clips.nope', value: 1 }))).toEqual([
      'unknown_tier',
      'unknown_key',
    ]);
  });
});

describe('an override', () => {
  const good = {
    key: 'clips.ai_minutes_per_month',
    value: 600,
    expiresAt: '2027-01-31T00:00:00Z',
    reason: 'Pilot for the agency deal',
  };

  it('passes and comes back cleaned', () => {
    expect(validateOverride({ ...good, reason: ` ${good.reason} ` }, NOW)).toEqual({
      ok: true,
      value: {
        key: 'clips.ai_minutes_per_month',
        value: 600,
        expiresAt: new Date('2027-01-31T00:00:00Z'),
        reason: 'Pilot for the agency deal',
      },
    });
  });

  it('marks every bad field', () => {
    const result = validateOverride(
      { key: 'clips.export_max_quality', value: '4k', expiresAt: '2020-01-01', reason: 'short' },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => [issue.field, issue.code])).toEqual([
        ['value', 'reserved_option'],
        ['expiresAt', 'end_date_past'],
        ['reason', 'reason_too_short'],
      ]);
    }
  });

  it('refuses an unknown key without looking at its value', () => {
    expect(codesOf(validateOverride({ ...good, key: 'clips.nope' }, NOW))).toEqual(['unknown_key']);
  });
});
