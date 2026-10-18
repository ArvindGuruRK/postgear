import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Progress } from './progress';
import { type ScoreTone, toneForScore } from './score-gauge';

/**
 * One sub-score as a labelled flat bar (Sprint 7: the four SEO categories
 * under the gauge). `Progress` with its stripes and crawl turned off (a
 * score is a reading, not a job in progress) and the tone taken from the
 * same bands as `ScoreGauge`, so a 55 reads red everywhere.
 */
export interface ScoreBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: string;
  /** 0–100. Null renders an empty bar with a dash. */
  score: number | null;
  /** Text after the value: "30% of total", "estimated". */
  hint?: string;
  tone?: ScoreTone;
  size?: 'sm' | 'md';
}

export const ScoreBar = forwardRef<HTMLDivElement, ScoreBarProps>(
  ({ className, label, score, hint, tone, size = 'md', ...props }, ref) => {
    const value = score === null ? null : Math.max(0, Math.min(100, Math.round(score)));
    const shownTone = tone ?? (value === null ? 'primary' : toneForScore(value));

    return (
      <div
        ref={ref}
        className={cn('flex flex-col gap-1.5', className)}
        data-score={value ?? undefined}
        {...props}
      >
        <div className="flex items-baseline justify-between gap-3 font-sans text-sm text-ink">
          <span className="font-bold">{label}</span>
          <span className="tabular-nums">
            <span className="type-heading text-lg">
              {value === null ? '–' : value}
            </span>
            {hint ? <span className="ms-2 text-xs font-medium opacity-70">{hint}</span> : null}
          </span>
        </div>
        <Progress
          value={value ?? 0}
          tone={shownTone}
          size={size === 'sm' ? 'sm' : 'md'}
          striped={false}
          animated={false}
          aria-label={`${label}: ${value === null ? 'no score' : `${value} out of 100`}`}
        />
      </div>
    );
  },
);
ScoreBar.displayName = 'ScoreBar';
