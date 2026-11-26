/**
 * The stored form of a transcript: one JSON file, gzipped on disk by whoever
 * writes it (the engine is pure, so the gzip is not here). About half a
 * megabyte for an hour of speech before gzip.
 *
 * Read strictly: an unknown key, a backwards word, an index used twice or
 * covered ranges that overlap are all refusals, because every caption, cut
 * and AI pick trusts this file.
 */
import { z } from 'zod';
import { mergeRanges } from './covered';
import {
  MAX_TRANSCRIPT_WORDS,
  MAX_WORD_CHARS,
  MAX_WORD_MS,
  type Transcript,
  TRANSCRIPT_SOURCES,
  TRANSCRIPT_VERSION,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const ms = z.number().int().min(0).max(DAY_MS);

const wordSchema = z
  .object({
    i: z.number().int().min(0),
    start: ms,
    end: ms,
    text: z.string().min(1).max(MAX_WORD_CHARS),
    sure: z.number().min(0).max(1),
  })
  .strict();

const rangeSchema = z.object({ fromMs: ms, toMs: ms }).strict();

export const transcriptSchema = z
  .object({
    version: z.literal(TRANSCRIPT_VERSION),
    language: z.string().regex(/^[a-z]{2,3}$/),
    model: z.string().min(1).max(80),
    source: z.enum(TRANSCRIPT_SOURCES),
    covered: z.array(rangeSchema).max(10_000),
    words: z.array(wordSchema).max(MAX_TRANSCRIPT_WORDS),
    nextIndex: z.number().int().min(0),
  })
  .strict()
  .superRefine((transcript, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    let previousEnd = -1;
    for (const range of transcript.covered) {
      if (range.toMs <= range.fromMs) return issue('A covered stretch must end after it starts');
      if (range.fromMs < previousEnd) return issue('Covered stretches must be in order and apart');
      previousEnd = range.toMs;
    }
    const seen = new Set<number>();
    let previousStart = -1;
    for (const word of transcript.words) {
      if (word.end <= word.start) return issue('A word must end after it starts');
      if (word.end - word.start > MAX_WORD_MS) return issue('A word is too long');
      if (word.start < previousStart) return issue('Words must be in time order');
      if (seen.has(word.i)) return issue('A word index is used twice');
      if (word.i >= transcript.nextIndex) return issue('A word index is past the next index');
      seen.add(word.i);
      previousStart = word.start;
    }
  });

export class TranscriptFileError extends Error {
  constructor(message = 'The transcript file could not be read.') {
    super(message);
    this.name = 'TranscriptFileError';
  }
}

/** The JSON text of a transcript file. Throws when the transcript breaks its own rules. */
export function encodeTranscript(transcript: Transcript): string {
  const out: Transcript = {
    version: TRANSCRIPT_VERSION,
    language: transcript.language,
    model: transcript.model,
    source: transcript.source,
    covered: mergeRanges(transcript.covered),
    words: transcript.words.map((word) => ({
      i: word.i,
      start: word.start,
      end: word.end,
      text: word.text,
      sure: word.sure,
    })),
    nextIndex: transcript.nextIndex,
  };
  const checked = transcriptSchema.safeParse(out);
  if (!checked.success) throw new TranscriptFileError('The transcript breaks its own rules.');
  return JSON.stringify(out);
}

/** Reads a transcript file's JSON text. Throws `TranscriptFileError`, never the text itself. */
export function decodeTranscript(text: string): Transcript {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TranscriptFileError();
  }
  const parsed = transcriptSchema.safeParse(raw);
  if (!parsed.success) throw new TranscriptFileError();
  return parsed.data;
}
