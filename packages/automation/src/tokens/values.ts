/**
 * How step data reads as text, numbers and dates, and how a token path
 * finds its value in a run. Shared by tokens, data formats and conditions
 * so a value means the same thing everywhere.
 */
import { parseIsoDate, toIsoString } from '../time/calendar';
import { MAX_FIELD_DEPTH, tokenSource } from './parse';

/**
 * Everything a token can read during a run: the trigger's data, each
 * finished step's output by key, the run and the workspace.
 */
export interface RunScope {
  trigger?: unknown;
  nodes?: Readonly<Record<string, { output?: unknown } | undefined>>;
  run?: { id?: string; startedAt?: string; mode?: 'test' | 'live' };
  workspace?: { name?: string };
}

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function child(value: unknown, key: string): unknown {
  if (BLOCKED_KEYS.has(key)) return undefined;
  if (Array.isArray(value)) return /^\d+$/.test(key) ? value[Number(key)] : undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * The value at a token path (`trigger.post.url`, `nodes.k3f9.output.text`),
 * or `undefined` when any part is missing. Only the object's own fields
 * are read, so a path can never reach into JavaScript internals.
 */
export function resolveValue(path: string, scope: RunScope): unknown {
  const source = tokenSource(path);
  if (!source.wellFormed) return undefined;
  if (source.field.split('.').length > MAX_FIELD_DEPTH) return undefined;
  let current: unknown = scope;
  for (const part of path.split('.')) {
    current = child(current, part);
    if (current === undefined) return undefined;
  }
  return current;
}

/** Empty text (after trimming), an empty list or object, null or missing. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * A value as it reads inside text: lists joined with ", ", objects as
 * compact JSON, missing as nothing.
 */
export function toText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(toText).join(', ');
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? toIsoString(ms) : '';
  }
  return compactJson(value);
}

const STRICT_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * A number, or `NaN` when the value is not clearly one. Empty text is
 * never 0 and "12 likes" is not 12, so a comparison with it is false.
 */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'string') {
    const text = value.trim();
    return STRICT_NUMBER.test(text) ? Number(text) : Number.NaN;
  }
  return Number.NaN;
}

/** Milliseconds since the epoch for an ISO date or a number of milliseconds. */
export function toEpoch(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return parseIsoDate(value);
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}
