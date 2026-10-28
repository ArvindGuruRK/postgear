/**
 * Small pieces the category files share: config field schemas and the
 * wording helpers summaries use. Summaries here are short and literal;
 * Module 02 swaps in the full sentences (schedules, conditions).
 */
import { z } from 'zod';
import type { OutputField, PortSpec, SummaryContext } from './types';

/** The single output most steps have. */
export const OUT: readonly PortSpec[] = [{ id: 'out', label: 'Out' }];

/** True for an empty string (after trimming), an empty list, null or undefined. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** A text field that may hold data tokens. Empty is allowed so defaults parse. */
export function templateField(max = 5_000) {
  return z.string().max(max);
}

/** Workspace channel ids. */
export function channelIdsField(max: number) {
  return z.array(z.string().min(1).max(64)).max(max);
}

/** The id of a saved connection; empty until the user picks one. */
export const connectionIdField = z.string().max(64);

/** "a TikTok", "an Instagram". */
export function withArticle(word: string): string {
  return `${/^[AEIOUaeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

/** "1 channel", "3 channels". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Names for ids where the context knows them: "Bloom Bakery, Acme +2". */
export function channelNames(ids: readonly string[], ctx: SummaryContext): string {
  const names = ids.map((id) => ctx.channels?.find((channel) => channel.id === id)?.name);
  if (names.some((name) => !name)) return count(ids.length, 'channel');
  const shown = names.slice(0, 2).join(', ');
  return ids.length > 2 ? `${shown} +${ids.length - 2}` : shown;
}

export function connectionName(id: string, ctx: SummaryContext): string | undefined {
  return ctx.connections?.find((connection) => connection.id === id)?.name;
}

/** The output fields a channel object adds under `prefix`. */
export function channelFields(prefix: string, label: string): OutputField[] {
  return [
    { path: prefix, label, type: 'object' },
    { path: `${prefix}.id`, label: `${label} Id`, type: 'text', sample: 'ch_8f2k1' },
    { path: `${prefix}.name`, label: `${label} Name`, type: 'text', sample: 'Bloom Bakery' },
    { path: `${prefix}.provider`, label: 'Platform', type: 'text', sample: 'instagram' },
  ];
}
