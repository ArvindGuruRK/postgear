/**
 * Data formats: the fixed list behind a chip's Format menu. Each is a
 * small pure function on the value; there are no user functions, no
 * expressions and no maths, and nothing here ever runs text as code.
 */
import { DEFAULT_DATE_PATTERN, formatDate } from '../time/format';
import type { TokenFilter } from './parse';
import { isEmptyValue, toEpoch, toText } from './values';

type ArgRule = 'none' | 'optionalText' | 'text' | 'count';

export interface FilterInfo {
  name: string;
  /** Title Case menu label. */
  label: string;
  /** Sentence case, what it does. */
  description: string;
  arg: ArgRule;
  /** The argument the Format menu fills in first. */
  defaultArg?: string | number;
}

/** Every data format, in menu order. Unknown names are a `token.bad_filter` issue. */
export const TOKEN_FILTERS: readonly FilterInfo[] = [
  {
    name: 'truncate',
    label: 'Shorten',
    description: 'Cuts the text to at most this many characters.',
    arg: 'count',
    defaultArg: 200,
  },
  {
    name: 'upper',
    label: 'Upper Case',
    description: 'Writes every letter as a capital.',
    arg: 'none',
  },
  { name: 'lower', label: 'Lower Case', description: 'Writes every letter small.', arg: 'none' },
  {
    name: 'trim',
    label: 'Trim Spaces',
    description: 'Removes spaces at the start and end.',
    arg: 'none',
  },
  {
    name: 'date',
    label: 'Date Format',
    description: 'Writes a date the way you choose, like 2026-11-03.',
    arg: 'optionalText',
    defaultArg: DEFAULT_DATE_PATTERN,
  },
  {
    name: 'default',
    label: 'If Empty Use',
    description: 'Uses this instead when the data is empty.',
    arg: 'text',
    defaultArg: 'n/a',
  },
  {
    name: 'json',
    label: 'As JSON',
    description: 'Writes the data as JSON, for other apps.',
    arg: 'none',
  },
  {
    name: 'join',
    label: 'Join List',
    description: 'Joins a list into one line.',
    arg: 'optionalText',
    defaultArg: ', ',
  },
  {
    name: 'first',
    label: 'First Item',
    description: 'Takes the first item of a list.',
    arg: 'none',
  },
  {
    name: 'count',
    label: 'Count',
    description: 'Counts the items in a list, or the characters in text.',
    arg: 'none',
  },
  {
    name: 'urlencode',
    label: 'For A Link',
    description: 'Makes the text safe to put inside a web address.',
    arg: 'none',
  },
];

const BY_NAME = new Map(TOKEN_FILTERS.map((filter) => [filter.name, filter]));

export const FILTER_NAMES = TOKEN_FILTERS.map((filter) => filter.name);

/** True when the format exists and its argument fits. */
export function isKnownFilter(filter: TokenFilter): boolean {
  const info = BY_NAME.get(filter.name);
  if (!info) return false;
  switch (info.arg) {
    case 'none':
      return filter.arg === undefined;
    case 'optionalText':
      return (
        filter.arg === undefined || (typeof filter.arg === 'string' && filter.arg.length <= 40)
      );
    case 'text':
      return filter.arg !== undefined && String(filter.arg).length <= 200;
    case 'count':
      return (
        typeof filter.arg === 'number' &&
        Number.isInteger(filter.arg) &&
        filter.arg >= 1 &&
        filter.arg <= 10_000
      );
  }
}

export interface FilterOptions {
  /** The zone dates are written in; UTC when absent. */
  timeZone?: string;
}

const ELLIPSIS = '…';

/** Applies one known format. An unknown one returns the value unchanged. */
export function applyFilter(value: unknown, filter: TokenFilter, options: FilterOptions): unknown {
  switch (filter.name) {
    case 'truncate': {
      const limit = typeof filter.arg === 'number' ? filter.arg : 200;
      const chars = Array.from(toText(value));
      if (chars.length <= limit) return chars.join('');
      return `${chars
        .slice(0, Math.max(0, limit - 1))
        .join('')
        .trimEnd()}${ELLIPSIS}`;
    }
    case 'upper':
      return toText(value).toUpperCase();
    case 'lower':
      return toText(value).toLowerCase();
    case 'trim':
      return toText(value).trim();
    case 'date': {
      if (isEmptyValue(value)) return '';
      const epoch = toEpoch(value);
      if (epoch === undefined) return toText(value);
      const pattern = typeof filter.arg === 'string' ? filter.arg : DEFAULT_DATE_PATTERN;
      return formatDate(epoch, pattern, options.timeZone);
    }
    case 'default':
      return isEmptyValue(value) ? String(filter.arg ?? '') : value;
    case 'json':
      try {
        return JSON.stringify(value) ?? '';
      } catch {
        return '';
      }
    case 'join':
      return Array.isArray(value)
        ? value.map(toText).join(typeof filter.arg === 'string' ? filter.arg : ', ')
        : value;
    case 'first':
      return Array.isArray(value) ? value[0] : value;
    case 'count':
      if (value === undefined || value === null) return 0;
      if (Array.isArray(value)) return value.length;
      if (typeof value === 'string') return Array.from(value).length;
      if (typeof value === 'object') return Object.keys(value).length;
      return 1;
    case 'urlencode':
      return encodeURIComponent(toText(value));
    default:
      return value;
  }
}
