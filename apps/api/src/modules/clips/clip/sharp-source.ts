/**
 * Which stored file an export reads a clip's picture from (Sprint 12,
 * Module 05, section 3), in the shape the API's services use.
 *
 * The rule itself is `pickSharpSource` in `@postgear/video-engine`, which
 * the worker uses too, so the API's "this export will be sharp" and the
 * file the worker reads can never disagree. The answer carries the key for
 * the API's own use (signing, the worker's input); it is never sent to a
 * browser.
 *
 * Module 11: a montage plays several videos, and the worker reads one file
 * per source (`rangesBySource`), so "will it be sharp" is answered per
 * source: each source's own range against its own video's files
 * (`sharpSourcesFor`). For a clip of one video that is the single answer
 * `sharpSourceFor` has always given.
 */
import type { ClipAsset } from '@postgear/db';
import {
  type ClipDocument,
  documentRange as engineDocumentRange,
  pickSharpSource,
  pickSourceFiles,
  rangesBySource,
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

/**
 * The ranges a stored document plays on one video, one per source of that
 * video (a montage can play two clips of the same video as two sources).
 * Brand intro and outro parts left out, as in `documentRange`. Empty when the
 * document does not read or does not play the video.
 */
export function storedRangesOnVideo(stored: unknown, videoId: string): SourceRange[] {
  const parsed = safeParseClipDocument(stored);
  if (!parsed.ok) return [];
  const onVideo = new Set(
    parsed.doc.sources.filter((source) => source.videoId === videoId).map((source) => source.id),
  );
  const own = mainSegments(parsed.doc).segments.filter((segment) => onVideo.has(segment.source));
  return [...rangesBySource({ segments: own }).values()];
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

type AssetFields = Pick<ClipAsset, 'id' | 'kind' | 'key' | 'meta' | 'createdAt'>;

/** One source's answer (Module 11): its video, the range it plays, the file an export reads. */
export interface SourceSharpness {
  sourceId: string;
  videoId: string;
  range: SourceRange;
  /** Null when its video has neither a covering SEGMENT nor a light copy. */
  source: SharpSource | null;
  /**
   * True when the export reads only sharp files for this source: the whole
   * range from one SEGMENT, or (a montage) every part from a SEGMENT that
   * covers it. The engine's `pickSourceFiles`, the rule the worker reads.
   */
  sharp: boolean;
}

/**
 * Per source of the document's main parts (brand intro and outro left out,
 * as everywhere here): the range that source plays, judged against the files
 * of that source's own video. `assetsOf` answers a video's assets (an empty
 * list for a video it does not know).
 */
export function sharpSourcesFor(
  doc: Pick<ClipDocument, 'segments' | 'sources'> & Partial<Pick<ClipDocument, 'meta'>>,
  assetsOf: (videoId: string) => readonly AssetFields[],
): SourceSharpness[] {
  const files = pickSourceFiles(
    { segments: mainSegments(doc).segments, sources: doc.sources, meta: doc.meta },
    assetsOf,
  );
  return files.map(({ sourceId, videoId, range, picked, sharp }) => ({
    sourceId,
    videoId,
    range,
    sharp,
    source: picked
      ? {
          kind: picked.sharp ? 'segment' : 'proxy',
          assetId: picked.asset.id,
          key: picked.asset.key,
          sourceOffsetMs: picked.sourceOffsetMs,
          height: picked.height,
        }
      : null,
  }));
}

/** True when every main source of the document reads a covering SEGMENT (an export will be sharp). */
export function allSourcesSharp(sources: readonly SourceSharpness[]): boolean {
  return sources.length > 0 && sources.every((entry) => entry.sharp);
}
