/**
 * Upload SRT (Sprint 13, Module 03): a captions file a person already has,
 * read into a transcript with no listening and no AI minutes.
 *
 * Reads SRT and WebVTT cues. Tolerant of what real files hold: a byte order
 * mark, Windows line ends, a cue number or a cue id (or neither), `,` or `.`
 * before the milliseconds, hours left out (`MM:SS.mmm`), position settings
 * after the times, and basic tags (`<i>`, `<b>`, `<c.yellow>`, `{\an8}`).
 * A `NOTE`, `STYLE` or `REGION` block of a VTT file is skipped.
 *
 * A cue's time is spread over its words by their length, as a translation's
 * is, so the page (the cue) is the unit of highlight, not the word. Cues that
 * overlap are kept in order and never run into the next one.
 *
 * Refuses a file with no cue it can read. Never echoes the file's text in an
 * error.
 */
import {
  type HeardWord,
  MAX_TRANSCRIPT_WORDS,
  MAX_WORD_CHARS,
  type MsRange,
  type Transcript,
  TRANSCRIPT_VERSION,
} from '../transcript/types';

/** A captions file may be this big (decision: the sprint doc says 2 MB on the video, 1 MB on a clip; one limit). */
export const SUBTITLE_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const SUBTITLE_MAX_CUES = 20_000;

export interface SubtitleCue {
  /** Whole milliseconds of the file's own clock. */
  start: number;
  end: number;
  text: string;
}

export type SubtitleFormat = 'srt' | 'vtt';

export class SubtitleFileError extends Error {
  readonly reason: 'empty' | 'too_big' | 'no_cues';

  constructor(reason: SubtitleFileError['reason']) {
    super('The captions file could not be read.');
    this.name = 'SubtitleFileError';
    this.reason = reason;
  }
}

