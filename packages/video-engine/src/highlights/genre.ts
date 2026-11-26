/**
 * Genre (Sprint 13, Module 05): what kind of video it is, as pure data.
 *
 * A genre does two things: a short note the moment picker adds to its
 * instructions (what a good moment is in this kind of video), and the
 * weights used when the five parts and Sprint 12's signals are blended.
 * The five parts and their scale never change, so scores stay comparable;
 * the weights only change how much each part counts. `auto` is neutral:
 * no note and every weight 1.
 */
import type { ScorePart } from './candidates';

export const GENRES = ['auto', 'podcast', 'gaming', 'education', 'interview', 'vlog'] as const;
export type Genre = (typeof GENRES)[number];

export const GENRE_LABELS: Readonly<Record<Genre, string>> = Object.freeze({
  auto: 'Auto',
  podcast: 'Podcast',
  gaming: 'Gaming',
  education: 'Education',
  interview: 'Interview',
  vlog: 'Vlog',
});

export interface GenreTuning {
  /** Added to the picker's instructions; empty for `auto`. */
  note: string;
  /** How much each of the five parts counts (1 is neutral). */
  weights: Readonly<Record<ScorePart, number>>;
  /** Points (of 100) a moment gains at most when a Sprint 12 signal highlight overlaps it. */
  signalBonus: number;
  /** A signal highlight with no transcript moment is kept as its own clip from this score up. */
  keepSignalFrom: number;
}

const NEUTRAL = Object.freeze({ hook: 1, standsAlone: 1, payoff: 1, clarity: 1, shareable: 1 });

const TUNINGS: Readonly<Record<Genre, GenreTuning>> = Object.freeze({
  auto: { note: '', weights: NEUTRAL, signalBonus: 12, keepSignalFrom: 70 },
  podcast: {
    note: 'This is a podcast. A good moment is a quote or a story that makes sense with no context, said clearly, with a point at the end.',
    weights: { hook: 1, standsAlone: 1.6, payoff: 1.2, clarity: 1.2, shareable: 1 },
    signalBonus: 5,
    keepSignalFrom: 85,
  },
  gaming: {
    note: 'This is a gaming video. A good moment is a clutch play, a big reaction, a funny fail or a win, with the lead-up that makes it land.',
    weights: { hook: 1.4, standsAlone: 0.8, payoff: 1.4, clarity: 0.6, shareable: 1.2 },
    signalBonus: 25,
    keepSignalFrom: 55,
  },
  education: {
    note: 'This is an educational video. A good moment teaches one step or idea completely, with its payoff, so a viewer learns something on its own.',
    weights: { hook: 0.8, standsAlone: 1.2, payoff: 1.5, clarity: 1.5, shareable: 0.8 },
    signalBonus: 5,
    keepSignalFrom: 90,
  },
  interview: {
    note: 'This is an interview. A good moment is a question and its full answer, or a strong answer that is clear without the question.',
    weights: { hook: 1, standsAlone: 1.5, payoff: 1.2, clarity: 1.2, shareable: 0.9 },
    signalBonus: 5,
    keepSignalFrom: 85,
  },
  vlog: {
    note: 'This is a vlog. A good moment has a hook in the first seconds and a beat people want to share: a reveal, a surprise or a strong feeling.',
    weights: { hook: 1.5, standsAlone: 0.9, payoff: 1, clarity: 0.8, shareable: 1.5 },
    signalBonus: 15,
    keepSignalFrom: 70,
  },
});

export function isGenre(value: unknown): value is Genre {
  return typeof value === 'string' && (GENRES as readonly string[]).includes(value);
}

export function genreTuning(genre: Genre): GenreTuning {
  return TUNINGS[genre] ?? TUNINGS.auto;
}
