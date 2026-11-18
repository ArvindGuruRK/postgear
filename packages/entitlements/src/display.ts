/**
 * How a value reads on a page: the operator's Plans table, a workspace's
 * override list, and the plan cards on the billing page.
 *
 * The plan cards list their Clips lines from the same values every gate uses
 * (`GET /billing/plans` carries each tier's `previewTier`), so a card can
 * never promise what Clips refuses, and an operator edit changes the card.
 * Lines are sentence case, one fact each, like the cards' existing features
 * ("25 AI credits a month").
 */
import { formatNumber } from './format-number';
import {
  type CountNoun,
  type EntitlementDef,
  type EntitlementUnit,
  getDef,
  type Key,
  type ValueOf,
} from './registry';
import { resolveValue } from './resolve';
import { validateValue } from './validate';

/** What a value shows when it cannot be read. */
export const INVALID_VALUE_LABEL = 'Not valid';

/** What an unlimited (`null`) value shows. */
export const UNLIMITED_LABEL = 'Unlimited';

const UNIT_NOUNS: Readonly<Record<EntitlementUnit, CountNoun | null>> = {
  minutes: { one: 'minute', other: 'minutes' },
  gigabytes: { one: 'GB', other: 'GB' },
  days: { one: 'day', other: 'days' },
  count: null,
  credits: { one: 'credit', other: 'credits' },
  none: null,
};

/** "1 minute", "60 minutes", "2 GB", "5 downloads". */
function amount(value: number, noun: CountNoun | null | undefined): string {
  const text = formatNumber(value);
  if (!noun) return text;
  return `${text} ${value === 1 ? noun.one : noun.other}`;
}

function nounOf(def: EntitlementDef): CountNoun | null {
  if (def.type === 'number' || def.type === 'meter') {
    return def.noun ?? UNIT_NOUNS[def.unit];
  }
  return null;
}

/**
 * One value as a short label: "60 minutes", "3 GB", "1080p 60 fps", "On",
 * "Unlimited". An unknown key or a value its key would refuse reads
 * "Not valid", so the operator sees a bad row instead of a guess.
 */
export function formatEntitlementValue(key: string, value: unknown): string {
  const def = getDef(key);
  if (!def || !validateValue(def, value).ok) {
    return INVALID_VALUE_LABEL;
  }
  switch (def.type) {
    case 'boolean':
      return value ? 'On' : 'Off';
    case 'enum':
      return def.optionLabels[value as string] ?? (value as string);
    default:
      return value === null ? UNLIMITED_LABEL : amount(value as number, nounOf(def));
  }
}

/** A plan's values, as the resolver or `TIER_SEED` gives them. Missing keys use their default. */
export type PlanValues = Partial<Record<Key, unknown>>;

function valueIn<K extends Key>(values: PlanValues, key: K): ValueOf<K> {
  // The same rules as a gate: a value that does not validate falls back to the default.
  return resolveValue(key, { planValue: values[key], now: new Date(0) });
}

function perMonth(limit: number | null, what: string): string {
  return limit === null ? `Unlimited ${what}` : `${formatNumber(limit)} ${what} a month`;
}

/**
 * The Clips lines of a plan card, one fact each, in sentence case:
 * "Videos up to 60 minutes long", "30 AI minutes a month", and so on. A plan
 * without Clips gets the one line "Clips is not included".
 */
export function planCardLines(values: PlanValues): string[] {
  if (!valueIn(values, 'clips.enabled')) {
    return ['Clips is not included'];
  }

  const quality = valueIn(values, 'clips.export_max_quality');
  const lines = [
    `Videos up to ${formatEntitlementValue('clips.max_video_minutes', valueIn(values, 'clips.max_video_minutes'))} long`,
    perMonth(valueIn(values, 'clips.import_minutes_per_month'), 'import minutes'),
    perMonth(valueIn(values, 'clips.ai_minutes_per_month'), 'AI minutes'),
    `${formatEntitlementValue('clips.storage_gb', valueIn(values, 'clips.storage_gb'))} of video space`,
    `Videos kept ${formatEntitlementValue('clips.retention_days', valueIn(values, 'clips.retention_days'))} after last use`,
    `Exports up to ${formatEntitlementValue('clips.export_max_quality', quality)}`,
    valueIn(values, 'clips.export_watermark')
      ? 'Exports carry a small PostGear mark'
      : 'No mark on exports',
    `${formatEntitlementValue('clips.concurrent_imports', valueIn(values, 'clips.concurrent_imports'))} at a time`,
    `Uploads up to ${formatEntitlementValue('clips.upload_max_gb', valueIn(values, 'clips.upload_max_gb'))}`,
    `${formatEntitlementValue('clips.downloads_per_day', valueIn(values, 'clips.downloads_per_day'))} a day`,
    `${formatEntitlementValue('clips.browse_channels', valueIn(values, 'clips.browse_channels'))} to browse`,
  ];
  if (valueIn(values, 'clips.queue_priority') === 'high') {
    lines.push('Priority in the video queue');
  }
  return lines;
}
