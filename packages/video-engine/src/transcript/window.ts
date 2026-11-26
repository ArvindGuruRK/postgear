/**
 * The words of a stretch. A word belongs to the stretch its middle falls in,
 * so two stretches that meet never both hold the same word.
 */
import type { MsRange, Transcript, TranscriptWord } from './types';
import { wordMid } from './types';

/** The position of the first word whose middle is at or after `ms` (words are sorted by start). */
function firstAtOrAfter(words: readonly TranscriptWord[], ms: number): number {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (wordMid(words[mid] as TranscriptWord) < ms) low = mid + 1;
    else high = mid;
  }
  // Starts are sorted, middles nearly so: step back over a long word that still straddles `ms`.
  while (low > 0 && wordMid(words[low - 1] as TranscriptWord) >= ms) low -= 1;
  return low;
}

/** The words whose middle falls in `[fromMs, toMs)`, in order. */
export function wordsInRange(
  transcript: Pick<Transcript, 'words'>,
  fromMs: number,
  toMs: number,
): TranscriptWord[] {
  if (!(toMs > fromMs)) return [];
  const { words } = transcript;
  const out: TranscriptWord[] = [];
  for (let at = firstAtOrAfter(words, fromMs); at < words.length; at += 1) {
    const word = words[at] as TranscriptWord;
    const mid = wordMid(word);
    if (mid >= toMs) {
      // A later word can still have an earlier middle only if it is shorter and starts
      // within the previous one, which sorted starts allow for a few words at most.
      if (word.start >= toMs) break;
      continue;
    }
    if (mid >= fromMs) out.push(word);
  }
  return out;
}

/** The words whose middle falls in any of the ranges. */
export function wordsInRanges(
  transcript: Pick<Transcript, 'words'>,
  ranges: readonly MsRange[],
): TranscriptWord[] {
  return ranges.flatMap((range) => wordsInRange(transcript, range.fromMs, range.toMs));
}

/** The word being said at `ms`, or the last one said before it; null before the first word. */
export function wordAt(transcript: Pick<Transcript, 'words'>, ms: number): TranscriptWord | null {
  const { words } = transcript;
  let low = 0;
  let high = words.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((words[mid] as TranscriptWord).start <= ms) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? null : (words[low - 1] as TranscriptWord);
}

/** A word by its stable index. */
export function wordByIndex(
  transcript: Pick<Transcript, 'words'>,
  index: number,
): TranscriptWord | null {
  return transcript.words.find((word) => word.i === index) ?? null;
}
