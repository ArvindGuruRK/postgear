/**
 * Data tokens: the text form behind Insert Data chips.
 *
 *   {{ trigger.post.url }}                 the trigger's data
 *   {{ nodes.k3f9a1b2c0.output.text }}     a step's output, by stable key
 *   {{ run.startedAt }}, {{ workspace.name }}
 *   {{ nodes.k3f9.output.text | truncate: 200 | upper }}
 *
 * People never type this; the chip editor writes it. `parseTemplate` and
 * `serializeSegments` are exact inverses: every segment keeps the text it
 * came from, so `serializeSegments(parseTemplate(x)) === x` for any `x`.
 *
 * Escaping: `\{{` is a literal `{{`. A run of backslashes right before
 * `{{` halves (`\\{{ x }}` is a backslash, then a chip); backslashes
 * anywhere else are plain text.
 */

/** Where token paths start. */
export const TOKEN_ROOTS = ['trigger', 'nodes', 'run', 'workspace'] as const;
export type TokenRoot = (typeof TOKEN_ROOTS)[number];

/** At most this many chips in one field (a validation error past it). */
export const MAX_TOKENS_PER_FIELD = 50;
/** At most this many levels inside a step's data (`post.channel.name` is 3). */
export const MAX_FIELD_DEPTH = 8;

export interface TokenFilter {
  name: string;
  arg?: string | number;
}

export interface TextSegment {
  kind: 'text';
  value: string;
  /** The source text, escapes included. Drop it when you change `value`. */
  raw?: string;
}

export interface TokenSegment {
  kind: 'token';
  /** Dotted, root first: `trigger.post.url`, `nodes.k3f9.output.text`. */
  path: string;
  filters: TokenFilter[];
  /** The source text (`{{ trigger.post.url }}`). */
  raw?: string;
}

export type Segment = TextSegment | TokenSegment;

const PATH = /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/y;
const SPACE = /\s*/y;
const FILTER_NAME = /[A-Za-z]+/y;
const NUMBER = /-?\d+(?:\.\d+)?/y;

function readAt(pattern: RegExp, text: string, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(text)?.[0];
}

/** A double-quoted string with `\"` and `\\` escapes; returns its value and end. */
function readQuoted(text: string, at: number): { value: string; end: number } | undefined {
  if (text[at] !== '"') return undefined;
  let value = '';
  for (let i = at + 1; i < text.length; i++) {
    const char = text[i];
    if (char === '"') return { value, end: i + 1 };
    if (char === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
      value += text[i + 1];
      i++;
    } else {
      value += char;
    }
  }
  return undefined;
}

/**
 * Reads `path (| filter (: arg)?)* }}` starting just after an opening `{{`.
 * Returns `undefined` when it is not a token, so the braces stay text.
 */
function readToken(
  text: string,
  start: number,
): { path: string; filters: TokenFilter[]; end: number } | undefined {
  let at = start + (readAt(SPACE, text, start)?.length ?? 0);
  const path = readAt(PATH, text, at);
  if (!path) return undefined;
  at += path.length;
  const filters: TokenFilter[] = [];
  for (;;) {
    at += readAt(SPACE, text, at)?.length ?? 0;
    if (text.startsWith('}}', at)) return { path, filters, end: at + 2 };
    if (text[at] !== '|') return undefined;
    at += 1;
    at += readAt(SPACE, text, at)?.length ?? 0;
    const name = readAt(FILTER_NAME, text, at);
    if (!name) return undefined;
    at += name.length;
    at += readAt(SPACE, text, at)?.length ?? 0;
    if (text[at] !== ':') {
      filters.push({ name });
      continue;
    }
    at += 1;
    at += readAt(SPACE, text, at)?.length ?? 0;
    const quoted = readQuoted(text, at);
    if (quoted) {
      filters.push({ name, arg: quoted.value });
      at = quoted.end;
      continue;
    }
    const number = readAt(NUMBER, text, at);
    if (!number) return undefined;
    filters.push({ name, arg: Number(number) });
    at += number.length;
  }
}

