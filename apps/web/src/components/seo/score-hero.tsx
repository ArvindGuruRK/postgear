'use client';

/**
 * The headline of an audit (revamped 2026-10-23): the gauge and how this run
 * compares with the last, beside the four category cards.
 *
 * The page's one bold element. The gauge is `ScoreGauge` at its largest; the
 * change since the last run is a filled chip under it (green up, red down)
 * with the earlier score and day spelled out, never a colour wash over the
 * number. Each category is a light card: its icon and name, its weight in
 * the total, the score large, and a flat bar in the score's own band colour,
 * the same bands the gauge uses (design-system-rules.md section 16c).
 *
 * Rendered from the reducer's partial fields: the cards fill the moment the
 * `scores` event lands, with skeletons in the same footprint before it so
 * nothing jumps (section 8, loading).
 */
import { Badge, cn, Progress, ScoreGauge, Skeleton, toneForScore } from '@postgear/ui';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { SeoCategoryScore } from '@/types/seo';
import { SEO_CATEGORIES, SEO_CATEGORY_LABELS, SEO_CATEGORY_WEIGHTS } from '@/types/seo';
import { useMounted } from '../posts/use-mounted';
import type { ScoreSnapshot, SeoState } from './seo-state';
import { CATEGORY_META, formatRunDay, INSET, SeoPanel } from './seo-ui';
import { scoreDelta } from './seo-view-model';

const GRID = 'grid gap-5 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-8';

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
      <SeoPanel className={GRID} role="status" aria-label="Scoring" aria-busy="true">
        <Skeleton className="mx-auto h-56 w-56 rounded-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          {SEO_CATEGORIES.map((category) => (
            <Skeleton key={category} className="h-32" />
          ))}
        </div>
      </SeoPanel>
    ) : null;
  }

  const byCategory = new Map((categories ?? []).map((category) => [category.category, category]));
  const change = scoreDelta(scores.overallScore, previous);

  return (
    <SeoPanel className={GRID} aria-label="Scores">
      <div className="flex flex-col items-center gap-3">
        <ScoreGauge
          size="lg"
          value={scores.overallScore}
          grade={scores.grade}
          label="Overall"
          data-testid="seo-score"
          aria-label="Overall SEO score"
        />

        {change ? (
          <p
            className="m-0 flex max-w-64 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center font-sans text-xs text-ink"
            data-testid="seo-delta"
            data-direction={change.direction}
          >
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full border-2 border-outline bg-clip-padding py-0.5 ps-1 pe-2 font-bold tabular-nums',
                change.direction === 'up'
                  ? 'bg-actionSuccess text-onActionLight'
                  : change.direction === 'down'
                    ? 'bg-actionDanger text-onActionLight'
                    : 'bg-secondary text-ink',
              )}
            >
              {change.direction === 'up' ? (
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              ) : change.direction === 'down' ? (
                <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              ) : (
                <Minus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              )}
              <span className="sr-only">
                {change.direction === 'up'
                  ? 'Improved by '
                  : change.direction === 'down'
                    ? 'Declined by '
                    : 'Unchanged, '}
              </span>
              {change.delta > 0 ? `+${change.delta}` : change.delta}
            </span>
            <span className="type-muted">
              vs last run ({change.previousScore}
              {mounted ? `, ${formatRunDay(change.previousAt)}` : ''})
            </span>
          </p>
        ) : null}
      </div>

      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {SEO_CATEGORIES.map((category) => {
          const detail = byCategory.get(category);
          const score = Math.round(scores.scores[category]);
          const { icon: Icon } = CATEGORY_META[category];

          return (
            <li
              key={category}
              data-testid="seo-category"
              data-category={category}
              data-score={score}
              className={cn(INSET, 'flex flex-col gap-3 p-4')}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 font-sans text-sm font-bold text-ink">
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                  <span className="truncate">{SEO_CATEGORY_LABELS[category]}</span>
                </span>
                {detail?.estimated ? (
                  <Badge variant="outline">Estimated</Badge>
                ) : (
                  <span className="shrink-0 font-sans text-xs text-ink type-muted">
                    {Math.round(SEO_CATEGORY_WEIGHTS[category] * 100)}% of total
                  </span>
                )}
              </span>
              <span className="flex items-baseline gap-1">
                <span className="type-heading text-4xl leading-none text-ink tabular-nums">
                  {score}
                </span>
                <span className="font-sans text-sm text-ink type-muted">/100</span>
              </span>
              <Progress
                value={score}
                tone={toneForScore(score)}
                size="sm"
                striped={false}
                animated={false}
                aria-label={`${SEO_CATEGORY_LABELS[category]}: ${score} out of 100`}
              />
            </li>
          );
        })}
      </ul>
    </SeoPanel>
  );
}
