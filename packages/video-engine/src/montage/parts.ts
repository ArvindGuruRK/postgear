/**
 * A montage in the editor (Sprint 13, Module 11): its original clips as
 * named runs of parts, and the layout of each part.
 *
 * - `montageParts(doc)`: each original clip's name and where it starts on
 *   the clip's clock, for the timeline's dividers. A clip whose first part
 *   an edit removed loses its divider.
 * - `segmentLayout(doc, segmentId)`: what frames a part, its own
 *   `layoutOverride` or the document's layout.
 * - `withSegmentLayout(doc, segmentId, layout)`: the editor's Layout tools
 *   on a montage act on the selected part's original clip, so the layout is
 *   set on every part of that clip (the run of parts from its divider to the
 *   next one), leaving brand intro and outro parts alone. On a clip that is
 *   not a montage, or on a brand part, it is set on that one part.
 *
 * Pure: one new document per call, the input never changed.
 */
import type { ClipDocument, ClipLayout, Segment } from '../document/schema';
import { placeSegments } from '../time/time-map';

export interface MontagePart {
  clipId: string;
  title: string;
  /** The id of the part the clip starts at. */
  firstSegment: string;
  /** Where that part starts on the clip's clock, ms. */
  outStart: number;
}

function isBrandPart(segment: Pick<Segment, 'role'>): boolean {
  return segment.role === 'intro' || segment.role === 'outro';
}

/** The montage's original clips, in play order, with where each starts (empty for a clip that is not one). */
export function montageParts(
  doc: Pick<ClipDocument, 'segments' | 'meta'> & Partial<Pick<ClipDocument, 'joins'>>,
): MontagePart[] {
  const parts = doc.meta?.montage?.parts ?? [];
  if (parts.length === 0) return [];
  const starts = new Map(placeSegments(doc).map((entry) => [entry.segment.id, entry.outStart]));
  const out: MontagePart[] = [];
  for (const part of parts) {
    const outStart = starts.get(part.firstSegment);
    if (outStart === undefined) continue;
    out.push({ clipId: part.clipId, title: part.title, firstSegment: part.firstSegment, outStart });
  }
  return out.sort((a, b) => a.outStart - b.outStart);
}

/** The layout that frames a part: its own, else the document's (the document's for an unknown id). */
export function segmentLayout(
  doc: Pick<ClipDocument, 'segments' | 'layout'>,
  segmentId: string,
): ClipLayout {
  const segment = doc.segments.find((candidate) => candidate.id === segmentId);
  return segment?.layoutOverride ?? doc.layout;
}

/** The ids of the parts of the original clip `segmentId` belongs to, or just it outside a montage. */
function runOf(doc: Pick<ClipDocument, 'segments' | 'meta'>, index: number): number[] {
  const segment = doc.segments[index] as Segment;
  const starts = new Set((doc.meta?.montage?.parts ?? []).map((part) => part.firstSegment));
  if (starts.size === 0 || isBrandPart(segment)) return [index];
  let from = index;
  while (from > 0 && !starts.has((doc.segments[from] as Segment).id)) from -= 1;
  let to = index;
  while (to + 1 < doc.segments.length && !starts.has((doc.segments[to + 1] as Segment).id)) {
    to += 1;
  }
  const run: number[] = [];
  for (let i = from; i <= to; i += 1) {
    if (!isBrandPart(doc.segments[i] as Segment)) run.push(i);
  }
  return run;
}

/**
 * The document with `layout` framing the part `segmentId` and, on a
 * montage, every other part of the same original clip (see the file
 * comment). The same document for an unknown id.
 */
export function withSegmentLayout(
  doc: ClipDocument,
  segmentId: string,
  layout: ClipLayout,
): ClipDocument {
  const index = doc.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return doc;
  const run = new Set(runOf(doc, index));
  return {
    ...doc,
    segments: doc.segments.map((segment, i) =>
      run.has(i) ? { ...segment, layoutOverride: JSON.parse(JSON.stringify(layout)) } : segment,
    ),
  };
}
