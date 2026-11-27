/**
 * Which stored file a clip's picture is read from (Sprint 12, Module 05
 * section 3). One rule, used by the API (to say whether an export will be
 * sharp, and to hand the worker its input) and by the worker (to read the
 * file), so the two can never pick differently.
 *
 * When a clip is made, its range (widened by the handles each side) is
 * fetched sharp at the plan's best height and stored as a SEGMENT asset with
 * `meta { fromMs, toMs, height, fps }` in the video's own time. A render uses
 * the SEGMENT that covers every part of the range (the tallest, then the
 * newest), and falls back to the light copy (the newest PROXY) when none
 * does: a trim past the handles, a platform copy that is gone, or a fetch
 * still running. `sourceOffsetMs` is where the chosen file starts in the
 * video's time, so the compiler subtracts it from every part's times.
 *
 * Pure: rows in, a choice out.
 */
import type { SegmentAssetMeta } from './assets';
import type { ClipDocument } from './document';

export interface SourceRange {
  fromMs: number;
  toMs: number;
}

/** The fields of an asset row the choice reads; callers keep their own row type. */
export interface SourceAsset {
  kind: string;
  meta: unknown;
  createdAt: Date;
}

export interface PickedSource<A extends SourceAsset> {
  asset: A;
  /** True for a covering SEGMENT, false for the light copy. */
  sharp: boolean;
  /** Where this file starts, in the video's time. */
  sourceOffsetMs: number;
  /** The SEGMENT's height; null for the light copy. */
  height: number | null;
}

/** A SEGMENT asset's meta, or null when it does not read as one (never trusted blindly). */
export function parseSegmentAssetMeta(meta: unknown): SegmentAssetMeta | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null;
  const value = meta as Record<string, unknown>;
  const { fromMs, toMs, height, fps } = value;
  if (
    typeof fromMs !== 'number' ||
    typeof toMs !== 'number' ||
    typeof height !== 'number' ||
    typeof fps !== 'number'
  ) {
    return null;
  }
  if (!Number.isInteger(fromMs) || !Number.isInteger(toMs) || !Number.isInteger(height)) {
    return null;
  }
  if (fromMs < 0 || toMs <= fromMs || height < 1 || !Number.isFinite(fps) || fps <= 0) {
    return null;
  }
  return { fromMs, toMs, height, fps };
}

/** The part of each video the document uses, keyed by the document's source id. */
export function rangesBySource(doc: Pick<ClipDocument, 'segments'>): Map<string, SourceRange> {
  const ranges = new Map<string, SourceRange>();
  for (const segment of doc.segments) {
    const current = ranges.get(segment.source);
    ranges.set(segment.source, {
      fromMs: current ? Math.min(current.fromMs, segment.sourceIn) : segment.sourceIn,
      toMs: current ? Math.max(current.toMs, segment.sourceOut) : segment.sourceOut,
    });
  }
  return ranges;
}

/**
 * The whole range a document plays, earliest start to latest end, or null
 * for a document with no parts. A Sprint 12 clip reads one video, so this
 * is that video's range.
 */
export function documentRange(doc: Pick<ClipDocument, 'segments'>): SourceRange | null {
  if (doc.segments.length === 0) return null;
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = 0;
  for (const segment of doc.segments) {
    fromMs = Math.min(fromMs, segment.sourceIn);
    toMs = Math.max(toMs, segment.sourceOut);
  }
  return { fromMs, toMs };
}

/**
 * The covering SEGMENT (tallest, then newest) among `assets`, else the newest
 * PROXY, else null (still importing, or deleted). A null range (a document
 * with no parts) skips the SEGMENTs and answers the light copy.
 */
export function pickSharpSource<A extends SourceAsset>(
  range: SourceRange | null,
  assets: readonly A[],
): PickedSource<A> | null {
  let best: { asset: A; meta: SegmentAssetMeta } | null = null;
  if (range) {
    for (const asset of assets) {
      if (asset.kind !== 'SEGMENT') continue;
      const meta = parseSegmentAssetMeta(asset.meta);
      if (!meta || meta.fromMs > range.fromMs || meta.toMs < range.toMs) continue;
      const better =
        !best ||
        meta.height > best.meta.height ||
        (meta.height === best.meta.height &&
          asset.createdAt.getTime() > best.asset.createdAt.getTime());
      if (better) best = { asset, meta };
    }
  }
  if (best) {
    return {
      asset: best.asset,
      sharp: true,
      sourceOffsetMs: best.meta.fromMs,
      height: best.meta.height,
    };
  }

  let proxy: A | null = null;
  for (const asset of assets) {
    if (asset.kind !== 'PROXY') continue;
    if (!proxy || asset.createdAt.getTime() > proxy.createdAt.getTime()) proxy = asset;
  }
  return proxy ? { asset: proxy, sharp: false, sourceOffsetMs: 0, height: null } : null;
}

