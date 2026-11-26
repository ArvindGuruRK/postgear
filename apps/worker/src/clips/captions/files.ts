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
 */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import type { PrivateStorage } from '@postgear/storage';
import {
  applyFixes,
  captionsTrackOf,
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

/**
 * The captions asset for a document, or undefined when it has no captions.
 * Throws a permanent `captions_missing` when the transcript cannot be found
 * or read: an export must never quietly lose its captions.
 */
export async function fetchCaptions(
  deps: CaptionFetchDeps,
  organizationId: string,
  videoId: string,
  document: ClipDocument,
  dir: string,
  signal?: AbortSignal,
): Promise<RenderCaptionsAsset | undefined> {
  const track = captionsTrackOf(document);
  if (!track) return undefined;

  const assets = await deps.rows.videoAssets(organizationId, videoId);
  const asset = assets.find(
    (row) => row.kind === 'TRANSCRIPT' && row.id === track.transcriptAssetId,
  );
  const meta = asset ? readTranscriptAssetMeta(asset.meta) : null;
  if (!asset || !meta) throw new ClipStepError('captions_missing', { retryable: false });

  const file = path.join(dir, 'captions-transcript.json.gz');
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

  const custom: CustomCaptionStyle[] = [];
  if (!isBuiltInCaptionStyle(track.styleId)) {
    const own = await deps.rows.captionStyle(organizationId, track.styleId);
    if (own) custom.push(own);
  }
  // A style that was deleted falls back to the default look: captions never vanish from an export.
  const { style } = resolveStyle(track.styleId, custom);

  const sourceId = document.sources.find((source) => source.videoId === videoId)?.id;
  return {
    transcript: applyFixes(transcript, meta.fixes),
    look: style.look,
    // Only a listened transcript has a real time for every word.
    wordTimed: meta.source === 'listened',
    ...(sourceId && document.sources.length > 1 ? { sourceId } : {}),
  };
}
