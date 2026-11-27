/**
 * Clip Setup (Sprint 13, Module 05): the choices of one Find Clips run and
 * their price in AI minutes. Pure.
 *
 * The setup travels in the request, is checked here, and is kept on the run
 * (`ClipHighlightRun.params.setup`). Look For Action is Module 06's; Follow
 * The Speaker is Module 08's: free (no line in the price), and refused on a
 * wide shape, where there is nothing to follow inside the picture. Module 10
 * opens Remove Silences, Hook Title, a recipe (a starter's id or the
 * workspace's own, by id) and a brand kit: all free, so the price does not
 * change. A setup stored before Module 10 (switches off, ids null) still
 * reads. The recipe's settings with the setup on top are `recipeFromSetup`.
 *
 * The price is one line per step, from the same `aiMinutesCost` the charge
 * uses. Listening is quoted by the transcript (only what was not listened
 * to yet). Sound and picture are free in a run that listens, and priced as
 * Sprint 12's Find Clips when it does not.
 */
import { z } from 'zod';
import { RATIOS } from '../canvas';
import { DEFAULT_CAPTION_STYLE } from '../captions/styles';
import { CLIP_MIN_MS } from '../document/limits';
import { aiMinutesCost } from '../pricing';
import { CLIP_LENGTHS } from './fit';
import { canFollow } from './follow';
import { GENRES } from './genre';

/** The most a request may say. */
export const SETUP_REQUEST_MAX = 300;

const ms = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 * 60 * 1000);

export const clipSetupSchema = z
  .object({
    range: z
      .object({ fromMs: ms, toMs: ms })
      .strict()
      .refine((range) => range.toMs - range.fromMs >= CLIP_MIN_MS, 'Choose at least 3 seconds'),
    /** "auto" or a language code: what is spoken. */
    language: z.string().regex(/^(?:auto|[a-z]{2,3})$/),
    request: z.string().max(SETUP_REQUEST_MAX),
    genre: z.enum(GENRES),
    length: z.enum(CLIP_LENGTHS),
    ratio: z.enum(RATIOS),
    captions: z
      .object({ on: z.boolean(), styleId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/i) })
      .strict(),
    /** Module 06: Look For Action. */
    action: z.boolean(),
    /** Module 08: Follow The Speaker (free; vertical, portrait or square only). */
    follow: z.boolean(),
    /** Module 10: Remove Silences (free). */
    silences: z.boolean(),
    /** Module 10: Add Hook Title from each clip's own AI title (free). */
    hookTitle: z.boolean(),
    /** Module 10: a starter recipe's id or one of the workspace's own (a uuid), or none. */
    recipeId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable(),
    /** Module 10: the brand kit the run's clips get, or none (a Studio kit's id). */
    brandKitId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable(),
  })
  .strict()
  // Refused rather than ignored: a stored setup never says it followed what it could not.
  .refine((setup) => !setup.follow || canFollow(setup.ratio), {
    message: 'Follow The Speaker needs a vertical or square shape',
    path: ['follow'],
  });

export type ClipSetup = z.infer<typeof clipSetupSchema>;

/** The setup a page opens with, over the whole video. */
export function defaultClipSetup(durationMs: number): ClipSetup {
  return {
    range: { fromMs: 0, toMs: Math.max(CLIP_MIN_MS, Math.round(durationMs)) },
    language: 'auto',
    request: '',
    genre: 'auto',
    length: 'auto',
    ratio: '9:16',
    captions: { on: false, styleId: DEFAULT_CAPTION_STYLE },
    follow: false,
    action: false,
    silences: false,
    hookTitle: false,
    recipeId: null,
    brandKitId: null,
  };
}

/** The request as the picker reads it: one line, no control characters, trimmed. */
export function cleanRequest(request: string): string {
  return request
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SETUP_REQUEST_MAX);
}

export const SETUP_STEPS = ['listen', 'read', 'signals', 'action'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_STEP_LABELS: Readonly<Record<SetupStep, string>> = Object.freeze({
  listen: 'Listening',
  read: 'Reading',
  signals: 'Sound And Picture',
  action: 'Looking For Action',
});

export interface SetupPriceLine {
  step: SetupStep;
  /** AI minutes; 0 shows as "free". */
  aiMinutes: number;
}

export interface SetupPrice {
  lines: SetupPriceLine[];
  total: number;
  /** The stretch chosen, ms. */
  rangeMs: number;
}

/**
 * The price of a setup, line by line. `listen` is what the transcript quotes
 * for the chosen stretch (0 when it was all listened to).
 */
export function setupPrice(setup: Pick<ClipSetup, 'range' | 'action'>, listen: number): SetupPrice {
  const rangeMs = Math.max(0, setup.range.toMs - setup.range.fromMs);
  const listening = Math.max(0, Math.round(listen));
  const lines: SetupPriceLine[] = [
    { step: 'listen', aiMinutes: listening },
    { step: 'read', aiMinutes: aiMinutesCost('read', rangeMs) },
    // Free in a run that listens; Sprint 12's Find Clips price when it does not.
    { step: 'signals', aiMinutes: listening > 0 ? 0 : aiMinutesCost('signals', rangeMs) },
  ];
  if (setup.action) lines.push({ step: 'action', aiMinutes: aiMinutesCost('action', rangeMs) });
  return { lines, total: lines.reduce((sum, line) => sum + line.aiMinutes, 0), rangeMs };
}
