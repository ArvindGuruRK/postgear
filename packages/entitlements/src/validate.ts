/**
 * Validation for every value that is about to be stored, and for every value
 * read back.
 *
 * One set of rules, used by the operator's Plans editor before it sends, by
 * the operator routes before they save, by the migration agreement test, and
 * by the resolver on read (a stored value that no longer passes, because a
 * key was tightened in code, is skipped and the next layer answers).
 *
 * Nothing here throws on bad input. Every function returns a typed result,
 * so a route can turn the issues into a 422 and the editor can show them
 * beside the field. The sentences are the operator's inline errors from
 * research 12 section 8.3, in plain words.
 */
import { formatNumber } from './format-number';
import {
  type EntitlementDef,
  type EntitlementValue,
  type EnumEntitlementDef,
  getDef,
  type Key,
  type MeterEntitlementDef,
  type NumberEntitlementDef,
} from './registry';
import { isTier, type Tier } from './seed';

/** Why a value, key, tier, date or reason was refused. */
export type ValidationCode =
  | 'unknown_key'
  | 'unknown_tier'
  | 'wrong_type'
  | 'not_whole'
  | 'below_min'
  | 'above_max'
  | 'value_required'
  | 'not_an_option'
  | 'reserved_option'
  | 'plan_only_key'
  | 'org_only_key'
  | 'end_date_invalid'
  | 'end_date_past'
  | 'end_date_too_far'
  | 'reason_too_short'
  | 'reason_too_long';

/** The part of a write an issue belongs to, so the editor can show it beside that field. */
export type ValidationField = 'key' | 'tier' | 'value' | 'expiresAt' | 'reason';

/** One refusal, with a sentence an operator reads. */
export interface ValidationIssue {
  readonly field: ValidationField;
  readonly code: ValidationCode;
  readonly message: string;
}

/** The value, cleaned, or every issue found. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** The shortest reason a write may carry. It goes in the Change Log, so it has to say something. */
export const REASON_MIN_LENGTH = 10;

/** The longest reason kept; anything longer is refused rather than cut. */
export const REASON_MAX_LENGTH = 500;

/** How far ahead an override may end. A deal longer than a year is a new, logged edit. */
export const OVERRIDE_MAX_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

function fail<T>(
  field: ValidationField,
  code: ValidationCode,
  message: string,
): ValidationResult<T> {
  return { ok: false, issues: [{ field, code, message }] };
}

function rangeSentence(def: NumberEntitlementDef | MeterEntitlementDef): string {
  const kind = def.integer ? 'a whole number' : 'a number';
  return `Enter ${kind} from ${formatNumber(def.min)} to ${formatNumber(def.max)}.`;
}

function validateNumber(
  def: NumberEntitlementDef | MeterEntitlementDef,
  value: unknown,
): ValidationResult<EntitlementValue> {
  if (value === null) {
    return def.allowUnlimited
      ? { ok: true, value: null }
      : fail('value', 'value_required', 'This plan value cannot be empty.');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('value', 'wrong_type', rangeSentence(def));
  }
  if (def.integer && !Number.isInteger(value)) {
    return fail('value', 'not_whole', rangeSentence(def));
  }
  if (value < def.min) {
    return fail('value', 'below_min', rangeSentence(def));
  }
  if (value > def.max) {
    return fail('value', 'above_max', rangeSentence(def));
  }
  return { ok: true, value };
}

function validateEnum(def: EnumEntitlementDef, value: unknown): ValidationResult<EntitlementValue> {
  if (value === null || value === undefined) {
    return fail('value', 'value_required', 'This plan value cannot be empty.');
  }
  if (typeof value !== 'string') {
    return fail('value', 'wrong_type', 'Pick one of the listed values.');
  }
  if (def.reserved?.includes(value)) {
    const label = def.optionLabels[value] ?? value;
    return fail('value', 'reserved_option', `${label} is reserved and cannot be saved yet.`);
  }
  if (!def.options.includes(value)) {
    return fail('value', 'not_an_option', 'Pick one of the listed values.');
  }
  return { ok: true, value };
}

/**
 * Whether `value` may be stored for this key: the right JSON type, inside
 * `min` and `max`, a whole number where the key wants one, `null` only where
 * unlimited is allowed, and an enum member that is listed and not reserved.
 */
export function validateValue(
  def: EntitlementDef,
  value: unknown,
): ValidationResult<EntitlementValue> {
  switch (def.type) {
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value };
      return value === null || value === undefined
        ? fail('value', 'value_required', 'This plan value cannot be empty.')
        : fail('value', 'wrong_type', 'Choose on or off.');
    case 'number':
    case 'meter':
      if (value === undefined) {
        return fail('value', 'value_required', 'This plan value cannot be empty.');
      }
      return validateNumber(def, value);
    case 'enum':
      return validateEnum(def, value);
    default:
      return fail('value', 'wrong_type', 'This value cannot be saved.');
  }
}

