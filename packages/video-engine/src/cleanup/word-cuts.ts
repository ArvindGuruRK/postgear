/**
 * Where to cut for a run of words (Sprint 13, Module 04). Pure.
 *
 * A cut never lands inside a word: it starts in the gap before the first
 * word and ends in the gap after the last, at the gap's middle, but never
 * more than `WORD_AIR_MS` from the word itself (a long pause before a
 * sentence is not taken with it; Remove Silences does that). Research 06,
 * section 5.
 */
import type { MsRange, Transcript, TranscriptWord } from '../transcript/types';

/** The most a cut reaches past the words it removes, into the gap on each side. */
export const WORD_AIR_MS = 150;
/** The shortest cut (a single short word still loses a whole breath of sound). */
export const CUT_MIN_MS = 80;

/** Where each word is in the time-sorted list, by its stable index. */
function positionsOf(words: readonly TranscriptWord[]): Map<number, number> {
  const positions = new Map<number, number>();
  for (const [position, word] of words.entries()) positions.set(word.i, position);
  return positions;
}

/**
 * The stretch of the video to remove for the words from `fromIndex` to
 * `toIndex` (stable indexes, either order; every word between them in time
 * goes too). Null when either word is not in the transcript.
 */
export function cutForWords(
  transcript: Pick<Transcript, 'words'>,
  fromIndex: number,
  toIndex: number,
): MsRange | null {
  const { words } = transcript;
  const positions = positionsOf(words);
  const a = positions.get(fromIndex);
  const b = positions.get(toIndex);
  if (a === undefined || b === undefined) return null;
  const first = Math.min(a, b);
  const last = Math.max(a, b);
  return cutForPositions(words, first, last);
}

/** `cutForWords` by place in the sorted list. */
export function cutForPositions(
  words: readonly TranscriptWord[],
  first: number,
  last: number,
): MsRange | null {
  const head = words[first];
  const tail = words[last];
  if (!head || !tail) return null;
  const before = words[first - 1];
  const after = words[last + 1];
  const start = Math.min(head.start, tail.start);
  const end = Math.max(head.end, tail.end);

  let fromMs = start - WORD_AIR_MS;
  if (before) {
    const middle = (Math.min(before.end, start) + start) / 2;
    fromMs = Math.max(fromMs, middle);
  }
  let toMs = end + WORD_AIR_MS;
  if (after) {
    const middle = (end + Math.max(after.start, end)) / 2;
    toMs = Math.min(toMs, middle);
  }
  fromMs = Math.max(0, Math.round(fromMs));
  toMs = Math.round(toMs);
  if (toMs - fromMs < CUT_MIN_MS) {
    const short = CUT_MIN_MS - (toMs - fromMs);
    fromMs = Math.max(0, fromMs - Math.ceil(short / 2));
    toMs = fromMs + Math.max(CUT_MIN_MS, toMs - fromMs);
  }
  return { fromMs, toMs };
}
