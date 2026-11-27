/**
 * A clip's captions, fetched for a render (Sprint 13, Module 03).
 *
 * The compiler never fetches anything, so the prepare step hands it the
 * words and the look: the transcript file the captions track names, with the
 * video's word fixes applied, and the caption style resolved.
 *
 * Tenancy (the gap Sprint 12's sweep left for this sprint): the track's
 * `transcriptAssetId` is only an id a person's document carries. It is looked
 * up **among this workspace's assets of this clip's video**, never by id
 * alone, and the style among this workspace's own. An id that is not there
 * (another workspace's, a deleted video's) stops the export with
 * `captions_missing`; nothing outside the workspace is ever read.
 *
 * Module 11: a montage has one captions track per video, each naming its
 * `source`; each track's transcript is looked up among its own video's
 * assets the same way (`fetchCaptionsTracks`).
 */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import type { PrivateStorage } from '@postgear/storage';
import {
  applyFixes,
  captionsTracksOf,
  type ClipDocument,
  type CustomCaptionStyle,
  decodeTranscript,
  isBuiltInCaptionStyle,
  readTranscriptAssetMeta,
  type RenderCaptionsAsset,
  resolveStyle,
  TranscriptFileError,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import type { AssetRow } from '../rows';

const gunzipAsync = promisify(gunzip);
const MAX_GZ_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024 * 1024;

export interface CaptionRows {
  /** Every asset of a video, inside the workspace. */
  videoAssets(organizationId: string, videoId: string): Promise<AssetRow[]>;
  /** One of the workspace's own caption styles, or null. */
  captionStyle(organizationId: string, styleId: string): Promise<CustomCaptionStyle | null>;
}

export interface CaptionFetchDeps {
  rows: CaptionRows;
  privateStorage: Pick<PrivateStorage, 'getToFile'>;
}

/** The words of every captions track of a render (Module 11: a montage has one per video). */
export interface FetchedCaptions {
  /** The only track's words (the first track's, for a document with several). */
  captions?: RenderCaptionsAsset;
  /** Every track's words, by track id, when the document has more than one captions track. */
  captionsByTrack?: Record<string, RenderCaptionsAsset>;
}

/**
 * The captions asset for a document, or undefined when it has no captions.
 * Throws a permanent `captions_missing` when the transcript cannot be found
 * or read: an export must never quietly lose its captions. For a document
 * with several captions tracks the first track's words; read them all with
 * `fetchCaptionsTracks`.
 */
export async function fetchCaptions(
  deps: CaptionFetchDeps,
  organizationId: string,
  videoId: string,
  document: ClipDocument,
  dir: string,
  signal?: AbortSignal,
): Promise<RenderCaptionsAsset | undefined> {
  return (await fetchCaptionsTracks(deps, organizationId, videoId, document, dir, signal)).captions;
}

/**
 * Every captions track's words for a render (Module 11). One track reads as
 * it always did: the transcript among the assets of the track's own video
 * (its `source`, else the clip's video `videoId`). A montage's tracks each
 * name their video; each transcript is looked up among THAT video's assets
 * inside the workspace, so a track can never read another workspace's
 * transcript, nor one of a video the document does not play. Every track is
 * drawn in the first track's style, so only that style is resolved.
 */
export async function fetchCaptionsTracks(
  deps: CaptionFetchDeps,
  organizationId: string,
  videoId: string,
  document: ClipDocument,
  dir: string,
  signal?: AbortSignal,
): Promise<FetchedCaptions> {
  const tracks = captionsTracksOf(document);
  const first = tracks[0];
  if (!first) return {};

  const custom: CustomCaptionStyle[] = [];
  if (!isBuiltInCaptionStyle(first.styleId)) {
    const own = await deps.rows.captionStyle(organizationId, first.styleId);
    if (own) custom.push(own);
  }
  // A style that was deleted falls back to the default look: captions never vanish from an export.
  const { style } = resolveStyle(first.styleId, custom);

  const byTrack: Record<string, RenderCaptionsAsset> = {};
  for (const [k, track] of tracks.entries()) {
    // The video this track's words are of: the one it names, else the clip's own.
    const named = track.source
      ? document.sources.find((source) => source.id === track.source)
      : undefined;
    if (track.source && !named) throw new ClipStepError('captions_missing', { retryable: false });
    const trackVideoId = named?.videoId ?? videoId;
    const file = k === 0 ? 'captions-transcript.json.gz' : `captions-transcript-${k}.json.gz`;
    const read = await readTranscript(
      deps,
      organizationId,
      trackVideoId,
      track.transcriptAssetId,
      path.join(dir, file),
      signal,
    );
    const sourceId =
      track.source ?? document.sources.find((source) => source.videoId === trackVideoId)?.id;
    byTrack[track.id] = {
      transcript: read.transcript,
      look: style.look,
      // Only a listened transcript has a real time for every word.
      wordTimed: read.listened,
      ...(sourceId && document.sources.length > 1 ? { sourceId } : {}),
    };
  }
  const captions = byTrack[first.id] as RenderCaptionsAsset;
  return tracks.length > 1 ? { captions, captionsByTrack: byTrack } : { captions };
}

/** One transcript asset of one video of the workspace, with the video's word fixes applied. */
async function readTranscript(
  deps: CaptionFetchDeps,
  organizationId: string,
  videoId: string,
  transcriptAssetId: string,
  file: string,
  signal?: AbortSignal,
): Promise<{ transcript: RenderCaptionsAsset['transcript']; listened: boolean }> {
  const assets = await deps.rows.videoAssets(organizationId, videoId);
  const asset = assets.find((row) => row.kind === 'TRANSCRIPT' && row.id === transcriptAssetId);
  const meta = asset ? readTranscriptAssetMeta(asset.meta) : null;
  if (!asset || !meta) throw new ClipStepError('captions_missing', { retryable: false });

  let text: string;
  try {
    await deps.privateStorage.getToFile(asset.key, file, signal);
    const bytes = await readFile(file);
    if (bytes.length > MAX_GZ_BYTES) throw new TranscriptFileError();
    text = (await gunzipAsync(bytes, { maxOutputLength: MAX_JSON_BYTES })).toString('utf8');
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ClipStepError('captions_missing', { retryable: false, cause: error });
  }

  let transcript: ReturnType<typeof decodeTranscript>;
  try {
    transcript = decodeTranscript(text);
  } catch {
    throw new ClipStepError('captions_missing', { retryable: false });
  }
  return { transcript: applyFixes(transcript, meta.fixes), listened: meta.source === 'listened' };
}
