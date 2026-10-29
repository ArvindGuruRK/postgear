/**
 * Pure helpers behind the step form: reading and writing a config by its
 * dotted path, and turning validation issues into inline errors per path.
 * No React here, so every rule is unit tested.
 */
import {
  configErrors,
  type FormTab,
  type NodeDefinition,
  tabForField,
  type ValidationIssue,
} from '@postgear/automation';

type Json = Record<string, unknown>;

/** The value at a dotted path (`fields.0.name`); '' is the whole value. */
export function getAtPath(value: unknown, path: string): unknown {
  if (path === '') return value;
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Json)[part];
  }
  return current;
}

/**
 * A copy of `config` with `value` at `path`; the config itself is never
 * changed. '' replaces the whole config. Numeric parts index lists.
 */
export function setAtPath(config: Json, path: string, value: unknown): Json {
  if (path === '') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Json)
      : {};
  }
  const [head, ...rest] = path.split('.');
  const write = (container: unknown, part: string, tail: string[]): unknown => {
    const isIndex = /^\d+$/.test(part);
    const base: unknown =
      typeof container === 'object' && container !== null ? container : isIndex ? [] : {};
    const current = (base as Json)[part];
    const next = tail.length === 0 ? value : write(current, tail[0], tail.slice(1));
    if (Array.isArray(base)) {
      const copy = [...base];
      copy[Number(part)] = next;
      return copy;
    }
    return { ...(base as Json), [part]: next };
  };
  return write(config, head, rest) as Json;
}

/** The first message per field: errors before warnings, token issues kept (their chip turns red too). */
export function issueErrors(issues: readonly ValidationIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const severity of ['error', 'warning'] as const) {
    for (const issue of issues) {
      if (issue.severity !== severity || issue.field === undefined) continue;
      if (severity === 'warning' && issue.code === 'token.maybe_empty') continue;
      errors[issue.field] ??= issue.message;
    }
  }
  return errors;
}

/** Inline errors for a step: its schema problems, then its validation issues. */
export function formErrors(
  definition: Pick<NodeDefinition, 'configSchema'>,
  config: unknown,
  issues: readonly ValidationIssue[],
): Record<string, string> {
  return { ...issueErrors(issues), ...configErrors(definition, config) };
}

/**
 * The errors inside a field, keyed by the path relative to it: for
 * `fields`, `{ '0.name': '...' }`. The field's own error is under ''.
 */
export function errorsUnder(
  errors: Readonly<Record<string, string>>,
  base: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (base === '') result[path] = message;
    else if (path === base) result[''] = message;
    else if (path.startsWith(`${base}.`)) result[path.slice(base.length + 1)] = message;
  }
  return result;
}

/** How many error issues each tab holds, for the "!" on its trigger. */
export function tabIssueCounts(
  definition: Pick<NodeDefinition, 'form' | 'connection' | 'channels'>,
  issues: readonly ValidationIssue[],
): Record<FormTab, number> {
  const counts: Record<FormTab, number> = { setup: 0, configure: 0 };
  for (const issue of issues) {
    if (issue.severity !== 'error' || issue.field === undefined) continue;
    const place = tabForField(definition, issue.field);
    if (place === 'setup' || place === 'configure') counts[place] += 1;
  }
  return counts;
}

/** A fresh short id for a rule, a case or a row: letters and digits, deterministic in tests. */
export function freshId(taken: readonly string[], prefix = 'r'): string {
  for (let n = taken.length + 1; ; n++) {
    const id = `${prefix}${n.toString(36)}`;
    if (!taken.includes(id)) return id;
  }
}
