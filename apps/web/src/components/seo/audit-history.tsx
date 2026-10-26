'use client';

/**
 * The history (revamped 2026-10-23): every site this workspace has analyzed,
 * latest first, with the trend of the one being looked at (user story 7.3).
 *
 * ## One row per site, not per run
 *
 * A site analyzed eight times is one row with a sparkline, not eight rows
 * that say the same host; its runs are listed under it when it is selected,
 * each loadable on its own, so "what did it score on the 3rd" is one click.
 * The trend chart at the top draws the selected site's finished runs once
 * there are at least two: one point is a number, not a trend.
 *
 * ## What is a button and what is not
 *
 * A row's main area is a button that loads the latest audit; Re-run is a
 * separate icon button beside it (named in a tooltip) that fills the form
 * and starts a run. Nesting one in the other is invalid HTML and a keyboard
 * trap, so the row holds two buttons rather than one big one.
 *
 * ## Grades read the one scale
 *
 * The grade sticker's tone comes from `gradeVariant`, the same bands the
 * gauge uses (design-system-rules.md section 16c). A failed run shows its
 * reason under a danger sticker; a run still going elsewhere shows as
 * pending.
 *
 * Relative times and dates are formatted in the viewer's locale, which the
 * server does not share, so they render after mount; a skeleton holds the
 * chart's space until then (see `use-mounted.ts`).
 */
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import {
  Badge,
  Button,
  cn,
  MotionIcon,
  Skeleton,
  Sparkline,
  TooltipHint,
  TrendChart,
  type TrendSeries,
} from '@postgear/ui';
import type { SeoAuditSummary } from '@/types/seo';
import { useMounted } from '../posts/use-mounted';
import { formatRunDay, formatRunMoment, INSET, PanelHeader, SeoPanel } from './seo-ui';
import { formatRelative, gradeVariant, type SiteHistory } from './seo-view-model';