/**
 * The stretch of the video held in sharp quality around a clip (Module 09,
 * the timeline's hatched tail), or null when nothing sharp touches it.
 *
 * The covering SEGMENT when there is one (the same pick as
 * `pickSharpSource`); otherwise the SEGMENT sharing the most time with the
 * range (then the taller, then the newer), which is what a clip trimmed
 * past its handles still has. Only an overlapping SEGMENT counts: one
 * elsewhere in the video says nothing about this clip.
 */
export function heldRange(
  range: SourceRange | null,
  assets: readonly SourceAsset[],
): SourceRange | null {
  if (!range) return null;
  const covering = pickSharpSource(range, assets);
  if (covering?.sharp) {
    const meta = parseSegmentAssetMeta(covering.asset.meta);
    if (meta) return { fromMs: meta.fromMs, toMs: meta.toMs };
  }

  let best: { meta: SegmentAssetMeta; overlap: number; createdAt: number } | null = null;
  for (const asset of assets) {
    if (asset.kind !== 'SEGMENT') continue;
    const meta = parseSegmentAssetMeta(asset.meta);
    if (!meta) continue;
    const overlap = Math.min(meta.toMs, range.toMs) - Math.max(meta.fromMs, range.fromMs);
    if (overlap <= 0) continue;
    const createdAt = asset.createdAt.getTime();
    const better =
      !best ||
      overlap > best.overlap ||
      (overlap === best.overlap &&
        (meta.height > best.meta.height ||
          (meta.height === best.meta.height && createdAt > best.createdAt)));
    if (better) best = { meta, overlap, createdAt };
  }
  return best ? { fromMs: best.meta.fromMs, toMs: best.meta.toMs } : null;
}

/** One part's own file (Module 11): the part, and the file that covers it, or null. */
export interface PartSource<A extends SourceAsset> {
  segmentId: string;
  picked: PickedSource<A> | null;
}

/** The files one source of a document is read from (`pickSourceFiles`). */
export interface SourceFiles<A extends SourceAsset> {
  sourceId: string;
  videoId: string;
  /** Every part of this source, earliest start to latest end. */
  range: SourceRange;
  /**
   * The one file for the whole range (a covering SEGMENT, else the light
   * copy), or null when the video has neither.
   */
  picked: PickedSource<A> | null;
  /**
   * Only for a montage whose source no single SEGMENT covers (two clips of
   * one video, far apart): each part's own pick, a SEGMENT covering that
   * part, else the light copy. Absent otherwise.
   */
  parts?: PartSource<A>[];
  /** True when every part of this source is read from a SEGMENT (sharp). */
  sharp: boolean;
}

/**
 * Which files a render reads, per source of `doc` (Module 11), the one rule
 * the API's "will it be sharp" and the worker's prepare step both call.
 * `assetsOf(videoId)` answers every asset of a video inside the workspace
 * (every clip's SEGMENTs and the light copies); a video it does not know
 * answers an empty list.
 *
 * - Each source's whole range is picked with `pickSharpSource`, exactly as a
 *   clip of one video always was.
 * - A montage (`meta.montage`) may play two clips of one video as one
 *   source, so its range spans both and a single SEGMENT rarely covers it:
 *   when the whole range is not covered sharp, each part is picked on its
 *   own (every part opens its own seeked input anyway), and the parts that a
 *   SEGMENT covers read it.
 *
 * Pass the parts that matter: the API leaves out brand intro and outro parts.
 */
export function pickSourceFiles<A extends SourceAsset>(
  doc: Pick<ClipDocument, 'segments' | 'sources'> & Partial<Pick<ClipDocument, 'meta'>>,
  assetsOf: (videoId: string) => readonly A[],
): SourceFiles<A>[] {
  const montage = doc.meta?.montage !== undefined;
  const videoOf = new Map(doc.sources.map((source) => [source.id, source.videoId]));
  const out: SourceFiles<A>[] = [];
  for (const [sourceId, range] of rangesBySource(doc)) {
    const videoId = videoOf.get(sourceId);
    if (!videoId) continue;
    const assets = assetsOf(videoId);
    const picked = pickSharpSource(range, assets);
    if (picked?.sharp || !montage) {
      out.push({ sourceId, videoId, range, picked, sharp: picked?.sharp === true });
      continue;
    }
    const parts = doc.segments
      .filter((segment) => segment.source === sourceId)
      .map((segment) => ({
        segmentId: segment.id,
        picked: pickSharpSource({ fromMs: segment.sourceIn, toMs: segment.sourceOut }, assets),
      }));
    out.push({
      sourceId,
      videoId,
      range,
      picked,
      parts,
      sharp: parts.every((part) => part.picked?.sharp === true),
    });
  }
  return out;
}

/** True when every source reads sharp files only (an export will be sharp). */
export function sourceFilesSharp(files: readonly SourceFiles<SourceAsset>[]): boolean {
  return files.length > 0 && files.every((entry) => entry.sharp);
}
