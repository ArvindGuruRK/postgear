/**
 * Making and changing a clip's captions track (Sprint 13, Module 03). Pure:
 * the editor calls these inside its own undo history, the API to answer the
 * track a new captions request gets.
 */
import type { CaptionsTrack, ClipDocument } from '../document/schema';
import { type CaptionLook, DEFAULT_CAPTION_POSITION } from './styles';

export const CAPTIONS_TRACK_ID = 'captions';

/** A new captions track drawn with `look`, pointing at one transcript. */
export function createCaptionsTrack(input: {
  transcriptAssetId: string;
  language: string;
  styleId: string;
  look: Pick<CaptionLook, 'sizePx' | 'maxWords'>;
}): CaptionsTrack {
  return {
    id: CAPTIONS_TRACK_ID,
    kind: 'captions',
    transcriptAssetId: input.transcriptAssetId,
    language: input.language,
    styleId: input.styleId,
    position: { ...DEFAULT_CAPTION_POSITION },
    sizePx: input.look.sizePx,
    maxWords: input.look.maxWords,
    edits: {},
  };
}

/**
 * The document with `track` as its one captions track. Another transcript
 * (a translation, a supplied file) starts with no word edits, since edits are
 * kept by word index and the indexes are the transcript's own; the place,
 * size and style a person chose stay.
 */
export function withCaptionsTrack<T extends Pick<ClipDocument, 'tracks'>>(
  doc: T,
  track: CaptionsTrack,
): T {
  const old = doc.tracks.find((candidate) => candidate.kind === 'captions');
  const next: CaptionsTrack =
    old && old.kind === 'captions'
      ? {
          ...old,
          transcriptAssetId: track.transcriptAssetId,
          language: track.language,
          edits: old.transcriptAssetId === track.transcriptAssetId ? old.edits : {},
        }
      : track;
  return {
    ...doc,
    tracks: [next, ...doc.tracks.filter((candidate) => candidate.kind !== 'captions')],
  };
}

/** The document with its captions track changed by `change`; unchanged when it has none. */
export function updateCaptionsTrack<T extends Pick<ClipDocument, 'tracks'>>(
  doc: T,
  change: (track: CaptionsTrack) => CaptionsTrack,
): T {
  return {
    ...doc,
    tracks: doc.tracks.map((track) => (track.kind === 'captions' ? change(track) : track)),
  };
}

/** The document without captions. */
export function withoutCaptions<T extends Pick<ClipDocument, 'tracks'>>(doc: T): T {
  return { ...doc, tracks: doc.tracks.filter((track) => track.kind !== 'captions') };
}
