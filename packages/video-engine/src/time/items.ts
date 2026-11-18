/**
 * The edits on texts, stickers and sounds: add one (on the first track with
 * room), change one, set when it shows (From, For, On This Moment or Whole
 * Clip), duplicate one (Ctrl+D) and remove one (Delete).
 *
 * Like the edits in `edits.ts`, each takes a document and returns a new one
 * (the input is never changed), or a refusal code. None moves video, so none
 * runs the `anchor` rule: every other item stays exactly where it is.
 * Dragging an item on the timeline is in `timeline/gestures.ts`, which reads
 * `anchorAfterRetime` from here.
 */
import { newId } from '../document/create';
import { ITEM_MIN_MS, MAX_ITEMS, MAX_TRACKS } from '../document/limits';
import type {
  Anchor,
  AudioTrack,
  ClipDocument,
  OverlayItem,
  OverlayTrack,
  TimedItem,
  Track,
} from '../document/schema';
import { outputDuration } from './time-map';

/** Why an item edit was refused. */
export type ItemRefusalCode =
  /** No text, sticker or sound has that id. */
  | 'item_not_found'
  /** The clip already holds `MAX_ITEMS`. */
  | 'too_many_items'
  /** Every track is busy at that time and the clip already has `MAX_TRACKS` tracks. */
  | 'too_many_tracks';

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
export function usedIds(doc: ClipDocument): Set<string> {
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

/** The id prefix each kind of item gets (`txt_3f9a...`). */
const ID_PREFIX: Readonly<Record<TimedItem['type'], string>> = {
  text: 'txt',
  sticker: 'stk',
  sfx: 'snd',
  music: 'mus',
};

/** Whether `[start, end)` is free of every item on the track. */
function trackHasRoom(items: readonly TimedItem[], start: number, end: number): boolean {
  return items.every((other) => other.start + other.duration <= start || other.start >= end);
}

/** The item's time window kept inside a clip of `total` ms (never shorter than `ITEM_MIN_MS`). */
function fitWindow(start: number, duration: number, total: number): { start: number; duration: number } {
  const length = Math.max(Math.min(ITEM_MIN_MS, total), Math.min(Math.round(duration), total));
  const from = Math.min(Math.max(0, Math.round(start)), Math.max(0, total - length));
  return { start: from, duration: length };
}

/**
 * Adds a text, sticker or sound. Texts and stickers go on the first overlay
 * track with room at their time, sounds on the first sound track with room;
 * when none has room, a new track of that kind is added on top (drawn and
 * heard above the others). The item gets a fresh id of its kind (the `id`
 * it carries is ignored) and is kept inside the clip.
 */
export function addItem(doc: ClipDocument, item: TimedItem): ItemEditResult {
  if (countItems(doc) >= MAX_ITEMS) {
    return { ok: false, code: 'too_many_items' };
  }
  const total = outputDuration(doc);
  const window = fitWindow(item.start, item.duration, total);
  const id = freshId(doc, `${ID_PREFIX[item.type]}_`);
  const placed = { ...item, ...window, id } as TimedItem;
  const kind: 'overlay' | 'audio' = item.type === 'text' || item.type === 'sticker' ? 'overlay' : 'audio';
  const end = window.start + window.duration;

  const trackIndex = doc.tracks.findIndex(
    (track) =>
      track.kind === kind && trackHasRoom(track.items as TimedItem[], window.start, end),
  );
  if (trackIndex >= 0) {
    const track = doc.tracks[trackIndex] as OverlayTrack | AudioTrack;
    const items = (track.items as TimedItem[]).slice();
    const at = items.findIndex((other) => other.start > window.start);
    items.splice(at < 0 ? items.length : at, 0, placed);
    return { ok: true, doc: withTrackItems(doc, trackIndex, items), itemId: id };
  }
  if (doc.tracks.length >= MAX_TRACKS) {
    return { ok: false, code: 'too_many_tracks' };
  }
  const trackId = freshId(doc, 'trk_');
  const track: Track =
    kind === 'overlay'
      ? { id: trackId, kind: 'overlay', items: [placed as OverlayItem] }
      : { id: trackId, kind: 'audio', items: [placed as AudioTrack['items'][number]] };
  // A fresh track id may clash with the item id just made: both are random, so check once more.
  if (trackId === id) {
    return addItem(doc, item);
  }
  return { ok: true, doc: { ...doc, tracks: [...doc.tracks, track] }, itemId: id };
}

/**
 * Changes one item through `change`, which gets the item and returns its new
 * version (it may not change the id or the kind). Returns the same document
 * when nothing changed.
 */
export function updateItem<T extends TimedItem>(
  doc: ClipDocument,
  itemId: string,
  change: (item: T) => T,
): ItemEditResult {
  const found = findItem(doc, itemId);
  if (!found) {
    return { ok: false, code: 'item_not_found' };
  }
  const next = change(found.item as T);
  if (next === found.item) {
    return { ok: true, doc };
  }
  const kept = { ...next, id: found.item.id, type: found.item.type } as TimedItem;
  return { ok: true, doc: replaceItem(doc, found, kept) };
}

/**
 * Whether an item covers the whole clip on the clip's own clock: **Whole
 * Clip** in the Text, Elements and Audio panels.
 */
export function isWholeClip(item: Pick<TimedItem, 'anchor' | 'start' | 'duration'>, total: number): boolean {
  return item.anchor === 'clip' && item.start === 0 && item.duration === total;
}

/**
 * The anchor an overlay keeps after it is moved or resized to `start` and
 * `duration`. A text or sticker on the clip's clock is always a Whole Clip
 * one, so once it no longer covers the clip it goes back on its moment.
 * Sounds keep their anchor (music sits on the clip's clock at any length).
 */
export function anchorAfterRetime(
  item: Pick<TimedItem, 'type' | 'anchor'>,
  start: number,
  duration: number,
  total: number,
): Anchor {
  const overlay = item.type === 'text' || item.type === 'sticker';
  if (overlay && item.anchor === 'clip' && !(start === 0 && duration === total)) {
    return 'moment';
  }
  return item.anchor;
}

/**
 * Sets when an item shows (the From and For fields): kept inside the clip,
 * never shorter than `ITEM_MIN_MS`. A Whole Clip text set to a shorter time
 * goes back on its moment.
 */
export function setItemTiming(
  doc: ClipDocument,
  itemId: string,
  start: number,
  duration: number,
): ItemEditResult {
  if (!Number.isFinite(start) || !Number.isFinite(duration)) {
    return { ok: true, doc };
  }
  const total = outputDuration(doc);
  return updateItem(doc, itemId, (item: TimedItem) => {
    const window = fitWindow(start, duration, total);
    const anchor = anchorAfterRetime(item, window.start, window.duration, total);
    if (item.start === window.start && item.duration === window.duration && item.anchor === anchor) {
      return item;
    }
    return { ...item, ...window, anchor } as TimedItem;
  });
}

/**
 * **On This Moment** or **Whole Clip**. Whole Clip puts the item on the
 * clip's clock from 0 for the clip's whole length, and `replaceItems` keeps
 * it stretched when the clip's length changes. On This Moment keeps its
 * time and puts it back on the video's moment.
 */
export function setItemAnchor(
  doc: ClipDocument,
  itemId: string,
  choice: 'moment' | 'whole',
): ItemEditResult {
  const total = outputDuration(doc);
  return updateItem(doc, itemId, (item: TimedItem) => {
    if (choice === 'whole') {
      return isWholeClip(item, total)
        ? item
        : ({ ...item, anchor: 'clip', start: 0, duration: total } as TimedItem);
    }
    return item.anchor === 'moment' ? item : ({ ...item, anchor: 'moment' } as TimedItem);
  });
}
