/**
 * Emote Maker (Sprint 13, Module 14): what each site takes, as data.
 *
 * A changed rule is a one-line edit here, never a code change: the ladder,
 * the planner, the worker and the page all read these rows. Where the
 * sources disagree the strictest number wins (Module 14, "Contradictions
 * Found"): 512 KB per animated file and 60 frames for Twitch and BetterTTV,
 * 25 KB per still, 7 MB and 1,000 frames for 7TV. Kilobytes here are 1,000
 * bytes, the smaller reading, so a file we call "under the limit" is under
 * it whichever way a site counts.
 *
 * Every export carries a GIF (the one format all three take). 7TV's WebP and
 * APNG are extras (`extra: true`): a site that prefers one can be promoted
 * by moving the flag. A still PNG is planned only when the Still Frame
 * switch is on, and only for a profile that lists PNG outputs (Twitch).
 *
 * Outputs are listed largest first: the largest file is the first to break a
 * cap, so the planner stops at the first required output that cannot fit.
 */
import { z } from 'zod';

export const EMOTE_PLATFORMS = ['twitch', 'sevenTv', 'bttv'] as const;
export type EmotePlatform = (typeof EMOTE_PLATFORMS)[number];

export const EMOTE_FORMATS = ['gif', 'webp', 'apng', 'png'] as const;
export type EmoteFormat = (typeof EMOTE_FORMATS)[number];

/** An emote is at most this long, whatever the site. */
export const EMOTE_MAX_MS = 3_000;
/** Times move in tenths of a second. */
export const EMOTE_STEP_MS = 100;
/** The smallest crop side, in source pixels. */
export const EMOTE_MIN_CROP = 16;
/** The largest crop side we read, in source pixels (a 4K frame's height is 2,160). */
export const EMOTE_MAX_CROP = 4_096;
/** Under this many source pixels the page warns "This will look soft" (Twitch's largest size). */
export const EMOTE_SOFT_BELOW = 112;

const KB = 1_000;
const MB = 1_000_000;

export interface EmoteOutput {
  /** The side of the square, in pixels. */
  size: number;
  format: EmoteFormat;
  maxBytes: number;
  /** Made when it can, never required: a file that cannot fit is left out, the export still works. */
  extra?: boolean;
}

export interface EmoteProfile {
  id: EmotePlatform;
  /** The site's name in a sentence ("too big for Twitch at 112 px"). */
  name: string;
  /** The site's word inside a file name (`emote-seventv-256.gif`): lowercase letters only. */
  fileKey: string;
  outputs: readonly EmoteOutput[];
  /** Twitch 60, 7TV 1,000, BetterTTV 60. */
  maxFrames: number;
  maxSeconds: 3;
  /** Shown under the export button. */
  note: string;
}

export const EMOTE_PROFILES: Readonly<Record<EmotePlatform, EmoteProfile>> = Object.freeze({
  twitch: {
    id: 'twitch',
    name: 'Twitch',
    fileKey: 'twitch',
    outputs: [
      { size: 112, format: 'gif', maxBytes: 512 * KB },
      { size: 56, format: 'gif', maxBytes: 512 * KB },
      { size: 28, format: 'gif', maxBytes: 512 * KB },
      { size: 112, format: 'png', maxBytes: 25 * KB },
      { size: 56, format: 'png', maxBytes: 25 * KB },
      { size: 28, format: 'png', maxBytes: 25 * KB },
    ],
    maxFrames: 60,
    maxSeconds: 3,
    note: 'GIFs at 112, 56 and 28 px, each under 512 KB and 60 frames.',
  },
  sevenTv: {
    id: 'sevenTv',
    name: '7TV',
    fileKey: 'seventv',
    outputs: [
      { size: 256, format: 'gif', maxBytes: 7 * MB },
      { size: 256, format: 'webp', maxBytes: 7 * MB, extra: true },
      { size: 256, format: 'apng', maxBytes: 7 * MB, extra: true },
    ],
    maxFrames: 1_000,
    maxSeconds: 3,
    note: 'A 256 px GIF under 7 MB, with WebP and APNG copies.',
  },
  bttv: {
    id: 'bttv',
    name: 'BetterTTV',
    fileKey: 'bttv',
    outputs: [
      { size: 112, format: 'gif', maxBytes: 512 * KB },
      { size: 56, format: 'gif', maxBytes: 512 * KB },
      { size: 28, format: 'gif', maxBytes: 512 * KB },
    ],
    maxFrames: 60,
    maxSeconds: 3,
    note: 'GIFs at 112, 56 and 28 px, each under 512 KB and 60 frames.',
  },
});

/** The checks every profile row must pass (the profile test parses each one). */
export const emoteProfileSchema = z
  .object({
    id: z.enum(EMOTE_PLATFORMS),
    name: z.string().min(1).max(40),
    fileKey: z.string().regex(/^[a-z]{2,16}$/),
    outputs: z
      .array(
        z
          .object({
            size: z.number().int().min(16).max(1_000),
            format: z.enum(EMOTE_FORMATS),
            maxBytes: z.number().int().positive(),
            extra: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    maxFrames: z.number().int().min(1).max(10_000),
    maxSeconds: z.literal(3),
    note: z.string().min(1).max(200),
  })
  .strict()
  .refine((profile) => profile.outputs.some((output) => !output.extra && output.format !== 'png'), {
    message: 'A profile needs one required moving file',
  });

export function isEmotePlatform(value: unknown): value is EmotePlatform {
  return typeof value === 'string' && (EMOTE_PLATFORMS as readonly string[]).includes(value);
}

/** The file's extension for a format: an APNG keeps `.apng` so the two PNG kinds never share a name. */
export function emoteExtension(format: EmoteFormat): EmoteFormat {
  return format;
}

/** `emote-twitch-112.gif`: the name a file is stored and saved under. */
export function emoteFileName(profile: Pick<EmoteProfile, 'fileKey'>, output: EmoteOutput): string {
  return `emote-${profile.fileKey}-${output.size}.${emoteExtension(output.format)}`;
}

/** `emote-twitch.zip`: Download All. */
export function emoteZipName(profile: Pick<EmoteProfile, 'fileKey'>): string {
  return `emote-${profile.fileKey}.zip`;
}

/** The outputs a request makes: still PNGs only with the switch on. Largest first, as listed. */
export function emoteOutputsFor(profile: EmoteProfile, still: boolean): EmoteOutput[] {
  return profile.outputs.filter((output) => output.format !== 'png' || still);
}
