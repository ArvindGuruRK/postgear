/**
 * Which of a clip's words still play (Sprint 13, Module 04). Pure.
 *
 * The Transcript pane shows the words of the clip's stretch of the video and
 * marks each one: `played` (the clip plays it), `removed` (inside the clip's
 * span but cut out: struck through, with Restore), or `outside` (before the
 * clip's first moment or after its last: dimmed context). A word plays when
 * more than half of it falls in a part, the same rule the captions use.
 */
import type { ClipDocument } from '../document/schema';
import type { Transcript, TranscriptWord } from '../transcript/types';

export type WordPlace = 'played' | 'removed' | 'outside';

function plays(
  word: TranscriptWord,
  doc: Pick<ClipDocument, 'segments'>,
  sourceId: string,
): boolean {
  const length = word.end - word.start;
  return doc.segments.some((segment) => {
    if (segment.source !== sourceId) return false;
    const overlap = Math.min(word.end, segment.sourceOut) - Math.max(word.start, segment.sourceIn);
    return length <= 0 ? overlap >= 0 && word.start >= segment.sourceIn : overlap * 2 > length;
  });
}

/** Each word's place in the clip, by stable index. */
export function wordPlaces(
  doc: Pick<ClipDocument, 'segments'>,
  transcript: Pick<Transcript, 'words'>,
  sourceId: string,
): Map<number, WordPlace> {
  const parts = doc.segments.filter((segment) => segment.source === sourceId);
  const places = new Map<number, WordPlace>();
  if (parts.length === 0) {
    for (const word of transcript.words) places.set(word.i, 'outside');
    return places;
  }
  const spanFrom = Math.min(...parts.map((segment) => segment.sourceIn));
  const spanTo = Math.max(...parts.map((segment) => segment.sourceOut));
  for (const word of transcript.words) {
    if (plays(word, doc, sourceId)) {
      places.set(word.i, 'played');
      continue;
    }
    const middle = (word.start + word.end) / 2;
    places.set(word.i, middle >= spanFrom && middle < spanTo ? 'removed' : 'outside');
  }
  return places;
}

/** The stable indexes of the words cut out of the clip's span, in time order. */
export function removedWords(
  doc: Pick<ClipDocument, 'segments'>,
  transcript: Pick<Transcript, 'words'>,
  sourceId: string,
): number[] {
  const places = wordPlaces(doc, transcript, sourceId);
  return transcript.words.filter((word) => places.get(word.i) === 'removed').map((word) => word.i);
}
