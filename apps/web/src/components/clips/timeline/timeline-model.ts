/**
 * The editing timeline's pure side (Sprint 12, Module 09): what the dock
 * draws and what its buttons and keys do, as plain functions over the clip
 * document, so every rule is tested without a browser.
 *
 * - **Rows** (blueprint section 7): Video (the parts), then Overlay, Zoom and
 *   Sound. Things that overlap in time on one row go to a second row of the
 *   same kind ("Overlay 2"), so no bar ever hides another. A row with nothing
 *   on it still shows, slim, so people learn where things go.
 * - **Hatching**: the part of a bar that uses video we do not hold in sharp
 *   quality, at either end.
 * - **Words**: what a screen reader hears for a bar ("Part 2, from 12
 *   seconds, 8 seconds long") and the sentences for a refused split or delete.
 * - **Edits** the dock and the keys share: delete the selection, nudge an
 *   item, split at the playhead, and where the playhead goes while an edge is
 *   dragged.
 */
import {
  type ClipDocument,
  documentRange,
  dragMoveItem,
  type EditRefusalCode,
  type ItemRefusalCode,
  MAX_ITEMS,
  MAX_SEGMENTS,
  placeSegments,
  removeHook,
  removeItem,
  removeSegment,
  SEGMENT_MIN_MS,
  type Segment,
  type SourceRange,
  splitAt,
  type TimedItem,
  type Zoom,
  zoomWindows,
} from '@postgear/video-engine';
import type { EditorSelection, EditorTab } from '../editor/editor-state';
import { TOO_MANY_SOUNDS } from '../panels/audio-model';
import { TOO_MANY_STICKERS } from '../panels/elements-model';

// ---------------------------------------------------------------------------
// Spoken words
// ---------------------------------------------------------------------------

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * A length or a moment as a screen reader says it: "0 seconds", "4.5
 * seconds", "1 minute 4 seconds", "1 hour 2 minutes". Tenths only under a
 * minute, where they matter.
 */
