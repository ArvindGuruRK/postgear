/**
 * Plain words for token paths: the fixed run and workspace data, and a
 * readable fallback when no step declares the field.
 */
import type { OutputField } from '../catalog/types';
import { tokenSource } from './parse';

/** `{{ run.* }}`. */
export const RUN_FIELDS: readonly OutputField[] = [
  { path: 'id', label: 'Run Id', type: 'text', sample: 'run_5h2k9q' },
  { path: 'startedAt', label: 'Run Started At', type: 'date', sample: '2026-11-03T09:00:00.000Z' },
  { path: 'mode', label: 'Run Type', type: 'text', sample: 'test' },
];

/** `{{ workspace.* }}`. Kept small on purpose: nothing private. */
export const WORKSPACE_FIELDS: readonly OutputField[] = [
  { path: 'name', label: 'Workspace Name', type: 'text', sample: 'Bloom Bakery' },
];

/** `publishedAt` is "Published At", `post_url` is "Post Url". */
export function humanise(part: string): string {
  return part
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A label made from the path alone, for summaries that have no graph to
 * look the field up in: `trigger.post.channel.name` is "Post Channel Name".
 */
export function fallbackLabel(path: string): string {
  const source = tokenSource(path);
  const words = source.field
    .split('.')
    .filter((part) => part && !/^\d+$/.test(part))
    .map(humanise);
  if (words.length) return words.join(' ');
  if (source.root === 'nodes') return 'Step Data';
  return humanise(source.root);
}
