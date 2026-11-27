/**
 * The Emote Maker's sentences that need a site or a size filled in. The
 * plain ones (`emote_too_long`, `emote_range_invalid`, `emote_failed` and the
 * generic `emote_too_big`) live in `CLIP_ERROR_MESSAGES` with every other
 * Clips sentence, so a failed job reads them like any other code.
 */
import { EMOTE_PROFILES, type EmoteFormat, type EmotePlatform } from './profiles';

/** "This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop." */
export function emoteTooBigSentence(platform: EmotePlatform, size: number): string {
  const site = EMOTE_PROFILES[platform].name;
  return `This emote is too big for ${site} at ${size} px. Try a shorter stretch or a smaller crop.`;
}

/**
 * Whether `text` is exactly one of the too-big sentences we write (a known
 * site at one of its sizes). The API keeps a stored sentence only then, so a
 * tampered row can never put other words on the page.
 */
export function isEmoteTooBigSentence(text: string): boolean {
  for (const profile of Object.values(EMOTE_PROFILES)) {
    for (const output of profile.outputs) {
      if (emoteTooBigSentence(profile.id, output.size) === text) return true;
    }
  }
  return false;
}

/** 512000 becomes "512 KB", 7000000 "7 MB", 900 "1 KB" (decimal, rounded up, never "0 KB"). */
export function emoteBytesLabel(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe >= 1_000_000) {
    const mb = Math.ceil(safe / 100_000) / 10;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.ceil(safe / 1_000))} KB`;
}

const FORMAT_NAMES: Record<EmoteFormat, string> = {
  gif: 'GIF',
  webp: 'WebP',
  apng: 'APNG',
  png: 'Still PNG',
};

/** "GIF", "WebP", "APNG", "Still PNG": a file's kind in the files table. */
export function emoteFormatName(format: EmoteFormat): string {
  return FORMAT_NAMES[format];
}

/**
 * Why a file is not under its site's limit, or null when it is. Frames are
 * checked as well as bytes, though the encoder caps them, so the table never
 * says "under the limit" about a file that is not.
 */
export function emoteOverReason(file: {
  bytes: number;
  maxBytes: number;
  frames: number;
  maxFrames: number;
}): string | null {
  if (file.bytes > file.maxBytes) {
    return `Over the ${emoteBytesLabel(file.maxBytes)} limit`;
  }
  if (file.frames > file.maxFrames) {
    return `Over the ${file.maxFrames} frame limit`;
  }
  return null;
}

export const EMOTE_UNDER_LIMIT = 'Under the limit';