const STATUS_LABELS: Record<SeoAuditSummary['status'], string> = {
  pending: 'Pending',
  crawling: 'Crawling',
  scoring: 'Scoring',
  advising: 'Advising',
  done: 'Done',
  failed: 'Failed',
};

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function AuditHistory({
  sites,
  selectedUrl,
  shownAuditId,
  loadingId,
  busy,
  failed = false,
  onRetry,
  onSelect,
  onRerun,
}: {
  sites: SiteHistory[];
  /** The history could not be loaded; shown instead of "no audits yet". */
  failed?: boolean;
  onRetry?: () => void;
  /** The site whose trend is drawn and whose runs are listed. */
  selectedUrl: string | null;
  /** The audit in the result area, if any. */
  shownAuditId: string | null;
  /** The audit being fetched after a click, if any. */
  loadingId: string | null;
  /** A run is in progress; re-runs wait. */
  busy: boolean;
  onSelect: (audit: SeoAuditSummary) => void;
  onRerun: (url: string) => void;
}) {
  const mounted = useMounted();
  const selected = sites.find((site) => site.targetUrl === selectedUrl) ?? null;
  const series: TrendSeries[] =
    selected && selected.trend.length >= 2
      ? [
          {
            id: selected.targetUrl,
            label: 'Overall Score',
            points: selected.trend,
            tone: 'primary',
          },
        ]
      : [];

  return (
    <SeoPanel className="flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="seo-history">
      <PanelHeader
        id="seo-history"
        title="History"
        sub={
          sites.length > 0 ? (
            <span className="font-sans text-sm text-ink type-muted">
              {sites.length} {sites.length === 1 ? 'site' : 'sites'} analyzed
            </span>
          ) : null
        }
      />

      {selected && series.length > 0 ? (
        <div
          className={cn(INSET, 'flex flex-col gap-2 p-3')}
          data-testid="seo-trend"
          data-points={selected.trend.length}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="m-0 font-sans text-sm font-bold text-ink">Score Over Time</h3>
            <span className="truncate font-sans text-xs text-ink type-muted">{selected.host}</span>
          </div>
          {mounted ? (
            <TrendChart
              series={series}
              height={150}
              showLegend={false}
              formatX={formatRunDay}
              formatXLong={formatRunMoment}
              formatValue={(value) => String(Math.round(value))}
              aria-label={`Score over time for ${selected.host}`}
            />
          ) : (
            <Skeleton className="h-36" />
          )}
        </div>
      ) : null}

      {sites.length === 0 && failed ? (
        <div
          className={cn(INSET, 'flex flex-wrap items-center justify-between gap-3 p-3')}
          role="alert"
          data-testid="seo-history-error"
        >
          <span className="font-sans text-sm text-ink type-muted">
            The history couldn't be loaded.
          </span>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : sites.length === 0 ? (
        <p className={cn(INSET, 'm-0 p-4 font-sans text-sm text-ink type-muted')}>
          No audits yet. Your first analysis lands here, and every run after it builds the trend.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Analyzed sites">
          {sites.map((site) => {
            const isSelected = site.targetUrl === selectedUrl;
            const latest = site.latest;
            const isFailed = latest.status === 'failed';
            const finished = latest.status === 'done';

            return (
              <li
                key={site.targetUrl}
                data-testid="seo-history-row"
                data-url={site.targetUrl}
                data-grade={latest.grade ?? undefined}
                data-status={latest.status}
                className={cn(
                  INSET,
                  'flex flex-col overflow-hidden',
                  isSelected && 'border-actionPrimary',
                )}
              >
                <div className="flex items-start gap-2 p-1.5">
                  <button
                    type="button"
                    onClick={() => onSelect(latest)}
                    aria-current={latest.id === shownAuditId ? 'true' : undefined}
                    aria-busy={loadingId === latest.id}
                    aria-label={`Open the latest audit of ${site.host}${site.path}`}
                    className={cn(
                      'flex min-w-0 flex-1 flex-col gap-2 rounded-md px-2.5 py-2 text-start transition-colors hover:bg-actionPrimary/10',
                      FOCUS,
                      latest.id === shownAuditId && 'bg-actionPrimary/10',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-sans text-sm font-bold text-ink">
                          {site.host}
                        </span>
                        {site.path ? (
                          <span className="truncate font-sans text-xs text-ink type-muted">
                            {site.path}
                          </span>
                        ) : null}
                      </span>
                      {isFailed ? (
                        <Badge variant="danger">Failed</Badge>
                      ) : finished ? (
                        <Badge
                          variant={gradeVariant(latest.grade)}
                          className="min-w-8 justify-center"
                        >
                          {latest.grade ?? '–'}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{STATUS_LABELS[latest.status]}</Badge>
                      )}
                    </span>

                    <span className="flex items-end justify-between gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="type-heading text-2xl leading-none text-ink tabular-nums">
                          {latest.overallScore === null ? '–' : Math.round(latest.overallScore)}
                        </span>
                        <span className="mt-1 font-sans text-xs text-ink type-muted">
                          {mounted ? formatRelative(latest.createdAt) : ''}
                          {site.audits.length > 1 ? `, ${site.audits.length} runs` : ''}
                        </span>
                      </span>
                      <Sparkline
                        points={site.trend.map((point) => point.y)}
                        tone={isFailed ? 'danger' : 'primary'}
                        width={72}
                        height={24}
                      />
                    </span>

                    {isFailed && latest.failureReason ? (
                      <span className="font-sans text-xs font-medium text-dangerInk">
                        {latest.failureReason}
                      </span>
                    ) : null}
                  </button>

                  <TooltipHint label="Re-Run">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-1.5 w-9 shrink-0 px-0"
                      disabled={busy}
                      onClick={() => onRerun(site.targetUrl)}
                      aria-label={`Re-run ${site.host}${site.path}`}
                    >
                      <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
                    </Button>
                  </TooltipHint>
                </div>

                {isSelected && site.audits.length > 1 ? (
                  <ol
                    className="m-0 flex list-none flex-col border-t-2 border-outline p-1.5"
                    aria-label={`Runs of ${site.host}`}
                  >
                    {site.audits.map((run) => (
                      <li key={run.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(run)}
                          aria-current={run.id === shownAuditId ? 'true' : undefined}
                          aria-busy={loadingId === run.id}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-start font-sans text-xs text-ink transition-colors hover:bg-actionPrimary/10',
                            FOCUS,
                            run.id === shownAuditId && 'bg-actionPrimary/10 font-bold',
                          )}
                        >
                          <span className={cn(run.id !== shownAuditId && 'type-muted')}>
                            {mounted ? formatRunMoment(run.createdAt) : run.createdAt.slice(0, 10)}
                          </span>
                          <span className="flex items-center gap-2 tabular-nums">
                            {run.status === 'failed' ? (
                              <Badge variant="danger">Failed</Badge>
                            ) : (
                              <>
                                <span className="font-bold">
                                  {run.overallScore === null ? '–' : Math.round(run.overallScore)}
                                </span>
                                <Badge
                                  variant={gradeVariant(run.grade)}
                                  className="min-w-7 justify-center"
                                >
                                  {run.grade ?? '–'}
                                </Badge>
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SeoPanel>
  );
}
