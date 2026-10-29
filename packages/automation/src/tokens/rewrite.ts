/**
 * Moving data chips to new step keys, for templates and Duplicate: every
 * copy of a workflow gets fresh keys, and its chips must follow them.
 */
import { parseTemplate, type Segment, serializeSegments, tokenSource } from './parse';

/** Rewrites `{{ nodes.<old>.output... }}` to the new key in one field's text. */
export function renameNodesInText(text: string, keys: ReadonlyMap<string, string>): string {
  if (!text.includes('{{')) return text;
  let changed = false;
  const segments = parseTemplate(text).map((segment): Segment => {
    if (segment.kind !== 'token') return segment;
    const source = tokenSource(segment.path);
    const next = source.root === 'nodes' && source.nodeKey ? keys.get(source.nodeKey) : undefined;
    if (!next) return segment;
    changed = true;
    const parts = segment.path.split('.');
    parts[1] = next;
    return { kind: 'token', path: parts.join('.'), filters: segment.filters };
  });
  return changed ? serializeSegments(segments) : text;
}

/** The same, for every string in a step's config. Returns a new object. */
export function renameNodesInConfig<T>(config: T, keys: ReadonlyMap<string, string>): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return renameNodesInText(value, keys);
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    }
    return value;
  };
  return walk(config) as T;
}
