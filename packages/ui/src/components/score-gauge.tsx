import { forwardRef } from 'react';
import { cn } from '../lib/utils';

/**
 * A 0–100 score as an arc meter with the number inside and a letter grade
 * under it (Sprint 7: the SEO analyzer's composite score).
 *
 * Restrained per design-system-rules.md §15 — a score is data. The arc has
 * hard ends (`butt` caps) and a thick stroke in the system's flat action
 * colours; the track is the outline at low opacity so it reads in both
 * themes; the number is `type-heading` because it is the one thing on the
 * screen meant to be read from across the room. No gradient, no glow.
 *
 * Tone follows the grade bands the analyzer uses (A/B good, C fair, D poor,
 * F failing), so a 92 and a 58 are never the same colour; `tone` overrides
 * for the rare case a caller means something else by the number.
 */
export type ScoreTone = 'success' | 'secondary' | 'accent' | 'danger' | 'primary' | 'ai';

export function toneForScore(score: number): ScoreTone {
  if (score >= 80) return 'success';
  if (score >= 70) return 'secondary';
  if (score >= 60) return 'accent';
  return 'danger';
}

const STROKE: Record<ScoreTone, string> = {
  success: 'stroke-actionSuccess',
  secondary: 'stroke-actionSecondary',
  accent: 'stroke-actionAccent',
  danger: 'stroke-actionDanger',
  primary: 'stroke-actionPrimary',
  ai: 'stroke-actionAi',
};

const SIZE = {
  sm: { box: 'h-24 w-24', value: 'text-2xl', grade: 'text-xs', stroke: 10 },
  md: { box: 'h-40 w-40', value: 'text-5xl', grade: 'text-sm', stroke: 12 },
  lg: { box: 'h-56 w-56', value: 'text-7xl', grade: 'text-base', stroke: 14 },
} as const;

/** The arc spans 240° — open at the bottom, like a dial. */
const SWEEP_DEGREES = 240;
const START_DEGREES = 150;
const RADIUS = 42;
const VIEWBOX = 100;

function polar(degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: VIEWBOX / 2 + RADIUS * Math.cos(radians),
    y: VIEWBOX / 2 + RADIUS * Math.sin(radians),
  };
}

/** An SVG arc path from the start angle through `degrees` of sweep. */
export function arcPath(degrees: number): string {
  const sweep = Math.max(0, Math.min(SWEEP_DEGREES, degrees));
  if (sweep === 0) return '';
  const start = polar(START_DEGREES);
  const end = polar(START_DEGREES + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export interface ScoreGaugeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0–100. Clamped. Null renders an empty dial with a dash. */
  value: number | null;
  /** A letter under the number — the analyzer's grade. */
  grade?: string | null;
  /** Small caption under the grade ("Overall"). */
  label?: string;
  size?: keyof typeof SIZE;
  tone?: ScoreTone;
}

export const ScoreGauge = forwardRef<HTMLDivElement, ScoreGaugeProps>(
  (
    { className, value, grade, label, size = 'md', tone, 'aria-label': ariaLabel, ...props },
    ref,
  ) => {
    const score = value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
    const shownTone = tone ?? (score === null ? 'primary' : toneForScore(score));
    const sizes = SIZE[size];

    return (
      // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be drawn as an arc; the role carries the same semantics
      <div
        ref={ref}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score ?? undefined}
        aria-valuetext={
          score === null ? 'No score yet' : `${score} out of 100${grade ? `, grade ${grade}` : ''}`
        }
        aria-label={ariaLabel ?? label ?? 'Score'}
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center',
          sizes.box,
          className,
        )}
        data-score={score ?? undefined}
        data-grade={grade ?? undefined}
        {...props}
      >
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <path
            d={arcPath(SWEEP_DEGREES)}
            fill="none"
            strokeWidth={sizes.stroke}
            strokeLinecap="butt"
            // Ink, not outline: outline stays near-black in dark mode by design
            // and the empty track would vanish against the dark surface.
            className="stroke-ink opacity-20"
          />
          {score !== null && score > 0 ? (
            <path
              d={arcPath((score / 100) * SWEEP_DEGREES)}
              fill="none"
              strokeWidth={sizes.stroke}
              strokeLinecap="butt"
              className={cn(
                STROKE[shownTone],
                'transition-[d] duration-300 ease-out motion-reduce:transition-none',
              )}
            />
          ) : null}
        </svg>
        <div className="relative flex flex-col items-center leading-none">
          <span className={cn('type-heading text-ink', sizes.value)}>
            {score === null ? '–' : score}
          </span>
          {grade ? (
            <span
              className={cn(
                'mt-1 rounded-full border-2 border-outline px-2 py-0.5 font-sans font-bold uppercase text-ink',
                sizes.grade,
              )}
            >
              {grade}
            </span>
          ) : null}
          {label ? (
            <span className="mt-1 font-sans text-[10px] font-bold uppercase tracking-wide text-ink opacity-60">
              {label}
            </span>
          ) : null}
        </div>
      </div>
    );
  },
);
ScoreGauge.displayName = 'ScoreGauge';
