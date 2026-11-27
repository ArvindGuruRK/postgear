/**
 * The refusal sentences: one per `refusalCode`, in plain words.
 *
 * The API puts the sentence in a 402 body beside the `code`, and the web app
 * shows it with **See Plans**. Both read it from here, so a refusal reads the
 * same in the lock dialog, the toast and the API. The sentences are research
 * 12 section 13 and the user stories, word for word where they give one.
 *
 * ## Placeholders
 *
 * - `{n}`: the plan's number (or what is left, for AI minutes), a whole number
 *   rounded down, so a sentence never promises more than the server allows.
 * - `{need}`: what an action needs, a whole number rounded up.
 * - `{date}`: the reset date, "1 December" (UTC).
 * - `{quality}`: the export quality asked for, by its label ("1080p 60 fps").
 * - `{s}` and `{s:need}`: an "s" when `{n}` (or `{need}`) is not 1, so a Free
 *   plan reads "1 channel", not "1 channels".
 *
 * A placeholder whose value is missing or not a real number or date never
 * shows as a gap: the code's fallback sentence, which names no number, is
 * returned instead. Nothing here throws.
 */
import { formatNumber } from './format-number';
import { toValidDate } from './validate';

/** Every refusal code a limit can raise. Fixed here so every module uses the same ones. */
export const REFUSAL_CODES = [
  'clips_not_in_plan',
  'clips_video_too_long',
  'clips_minutes_used',
  'clips_storage_full',
  'clips_upload_too_big',
  'clips_quality_requires_plan',
  'clips_ai_minutes_used',
  'clips_downloads_today',
  'channel_limit',
  'members_editor_seats_full',
] as const;

/** A refusal code. */
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** Whether a string is one of the refusal codes. */
export function isRefusalCode(value: unknown): value is RefusalCode {
  return typeof value === 'string' && (REFUSAL_CODES as readonly string[]).includes(value);
}

/** A sentence with placeholders, and the plain sentence used when a value is missing. */
export interface RefusalTemplate {
  readonly template: string;
  readonly fallback: string;
  /**
   * Used instead of `template` when `{n}` (what is left) is 0, so a sentence
   * never reads "you have 0 left" (Module 20 edge cases).
   */
  readonly none?: string;
}

/** The sentence for every code. */
export const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, RefusalTemplate>> = Object.freeze({
  clips_not_in_plan: {
    template: "Clips is not part of this workspace's plan.",
    fallback: "Clips is not part of this workspace's plan.",
  },
  clips_video_too_long: {
    template:
      'This video is longer than your plan allows ({n} minute{s}). Upgrade the plan to bring in longer videos.',
    fallback:
      'This video is longer than your plan allows. Upgrade the plan to bring in longer videos.',
  },
  clips_minutes_used: {
    template:
      'You have used all {n} import minute{s} for this month. They come back on {date}, or you can upgrade the plan.',
    fallback:
      'You have used all your import minutes for this month. They come back when the month resets, or you can upgrade the plan.',
  },
  clips_storage_full: {
    template:
      'Your video space is full ({n} GB). Delete a video you no longer need, or upgrade the plan.',
    fallback: 'Your video space is full. Delete a video you no longer need, or upgrade the plan.',
  },
  clips_upload_too_big: {
    template: 'Uploads can be up to {n} GB.',
    fallback: 'This file is bigger than your plan allows. Upgrade the plan to upload bigger files.',
  },
  clips_quality_requires_plan: {
    template: '{quality} export needs a higher plan.',
    fallback: 'This export quality needs a higher plan.',
  },
  clips_ai_minutes_used: {
    template:
      'This needs {need} AI minute{s:need} and you have {n} left. They come back on {date}, or you can upgrade the plan.',
    none: 'This workspace has used all its AI minutes for this month. They come back on {date}, or you can upgrade the plan.',
    fallback:
      'This workspace does not have enough AI minutes left this month. They come back when the month resets, or you can upgrade the plan.',
  },
  clips_downloads_today: {
    template: "You have reached today's limit of {n} download{s}. It resets at midnight UTC.",
    fallback: "You have reached today's download limit. It resets at midnight UTC.",
  },
  channel_limit: {
    template: 'Your plan allows {n} channel{s}. Remove one to add another.',
    fallback: "You have reached your plan's channel limit. Remove one to add another.",
  },
  members_editor_seats_full: {
    template: 'No editor seats left. Remove an editor or change your plan.',
    fallback: 'No editor seats left. Remove an editor or change your plan.',
  },
});

/** The values a sentence may need. Extra values are ignored. */
export interface RefusalParams {
  /** The plan's number, or what is left for AI minutes. Rounded down. */
  readonly n?: number;
  /** What the action needs. Rounded up. */
  readonly need?: number;
  /** When the allowance comes back. */
  readonly date?: Date | string;
  /** The quality asked for, already as a label ("1080p"). */
  readonly quality?: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A reset date as a person says it: "1 December", in UTC (the cycle and the
 * day window both turn at midnight UTC). An empty string for a date that
 * cannot be read.
 */
export function formatResetDate(date: Date | string): string {
  const valid = toValidDate(date);
  if (!valid) return '';
  return `${valid.getUTCDate()} ${MONTHS[valid.getUTCMonth()]}`;
}

/** A limit as a whole number, rounded down; a positive amount under 1 keeps one decimal. */
function roundDown(value: number): number {
  if (value > 0 && value < 1) return Math.floor(value * 10) / 10;
  return Math.max(0, Math.floor(value));
}

/** An amount needed, as a whole number rounded up. */
function roundUp(value: number): number {
  return Math.max(0, Math.ceil(value));
}

const PLACEHOLDER = /\{(n|need|date|quality|s|s:need)\}/g;

/**
 * The sentence for a refusal, with its values filled in. An unknown code reads
 * as a plain plan refusal; a missing or unreadable value gives the code's
 * fallback sentence.
 */
export function refusalMessage(code: string, params: RefusalParams = {}): string {
  const entry = isRefusalCode(code) ? REFUSAL_MESSAGES[code] : null;
  if (!entry) {
    return 'This needs a higher plan.';
  }

  const n = typeof params.n === 'number' && Number.isFinite(params.n) ? roundDown(params.n) : null;
  const need =
    typeof params.need === 'number' && Number.isFinite(params.need) ? roundUp(params.need) : null;
  const date = params.date === undefined ? '' : formatResetDate(params.date);
  const quality = typeof params.quality === 'string' ? params.quality.trim() : '';

  let missing = false;
  const template = n === 0 && entry.none ? entry.none : entry.template;
  const text = template.replace(PLACEHOLDER, (_match, name: string) => {
    switch (name) {
      case 'n':
        if (n === null) missing = true;
        return n === null ? '' : formatNumber(n);
      case 'need':
        if (need === null) missing = true;
        return need === null ? '' : formatNumber(need);
      case 's':
        return n === 1 ? '' : 's';
      case 's:need':
        return need === 1 ? '' : 's';
      case 'date':
        if (date === '') missing = true;
        return date;
      default:
        if (quality === '') missing = true;
        return quality;
    }
  });

  return missing ? entry.fallback : text;
}
