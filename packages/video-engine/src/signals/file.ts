/**
 * The stored form of a video's signals (Module 16 section 1): one JSON file
 * holding every track with its header, gzipped on disk by the worker (the
 * engine is pure, so the gzip lives in `media-tools`). One file per video,
 * the `SIGNALS` asset: small enough to load in one read for a six hour video
 * (about 43,000 samples a track at two a second, a few hundred KB gzipped).
 *
 * Rules: a track is written once and reused (pressing Find Clips again or a
 * new scorer costs no FFmpeg time); a track whose producer changed carries a
 * new version, and an old one is measured again rather than mixed in.
 */
import { z } from 'zod';
import { isCurrentTrack } from './tracks';
import { RESERVED_SIGNAL_TRACKS, SIGNAL_TRACKS, type SignalTrack, TRACK_UNITS } from './types';

/** The layout of the file itself; bumped only if the shape changes. */
export const SIGNALS_FILE_FORMAT = 1;

/** The most samples one track may hold: 24 hours at two a second. */
export const MAX_TRACK_SAMPLES = 24 * 3600 * 2;

export interface SignalsFile {
  format: typeof SIGNALS_FILE_FORMAT;
  /** The video's length the tracks were measured on. */
  durationMs: number;
  tracks: SignalTrack[];
}

const trackSchema = z
  .object({
    name: z.enum([...SIGNAL_TRACKS, ...RESERVED_SIGNAL_TRACKS]),
    version: z.number().int().positive(),
    sampleRateHz: z.number().positive().max(100),
    startSec: z.number().min(0),
    unit: z.enum(TRACK_UNITS),
    values: z.array(z.number().finite().nullable()).max(MAX_TRACK_SAMPLES),
  })
  .strict();

const fileSchema = z
  .object({
    format: z.literal(SIGNALS_FILE_FORMAT),
    durationMs: z.number().int().min(0),
    tracks: z.array(trackSchema).max(16),
  })
  .strict();

export class SignalsFileError extends Error {
  constructor(message = 'The signals file could not be read.') {
    super(message);
    this.name = 'SignalsFileError';
  }
}

/** Values are kept to two decimals: plenty for a score, and the file stays short. */
function rounded(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const out = Math.round(value * 100) / 100;
  return Object.is(out, -0) ? 0 : out;
}

/** The JSON text of a signals file (the worker gzips it). */
export function encodeSignalsFile(file: SignalsFile): string {
  const out: SignalsFile = {
    format: SIGNALS_FILE_FORMAT,
    durationMs: Math.max(0, Math.round(file.durationMs)),
    tracks: file.tracks.map((track) => ({
      name: track.name,
      version: track.version,
      sampleRateHz: track.sampleRateHz,
      startSec: track.startSec,
      unit: track.unit,
      values: track.values.map(rounded),
    })),
  };
  fileSchema.parse(out);
  return JSON.stringify(out);
}

/** Reads a signals file's JSON text. Throws `SignalsFileError` for anything that does not fit. */
export function decodeSignalsFile(text: string): SignalsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SignalsFileError();
  }
  const result = fileSchema.safeParse(parsed);
  if (!result.success) throw new SignalsFileError();
  return result.data as SignalsFile;
}

/**
 * The stored track of `name` the scorer can reuse: the current version,
 * measured on a video of the same length. Null otherwise.
 */
export function reusableTrack(
  file: SignalsFile | null,
  name: SignalTrack['name'],
  durationMs: number,
): SignalTrack | null {
  if (!file || Math.abs(file.durationMs - durationMs) > 1000) return null;
  const track = file.tracks.find((candidate) => candidate.name === name);
  return track && isCurrentTrack(track) ? track : null;
}

/**
 * A file with `tracks` put in (replacing any of the same name). Old tracks of
 * other names stay when the length matches; otherwise the file starts over.
 */
export function withTracks(
  file: SignalsFile | null,
  durationMs: number,
  tracks: readonly SignalTrack[],
): SignalsFile {
  const kept =
    file && Math.abs(file.durationMs - durationMs) <= 1000
      ? file.tracks.filter((track) => !tracks.some((next) => next.name === track.name))
      : [];
  return {
    format: SIGNALS_FILE_FORMAT,
    durationMs: Math.max(0, Math.round(durationMs)),
    tracks: [...kept, ...tracks],
  };
}