/** Splits a field's text into plain text and tokens. Never throws. */
export function parseTemplate(text: string): Segment[] {
  const segments: Segment[] = [];
  let value = '';
  let rawStart = 0;
  let i = 0;

  const flush = (end: number) => {
    if (end > rawStart) segments.push({ kind: 'text', value, raw: text.slice(rawStart, end) });
    value = '';
  };

  while (i < text.length) {
    if (text[i] === '\\') {
      let run = 0;
      while (text[i + run] === '\\') run++;
      if (!text.startsWith('{{', i + run)) {
        value += text.slice(i, i + run);
        i += run;
        continue;
      }
      value += '\\'.repeat(Math.floor(run / 2));
      i += run;
      if (run % 2 === 1) {
        value += '{{';
        i += 2;
        continue;
      }
    }
    if (text.startsWith('{{', i)) {
      const token = readToken(text, i + 2);
      if (token) {
        flush(i);
        segments.push({
          kind: 'token',
          path: token.path,
          filters: token.filters,
          raw: text.slice(i, token.end),
        });
        i = token.end;
        rawStart = i;
        continue;
      }
      // Not a token: keep one brace and look again from the next one.
      value += '{';
      i += 1;
      continue;
    }
    value += text[i];
    i += 1;
  }
  flush(text.length);
  return segments;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The canonical text of a token: `{{ path | name: arg }}`. */
export function formatToken(token: Pick<TokenSegment, 'path' | 'filters'>): string {
  const filters = token.filters
    .map((filter) => {
      if (filter.arg === undefined) return ` | ${filter.name}`;
      const arg = typeof filter.arg === 'number' ? String(filter.arg) : quote(filter.arg);
      return ` | ${filter.name}: ${arg}`;
    })
    .join('');
  return `{{ ${token.path}${filters} }}`;
}

/** Escapes text so it reads back as itself, given what comes after it. */
function escapeText(value: string, beforeToken: boolean): string {
  const escaped = value.replace(/(\\*)\{\{/g, (_match, run: string) => `${run}${run}\\{{`);
  return beforeToken ? escaped.replace(/(\\+)$/, '$1$1') : escaped;
}

/** Adjacent text pieces joined, empty ones dropped: what a parse would give. */
function normalise(segments: readonly Segment[]): Segment[] {
  const result: Segment[] = [];
  for (const segment of segments) {
    if (segment.kind === 'text') {
      if (segment.value === '' && !segment.raw) continue;
      const last = result.at(-1);
      if (last?.kind === 'text') {
        result[result.length - 1] = { kind: 'text', value: last.value + segment.value };
        continue;
      }
    }
    result.push(segment);
  }
  return result;
}

function sameFilters(a: readonly TokenFilter[], b: readonly TokenFilter[]): boolean {
  return a.length === b.length && a.every((f, i) => f.name === b[i].name && f.arg === b[i].arg);
}

/** True when `parseTemplate(text)` gives exactly these segments (ignoring `raw`). */
export function sameSegments(a: readonly Segment[], b: readonly Segment[]): boolean {
  const left = normalise(a).filter((s) => s.kind === 'token' || s.value !== '');
  const right = normalise(b).filter((s) => s.kind === 'token' || s.value !== '');
  return (
    left.length === right.length &&
    left.every((segment, i) => {
      const other = right[i];
      if (segment.kind === 'text') return other.kind === 'text' && other.value === segment.value;
      return (
        other.kind === 'token' &&
        other.path === segment.path &&
        sameFilters(other.filters, segment.filters)
      );
    })
  );
}

/**
 * The text for a list of segments: the inverse of `parseTemplate`. Uses
 * each segment's `raw` when the result reads back the same, and the
 * escaped form otherwise, so an edited chip list is always stored safely.
 */
export function serializeSegments(segments: readonly Segment[]): string {
  const fromRaw = segments
    .map((segment) =>
      segment.raw !== undefined
        ? segment.raw
        : segment.kind === 'token'
          ? formatToken(segment)
          : undefined,
    )
    .join('');
  const allRaw = segments.every((segment) => segment.raw !== undefined || segment.kind === 'token');
  if (allRaw && sameSegments(parseTemplate(fromRaw), segments)) return fromRaw;

  const clean = normalise(segments);
  return clean
    .map((segment, i) =>
      segment.kind === 'token'
        ? formatToken(segment)
        : escapeText(segment.value, clean[i + 1]?.kind === 'token'),
    )
    .join('');
}

/** The tokens in a field, in order. */
export function tokensIn(text: string): TokenSegment[] {
  if (!text.includes('{{')) return [];
  return parseTemplate(text).filter((segment): segment is TokenSegment => segment.kind === 'token');
}

/**
 * The token when a field is one token and nothing else (spaces around it
 * are ignored), so its value keeps its type: a number stays a number, a
 * list stays a list.
 */
export function singleToken(segments: readonly Segment[]): TokenSegment | undefined {
  const tokens = segments.filter((segment) => segment.kind === 'token');
  if (tokens.length !== 1) return undefined;
  const textOnlySpaces = segments.every(
    (segment) => segment.kind === 'token' || segment.value.trim() === '',
  );
  return textOnlySpaces ? (tokens[0] as TokenSegment) : undefined;
}

/** A token path's parts: its source and the field inside that source's data. */
export interface TokenSource {
  root: string;
  /** `nodes` only: the step key. */
  nodeKey?: string;
  /** The field path inside the source's data (`post.url`); empty for the whole thing. */
  field: string;
  /** False when a `nodes` path does not read `nodes.<key>.output...`. */
  wellFormed: boolean;
}

export function tokenSource(path: string): TokenSource {
  const parts = path.split('.');
  const [root] = parts;
  if (root !== 'nodes') return { root, field: parts.slice(1).join('.'), wellFormed: true };
  return {
    root,
    nodeKey: parts[1],
    field: parts.slice(3).join('.'),
    wellFormed: parts.length >= 3 && parts[2] === 'output',
  };
}

/** `{{ nodes.<key>.output.<field> }}` for Insert Data. */
export function nodeTokenPath(nodeKey: string, field = ''): string {
  return field ? `nodes.${nodeKey}.output.${field}` : `nodes.${nodeKey}.output`;
}
