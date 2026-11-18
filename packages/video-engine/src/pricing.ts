/**
 * AI Minutes prices: the one place they live.
 *
 * One AI minute is one minute of video an AI step works on. The API charges
 * `aiMinutesCost(...)` through `UsageService.consume` before a step starts,
 * the web shows the same number on the button ("Find Clips (15 AI Minutes)"),
 * so the label and the charge can never disagree.
 *
 * Price is `ceil(minutes x rate)`, never below the kind's minimum (1, or 2
 * for `listen`). Following the speaker and Detect Camera are free and have no
 * kind here.
 */

export const AI_COST_KINDS = ['signals', 'listen', 'read', 'action', 'translate', 'voice'] as const;
export type AiCostKind = (typeof AI_COST_KINDS)[number];

/** What the amount given to `aiMinutesCost` counts. */
export type AiCostUnit = 'video_ms' | 'clip_ms' | 'characters';

export interface AiCostRate {
  /** AI minutes per minute of video (or clip), or per 1,000 characters for `voice`. */
  rate: number;
  unit: AiCostUnit;
  /** The smallest price, whatever the amount. */
  minimum: number;
}

export const AI_COST_RATES: Readonly<Record<AiCostKind, Readonly<AiCostRate>>> = Object.freeze({
  /** Sprint 12 Find Clips: loudness, scenes, chat. Free inside a Sprint 13 run that also listens. */
  signals: Object.freeze({ rate: 0.25, unit: 'video_ms', minimum: 1 }),
  /** Sprint 13 speech to text. */
  listen: Object.freeze({ rate: 1, unit: 'video_ms', minimum: 2 }),
  /** Sprint 13: the model picking moments from the transcript. */
  read: Object.freeze({ rate: 0.25, unit: 'video_ms', minimum: 1 }),
  /** Sprint 13 Look For Action. */
  action: Object.freeze({ rate: 0.5, unit: 'video_ms', minimum: 1 }),
  /** Sprint 13 translation, by the clip's length. */
  translate: Object.freeze({ rate: 0.25, unit: 'clip_ms', minimum: 1 }),
  /** Sprint 13 text to speech, by characters. */
  voice: Object.freeze({ rate: 1, unit: 'characters', minimum: 1 }),
} satisfies Record<AiCostKind, AiCostRate>);

/** Milliseconds in a minute, and characters in a priced block. */
const MS_PER_MINUTE = 60_000;
const CHARACTERS_PER_BLOCK = 1_000;

/** Floating point slack so that 15.000000000000002 is not charged as 16. */
const EPSILON = 1e-9;

/**
 * The AI minutes a step costs. `amount` is milliseconds of video for
 * `signals`, `listen`, `read` and `action`, milliseconds of clip for
 * `translate`, and characters for `voice`. Throws a `RangeError` for a
 * negative or non-finite amount or an unknown kind, because a wrong price
 * must never reach the ledger.
 */
export function aiMinutesCost(kind: AiCostKind, amount: number): number {
  if (!Object.hasOwn(AI_COST_RATES, kind)) {
    throw new RangeError(`Unknown AI cost kind: ${String(kind)}`);
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new RangeError('The amount to price must be a number from 0.');
  }
  const { rate, unit, minimum } = AI_COST_RATES[kind];
  const blocks = unit === 'characters' ? amount / CHARACTERS_PER_BLOCK : amount / MS_PER_MINUTE;
  const price = Math.ceil(blocks * rate - EPSILON);
  return Math.max(minimum, price);
}
