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
 *
 * A montage (Module 11) has one captions track per video: there `track`
 * takes the place of the one for its `source` (the first one when it names
 * none, or none matches), and the others stay as they are.
 */
export function withCaptionsTrack<T extends Pick<ClipDocument, 'tracks'>>(
  doc: T,
  track: CaptionsTrack,
): T {
  const all = doc.tracks.filter((candidate) => candidate.kind === 'captions');
  const same =
    track.source !== undefined
      ? all.find((candidate) => candidate.kind === 'captions' && candidate.source === track.source)
      : undefined;
  const first = all[0];
  if (
    track.source !== undefined &&
    !same &&
    first?.kind === 'captions' &&
    first.source !== undefined
  ) {
    // A montage's video with no captions yet: a track of its own, in the first one's look.
    const taken = new Set(doc.tracks.map((candidate) => candidate.id));
    let id = track.id;
    for (let n = 2; taken.has(id); n += 1) id = `${track.id}_${n}`;
    const added: CaptionsTrack = {
      ...track,
      id,
      styleId: first.styleId,
      position: { ...first.position },
      sizePx: first.sizePx,
      maxWords: first.maxWords,
    };
    if (first.letterCase !== undefined) added.letterCase = first.letterCase;
    if (first.markColour !== undefined) added.markColour = first.markColour;
    return { ...doc, tracks: [...doc.tracks, added] };
  }
  const old = same ?? first;
  const next: CaptionsTrack =
    old && old.kind === 'captions'
      ? {
          ...old,
          transcriptAssetId: track.transcriptAssetId,
          language: track.language,
          edits: old.transcriptAssetId === track.transcriptAssetId ? old.edits : {},
        }
      : track;
  if (all.length > 1) {
    return {
      ...doc,
      tracks: doc.tracks.map((candidate) => (candidate === old ? next : candidate)),
    };
  }
  return {
    ...doc,
    tracks: [next, ...doc.tracks.filter((candidate) => candidate.kind !== 'captions')],
  };
}

/**
 * The document with its captions track changed by `change`; unchanged when it
 * has none. A montage's tracks (one per video, Module 11) all take the
 * change, so a style, size or place stays the same on each; a change to word
 * edits, which are keyed by each transcript's own word indexes, names its
 * track with `options.trackId`.
 */
export function updateCaptionsTrack<T extends Pick<ClipDocument, 'tracks'>>(
  doc: T,
  change: (track: CaptionsTrack) => CaptionsTrack,
  options: { trackId?: string } = {},
): T {
  return {
    ...doc,
    tracks: doc.tracks.map((track) =>
      track.kind === 'captions' && (options.trackId === undefined || track.id === options.trackId)
        ? change(track)
        : track,
    ),
  };
}

/** The document without captions. */
export function withoutCaptions<T extends Pick<ClipDocument, 'tracks'>>(doc: T): T {
  return { ...doc, tracks: doc.tracks.filter((track) => track.kind !== 'captions') };
}
