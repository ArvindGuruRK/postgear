/**
 * What a layout draws behind its areas.
 *
 * Kept apart from the presets and the edits because `frameState` reads it
 * and the edits read `frameState`'s crop rules: a file of its own keeps the
 * imports one way.
 */
import type { ClipLayout, LayoutBase, LayoutKind } from '../document/schema';

/** The kinds whose base is a blurred copy of the video when the layout does not say. */
const BLURRED_KINDS: ReadonlySet<LayoutKind> = new Set<LayoutKind>(['blurred', 'screen_share']);

/** The base a kind has by default: Blurred and Screen Share are blurred, the rest solid. */
export function defaultBaseFor(kind: LayoutKind): LayoutBase {
  return BLURRED_KINDS.has(kind) ? 'blurred' : 'solid';
}

/** The base a layout really has: its own `base`, or its kind's default. */
export function layoutBase(layout: Pick<ClipLayout, 'kind' | 'base'>): LayoutBase {
  return layout.base ?? defaultBaseFor(layout.kind);
}
