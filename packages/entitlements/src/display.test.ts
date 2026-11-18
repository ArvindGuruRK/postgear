/**
 * Values as the operator table and the plan cards show them.
 */
import { formatEntitlementValue, INVALID_VALUE_LABEL, planCardLines } from './display';
import { formatNumber } from './format-number';
import { TIER_SEED } from './seed';

describe('formatNumber', () => {
  it('groups thousands and keeps at most two decimals', () => {
    expect(formatNumber(1440)).toBe('1,440');
    expect(formatNumber(1_000_000)).toBe('1,000,000');
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(2.345)).toBe('2.35');
    expect(formatNumber(-1200)).toBe('-1,200');
    expect(formatNumber(Number.NaN)).toBe('0');
  });
});

describe('formatEntitlementValue', () => {
  it('reads each type with its unit', () => {
    expect(formatEntitlementValue('clips.max_video_minutes', 60)).toBe('60 minutes');
    expect(formatEntitlementValue('clips.max_video_minutes', 1)).toBe('1 minute');
    expect(formatEntitlementValue('clips.storage_gb', 1500)).toBe('1,500 GB');
    expect(formatEntitlementValue('clips.upload_max_gb', 0.5)).toBe('0.5 GB');
    expect(formatEntitlementValue('clips.retention_days', 7)).toBe('7 days');
    expect(formatEntitlementValue('clips.downloads_per_day', 1)).toBe('1 download');
    expect(formatEntitlementValue('clips.browse_channels', 3)).toBe('3 channels');
    expect(formatEntitlementValue('clips.export_max_quality', '1080p60')).toBe('1080p 60 fps');
    expect(formatEntitlementValue('clips.queue_priority', 'high')).toBe('High');
    expect(formatEntitlementValue('clips.export_watermark', true)).toBe('On');
    expect(formatEntitlementValue('clips.import_minutes_per_month', null)).toBe('Unlimited');
  });

  it('shows a bad value or an unknown key as not valid instead of guessing', () => {
    expect(formatEntitlementValue('clips.export_max_quality', '4k')).toBe(INVALID_VALUE_LABEL);
    expect(formatEntitlementValue('clips.storage_gb', null)).toBe(INVALID_VALUE_LABEL);
    expect(formatEntitlementValue('clips.nope', 1)).toBe(INVALID_VALUE_LABEL);
  });
});

describe('planCardLines', () => {
  it('lists the Free plan in sentence case', () => {
    expect(planCardLines(TIER_SEED.FREE)).toEqual([
      'Videos up to 60 minutes long',
      '180 import minutes a month',
      '30 AI minutes a month',
      '3 GB of video space',
      'Videos kept 7 days after last use',
      'Exports up to 720p',
      'Exports carry a small PostGear mark',
      '1 import at a time',
      'Uploads up to 2 GB',
      '5 downloads a day',
      '1 channel to browse',
    ]);
  });

  it('adds the queue line for a high priority plan and reads unlimited meters', () => {
    const lines = planCardLines({ ...TIER_SEED.TEAM, 'clips.ai_minutes_per_month': null });
    expect(lines).toContain('Unlimited AI minutes');
    expect(lines).toContain('7,200 import minutes a month');
    expect(lines).toContain('No mark on exports');
    expect(lines).toContain('Exports up to 1080p 60 fps');
    expect(lines.at(-1)).toBe('Priority in the video queue');
  });

  it('says only that Clips is not included when the plan has it off', () => {
    expect(planCardLines({ ...TIER_SEED.PRO, 'clips.enabled': false })).toEqual([
      'Clips is not included',
    ]);
  });

  it('falls back to the default for a missing or bad value, as a gate would', () => {
    const lines = planCardLines({ 'clips.storage_gb': 'lots' });
    expect(lines).toContain('3 GB of video space');
    expect(lines).toContain('Videos up to 60 minutes long');
  });

  it('starts every line with a capital or a number and never ends with a full stop', () => {
    for (const tier of Object.values(TIER_SEED)) {
      for (const line of planCardLines(tier)) {
        expect(line).toMatch(/^[A-Z0-9]/);
        expect(line).not.toMatch(/\.$/);
      }
    }
  });
});
