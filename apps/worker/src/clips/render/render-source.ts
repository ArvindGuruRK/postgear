/**
 * Which stored file an export reads for each video in the document
 * (Module 05 section 3). The rule is `pickSharpSource` in
 * `@postgear/video-engine`, the same one the API uses to say whether an
 * export will be sharp, so the two never pick differently. This file only
 * adapts it to the worker's rows: the SEGMENT assets of the clip and the
 * video's one light copy.
 */
import {
  type ClipDocument,
  rangesBySource as engineRangesBySource,
  pickSharpSource,
  type SourceRange,
} from '@postgear/video-engine';
import type { AssetRow } from '../rows';

export type { SourceRange };

export interface PickedSource {
  asset: AssetRow;
  sharp: boolean;
  /** Where in the video the file starts, in ms. */
  sourceOffsetMs: number;
}

/** The part of each video the document uses, keyed by the document's source id. */
export function rangesBySource(doc: Pick<ClipDocument, 'segments'>): Map<string, SourceRange> {
  return engineRangesBySource(doc);
}

/** The file to read for one video, or null when it has neither a covering range nor a light copy. */
export function pickRenderSource(
  range: SourceRange,
  segments: readonly AssetRow[],
  proxy: AssetRow | null,
): PickedSource | null {
  const candidates = proxy ? [...segments, proxy] : segments;
  const picked = pickSharpSource(range, candidates);
  if (!picked) return null;
  return { asset: picked.asset, sharp: picked.sharp, sourceOffsetMs: picked.sourceOffsetMs };
}
