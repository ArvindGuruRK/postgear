'use client';

/**
 * The headline of an audit: the gauge, the four category bars beside it, and
 * how this run compares with the last.
 *
 * Restrained by rule (design-system-rules.md §15, §16c): the gauge and the
 * bars are data, drawn by `ScoreGauge`/`ScoreBar` from the one score scale,
 * with no card shadow of their own. The comparison is an arrow and a word
 * — `ArrowUp` success, `ArrowDown` danger, `Minus` muted — plus a badge that
 * says it in a word, never a colour wash over the number.
 *
 * Rendered from the reducer's partial fields: the bars fill the moment the
 * `scores` event lands, with skeletons of the same footprint before it so
 * the layout does not jump when the numbers arrive (§8, loading).
 */
import { Badge, ScoreBar, ScoreGauge, Skeleton } from '@postgear/ui';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { SeoCategoryScore } from '@/types/seo';
import { SEO_CATEGORIES, SEO_CATEGORY_LABELS, SEO_CATEGORY_WEIGHTS } from '@/types/seo';
import { useMounted } from '../posts/use-mounted';
import type { ScoreSnapshot, SeoState } from './seo-state';
import { scoreDelta } from './seo-view-model';

export function ScoreHero({
  scores,
  categories,
  previous,
  running,
}: {
  scores: ScoreSnapshot | null;
  categories: SeoCategoryScore[] | null;
  previous: SeoState['previous'];
  running: boolean;
}) {
  const mounted = useMounted();

  if (scores === null) {
    return running ? (
      <div
        className="flex flex-col items-center gap-6 md:flex-row md:items-center"
        role="status"
        aria-label="Scoring"
        aria-busy="true"
      >
        <Skeleton className="h-56 w-56 shrink-0 rounded-full" />
        <div className="flex w-full flex-1 flex-col gap-4">
          {SEO_CATEGORIES.map((category) => (
            <Skeleton key={category} className="h-11" />
          ))}
        </div>
      </div>
    ) : null;
  }

  const byCategory = new Map((categories ?? []).map((category) => [category.category, category]));
  const change = scoreDelta(scores.overallScore, previous);

  return (
    <div className="flex flex-col items-center gap-6 md:flex-row md:items-center">
      <ScoreGauge
        size="lg"
        value={scores.overallScore}
        grade={scores.grade}
        label="Overall"
        data-testid="seo-score"
        aria-label="Overall SEO score"
      />

      <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
        {SEO_CATEGORIES.map((category) => {
          const detail = byCategory.get(category);
          const weight = `${Math.round(SEO_CATEGORY_WEIGHTS[category] * 100)}%`;
          return (
            <ScoreBar
              key={category}
              label={SEO_CATEGORY_LABELS[category]}
              score={scores.scores[category]}
              hint={detail?.estimated ? `${weight} · estimated` : weight}
              data-testid="seo-category"
              data-category={category}
            />
          );
        })}

        {change ? (
          <p
            className="m-0 flex flex-wrap items-center gap-2 font-sans text-sm text-ink"
            data-testid="seo-delta"
            data-direction={change.direction}
          >
            {change.direction === 'up' ? (
              <ArrowUp className="h-4 w-4 text-actionSuccess" strokeWidth={3} aria-hidden="true" />
            ) : change.direction === 'down' ? (
              <ArrowDown className="h-4 w-4 text-actionDanger" strokeWidth={3} aria-hidden="true" />
            ) : (
              <Minus className="h-4 w-4 opacity-60" strokeWidth={3} aria-hidden="true" />
            )}
            <span className="font-bold tabular-nums">
              {change.delta > 0 ? `+${change.delta}` : change.delta}
            </span>
            <span className="opacity-70">
              vs last run ({change.previousScore}
              {mounted
                ? `, ${new Date(change.previousAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}`
                : ''}
              )
            </span>
            <Badge
              variant={
                change.direction === 'up'
                  ? 'success'
                  : change.direction === 'down'
                    ? 'danger'
                    : 'outline'
              }
            >
              {change.direction === 'up'
                ? 'Improved'
                : change.direction === 'down'
                  ? 'Declined'
                  : 'Unchanged'}
            </Badge>
          </p>
        ) : null}
      </div>
    </div>
  );
}