export function spokenTime(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safe < 60_000) {
    const tenths = Math.round(safe / 100) / 10;
    if (tenths < 60) {
      return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)} ${tenths === 1 ? 'second' : 'seconds'}`;
    }
  }
  const totalSeconds = Math.round(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const words: string[] = [];
  if (hours > 0) words.push(plural(hours, 'hour'));
  if (minutes > 0) words.push(plural(minutes, 'minute'));
  if (seconds > 0 && hours === 0) words.push(plural(seconds, 'second'));
  return words.length > 0 ? words.join(' ') : '0 seconds';
}

/** "Part 2, from 12 seconds, 8 seconds long", with ", 2x speed" when it is not 1x. */
export function partLabel(index: number, outStart: number, outEnd: number, speed: number): string {
  const words = [
    `Part ${index + 1}`,
    `from ${spokenTime(outStart)}`,
    `${spokenTime(outEnd - outStart)} long`,
  ];
  if (speed !== 1) words.push(`${speed}x speed`);
  return words.join(', ');
}

/** A hook part's spoken name (Module 09): "Hook, from 0 seconds, 2.5 seconds long". */
export function hookPartLabel(outStart: number, outEnd: number): string {
  return `Hook, from ${spokenTime(outStart)}, ${spokenTime(outEnd - outStart)} long`;
}

/** Whether a part is the clip's hook (Module 09: played first, removed whole). */
export function isHookPart(segment: Pick<Segment, 'role'>): boolean {
  return segment.role === 'hook';
}

/**
 * Whether a part is a brand kit's intro or outro (Module 10): another video,
 * played before or after the clip. It is switched on and off in the Layouts
 * tab, so the timeline does not trim, split or remove it.
 */
export function isBrandPart(segment: Pick<Segment, 'role'>): boolean {
  return segment.role === 'intro' || segment.role === 'outro';
}

/** The chip on a brand part's bar: "Intro" or "Outro". */
export function brandPartName(segment: Pick<Segment, 'role'>): 'Intro' | 'Outro' | null {
  return segment.role === 'intro' ? 'Intro' : segment.role === 'outro' ? 'Outro' : null;
}

/** A brand part's spoken name (Module 10): "Intro, from 0 seconds, 3 seconds long". */
export function brandPartLabel(name: 'Intro' | 'Outro', outStart: number, outEnd: number): string {
  return `${name}, from ${spokenTime(outStart)}, ${spokenTime(outEnd - outStart)} long`;
}

/** An ordinary part: not a hook, an intro or an outro. */
function isMainPart(segment: Pick<Segment, 'role'>): boolean {
  return segment.role === undefined;
}

/** What an item is called on its bar: the text itself, or its kind. */
export function itemName(item: TimedItem): string {
  switch (item.type) {
    case 'text':
      return item.text.replace(/\s+/g, ' ').trim();
    case 'sticker':
      return 'badge' in item.ref ? 'Follow Badge' : 'Sticker';
    case 'sfx':
      return 'Sound Effect';
    case 'music':
      return 'Music';
  }
}

/** "Text, HE REALLY DID THAT, from 4 seconds, 3 seconds long". */
export function itemLabel(item: TimedItem): string {
  const kind = item.type === 'text' ? `Text, ${itemName(item)}` : itemName(item);
  return `${kind}, from ${spokenTime(item.start)}, ${spokenTime(item.duration)} long`;
}

/** A zoom's bar name: "Zoom 1.5x". */
export function zoomName(zoom: Zoom): string {
  return `Zoom ${Math.round(zoom.scale * 100) / 100}x`;
}

/** "Zoom 1.5x, from 4 seconds, 3 seconds long". */
export function zoomLabel(zoom: Zoom, startMs: number, endMs: number): string {
  return `${zoomName(zoom)}, from ${spokenTime(startMs)}, ${spokenTime(endMs - startMs)} long`;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type TimelineRowKind = 'overlay' | 'zoom' | 'sound';

export interface TimelineBarModel {
  /** Unique on the timeline (a zoom across a cut draws one bar per piece). */
  key: string;
  selection: NonNullable<EditorSelection>;
  /** Output time. */
  startMs: number;
  endMs: number;
  /** The words on the bar. */
  name: string;
  /** What a screen reader hears. */
  label: string;
  /** Texts, stickers, sounds and zooms move and resize. */
  movable: boolean;
  /** A zoom's window: 0, or 1 and on for the pieces after a cut. */
  piece?: number;
}

export interface TimelineRowModel {
  key: string;
  kind: TimelineRowKind;
  /** "Overlay", "Overlay 2", "Zoom", "Sound". */
  label: string;
  bars: TimelineBarModel[];
}

const ROW_NAMES: Readonly<Record<TimelineRowKind, string>> = Object.freeze({
  overlay: 'Overlay',
  zoom: 'Zoom',
  sound: 'Sound',
});

/**
 * Bars into as few rows as they fit without touching: each bar goes on the
 * first row whose last bar ends at or before it starts. Always at least one
 * row, so an empty kind still shows.
 */
export function packLanes<T extends { startMs: number; endMs: number }>(bars: readonly T[]): T[][] {
  const sorted = bars
    .map((bar, order) => ({ bar, order }))
    .sort(
      (a, b) => a.bar.startMs - b.bar.startMs || a.bar.endMs - b.bar.endMs || a.order - b.order,
    );
  const lanes: T[][] = [];
  const ends: number[] = [];
  for (const { bar } of sorted) {
    const lane = ends.findIndex((end) => end <= bar.startMs);
    if (lane >= 0) {
      lanes[lane].push(bar);
      ends[lane] = bar.endMs;
    } else {
      lanes.push([bar]);
      ends.push(bar.endMs);
    }
  }
  return lanes.length > 0 ? lanes : [[]];
}

function lanesOf(kind: TimelineRowKind, bars: TimelineBarModel[]): TimelineRowModel[] {
  return packLanes(bars).map((lane, index) => ({
    key: `${kind}-${index}`,
    kind,
    label: index === 0 ? ROW_NAMES[kind] : `${ROW_NAMES[kind]} ${index + 1}`,
    bars: lane,
  }));
}

/** The Overlay, Zoom and Sound rows of a document, in that order (the Video row is the parts). */
export function timelineRows(doc: ClipDocument): TimelineRowModel[] {
  const overlays: TimelineBarModel[] = [];
  const sounds: TimelineBarModel[] = [];
  for (const track of doc.tracks) {
    if (track.kind === 'captions') continue;
    for (const item of track.items as TimedItem[]) {
      const bar: TimelineBarModel = {
        key: item.id,
        selection: { kind: 'item', id: item.id },
        startMs: item.start,
        endMs: item.start + item.duration,
        name: itemName(item),
        label: itemLabel(item),
        movable: true,
      };
      (track.kind === 'audio' ? sounds : overlays).push(bar);
    }
  }

  // A zoom's bars are the engine's windows: one while the clip plays its stretch of the video
  // without a jump, so each bar eases in and out as the export does.
  const byId = new Map(doc.zooms.map((zoom) => [zoom.id, zoom] as const));
  const zooms: TimelineBarModel[] = [];
  for (const window of zoomWindows(doc)) {
    const zoom = byId.get(window.zoomId);
    if (!zoom) continue;
    zooms.push({
      key: `${zoom.id}:${window.piece}`,
      selection: { kind: 'zoom', id: zoom.id },
      startMs: window.startMs,
      endMs: window.endMs,
      name: zoomName(zoom),
      label: zoomLabel(zoom, window.startMs, window.endMs),
      movable: true,
      piece: window.piece,
    });
  }

  return [...lanesOf('overlay', overlays), ...lanesOf('zoom', zooms), ...lanesOf('sound', sounds)];
}

// ---------------------------------------------------------------------------
// Video we do not hold yet
// ---------------------------------------------------------------------------

/**
 * The hatched ends of a part, in output ms from the bar's own start:
 * `untilMs` hatches from the start to there (video brought back before what
 * we hold), `fromMs` from there to the end (past it). Nothing without a held
 * range: there is nothing to compare with, and nothing will be fetched.
 */
export function partHatch(
  segment: Pick<Segment, 'sourceIn' | 'sourceOut'> & { speed: number; role?: Segment['role'] },
  lengthMs: number,
  held: SourceRange | null,
): { untilMs?: number; fromMs?: number } {
  // Module 10: a brand intro or outro plays another video's light copy, never this one's.
  if (!held || isBrandPart({ role: segment.role })) return {};
  const hatch: { untilMs?: number; fromMs?: number } = {};
  if (segment.sourceIn < held.fromMs) {
    const edge = Math.min(held.fromMs, segment.sourceOut);
    hatch.untilMs = Math.min(lengthMs, Math.round((edge - segment.sourceIn) / segment.speed));
  }
  if (segment.sourceOut > held.toMs) {
    const edge = Math.max(held.toMs, segment.sourceIn);
    hatch.fromMs = Math.max(0, Math.round((edge - segment.sourceIn) / segment.speed));
  }
  return hatch;
}

/**
 * The range a clip plays on its own video (Module 10): its brand intro and
 * outro left out, since they play other videos. The engine's whole range
 * when every part is a brand part.
 */
export function mainDocumentRange(doc: Pick<ClipDocument, 'segments'>): SourceRange | null {
  const own = doc.segments.filter((segment) => !isBrandPart(segment));
  return documentRange({ segments: own.length > 0 ? own : doc.segments });
}

/**
 * The range More Video should fetch: the clip's whole range when any of it
 * lies outside what we hold (an export reads one stored stretch that covers
 * every part), else null.
 */
export function missingRange(doc: ClipDocument, held: SourceRange | null): SourceRange | null {
  if (!held) return null;
  const range = mainDocumentRange(doc);
  if (!range) return null;
  return range.fromMs < held.fromMs || range.toMs > held.toMs ? range : null;
}

// ---------------------------------------------------------------------------
// Split and delete
// ---------------------------------------------------------------------------

export const LAST_PART_SENTENCE = 'A clip needs at least one part.';
export const BRAND_PART_SENTENCE =
  'The intro and outro come from the brand kit. Switch them off in the Layouts tab.';
export const SPLIT_EDGE_SENTENCE = `Move the playhead at least ${SEGMENT_MIN_MS / 1000} seconds inside a part to split it.`;
export const SPLIT_LIMIT_SENTENCE = `A clip can have at most ${MAX_SEGMENTS} parts.`;
export const SPLIT_FAILED_SENTENCE = 'This part cannot be split here.';
export const ITEM_LIMIT_SENTENCE = `A clip can hold at most ${MAX_ITEMS} texts, stickers and sounds.`;
export const TRACK_LIMIT_SENTENCE = 'There is no free row at this time. Move something first.';

/** Why a text, sticker or sound could not be added or copied, or null when it simply is not there. */
export function addRefusalSentence(code: ItemRefusalCode): string | null {
  switch (code) {
    case 'too_many_items':
      return ITEM_LIMIT_SENTENCE;
    case 'too_many_sounds':
      return TOO_MANY_SOUNDS;
    case 'too_many_stickers':
      return TOO_MANY_STICKERS;
    case 'too_many_tracks':
      return TRACK_LIMIT_SENTENCE;
    default:
      return null;
  }
}

function splitSentence(code: EditRefusalCode): string {
  switch (code) {
    case 'split_too_close_to_edge':
    case 'outside_clip':
      return SPLIT_EDGE_SENTENCE;
    case 'too_many_segments':
      return SPLIT_LIMIT_SENTENCE;
    default:
      return SPLIT_FAILED_SENTENCE;
  }
}

/** Splits the part under the playhead: the new document, or why not in one sentence. */
export function splitAtPlayhead(
  doc: ClipDocument,
  playheadMs: number,
): { ok: true; doc: ClipDocument } | { ok: false; sentence: string } {
  // An intro or outro is the kit's own video: it is not cut.
  const under = placeSegments(doc).find(
    (placed) => playheadMs > placed.outStart && playheadMs < placed.outEnd,
  );
  if (under && isBrandPart(under.segment)) return { ok: false, sentence: BRAND_PART_SENTENCE };
  const result = splitAt(doc, playheadMs);
  return result.ok
    ? { ok: true, doc: result.doc }
    : { ok: false, sentence: splitSentence(result.code) };
}

/**
 * Removes the selected part, item or zoom: the new document, or why not
 * (the last part). A crop area is not removed from the timeline, and nothing
 * selected is nothing to do (`null`).
 */
export function removeSelection(
  doc: ClipDocument,
  selection: EditorSelection,
): { ok: true; doc: ClipDocument } | { ok: false; sentence: string } | null {
  if (!selection) return null;
  switch (selection.kind) {
    case 'segment': {
      // A hook part goes with the whole hook: every item back where it was.
      const part = doc.segments.find((segment) => segment.id === selection.id);
      if (part && isHookPart(part)) {
        const next = removeHook(doc);
        return next === doc ? { ok: false, sentence: LAST_PART_SENTENCE } : { ok: true, doc: next };
      }
      // Module 10: the kit's intro and outro are switched off in the Layouts tab.
      if (part && isBrandPart(part)) return { ok: false, sentence: BRAND_PART_SENTENCE };
      // The main clip keeps a part of its own: a clip that is only its hook is no clip.
      if (part && doc.segments.filter(isMainPart).length <= 1) {
        return { ok: false, sentence: LAST_PART_SENTENCE };
      }
      const result = removeSegment(doc, selection.id);
      if (result.ok) return { ok: true, doc: result.doc };
      return result.code === 'last_segment' ? { ok: false, sentence: LAST_PART_SENTENCE } : null;
    }
    case 'item': {
      const result = removeItem(doc, selection.id);
      return result.ok ? { ok: true, doc: result.doc } : null;
    }
    case 'zoom': {
      const zooms = doc.zooms.filter((zoom) => zoom.id !== selection.id);
      return zooms.length === doc.zooms.length ? null : { ok: true, doc: { ...doc, zooms } };
    }
    case 'area':
      return null;
  }
}

/** Why the selection cannot be removed right now (the delete button's tooltip), or null. */
export function removeProblem(doc: ClipDocument, selection: EditorSelection): string | null {
  if (selection?.kind === 'segment' && doc.segments.length <= 1) return LAST_PART_SENTENCE;
  if (selection?.kind === 'segment') {
    // The main clip's last part, when the clip also has a hook.
    const part = doc.segments.find((segment) => segment.id === selection.id);
    if (part && isBrandPart(part)) return BRAND_PART_SENTENCE;
    const main = doc.segments.filter(isMainPart);
    if (part && isMainPart(part) && main.length <= 1) return LAST_PART_SENTENCE;
  }
  return null;
}

/** Moves an item by `deltaMs`, kept inside the clip (an arrow key on its bar). */
export function nudgeItem(doc: ClipDocument, itemId: string, deltaMs: number): ClipDocument {
  return dragMoveItem(doc, { itemId, grabMs: 0, pointerMs: deltaMs }).doc;
}

/** The panel a selection opens (Enter on a bar; selecting an item or zoom). */
export function tabForSelection(doc: ClipDocument, selection: EditorSelection): EditorTab | null {
  if (!selection) return null;
  switch (selection.kind) {
    case 'segment':
    case 'zoom':
      return 'effects';
    case 'area':
      return 'layouts';
    case 'item': {
      for (const track of doc.tracks) {
        if (track.kind === 'captions') continue;
        const item = (track.items as TimedItem[]).find(
          (candidate) => candidate.id === selection.id,
        );
        if (!item) continue;
        if (item.type === 'text') return 'text';
        if (item.type === 'sticker') return 'elements';
        return 'audio';
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Dragging an edge
// ---------------------------------------------------------------------------

/**
 * Where the playhead sits while an edge is dragged, so the stage shows the
 * frame being cut on: a start edge shows its first frame, an end edge its
 * last (one frame before the end, never before the part's start).
 */
export function edgeFrameMs(
  doc: ClipDocument,
  segmentId: string,
  edge: 'start' | 'end',
  fps: number,
): number | null {
  const entry = placeSegments(doc).find((placed) => placed.segment.id === segmentId);
  if (!entry) return null;
  if (edge === 'start') return entry.outStart;
  const frameMs = 1000 / (fps > 0 ? fps : 30);
  return Math.max(entry.outStart, entry.outEnd - frameMs);
}

/**
 * While a start edge is trimmed inward the clip closes up only on release:
 * until then the dragged part and everything after it are drawn this many ms
 * to the right, so the edge stays under the pointer and nothing else jumps.
 * Zero for an end edge, or a start edge dragged outward.
 */
export function trimShiftMs(
  startDoc: ClipDocument,
  draft: ClipDocument,
  segmentId: string,
  edge: 'start' | 'end',
): number {
  if (edge !== 'start') return 0;
  const before = placeSegments(startDoc).find((placed) => placed.segment.id === segmentId);
  const after = placeSegments(draft).find((placed) => placed.segment.id === segmentId);
  if (!before || !after) return 0;
  return Math.max(0, before.outEnd - before.outStart - (after.outEnd - after.outStart));
}

// ---------------------------------------------------------------------------
// The snapping switch, kept in this browser
// ---------------------------------------------------------------------------

export const SNAP_STORAGE_KEY = 'postgear.clips.snapping';

/** Whether snapping is on in this browser (on unless it was turned off); crops keep their own key. */
export function readSnapping(key: string = SNAP_STORAGE_KEY): boolean {
  try {
    return window.localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

export function writeSnapping(on: boolean, key: string = SNAP_STORAGE_KEY): void {
  try {
    window.localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // Private windows and blocked storage: the switch still works for this visit.
  }
}
