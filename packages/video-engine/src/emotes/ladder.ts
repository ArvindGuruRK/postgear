/**
 * The size ladder (Module 14, B2): how an emote is made smaller until it
 * fits its site's cap, one rung at a time, best first.
 *
 * Never the pixel size, never the length: only the frame rate, the colours
 * and the dither move (a WebP walks its quality down instead of colours). A
 * rung's frame rate is capped by the site's frame limit for this length, so
 * `frames = fps x seconds` can never pass it (20 fps for 3 seconds at 60
 * frames). Each output climbs from rung 1; the worker encodes, measures, and
 * stops at the first file under the cap. Past the last rung the answer is
 * `emote_too_big`, with the site and the size in the sentence.
 *
 * Starting point (research 10, section 4.1), tuned by the Module 14 spike:
 * 20 fps 256 colours, 20 fps 128, 15 fps 128, 15 fps 64, 12 fps 64 with no
 * dither, 10 fps 32 with no dither. Higher `bayer_scale` draws a fainter
 * pattern and a smaller file.
 */
import { emoteTooBigSentence } from './messages';
import type { EmoteOutput, EmoteProfile } from './profiles';

export type EmoteDither = { mode: 'bayer'; scale: number } | { mode: 'none' };

export interface EmoteRung {
  /** 1 is the best rung. */
  index: number;
  /** Frames a second, already capped by the frame limit; 0 for a still. */
  fps: number;
  /** Palette size; null keeps full colour (an APNG's or a still's first rung, and every WebP). */
  colours: number | null;
  dither: EmoteDither;
  /** WebP only: `-quality`, 0 to 100. */
  quality: number | null;
}

type RungSpec = Omit<EmoteRung, 'index'>;

const bayer = (scale: number): EmoteDither => ({ mode: 'bayer', scale });
const NONE: EmoteDither = { mode: 'none' };

const GIF_LADDER: readonly RungSpec[] = [
  { fps: 20, colours: 256, dither: bayer(3), quality: null },
  { fps: 20, colours: 128, dither: bayer(3), quality: null },
  { fps: 15, colours: 128, dither: bayer(4), quality: null },
  { fps: 15, colours: 64, dither: bayer(5), quality: null },
  { fps: 12, colours: 64, dither: NONE, quality: null },
  { fps: 10, colours: 32, dither: NONE, quality: null },
];

/** An APNG starts in full colour (soft edges on a keyed emote), then walks the GIF palette rungs. */
const APNG_LADDER: readonly RungSpec[] = [
  { fps: 20, colours: null, dither: NONE, quality: null },
  ...GIF_LADDER.slice(0, 1),
  ...GIF_LADDER.slice(2),
];

const WEBP_LADDER: readonly RungSpec[] = [
  { fps: 20, colours: null, dither: NONE, quality: 80 },
  { fps: 20, colours: null, dither: NONE, quality: 70 },
  { fps: 15, colours: null, dither: NONE, quality: 60 },
  { fps: 15, colours: null, dither: NONE, quality: 50 },
  { fps: 12, colours: null, dither: NONE, quality: 40 },
  { fps: 10, colours: null, dither: NONE, quality: 30 },
];

/** A still: full colour first, then a palette (a still PNG with a palette is a third the size). */
const PNG_LADDER: readonly RungSpec[] = [
  { fps: 0, colours: null, dither: NONE, quality: null },
  { fps: 0, colours: 256, dither: bayer(3), quality: null },
  { fps: 0, colours: 128, dither: bayer(4), quality: null },
  { fps: 0, colours: 64, dither: bayer(5), quality: null },
  { fps: 0, colours: 32, dither: NONE, quality: null },
];

const LADDERS: Record<EmoteOutput['format'], readonly RungSpec[]> = {
  gif: GIF_LADDER,
  apng: APNG_LADDER,
  webp: WEBP_LADDER,
  png: PNG_LADDER,
};

/** How many rungs a format has. */
export function ladderLength(format: EmoteOutput['format']): number {
  return LADDERS[format].length;
}

/** The highest frame rate that keeps `seconds` of emote within the site's frame limit (at least 1). */
export function emoteFpsCap(profile: Pick<EmoteProfile, 'maxFrames'>, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.floor(profile.maxFrames / seconds));
}

/** The frames an encode of `seconds` at `fps` holds, at most the limit (the encoder stops there too). */
export function emoteFrames(
  profile: Pick<EmoteProfile, 'maxFrames'>,
  seconds: number,
  fps: number,
): number {
  if (fps <= 0) return 1;
  return Math.min(profile.maxFrames, Math.max(1, Math.round(seconds * fps)));
}

export type RungAnswer =
  | { kind: 'rung'; rung: EmoteRung }
  | { kind: 'too_big'; code: 'emote_too_big'; message: string };

/**
 * The rung after `rung` (null: the first), or `emote_too_big` past the last.
 * `seconds` is the emote's length, which caps the frame rate.
 */
export function nextRung(
  profile: EmoteProfile,
  output: EmoteOutput,
  rung: EmoteRung | null,
  options: { seconds: number },
): RungAnswer {
  const ladder = LADDERS[output.format];
  const index = rung ? rung.index + 1 : 1;
  const spec = ladder[index - 1];
  if (!spec) {
    return {
      kind: 'too_big',
      code: 'emote_too_big',
      message: emoteTooBigSentence(profile.id, output.size),
    };
  }
  const fps = spec.fps === 0 ? 0 : Math.min(spec.fps, emoteFpsCap(profile, options.seconds));
  return { kind: 'rung', rung: { index, ...spec, fps } };
}

/** What one encode measured. */
export interface EmoteMeasure {
  bytes: number;
  frames: number;
}

/** Under the byte cap and the frame limit (a still is one frame). */
export function fitsEmoteOutput(
  profile: Pick<EmoteProfile, 'maxFrames'>,
  output: EmoteOutput,
  measure: EmoteMeasure,
): boolean {
  const maxFrames = output.format === 'png' ? 1 : profile.maxFrames;
  return measure.bytes <= output.maxBytes && measure.frames <= maxFrames;
}

export type LadderResult =
  | { fits: true; rung: EmoteRung; measure: EmoteMeasure }
  | {
      fits: false;
      /** The last rung tried, and what it measured. */
      rung: EmoteRung;
      measure: EmoteMeasure;
      code: 'emote_too_big';
      message: string;
    };

/**
 * Climbs the ladder: `encode` makes the file at a rung and measures it; the
 * climb stops at the first rung that fits. Pure: the encoding is the caller's.
 */
export async function climbLadder(
  profile: EmoteProfile,
  output: EmoteOutput,
  seconds: number,
  encode: (rung: EmoteRung) => Promise<EmoteMeasure>,
): Promise<LadderResult> {
  let rung: EmoteRung | null = null;
  let measured: EmoteMeasure | null = null;
  for (;;) {
    const answer = nextRung(profile, output, rung, { seconds });
    if (answer.kind === 'too_big') {
      // A ladder always has a first rung, so something was measured.
      return {
        fits: false,
        rung: rung as EmoteRung,
        measure: measured as EmoteMeasure,
        code: answer.code,
        message: answer.message,
      };
    }
    rung = answer.rung;
    measured = await encode(rung);
    if (fitsEmoteOutput(profile, output, measured)) {
      return { fits: true, rung, measure: measured };
    }
  }
}
