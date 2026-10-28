/**
 * Helpers for reading step config by dotted path, shared by the rules.
 * Config is untyped JSON here: rules run on unfinished drafts too.
 */
import type { ZodErrorMap } from 'zod';

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** `getAtPath({ a: [{ b: 1 }] }, 'a.0.b')` is 1. */
export function getAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Every string inside a config, with its dotted path. */
export function stringsIn(value: unknown, path = ''): { path: string; value: string }[] {
  if (typeof value === 'string') return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => stringsIn(item, path ? `${path}.${i}` : String(i)));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      stringsIn(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/**
 * Plain words for Zod's built-in messages. Messages written in a schema
 * (`.min(1, 'Name this path.')`) take priority over this map, so only the
 * defaults ("Expected string, received number") are replaced.
 */
export const plainErrorMap: ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      return {
        message:
          issue.received === 'undefined' ? 'Fill in this field.' : 'This value is not valid here.',
      };
    case 'too_small':
      if (issue.type === 'string') return { message: 'Fill in this field.' };
      if (issue.type === 'array') return { message: `Add at least ${issue.minimum}.` };
      return { message: `Use ${issue.minimum} or more.` };
    case 'too_big':
      if (issue.type === 'string') {
        return { message: `Keep this to ${issue.maximum} characters or fewer.` };
      }
      if (issue.type === 'array') return { message: `Use ${issue.maximum} or fewer.` };
      return { message: `Use ${issue.maximum} or less.` };
    case 'invalid_enum_value':
    case 'invalid_literal':
    case 'invalid_union':
    case 'invalid_union_discriminator':
      return { message: 'Choose one of the options.' };
    case 'unrecognized_keys':
      return { message: 'This step has settings this version of PostGear does not know.' };
    default:
      return { message: 'This value is not valid here.' };
  }
};
