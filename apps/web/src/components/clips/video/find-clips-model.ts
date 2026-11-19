/**
 * Find Clips on the video page (Module 16, section 5), as plain functions:
 * the button's label, when it is off and why, the confirm sentence, the
 * notes, and the list order (AI clips best first, then the hand-made ones).
 *
 * Sentences are the stories' and the blueprint's, word for word. The
 * refusal ("This needs 15 AI minutes and you have 9 left...") comes from
 * `@postgear/entitlements`, the same words the API puts in its 402.
 */
import { refusalMessage } from '@postgear/entitlements';
import { HIGHLIGHT_REASON_LABELS, type HighlightReason } from '@postgear/video-engine';
import type { ClipSummary, HighlightRunView, HighlightsView } from '@/types/clips';
import { formatDayMonth } from '../home/home-model';

/** Always under the button: what this version of the AI does and does not do. */
export const AI_NOTE =
  'AI in this version listens and watches for action. It does not understand speech yet.';
export const NO_SOUND_NOTE = 'This video has no sound, so we looked at the picture only.';
export const NOTHING_FOUND_NOTE =
  'We did not find any stand-out moments. You can still mark clips by hand.';
export const HIGHLIGHTS_FAILED =
  'We could not finish looking for clips. Your AI minutes were given back.';
export const HIGHLIGHTS_CANCELLED = 'Stopped. Your AI minutes were given back.';
/** The group name over hand-made clips once AI clips sit above them. */
export const HAND_MADE_GROUP = 'Made By Hand';

/** The meter the button reads (the plan snapshot's `clips.ai_minutes_per_month`). */
export interface AiMinutesMeter {
  limit: number | null;
  remaining: number | null;
  cycleEnd: string;
}

/** "Find Clips (15 AI Minutes)"; one minute reads "(1 AI Minute)". */
export function findClipsLabel(price: number): string {
  const minutes = Math.max(1, Math.ceil(price));
  return `Find Clips (${minutes} AI ${minutes === 1 ? 'Minute' : 'Minutes'})`;
}

/**
 * Why the button is off, or null when it is on. An unknown meter (the plan
 * snapshot not read yet) or an unlimited one never blocks: the API has the
 * last word and answers its own 402.
 */
export function findClipsBlock(price: number, meter: AiMinutesMeter | null): string | null {
  if (!meter || meter.limit === null || meter.remaining === null) return null;
  const left = Math.max(0, Math.floor(meter.remaining));
  if (left >= price) return null;
  if (left === 0) {
    const day = formatDayMonth(meter.cycleEnd);
    return `This workspace has used all its AI minutes for this month.${day ? ` They reset on ${day}.` : ''}`;
  }
  return refusalMessage('clips_ai_minutes_used', { need: price, n: left, date: meter.cycleEnd });
}

/** The confirm before a second run: unopened AI clips are replaced. */
export function findAgainSentence(price: number): string {
  const minutes = Math.max(1, Math.ceil(price));
  return `Find clips again? New clips you have not opened will be replaced. This costs ${minutes} AI ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/** A run has been made for this video before (or its AI clips are on the list): ask first. */
export function asksFirst(
  highlights: Pick<HighlightsView, 'run'>,
  clips: readonly ClipSummary[],
): boolean {
  return highlights.run?.status === 'DONE' || clips.some((clip) => clip.origin === 'AI_SIGNALS');
}

/** The notes under the button, in order (Module 16 section 5). */
export function findClipsNotes(
  highlights: Pick<HighlightsView, 'noSound' | 'run'>,
  running: boolean,
): string[] {
  const notes = [AI_NOTE];
  if (highlights.noSound) notes.push(NO_SOUND_NOTE);
  if (!running && highlights.run?.status === 'DONE' && highlights.run.found === 0)
    notes.push(NOTHING_FOUND_NOTE);
  return notes;
}

/** "How this was found: Sound, picture and chat", once a run has finished with clips. */
export function foundByLine(
  run: Pick<HighlightRunView, 'status' | 'foundBy' | 'found'> | null,
): string | null {
  if (run?.status !== 'DONE' || !run.foundBy || run.found === 0) return null;
  return `How this was found: ${run.foundBy}`;
}

function isReason(code: string): code is HighlightReason {
  return Object.hasOwn(HIGHLIGHT_REASON_LABELS, code);
}

/** Up to three reasons in words, strongest first; codes this version does not know are left out. */
export function reasonLabels(reasons: readonly string[]): string[] {
  return reasons
    .filter(isReason)
    .slice(0, 3)
    .map((code) => HIGHLIGHT_REASON_LABELS[code]);
}

/** The score chip's number: 0 to 100, whole. */
export function scoreText(score: number | null): string | null {
  if (score === null || !Number.isFinite(score)) return null;
  return String(Math.round(Math.min(100, Math.max(0, score))));
}

/**
 * The list order: AI clips best first (a higher score, then the newer), then
 * the hand-made ones as they came (newest first).
 */
export function orderClips(clips: readonly ClipSummary[]): {
  ai: ClipSummary[];
  manual: ClipSummary[];
} {
  const ai = clips
    .filter((clip) => clip.origin === 'AI_SIGNALS')
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.createdAt.localeCompare(a.createdAt));
  const manual = clips.filter((clip) => clip.origin !== 'AI_SIGNALS');
  return { ai, manual };
}
