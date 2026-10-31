/**
 * Filling tokens in with run data.
 *
 * - **Single pass.** A resolved value is inserted as data and never read
 *   for tokens again, so a post whose text contains `{{ nodes.x }}` stays
 *   that literal text.
 * - **Typed.** A field that is one token and nothing else keeps the
 *   value's type (a number, a list, an image). Mixed with text, the value
 *   is written as text (`toText`).
 * - **Missing is explicit.** A path with no value reads as empty and is
 *   listed in `missing`, unless a `default` format filled it; the caller
 *   decides whether that fails the step.
 * - **JSON mode** (`{ json: true }`, HTTP Request's JSON body, Module 13).
 *   The template is JSON text, so a value is encoded, never spliced raw: a
 *   chip inside a JSON string is escaped as string content (a quote in a
 *   post's text cannot end the string), and a chip outside one is written
 *   as a JSON value (`"text"`, `42`, `["a","b"]`, `{"k":1}`). The result is
 *   always text.
 */
import { applyFilter, type FilterOptions, isKnownFilter } from './filters';
import { parseTemplate, singleToken, type TokenSegment } from './parse';
import { type RunScope, resolveValue, toText } from './values';

export interface Resolved {
  /** Text, or the typed value when the field is one token. */
  value: unknown;
  /** Paths that had no value, in field order, each once. */
  missing: string[];
  /** Formats that do not exist, skipped. Validation reports them earlier. */
  unknownFilters: string[];
}

export interface ResolveOptions extends FilterOptions {
  /** The template is JSON text: values are JSON-encoded where they land. */
  json?: boolean;
}

/**
 * Whether a JSON text ends inside a string, carried across text segments.
 * Data chips never change it: their values are encoded, so they cannot
 * open or close a string.
 */
interface JsonCursor {
  inString: boolean;
  escaped: boolean;
}

function advanceJson(cursor: JsonCursor, text: string): void {
  for (const char of text) {
    if (cursor.inString) {
      if (cursor.escaped) cursor.escaped = false;
      else if (char === '\\') cursor.escaped = true;
      else if (char === '"') cursor.inString = false;
    } else if (char === '"') {
      cursor.inString = true;
    }
  }
}

/** A value as JSON: string content inside a string, a whole JSON value outside one. */
function jsonEncode(value: unknown, inString: boolean): string {
  if (inString) return JSON.stringify(toText(value)).slice(1, -1);
  if (value instanceof Date) return JSON.stringify(toText(value));
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

function evaluate(
  token: TokenSegment,
  scope: RunScope,
  options: ResolveOptions,
  report: { missing: Set<string>; unknownFilters: Set<string> },
): unknown {
  const raw = resolveValue(token.path, scope);
  let value: unknown = raw;
  let filled = false;
  for (const filter of token.filters) {
    if (!isKnownFilter(filter)) {
      report.unknownFilters.add(filter.name);
      continue;
    }
    value = applyFilter(value, filter, options);
    if (filter.name === 'default') filled = true;
  }
  if ((raw === undefined || raw === null) && !filled) report.missing.add(token.path);
  return value === undefined || value === null ? '' : value;
}

/** Resolves one field's text against a run's data. Never throws. */
export function resolveTemplate(
  text: string,
  scope: RunScope,
  options: ResolveOptions = {},
): Resolved {
  const report = { missing: new Set<string>(), unknownFilters: new Set<string>() };
  const done = (value: unknown): Resolved => ({
    value,
    missing: [...report.missing],
    unknownFilters: [...report.unknownFilters],
  });
  if (!text.includes('{{')) return done(text);

  const segments = parseTemplate(text);
  if (options.json) {
    const cursor: JsonCursor = { inString: false, escaped: false };
    let out = '';
    for (const segment of segments) {
      if (segment.kind === 'text') {
        advanceJson(cursor, segment.value);
        out += segment.value;
      } else {
        out += jsonEncode(evaluate(segment, scope, options, report), cursor.inString);
      }
    }
    return done(out);
  }
  const single = singleToken(segments);
  if (single) return done(evaluate(single, scope, options, report));

  return done(
    segments
      .map((segment) =>
        segment.kind === 'text' ? segment.value : toText(evaluate(segment, scope, options, report)),
      )
      .join(''),
  );
}

export interface ResolvedConfig {
  value: unknown;
  /** Each missing path with the config field it was in (`message`, `fields.0.value`). */
  missing: { field: string; path: string }[];
  unknownFilters: string[];
}

/**
 * Resolves every string inside a step's config, keeping its shape. The
 * worker calls this once per step run, Test Step once per test.
 */
export function resolveConfig(
  config: unknown,
  scope: RunScope,
  options: ResolveOptions = {},
): ResolvedConfig {
  const missing: { field: string; path: string }[] = [];
  const unknownFilters = new Set<string>();
  const walk = (value: unknown, field: string): unknown => {
    if (typeof value === 'string') {
      const resolved = resolveTemplate(value, scope, options);
      for (const path of resolved.missing) missing.push({ field, path });
      for (const name of resolved.unknownFilters) unknownFilters.add(name);
      return resolved.value;
    }
    if (Array.isArray(value)) {
      return value.map((item, i) => walk(item, field ? `${field}.${i}` : String(i)));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          walk(item, field ? `${field}.${key}` : key),
        ]),
      );
    }
    return value;
  };
  return { value: walk(config, ''), missing, unknownFilters: [...unknownFilters] };
}
