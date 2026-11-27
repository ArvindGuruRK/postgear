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
 * - `cameraOnOpen` (Module 10): `true` on a clip a recipe gave a Split or
 *   Gameplay layout with a Camera area. The editor runs Detect Camera the
 *   first time the clip opens; the first document save ends it like the
 *   follow mark (`withoutFollowOnOpen` takes both away).
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
  /** Module 10: the editor finds the camera box when the clip first opens. */
  cameraOnOpen?: true;
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
  if (value.cameraOnOpen === true) view.cameraOnOpen = true;
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

/** Module 10: true when the stored meta asks the editor to find the camera box on open. */
export function camerasOnOpen(raw: unknown): boolean {
  return record(raw)?.cameraOnOpen === true;
}

/** Module 10: the stored meta with the camera mark added, every other key kept. */
export function withCameraOnOpen(raw: unknown): Prisma.InputJsonValue {
  return { ...(record(raw) ?? {}), cameraOnOpen: true } as Prisma.InputJsonValue;
}

/** True when the stored meta carries a first-open mark (follow, or the camera). */
export function hasOpenMarks(raw: unknown): boolean {
  return followsOnOpen(raw) || camerasOnOpen(raw);
}

/**
 * The stored meta without the first-open marks (follow and, Module 10, the
 * camera): the other keys kept, or no meta at all when none is left.
 */
export function withoutFollowOnOpen(raw: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const { followOnOpen: _gone, cameraOnOpen: _camera, ...rest } = record(raw) ?? {};
  return Object.keys(rest).length > 0 ? (rest as Prisma.InputJsonValue) : Prisma.DbNull;
}

/** `withoutFollowOnOpen` by the name that says what it does since Module 10. */
export const withoutOpenMarks = withoutFollowOnOpen;
