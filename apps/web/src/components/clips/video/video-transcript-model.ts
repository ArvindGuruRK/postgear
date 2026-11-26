/**
 * The video page's transcript sheet (Sprint 13, Module 04), as plain data:
 * the listened parts as paragraphs with gaps between them, finding words,
 * and the clip a selection of words makes. Tested without React.
 */
import type { TranscriptTextParagraph } from '@postgear/ui';
import {
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  formatClipLength,
  type MsRange,
  type TranscriptWord,
  UNSURE_BELOW,
} from '@postgear/video-engine';

/** A pause this long starts a new paragraph (the same as the editor's pane). */
const PARAGRAPH_PAUSE_MS = 1_200;
const PARAGRAPH_MAX_WORDS = 60;
/** A clip from text starts this much before its first word and ends this much after its last. */
export const CLIP_AIR_MS = 150;

export const NOT_LISTENED = 'Not listened to yet';
export const SELECT_TO_CLIP = 'Select words to make a clip of them.';

export type SheetSection =
  | { kind: 'words'; key: string; range: MsRange; paragraphs: TranscriptTextParagraph[] }
  | { kind: 'gap'; key: string; range: MsRange };

function endsSentence(text: string): boolean {
  return /[.!?…]["')\]]*$/.test(text.trim());
}

function paragraphsOf(words: readonly TranscriptWord[]): TranscriptTextParagraph[] {
  const out: Array<{ key: string; words: TranscriptWord[] }> = [];
  let previous: TranscriptWord | null = null;
  for (const word of words) {
    const current = out.at(-1);
    const breakHere =
      !current ||
      (previous !== null && word.start - previous.end >= PARAGRAPH_PAUSE_MS) ||
      current.words.length >= PARAGRAPH_MAX_WORDS ||
      (current.words.length >= 30 && previous !== null && endsSentence(previous.text));
    if (breakHere) out.push({ key: `p${word.i}`, words: [word] });
    else current.words.push(word);
    previous = word;
  }
  return out.map((paragraph) => ({
    key: paragraph.key,
    label: formatClipLength(paragraph.words[0]?.start ?? 0),
    words: paragraph.words.map((word) => ({
      id: word.i,
      text: word.text,
      unsure: word.sure < UNSURE_BELOW,
    })),
  }));
}

/**
 * The video from start to end: each listened part as paragraphs, and the
 * parts not listened to yet as gaps (each with its own Listen).
 */
export function sheetSections(
  words: readonly TranscriptWord[],
  covered: readonly MsRange[],
  durationMs: number,
): SheetSection[] {
  const sections: SheetSection[] = [];
  let cursor = 0;
  const sorted = [...covered].sort((a, b) => a.fromMs - b.fromMs);
  for (const range of sorted) {
    if (range.fromMs > cursor) {
      sections.push({
        kind: 'gap',
        key: `gap${cursor}`,
        range: { fromMs: cursor, toMs: range.fromMs },
      });
    }
    const inside = words.filter((word) => word.start >= range.fromMs && word.start < range.toMs);
    if (inside.length > 0) {
      sections.push({
        kind: 'words',
        key: `words${range.fromMs}`,
        range,
        paragraphs: paragraphsOf(inside),
      });
    }
    cursor = Math.max(cursor, range.toMs);
  }
  if (durationMs > cursor) {
    sections.push({
      kind: 'gap',
      key: `gap${cursor}`,
      range: { fromMs: cursor, toMs: durationMs },
    });
  }
  return sections;
}

/** A word as find compares it: lower case, without the punctuation around it. */
function bare(text: string): string {
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Every place the words of `query` are said, in order: each match is the
 * run of word indexes it covers. One word matches any word that starts with
 * it ("lear" finds "learned"); several words must follow each other, the
 * last one again by its start.
 */
export function findInWords(words: readonly TranscriptWord[], query: string): number[][] {
  const tokens = query
    .split(/\s+/)
    .map(bare)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [];
  const matches: number[][] = [];
  for (let p = 0; p + tokens.length <= words.length; p += 1) {
    let ok = true;
    for (let k = 0; k < tokens.length; k += 1) {
      const word = bare((words[p + k] as TranscriptWord).text);
      const token = tokens[k] as string;
      const last = k === tokens.length - 1;
      if (last ? !word.startsWith(token) : word !== token) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(words.slice(p, p + tokens.length).map((word) => word.i));
  }
  return matches;
}

/** The clip a selection of words makes, or the sentence why it cannot be made. */
export function clipRangeForWords(
  words: readonly TranscriptWord[],
  ids: readonly number[],
  durationMs: number,
): { ok: true; fromMs: number; toMs: number } | { ok: false; sentence: string } {
  const wanted = new Set(ids);
  const chosen = words.filter((word) => wanted.has(word.i));
  const first = chosen[0];
  const last = chosen.at(-1);
  if (!first || !last) return { ok: false, sentence: SELECT_TO_CLIP };
  const fromMs = Math.max(0, first.start - CLIP_AIR_MS);
  const toMs = Math.min(
    durationMs > 0 ? durationMs : last.end + CLIP_AIR_MS,
    last.end + CLIP_AIR_MS,
  );
  if (toMs - fromMs < CLIP_MIN_MS) {
    return { ok: false, sentence: 'Select at least 3 seconds of speech to make a clip.' };
  }
  if (toMs - fromMs > CLIP_MAX_MS) {
    return { ok: false, sentence: 'A clip can be at most 30 minutes long. Select less.' };
  }
  return { ok: true, fromMs, toMs };
}
