/**
 * The `TRANSCRIPT` asset's `meta` (the row beside the stored file), and the
 * speech curve worked out from a transcript.
 *
 * `meta` holds what the API needs without opening the file: the language, the
 * covered stretches (so `ensure` can answer "already listened" with one row
 * read), the word count, where the words came from, and the word fixes, which
 * live here so they survive the file being rewritten by a later listen.
 */
import { z } from 'zod';
import { mergeRanges } from './covered';
import type { WordFix } from './fixes';
import { MAX_WORD_FIXES } from './fixes';
import { MAX_WORD_CHARS, type MsRange, type Transcript, TRANSCRIPT_SOURCES } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const ms = z.number().int().min(0).max(DAY_MS);

export const transcriptAssetMetaSchema = z
  .object({
    language: z.string().regex(/^[a-z]{2,3}$/),
    model: z.string().min(1).max(80),
    source: z.enum(TRANSCRIPT_SOURCES),
    covered: z.array(z.object({ fromMs: ms, toMs: ms }).strict()).max(10_000),
    words: z.number().int().min(0),
    fixes: z
      .array(z.object({ at: ms, text: z.string().min(1).max(MAX_WORD_CHARS) }).strict())
      .max(MAX_WORD_FIXES),
    /** The supplied file's name, for "From your file: episode14.srt". */
    fileName: z.string().min(1).max(200).optional(),
    /** A translation: the transcript row it was made from. */
    origin: z.string().uuid().optional(),
    /** A translation: a hash of the language and the sentences it translated, to answer the same request once. */
    inputHash: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
  })
  .strict();

export type TranscriptAssetMeta = z.infer<typeof transcriptAssetMetaSchema>;

/** The meta of a stored transcript, keeping the fixes already made. */
export function transcriptAssetMeta(
  transcript: Transcript,
  fixes: readonly WordFix[] = [],
  fileName?: string,
): TranscriptAssetMeta {
  return {
    language: transcript.language,
    model: transcript.model,
    source: transcript.source,
    covered: mergeRanges(transcript.covered),
    words: transcript.words.length,
    fixes: [...fixes].sort((a, b) => a.at - b.at).slice(-MAX_WORD_FIXES),
    ...(fileName ? { fileName } : {}),
  };
}

/** A stored meta, or null when it does not read (a row written by something else). */
export function readTranscriptAssetMeta(raw: unknown): TranscriptAssetMeta | null {
  const parsed = transcriptAssetMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The speech curve's rate: the same two a second as every signal track. */
export const SPEECH_RATE_HZ = 2;
const SLOT_MS = 1000 / SPEECH_RATE_HZ;

/**
 * How sure we are someone is talking, 0 to 1, two values a second from the
 * start of the video: the share of each half second covered by words,
 * weighted by how sure each word was. `null` where nothing was listened to.
 *
 * Worked out from the words whenever it is needed (Remove Silences, the
 * moment picker), so it is never stored and can never disagree with the
 * transcript after a fix or a new listen. The Python service computes the
 * same curve for its heard file.
 */
export function speechValues(
  transcript: Pick<Transcript, 'words' | 'covered'>,
  durationMs: number,
): Array<number | null> {
  const slots = Math.max(0, Math.ceil(durationMs / SLOT_MS));
  const values: Array<number | null> = new Array(slots).fill(null);
  for (const range of transcript.covered) {
    const first = Math.max(0, Math.floor(range.fromMs / SLOT_MS));
    const last = Math.min(slots, Math.ceil(range.toMs / SLOT_MS));
    for (let slot = first; slot < last; slot += 1) values[slot] = 0;
  }
  for (const word of transcript.words) {
    if (word.end <= word.start) continue;
    const first = Math.max(0, Math.floor(word.start / SLOT_MS));
    const last = Math.min(slots - 1, Math.floor((word.end - 1) / SLOT_MS));
    for (let slot = first; slot <= last; slot += 1) {
      const current = values[slot];
      if (current === null || current === undefined) continue;
      const from = slot * SLOT_MS;
      const overlap = Math.min(word.end, from + SLOT_MS) - Math.max(word.start, from);
      if (overlap > 0) values[slot] = Math.min(1, current + (overlap / SLOT_MS) * word.sure);
    }
  }
  return values.map((value) => (value === null ? null : Math.round(value * 100) / 100));
}

/** The silences of a stretch: gaps between words at least `minMs` long, inside listened parts. */
export function silencesIn(
  transcript: Pick<Transcript, 'words' | 'covered'>,
  window: MsRange,
  minMs: number,
): MsRange[] {
  const out: MsRange[] = [];
  for (const covered of mergeRanges(transcript.covered)) {
    const from = Math.max(covered.fromMs, window.fromMs);
    const to = Math.min(covered.toMs, window.toMs);
    if (to <= from) continue;
    let cursor = from;
    for (const word of transcript.words) {
      if (word.end <= from) continue;
      if (word.start >= to) break;
      if (word.start - cursor >= minMs) out.push({ fromMs: cursor, toMs: word.start });
      cursor = Math.max(cursor, word.end);
    }
    if (to - cursor >= minMs) out.push({ fromMs: cursor, toMs: to });
  }
  return out;
}
