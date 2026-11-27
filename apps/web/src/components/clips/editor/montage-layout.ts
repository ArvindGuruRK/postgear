/**
 * The Layout tools on a montage (Module 11, section 4). Each original clip
 * of a montage keeps its own framing as its parts' `layoutOverride`, so the
 * tools must read and write the picked part's layout, not the document's.
 *
 * They work on a "part view": the document with the part's layout in
 * `layout`, so the Layouts panel and the crop boxes need not know about
 * montages. What they make is written back with the engine's
 * `withSegmentLayout` (every part of that original clip), as one undo step.
 * A change of shape is the whole montage's and goes to the document as it is.
 */
import {
  type ClipDocument,
  montageParts,
  segmentLayout,
  withSegmentLayout,
} from '@postgear/video-engine';

/** The document is a montage (it names its original clips). */
export function isMontage(doc: Pick<ClipDocument, 'meta'>): boolean {
  return (doc.meta?.montage?.parts.length ?? 0) > 0;
}

/**
 * The part the Layout tools act on: the picked part while it is still
 * there and not a brand intro or outro, else the first ordinary part. Null
 * outside a montage (the tools act on the document's own layout).
 */
export function layoutPartOf(doc: ClipDocument, picked: string | null): string | null {
  if (!isMontage(doc)) return null;
  const ordinary = (id: string | null) =>
    doc.segments.find((segment) => segment.id === id && segment.role === undefined) ?? null;
  return (
    ordinary(picked)?.id ?? doc.segments.find((segment) => segment.role === undefined)?.id ?? null
  );
}

/** The original clip's name a part belongs to ("Big Play (1:10)"), or null. */
export function partClipTitle(doc: ClipDocument, segmentId: string): string | null {
  const index = doc.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return null;
  const starts = new Map(
    (doc.meta?.montage?.parts ?? []).map((part) => [part.firstSegment, part.title]),
  );
  for (let i = index; i >= 0; i -= 1) {
    const title = starts.get(doc.segments[i]?.id ?? '');
    if (title !== undefined) return title;
  }
  return montageParts(doc)[0]?.title ?? null;
}

/** The document as the Layout tools see it: the part's layout in `layout`. */
export function partView(doc: ClipDocument, segmentId: string | null): ClipDocument {
  if (!segmentId) return doc;
  const layout = segmentLayout(doc, segmentId);
  return layout === doc.layout ? doc : { ...doc, layout };
}

/** What the tools made on the part view (`next`), written back onto `doc`. */
export function fromPartView(
  doc: ClipDocument,
  segmentId: string | null,
  next: ClipDocument,
): ClipDocument {
  if (!segmentId) return next;
  const partLayout = segmentLayout(doc, segmentId);
  const rest = { ...next, layout: doc.layout };
  if (next.layout !== partLayout) return withSegmentLayout(rest, segmentId, next.layout);
  // Nothing but the view's own layout field differs: the document as it was.
  const keys = new Set([...Object.keys(doc), ...Object.keys(rest)]) as Set<keyof ClipDocument>;
  return [...keys].every((key) => rest[key] === doc[key]) ? doc : rest;
}

/** A layout change applied to the part (or, for a change of shape, to the whole document). */
export function applyToPart(
  doc: ClipDocument,
  segmentId: string | null,
  change: (doc: ClipDocument) => ClipDocument,
): ClipDocument {
  if (!segmentId) return change(doc);
  const next = change(partView(doc, segmentId));
  if (next.canvas.ratio !== doc.canvas.ratio) return change(doc);
  return fromPartView(doc, segmentId, next);
}
