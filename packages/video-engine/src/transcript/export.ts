/**
 * Export The Transcript (Sprint 13, Module 17 item 10).
 *
 * Words with times in, a file out: a plain text file (one sentence a line)
 * or an SRT file (short numbered cues of at most two lines). The words are
 * already on the clock the file is for: a video's own words on the video's
 * clock, a clip's caption words on the clip's clock (`captionWords`, through
 * the time map, so cuts, speed changes, hidden words and bleeps are right).
 *
 * Pure and deterministic: the same words always give the same bytes.
 */
import { endsSentence, SENTENCE_PAUSE_MS } from './sentences';

export const TRANSCRIPT_FILE_FORMATS = ['txt', 'srt'] as const;
export type TranscriptFileFormat = (typeof TRANSCRIPT_FILE_FORMATS)[number];

/** A word on the file's clock, whole milliseconds, `end` exclusive. */
export interface TimedWord {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface CueOptions {
  /** A silence this long ends the cue. Default 900 ms (a sentence's pause). */
  pauseMs?: number;
  /** A cue never holds more characters than this, unless one word is longer. */
  maxChars?: number;
  /** A cue never runs longer than this, unless one word does. */
  maxMs?: number;
}

/** The subtitle guidance most players and platforms follow: two lines of about 42. */
export const SRT_LINE_CHARS = 42;
export const SRT_CUE_MAX_CHARS = SRT_LINE_CHARS * 2;
export const SRT_CUE_MAX_MS = 7_000;

/** A text line is a sentence, so it may run long; a long pause still ends it. */
const TEXT_LINE = { pauseMs: 2_000, maxChars: 600, maxMs: 60_000 } as const;

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what this strips.
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** One word as a file may carry it: no control characters, no SRT arrow. */
function cleanWord(text: string): string {
  return text.replace(CONTROL, ' ').replace(/-->/g, '->').replace(/\s+/g, ' ').trim();
}

/**
 * Words grouped into cues: a cue ends at a sentence's closing punctuation,
 * at a pause, or before it would pass `maxChars` or `maxMs`. A cue ends no
 * later than the next one starts, so the times never go backwards.
 */
export function transcriptCues(
  words: readonly TimedWord[],
  options: CueOptions = {},
): TranscriptCue[] {
  const pauseMs = options.pauseMs ?? SENTENCE_PAUSE_MS;
  const maxChars = options.maxChars ?? SRT_CUE_MAX_CHARS;
  const maxMs = options.maxMs ?? SRT_CUE_MAX_MS;
  const cues: TranscriptCue[] = [];
  let parts: string[] = [];
  let chars = 0;
  let cueStart = 0;
  let cueEnd = 0;

  const close = () => {
    if (parts.length > 0) cues.push({ start: cueStart, end: cueEnd, text: parts.join(' ') });
    parts = [];
    chars = 0;
  };

  const ordered = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const word of ordered) {
    const text = cleanWord(word.text);
    if (text.length === 0) continue;
    const start = Math.max(0, Math.round(word.start));
    const end = Math.max(start + 1, Math.round(word.end));
    if (
      parts.length > 0 &&
      (start - cueEnd >= pauseMs || chars + 1 + text.length > maxChars || end - cueStart > maxMs)
    ) {
      close();
    }
    if (parts.length === 0) {
      cueStart = start;
      cueEnd = end;
      chars = text.length;
    } else {
      chars += 1 + text.length;
      cueEnd = Math.max(cueEnd, end);
    }
    parts.push(text);
    if (endsSentence(text)) close();
  }
  close();

  for (let index = 0; index + 1 < cues.length; index += 1) {
    const cue = cues[index] as TranscriptCue;
    const next = cues[index + 1] as TranscriptCue;
    if (cue.end > next.start) cue.end = Math.max(cue.start + 1, next.start);
  }
  return cues;
}

/** `HH:MM:SS,mmm`, the SRT clock. */
export function srtTime(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  const hours = Math.floor(whole / 3_600_000);
  const minutes = Math.floor((whole % 3_600_000) / 60_000);
  const seconds = Math.floor((whole % 60_000) / 1_000);
  const millis = whole % 1_000;
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(hours)}:${two(minutes)}:${two(seconds)},${String(millis).padStart(3, '0')}`;
}

/** A cue's text on at most two lines, split at the space nearest the middle. */
export function srtLines(text: string, lineChars: number = SRT_LINE_CHARS): string {
  if (text.length <= lineChars) return text;
  const middle = text.length / 2;
  let best = -1;
  for (let at = text.indexOf(' '); at !== -1; at = text.indexOf(' ', at + 1)) {
    if (best === -1 || Math.abs(at - middle) < Math.abs(best - middle)) best = at;
  }
  return best === -1 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** An SRT file: numbered cues, a blank line after each. Empty when there are no words. */
export function writeSrt(cues: readonly TranscriptCue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${srtLines(cue.text)}\n`,
    )
    .join('\n');
}

/** A plain text file: one sentence a line, ending with a new line. */
export function writeTranscriptText(words: readonly TimedWord[]): string {
  const lines = transcriptCues(words, TEXT_LINE).map((cue) => cue.text);
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** The file for `format`, with how many words and cues it holds (for logs: counts, never words). */
export function transcriptFile(
  words: readonly TimedWord[],
  format: TranscriptFileFormat,
): { body: string; words: number; cues: number } {
  const kept = words.filter((word) => cleanWord(word.text).length > 0);
  if (format === 'srt') {
    const cues = transcriptCues(kept);
    return { body: writeSrt(cues), words: kept.length, cues: cues.length };
  }
  const body = writeTranscriptText(kept);
  return { body, words: kept.length, cues: body === '' ? 0 : body.split('\n').length - 1 };
}
