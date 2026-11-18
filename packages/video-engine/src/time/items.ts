/**
 * The edits on texts, stickers and sounds that the timeline's keys need:
 * duplicate one (Ctrl+D) and remove one (Delete).
 *
 * Like the edits in `edits.ts`, each takes a document and returns a new one
 * (the input is never changed), or a refusal code. Neither moves video, so
 * neither runs the `anchor` rule: every other item stays exactly where it is.
 * Moving and resizing an item are drags, in `timeline/gestures.ts`.
 */
import { newId } from '../document/create';
import { MAX_ITEMS } from '../document/limits';
import type { ClipDocument, TimedItem, Track } from '../document/schema';
import { outputDuration } from './time-map';

/** Why an item edit was refused. */
export type ItemRefusalCode =
  /** No text, sticker or sound has that id. */
  | 'item_not_found'
  /** The clip already holds `MAX_ITEMS`. */
  | 'too_many_items';

export type ItemEditResult =
  | {
      ok: true;
      doc: ClipDocument;
      /** The new item's id, on a duplicate. */
      itemId?: string;
    }
  | { ok: false; code: ItemRefusalCode };

/** Where an item is: its track's index and its own index in that track. */
export interface ItemLocation {
  trackIndex: number;
  itemIndex: number;
  item: TimedItem;
}

/** Finds a text, sticker or sound by id, or null. */
export function findItem(doc: ClipDocument, itemId: string): ItemLocation | null {
  for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex += 1) {
    const track = doc.tracks[trackIndex] as Track;
    if (track.kind === 'captions') {
      continue;
    }
    const itemIndex = (track.items as TimedItem[]).findIndex((item) => item.id === itemId);
    if (itemIndex >= 0) {
      return { trackIndex, itemIndex, item: track.items[itemIndex] as TimedItem };
    }
  }
  return null;
}

/** How many texts, stickers and sounds the clip holds. */
export function countItems(doc: ClipDocument): number {
  let count = 0;
  for (const track of doc.tracks) {
    if (track.kind !== 'captions') {
      count += track.items.length;
    }
  }
  return count;
}

/** Every id the document uses, so a new one never clashes. */
function usedIds(doc: ClipDocument): Set<string> {
  const ids = new Set<string>();
  for (const source of doc.sources) ids.add(source.id);
  for (const segment of doc.segments) ids.add(segment.id);
  for (const area of doc.layout.areas) ids.add(area.id);
  for (const zoom of doc.zooms) ids.add(zoom.id);
  for (const track of doc.tracks) {
    ids.add(track.id);
    if (track.kind !== 'captions') {
      for (const item of track.items) ids.add(item.id);
    }
  }
  return ids;
}

/** A new id with the same prefix as `like` (`txt_3f9a...` gives `txt_...`), unused in the document. */
function freshId(doc: ClipDocument, like: string): string {
  const match = /^([A-Za-z0-9]{1,16})_/.exec(like);
  const prefix = match ? match[1] : 'item';
  const taken = usedIds(doc);
  let id = newId(prefix);
  while (taken.has(id)) {
    id = newId(prefix);
  }
  return id;
}

/** A copy of `tracks` with one track's items replaced. */
function withTrackItems(doc: ClipDocument, trackIndex: number, items: TimedItem[]): ClipDocument {
  const tracks = doc.tracks.map((track, i) =>
    i === trackIndex && track.kind !== 'captions' ? ({ ...track, items } as Track) : track,
  );
  return { ...doc, tracks };
}

/**
 * Copies an item to just after itself on the same track, with a new id and
 * everything else the same. When it does not fit after the original, it
 * ends with the clip instead (overlapping the original, which the timeline
 * shows on a second row). Refused past `MAX_ITEMS`.
 */
export function duplicateItem(doc: ClipDocument, itemId: string): ItemEditResult {
  const found = findItem(doc, itemId);
  if (!found) {
    return { ok: false, code: 'item_not_found' };
  }
  if (countItems(doc) >= MAX_ITEMS) {
    return { ok: false, code: 'too_many_items' };
  }
  const { item, trackIndex, itemIndex } = found;
  const total = outputDuration(doc);
  const duration = Math.min(item.duration, total);
  const after = item.start + item.duration;
  const start = after + duration <= total ? after : Math.max(0, total - duration);
  const id = freshId(doc, item.id);
  const copy = { ...item, id, start, duration } as TimedItem;
  const track = doc.tracks[trackIndex] as Exclude<Track, { kind: 'captions' }>;
  const items = (track.items as TimedItem[]).slice();
  items.splice(itemIndex + 1, 0, copy);
  return { ok: true, doc: withTrackItems(doc, trackIndex, items), itemId: id };
}

/** Removes a text, sticker or sound. Nothing else moves. */
export function removeItem(doc: ClipDocument, itemId: string): ItemEditResult {
  const found = findItem(doc, itemId);
  if (!found) {
    return { ok: false, code: 'item_not_found' };
  }
  const track = doc.tracks[found.trackIndex] as Exclude<Track, { kind: 'captions' }>;
  const items = (track.items as TimedItem[]).filter((_, i) => i !== found.itemIndex);
  return { ok: true, doc: withTrackItems(doc, found.trackIndex, items) };
}

/** A copy of the document with one item replaced (same track, same place). */
export function replaceItem(
  doc: ClipDocument,
  location: ItemLocation,
  next: TimedItem,
): ClipDocument {
  const track = doc.tracks[location.trackIndex] as Exclude<Track, { kind: 'captions' }>;
  const items = (track.items as TimedItem[]).slice();
  items[location.itemIndex] = next;
  return withTrackItems(doc, location.trackIndex, items);
}
