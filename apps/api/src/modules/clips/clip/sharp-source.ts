/**
 * Which stored file an export reads a clip's picture from (Sprint 12,
 * Module 05, section 3), in the shape the API's services use.
 *
 * The rule itself is `pickSharpSource` in `@postgear/video-engine`, which
 * the worker uses too, so the API's "this export will be sharp" and the
 * file the worker reads can never disagree. The answer carries the key for
 * the API's own use (signing, the worker's input); it is never sent to a
 * browser.
 */
import type { ClipAsset } from '@postgear/db';
import {
  type ClipDocument,
  documentRange as engineDocumentRange,
  pickSharpSource,
  type SourceRange,
  safeParseClipDocument,
} from '@postgear/video-engine';

/**
 * The parts that play the clip's own video (Module 10): a brand intro or
 * outro plays another video, in that video's own time, so it never widens
 * the clip's range on its video. A document whose every part is one keeps
 * them all.
 */
export function mainSegments<T extends Pick<ClipDocument, 'segments'>>(
  doc: T,
): Pick<ClipDocument, 'segments'> {
  const own = doc.segments.filter(
    (segment) => segment.role !== 'intro' && segment.role !== 'outro',
  );
  return { segments: own.length > 0 ? own : doc.segments };
}

/**
 * The range a document plays on the clip's own video: what its SEGMENT
 * (sharp copy) must cover, its line on the video. Brand parts left out.
 */
export function documentRange(doc: Pick<ClipDocument, 'segments'>): SourceRange | null {
  return engineDocumentRange(mainSegments(doc));
}

/** The range a stored document plays (Module 07, a clip's line on its video), or null if unreadable. */
export function storedDocumentRange(stored: unknown): SourceRange | null {
  const parsed = safeParseClipDocument(stored);
  return parsed.ok ? documentRange(parsed.doc) : null;
}

export interface SharpSource {
  kind: 'segment' | 'proxy';
  assetId: string;
  /** Private storage key: for signing and the worker only. */
  key: string;
  /** Where this file starts, in the video's time. */
  sourceOffsetMs: number;
  /** The SEGMENT's height; null for the proxy. */
  height: number | null;
}

/**
 * The SEGMENT asset covering every part of the clip on its own video (brand
 * intro and outro parts are another video's), or the newest PROXY,
 * or null when the video has neither (still importing, or deleted).
 */
export function sharpSourceFor(
  doc: Pick<ClipDocument, 'segments'>,
  assets: readonly Pick<ClipAsset, 'id' | 'kind' | 'key' | 'meta' | 'createdAt'>[],
): SharpSource | null {
  const picked = pickSharpSource(documentRange(doc), assets);
  if (!picked) return null;
  return {
    kind: picked.sharp ? 'segment' : 'proxy',
    assetId: picked.asset.id,
    key: picked.asset.key,
    sourceOffsetMs: picked.sourceOffsetMs,
    height: picked.height,
  };
}
