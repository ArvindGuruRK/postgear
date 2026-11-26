/**
 * `Clip.meta` (nullable JSON, Sprint 13): small notes about a clip that are
 * not part of its document.
 *
 * - `seen` (Module 06): the still check's one sentence about an action clip.
 * - `followOnOpen` (Module 08): `'speaker'` on every clip a Find Clips run
 *   made with Follow The Speaker on. The editor turns following on the first
 *   time the clip opens (one writer of the document: the editor), and the
 *   API takes the mark away on the clip's first document save, so a person
 *   who turns it off is never overridden on the next open.
 *
 * Only these keys reach a view, each checked; anything else stored is kept
 * as it is but never shown.
 */
import { Prisma } from '@postgear/db';

export const FOLLOW_ON_OPEN = 'speaker' as const;

/** What a clip view carries of `Clip.meta`. */
export interface ClipMetaView {
  /** Module 06: what AI saw on screen (one sentence). */
  seen?: string;
  /** Module 08: the editor follows the speaker when the clip first opens. */
  followOnOpen?: typeof FOLLOW_ON_OPEN;
}

function record(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** The view of a stored meta: the known keys that read, or null when none does. */
export function clipMetaView(raw: unknown): ClipMetaView | null {
  const value = record(raw);
  if (!value) return null;
  const view: ClipMetaView = {};
  if (typeof value.seen === 'string' && value.seen.trim())
    view.seen = value.seen.trim().slice(0, 200);
  if (value.followOnOpen === FOLLOW_ON_OPEN) view.followOnOpen = FOLLOW_ON_OPEN;
  return Object.keys(view).length > 0 ? view : null;
}

/** True when the stored meta asks the editor to follow on open. */
export function followsOnOpen(raw: unknown): boolean {
  return record(raw)?.followOnOpen === FOLLOW_ON_OPEN;
}

/** The stored meta with the follow mark added, every other key kept. */
export function withFollowOnOpen(raw: unknown): Prisma.InputJsonValue {
  return { ...(record(raw) ?? {}), followOnOpen: FOLLOW_ON_OPEN } as Prisma.InputJsonValue;
}

/** The stored meta without the follow mark: the other keys kept, or no meta at all when none is left. */
export function withoutFollowOnOpen(raw: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const { followOnOpen: _gone, ...rest } = record(raw) ?? {};
  return Object.keys(rest).length > 0 ? (rest as Prisma.InputJsonValue) : Prisma.DbNull;
}