/** A key name from a request or a row: known to the registry, or refused. */
export function validateKey(key: unknown): ValidationResult<Key> {
  if (typeof key === 'string' && getDef(key)) {
    return { ok: true, value: key as Key };
  }
  return fail('key', 'unknown_key', 'This setting does not exist.');
}

/** A tier name: one of `TIERS` (the API's `PLAN_ORDER`), or refused. */
export function validateTier(tier: unknown): ValidationResult<Tier> {
  return isTier(tier)
    ? { ok: true, value: tier }
    : fail('tier', 'unknown_tier', 'This plan does not exist.');
}

/** A reason for the Change Log: trimmed, at least 10 characters, at most 500. */
export function validateReason(reason: unknown): ValidationResult<string> {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < REASON_MIN_LENGTH) {
    return fail('reason', 'reason_too_short', 'Enter a reason of at least 10 characters.');
  }
  if (text.length > REASON_MAX_LENGTH) {
    return fail('reason', 'reason_too_long', 'Keep the reason to 500 characters or fewer.');
  }
  return { ok: true, value: text };
}

/** A `Date` or an ISO string as a valid `Date`, or `null`. */
export function toValidDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** When an override ends: a real date, after `now`, and at most 366 days ahead. */
export function validateOverrideEnd(expiresAt: unknown, now: Date): ValidationResult<Date> {
  const end = toValidDate(expiresAt);
  if (!end) {
    return fail('expiresAt', 'end_date_invalid', 'Enter the date this override ends.');
  }
  if (end.getTime() <= now.getTime()) {
    return fail('expiresAt', 'end_date_past', 'Pick a date after today.');
  }
  if (end.getTime() > now.getTime() + OVERRIDE_MAX_DAYS * DAY_MS) {
    return fail('expiresAt', 'end_date_too_far', 'Pick a date at most 366 days from today.');
  }
  return { ok: true, value: end };
}

/** The value of a result already known to be ok (`collect` calls its builder only then). */
function unwrap<T>(result: ValidationResult<T>): T {
  return (result as { readonly value: T }).value;
}

function collect<T>(results: ValidationResult<unknown>[], value: () => T): ValidationResult<T> {
  const issues = results.flatMap((result) => (result.ok ? [] : result.issues));
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value() };
}

/** A plan cell the operator is saving. */
export interface PlanValueInput {
  tier: unknown;
  key: unknown;
  value: unknown;
}

/** A plan cell that passed. */
export interface ValidPlanValue {
  tier: Tier;
  key: Key;
  value: EntitlementValue;
}

/**
 * One plan cell: a known tier, a known key that may live on a plan row (not
 * an `org` only key), and a value that passes `validateValue`. The reason is
 * checked once per save with `validateReason`, not per cell.
 */
export function validatePlanValue(input: PlanValueInput): ValidationResult<ValidPlanValue> {
  const tier = validateTier(input.tier);
  const key = validateKey(input.key);
  if (!key.ok) {
    return collect([tier, key], () => ({}) as ValidPlanValue);
  }
  const def = getDef(key.value) as EntitlementDef;
  const scope: ValidationResult<null> =
    def.scope === 'org'
      ? fail('key', 'org_only_key', 'This setting can only be set for one workspace.')
      : { ok: true, value: null };
  const value = validateValue(def, input.value);
  return collect([tier, key, scope, value], () => ({
    tier: unwrap(tier),
    key: key.value,
    value: unwrap(value),
  }));
}

/** A workspace override the operator is saving. */
export interface OverrideInput {
  key: unknown;
  value: unknown;
  expiresAt: unknown;
  reason: unknown;
}

/** An override that passed. */
export interface ValidOverride {
  key: Key;
  value: EntitlementValue;
  expiresAt: Date;
  reason: string;
}

/**
 * A workspace override: a known key that may be overridden (not a `plan`
 * only key), a value that passes, an end date after `now` and at most 366
 * days ahead, and a reason of at least 10 characters. Every issue is
 * returned at once, so the dialog can mark each field.
 */
export function validateOverride(input: OverrideInput, now: Date): ValidationResult<ValidOverride> {
  const key = validateKey(input.key);
  const expiresAt = validateOverrideEnd(input.expiresAt, now);
  const reason = validateReason(input.reason);
  if (!key.ok) {
    return collect([key, expiresAt, reason], () => ({}) as ValidOverride);
  }
  const def = getDef(key.value) as EntitlementDef;
  const scope: ValidationResult<null> =
    def.scope === 'plan'
      ? fail('key', 'plan_only_key', 'This setting is the same for every workspace on a plan.')
      : { ok: true, value: null };
  const value = validateValue(def, input.value);
  return collect([key, scope, value, expiresAt, reason], () => ({
    key: key.value,
    value: unwrap(value),
    expiresAt: unwrap(expiresAt),
    reason: unwrap(reason),
  }));
}
