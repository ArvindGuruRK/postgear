/**
 * How a painted run dresses a step card (Module 08, blueprint 7.1): the
 * card's own style per state, and the result mark with its icon, colour, words
 * and duration. Each state has its own icon and says its words in a tooltip, so
 * a state never rests on colour alone, and a handled error is amber, never
 * green.
 */
import type { StepPaint, StepPaintState } from '../runs/run-model';
import { formatDuration, stepBadgeText } from '../runs/run-words';

export type BadgeIcon =
  | 'check'
  | 'cross'
  | 'pause'
  | 'alert'
  | 'clock'
  | 'spinner'
  | 'skip'
  | 'stop';

/** The badge's fill, as a `Badge` variant (neutral is the card surface). */
export type BadgeTone = 'success' | 'danger' | 'accent' | 'primary' | 'neutral';

export interface PaintLook {
  state: StepPaintState;
  /** Classes added to the card's box. */
  card: string;
  icon: BadgeIcon;
  tone: BadgeTone;
  /** "Succeeded", "Succeeded after 2 attempts", "Error Handled". */
  words: string;
  /** "1.2 s", or empty while the step has no duration yet. */
  duration: string;
  /** Marching dashes round the icon, which pulses. */
  running: boolean;
  /** The card's border pulses amber while a step waits for review. */
  waiting: boolean;
}

const LOOKS: Record<StepPaintState, { card: string; icon: BadgeIcon; tone: BadgeTone }> = {
  queued: { card: 'border-dashed', icon: 'clock', tone: 'neutral' },
  running: { card: '', icon: 'spinner', tone: 'primary' },
  waiting: { card: 'pg-run-waiting', icon: 'pause', tone: 'accent' },
  succeeded: { card: '', icon: 'check', tone: 'success' },
  dryRun: { card: '', icon: 'check', tone: 'success' },
  handled: { card: '', icon: 'alert', tone: 'accent' },
  failed: { card: 'pg-run-failed', icon: 'cross', tone: 'danger' },
  skipped: { card: 'opacity-40', icon: 'skip', tone: 'neutral' },
  cancelled: { card: 'opacity-60', icon: 'stop', tone: 'neutral' },
};

export function paintLook(paint: StepPaint): PaintLook {
  const look = LOOKS[paint.state];
  return {
    state: paint.state,
    card: look.card,
    icon: look.icon,
    tone: look.tone,
    words: stepBadgeText(paint),
    duration: formatDuration(paint.durationMs),
    running: paint.state === 'running',
    waiting: paint.state === 'waiting',
  };
}

/** What the badge says to a screen reader, and what clicking it does. */
export function badgeLabel(look: Pick<PaintLook, 'words' | 'duration'>, stepName: string): string {
  const duration = look.duration ? `, ${look.duration}` : '';
  return `${stepName}: ${look.words}${duration}. Open this step's run data.`;
}
