/**
 * Run data made safe to store and show. Used by the worker before it
 * writes any step's input or output, and by the API again before it
 * returns a run (defence in depth).
 *
 * - A field whose name says secret (`password`, `apiKey`, `Authorization`)
 *   becomes "[hidden]", unless it is a number or yes/no (`maxTokens: 500`).
 *   A `{ name, value }` pair counts by its name (HTTP headers).
 * - Text that is, or contains, a connection's own value (a webhook link,
 *   an access token) becomes "[hidden]" as a whole.
 * - Text shaped like a secret (a bearer token, a Slack webhook link, an
 *   `sk-` key) has that part replaced; a link with a secret in its query
 *   string keeps only its scheme and host.
 * - The result is capped at 64 KB of JSON: long text is cut first with
 *   "... (cut, 812 KB in total)", then long lists.
 */
import { LIMITS } from '../limits';
import { isSecretKey, SECRET_VALUE_PATTERNS, secretLinks } from './patterns';

export const HIDDEN = '[hidden]';

/** Connection values shorter than this are not matched inside text (too many false hits). */
const MIN_CONNECTION_VALUE = 8;

export interface RedactOptions {
  /** Every secret value of the connections the run used. */
  connectionValues?: readonly string[];
  /** Defaults to `LIMITS.stepIoCapBytes` (64 KB). */
  capBytes?: number;
}

export interface Redacted {
  value: unknown;
  /** True when something was cut to fit the cap: set `truncated` on the step. */
  truncated: boolean;
  /** How many values were hidden. */
  hidden: number;
}

const GLOBAL_PATTERNS = SECRET_VALUE_PATTERNS.map(
  ({ pattern }) => new RegExp(pattern.source, `${pattern.flags}g`),
);

/** UTF-8 length without `TextEncoder`. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function jsonBytes(value: unknown): number {
  try {
    return utf8Bytes(JSON.stringify(value) ?? '');
  } catch {
    return 0;
  }
}

function hideSecrets(value: unknown, options: RedactOptions): { value: unknown; hidden: number } {
  const known = (options.connectionValues ?? []).filter(
    (secret) => typeof secret === 'string' && secret.length >= MIN_CONNECTION_VALUE,
  );
  let hidden = 0;
  const seen = new WeakSet<object>();

  const text = (input: string): string => {
    if (known.some((secret) => input.includes(secret))) {
      hidden++;
      return HIDDEN;
    }
    let output = input;
    for (const pattern of GLOBAL_PATTERNS) {
      output = output.replace(pattern, () => {
        hidden++;
        return HIDDEN;
      });
    }
    for (const { link, origin } of secretLinks(output)) {
      hidden++;
      output = output.split(link).join(`${origin}/${HIDDEN}`);
    }
    return output;
  };

  const hide = (input: unknown): unknown => {
    if (input === null || input === undefined || input === '') return input;
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    hidden++;
    return HIDDEN;
  };

  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return text(input);
    if (typeof input === 'bigint') return String(input);
    if (typeof input !== 'object' || input === null) {
      return typeof input === 'function' || typeof input === 'symbol' ? undefined : input;
    }
    if (input instanceof Date) {
      return Number.isFinite(input.getTime()) ? input.toISOString() : null;
    }
    if (seen.has(input)) return '[circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map((item) => walk(item) ?? null);

    const record = input as Record<string, unknown>;
    const pairName = typeof record.name === 'string' && 'value' in record ? record.name : undefined;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      const secret = isSecretKey(key) || (key === 'value' && pairName && isSecretKey(pairName));
      const next = secret ? hide(item) : walk(item);
      if (next !== undefined) result[key] = next;
    }
    seen.delete(input);
    return result;
  };

  return { value: walk(value), hidden };
}

function cutNote(bytes: number): string {
  return `... (cut, ${Math.max(1, Math.round(bytes / 1024))} KB in total)`;
}

function cutStrings(value: unknown, limit: number): unknown {
  if (typeof value === 'string') {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}${cutNote(utf8Bytes(value))}`;
  }
  if (Array.isArray(value)) return value.map((item) => cutStrings(item, limit));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cutStrings(item, limit)]),
    );
  }
  return value;
}

function cutLists(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) {
    const kept = value.slice(0, limit).map((item) => cutLists(item, limit));
    return value.length > limit ? [...kept, `... (cut, ${value.length - limit} more items)`] : kept;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cutLists(item, limit)]),
    );
  }
  return value;
}

/** Hides secrets, then caps the size. Never throws; the input is not changed. */
export function redact(value: unknown, options: RedactOptions = {}): Redacted {
  const cap = options.capBytes ?? LIMITS.stepIoCapBytes;
  const { value: safe, hidden } = hideSecrets(value, options);
  const total = jsonBytes(safe);
  if (total <= cap) return { value: safe, truncated: false, hidden };

  let current = safe;
  for (const limit of [16_384, 4_096, 1_024, 256, 64]) {
    current = cutStrings(current, limit);
    if (jsonBytes(current) <= cap) return { value: current, truncated: true, hidden };
  }
  for (const limit of [100, 20, 5]) {
    current = cutLists(current, limit);
    if (jsonBytes(current) <= cap) return { value: current, truncated: true, hidden };
  }
  return { value: cutNote(total), truncated: true, hidden };
}