const TIME = String.raw`(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?`;
const CUE_TIMES = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}(?:\s+.*)?$`);

function toMs(hours: string | undefined, minutes: string, seconds: string, fraction: string | undefined): number {
  const ms = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;
  return ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + ms;
}

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&#39;': "'",
  '&lrm;': '',
  '&rlm;': '',
});

/** A cue's text with its tags and entities taken out, on one line. */
export function cleanCueText(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]{0,80}>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|quot|#39|lrm|rlm);/g, (entity) => ENTITIES[entity] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The cues of an SRT or VTT file, in time order. Throws `SubtitleFileError`. */
export function parseSubtitleCues(input: string): { format: SubtitleFormat; cues: SubtitleCue[] } {
  if (input.length > SUBTITLE_FILE_MAX_BYTES) throw new SubtitleFileError('too_big');
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (text.trim().length === 0) throw new SubtitleFileError('empty');
  const format: SubtitleFormat = /^WEBVTT(?:[ \t\n]|$)/.test(text) ? 'vtt' : 'srt';

  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    const at = lines.findIndex((line) => CUE_TIMES.test(line));
    // A cue's times are on its first or second line (after a number or an id).
    if (at < 0 || at > 1) continue;
    const match = CUE_TIMES.exec(lines[at] as string);
    if (!match) continue;
    const start = toMs(match[1], match[2] as string, match[3] as string, match[4]);
    const end = toMs(match[5], match[6] as string, match[7] as string, match[8]);
    const body = cleanCueText(lines.slice(at + 1).join(' '));
    if (end <= start || body.length === 0) continue;
    cues.push({ start, end, text: body });
    if (cues.length > SUBTITLE_MAX_CUES) break;
  }
  if (cues.length === 0) throw new SubtitleFileError('no_cues');
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  // A cue never runs into the next one: two lines at once are shown one after the other.
  for (let index = 0; index < cues.length - 1; index += 1) {
    const cue = cues[index] as SubtitleCue;
    const next = cues[index + 1] as SubtitleCue;
    if (cue.end > next.start) cue.end = Math.max(cue.start + 1, next.start);
  }
  return { format, cues: cues.filter((cue) => cue.end > cue.start) };
}

/**
 * A line's time spread over its words by their length (a longer word takes
 * longer to say). Also used for a translated line. The last word of a line
 * closes its sentence, so a page never joins two lines.
 */
export function spreadWords(
  text: string,
  start: number,
  end: number,
  options: { closeSentence?: boolean } = {},
): HeardWord[] {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0 || end <= start) return [];
  const units = tokens.map((token) => Math.min(token.length, 20) + 2);
  const total = units.reduce((sum, value) => sum + value, 0);
  const span = end - start;
  const words: HeardWord[] = [];
  let cursor = start;
  let used = 0;
  tokens.forEach((token, index) => {
    used += units[index] as number;
    const until = index === tokens.length - 1 ? end : start + Math.round((span * used) / total);
    const wordEnd = Math.max(cursor + 1, until);
    let word = token.slice(0, MAX_WORD_CHARS);
    if (options.closeSentence && index === tokens.length - 1 && !/[.!?…।]["')\]]*$/u.test(word)) {
      word = `${word}.`.slice(0, MAX_WORD_CHARS);
    }
    words.push({ start: cursor, end: wordEnd, text: word, sure: 1 });
    cursor = wordEnd;
  });
  return words;
}

export interface SuppliedTranscript {
  transcript: Transcript;
  format: SubtitleFormat;
  cues: number;
  /** Cues left out because they fall outside `window`. */
  skipped: number;
}

/** Where one cue of a file belongs in the video, or null when it belongs nowhere. */
export type CuePlacer = (cue: Pick<SubtitleCue, 'start' | 'end'>) => {
  start: number;
  end: number;
} | null;

/**
 * A captions file as a transcript marked `supplied`.
 *
 * A file's clock is either the video's (`offsetMs` 0, the default) or the
 * clip's: for a clip that is one uncut stretch that is an `offsetMs` (the
 * clip's start), and for a clip with cuts, speeds or reordered parts it is a
 * `place` function that maps each cue through the clip's parts
 * (`clipClockPlacer`). Cues outside `window` (the video, or the clip's
 * stretch) are left out and counted. Words are answered in video time order,
 * whatever order the clip plays its parts in.
 */
export function parseSubtitleFile(
  input: string,
  options: { language: string; window: MsRange; offsetMs?: number; place?: CuePlacer },
): SuppliedTranscript {
  const { format, cues } = parseSubtitleCues(input);
  const offset = Math.round(options.offsetMs ?? 0);
  const place: CuePlacer =
    options.place ?? ((cue) => ({ start: cue.start + offset, end: cue.end + offset }));
  const { window } = options;
  let skipped = 0;
  const heard: HeardWord[] = [];
  for (const cue of cues) {
    const placed = place(cue);
    const start = placed ? Math.round(placed.start) : Number.NaN;
    const end = placed ? Math.min(Math.round(placed.end), window.toMs) : Number.NaN;
    if (!placed || !(start >= window.fromMs) || start >= window.toMs || !(end > start)) {
      skipped += 1;
      continue;
    }
    for (const word of spreadWords(cue.text, start, end)) {
      if (heard.length >= MAX_TRANSCRIPT_WORDS) break;
      heard.push(word);
    }
  }
  heard.sort((a, b) => a.start - b.start || a.end - b.end);
  // Reordered parts can put two cues on one stretch of video: a word never runs into the next.
  for (let at = 0; at < heard.length - 1; at += 1) {
    const word = heard[at] as HeardWord;
    const next = heard[at + 1] as HeardWord;
    if (word.end > next.start) word.end = Math.max(word.start + 1, next.start);
  }
  const words: Transcript['words'] = heard.map((word, i) => ({ i, ...word }));
  const nextIndex = words.length;
  if (words.length === 0) throw new SubtitleFileError('no_cues');
  return {
    transcript: {
      version: TRANSCRIPT_VERSION,
      language: options.language,
      model: 'supplied',
      source: 'supplied',
      // The person's own words stand for the whole stretch: nothing is listened to on top.
      covered: [{ fromMs: window.fromMs, toMs: window.toMs }],
      words,
      nextIndex,
    },
    format,
    cues: cues.length,
    skipped,
  };
}
