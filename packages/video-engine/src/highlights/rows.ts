/**
 * The transcript as numbered rows, for the moment picker (Sprint 13, Module 05). Pure.
 *
 * The model is shown rows, never times: it answers with row numbers and the
 * engine turns them back into a stretch of the video. That removes invented
 * timestamps (research 06, section 4). A row is a sentence of the
 * transcript, at most `ROW_MAX_MS` long (`sentences()` splits a long one).
 */
import { sentences } from '../transcript/sentences';
import type { MsRange, Transcript } from '../transcript/types';

/** The longest one row may be. */
export const ROW_MAX_MS = 20_000;

export interface TranscriptRow {
  /** 1, 2, 3, ... in time order: what the model answers with. */
  n: number;
  /** Video time of its first word's start and its last word's end. */
  from: number;
  to: number;
  text: string;
}

/** The sentences of `range` as numbered rows (a sentence belongs where its middle falls). */
export function transcriptRows(
  transcript: Pick<Transcript, 'words' | 'covered'>,
  range: MsRange,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const sentence of sentences(transcript, { maxMs: ROW_MAX_MS })) {
    const middle = (sentence.from + sentence.to) / 2;
    if (middle < range.fromMs || middle >= range.toMs) continue;
    rows.push({ n: rows.length + 1, from: sentence.from, to: sentence.to, text: sentence.text });
  }
  return rows;
}

export interface WindowOptions {
  /** How much of the video one model call reads. */
  windowMs?: number;
  /** How much each window repeats of the one before, so a moment on a seam is seen whole. */
  overlapMs?: number;
}

export const WINDOW_MS = 90_000;
export const WINDOW_OVERLAP_MS = 30_000;

/** Overlapping groups of whole rows, in order; every row is in at least one. */
export function rowWindows(
  rows: readonly TranscriptRow[],
  options: WindowOptions = {},
): TranscriptRow[][] {
  const windowMs = Math.max(1_000, options.windowMs ?? WINDOW_MS);
  const overlapMs = Math.min(windowMs - 1_000, Math.max(0, options.overlapMs ?? WINDOW_OVERLAP_MS));
  const windows: TranscriptRow[][] = [];
  let start = 0;
  while (start < rows.length) {
    const first = rows[start] as TranscriptRow;
    const window: TranscriptRow[] = [];
    let end = start;
    while (end < rows.length) {
      const row = rows[end] as TranscriptRow;
      if (window.length > 0 && row.to - first.from > windowMs) break;
      window.push(row);
      end += 1;
    }
    windows.push(window);
    if (end >= rows.length) break;
    // The next window starts at the first row inside the overlap, always moving forward.
    const nextFrom = first.from + windowMs - overlapMs;
    let next = start + 1;
    while (next < end && (rows[next] as TranscriptRow).from < nextFrom) next += 1;
    start = Math.min(next, end);
  }
  return windows;
}
