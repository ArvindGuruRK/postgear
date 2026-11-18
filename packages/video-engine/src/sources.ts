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
