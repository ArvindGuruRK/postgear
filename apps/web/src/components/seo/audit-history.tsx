'use client';

/**
 * The history: every site this workspace has analyzed, latest first, with
 * the trend of the one being looked at (user story 7.3).
 *
 * ## One row per site, not per run
 *
 * A site analyzed eight times is one line with a sparkline, not eight lines
 * that say the same host; the runs are listed under the selected site, each
 * loadable on its own, so "what did it score on the 3rd" is one click. The
 * `TrendChart` at the top draws the selected site's finished runs when there
 * are at least two of them — one point is a number, not a trend.
 *
 * ## What is a button and what is not
 *
 * A row's main area is a button that loads the latest audit; "Re-run" is a
 * separate button beside it that fills the form and starts a run. Nesting
 * one in the other is invalid HTML and a keyboard trap, so the row is a
 * `div` holding two buttons rather than one big one.
 *
 * ## Grades read the one scale
 *
 * The badge tone comes from `gradeVariant`, the same bands the gauge uses
 * (design-system-rules.md §16c). A failed run shows its reason under a
 * `danger` badge; a run still in progress elsewhere shows as pending.
 *
 * Relative times and the chart's axis are formatted in the viewer's locale,
 * which the server does not share, so they render after mount; a skeleton
 * holds the space until then (see `use-mounted.ts`).
 */
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Skeleton,
  Sparkline,
  Text,
  TrendChart,
  type TrendSeries,
} from '@postgear/ui';
import { History, RefreshCw } from 'lucide-react';
import type { SeoAuditSummary } from '@/types/seo';
import { useMounted } from '../posts/use-mounted';
import { formatRelative, gradeVariant, type SiteHistory } from './seo-view-model';

const STATUS_LABELS: Record<SeoAuditSummary['status'], string> = {
  pending: 'Pending',
  crawling: 'Crawling',
  scoring: 'Scoring',
  advising: 'Advising',
  done: 'Done',
  failed: 'Failed',
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
            label: 'Overall score',
            points: selected.trend,
            tone: 'primary',
          },
        ]
      : [];

  return (
    <Card className="flex min-w-0 flex-col" aria-label="History">
      <CardHeader className="flex-row items-center gap-3 p-5">
        <History className="h-5 w-5 shrink-0 text-ink" strokeWidth={2.5} aria-hidden="true" />
        <CardTitle className="text-xl">History</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-5 pt-0">
        {selected && series.length > 0 ? (
          <div
            className="flex flex-col gap-2"
            data-testid="seo-trend"
            data-points={selected.trend.length}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="m-0 font-display text-xs uppercase tracking-wide text-ink">
                Score over time
              </h3>
              <Text size="xs" muted as="span" className="truncate">
                {selected.host}
              </Text>
            </div>
            {mounted ? (
              <TrendChart
                series={series}
                height={160}
                showLegend={false}
                formatX={formatDay}
                formatXLong={formatMoment}
                formatValue={(value) => String(Math.round(value))}
                aria-label={`Score over time for ${selected.host}`}
              />
            ) : (
              <Skeleton className="h-40" />
            )}
          </div>
        ) : null}

        {sites.length === 0 && failed ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3"
            role="alert"
            data-testid="seo-history-error"
          >
            <Text size="sm" muted as="span">
              The history couldn't be loaded.
            </Text>
            {onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : sites.length === 0 ? (
          <Text size="sm" muted>
            No audits yet — analyze your first URL.
          </Text>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Analyzed sites">
            {sites.map((site) => {
              const isSelected = site.targetUrl === selectedUrl;
              const latest = site.latest;
              const failed = latest.status === 'failed';
              const finished = latest.status === 'done';

              return (
                <li
                  key={site.targetUrl}
                  data-testid="seo-history-row"
                  data-url={site.targetUrl}
                  data-grade={latest.grade ?? undefined}
                  data-status={latest.status}
                  className={cn(
                    'flex flex-col rounded-md border-2 border-outline bg-secondary',
                    isSelected && 'border-s-4 border-s-actionPrimary',
                  )}
                >
                  <div className="flex items-stretch gap-1 p-1">
                    <button
                      type="button"
                      onClick={() => onSelect(latest)}
                      aria-current={latest.id === shownAuditId ? 'true' : undefined}
                      aria-busy={loadingId === latest.id}
                      aria-label={`Open the latest audit of ${site.host}${site.path}`}
                      className={cn(
                        'flex min-w-0 flex-1 flex-col gap-2 rounded-md px-3 py-2 text-left transition-colors',
                        'hover:bg-actionPrimary/10 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                        latest.id === shownAuditId && 'bg-actionPrimary/10',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-sans text-sm font-bold text-ink">
                            {site.host}
                          </span>
                          {site.path ? (
                            <span className="truncate font-sans text-xs font-medium text-ink opacity-70">
                              {site.path}
                            </span>
                          ) : null}
                        </span>
                        {failed ? (
                          <Badge variant="danger">Failed</Badge>
                        ) : finished ? (
                          <Badge variant={gradeVariant(latest.grade)}>{latest.grade ?? '–'}</Badge>
                        ) : (
                          <Badge variant="outline">{STATUS_LABELS[latest.status]}</Badge>
                        )}
                      </span>

                      <span className="flex items-center justify-between gap-3">
                        <span className="flex items-baseline gap-2">
                          <span className="font-display text-xl tracking-wide text-ink tabular-nums">
                            {latest.overallScore === null ? '–' : Math.round(latest.overallScore)}
                          </span>
                          <span className="font-sans text-xs font-medium text-ink opacity-70">
                            {mounted ? formatRelative(latest.createdAt) : ''}
                            {site.audits.length > 1 ? ` · ${site.audits.length} runs` : ''}
                          </span>
                        </span>
                        <Sparkline
                          points={site.trend.map((point) => point.y)}
                          tone={failed ? 'danger' : 'primary'}
                          width={72}
                          height={24}
                        />
                      </span>

                      {failed && latest.failureReason ? (
                        <span className="font-sans text-xs font-medium text-actionDanger">
                          {latest.failureReason}
                        </span>
                      ) : null}
                    </button>

                    <Button
                      variant="secondary"
                      size="sm"
                      className="self-center"
                      disabled={busy}
                      onClick={() => onRerun(site.targetUrl)}
                      aria-label={`Re-run ${site.host}${site.path}`}
                      title="Re-run"
                    >
                      <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
                      <span className="sr-only sm:not-sr-only">Re-run</span>
                    </Button>
                  </div>

                  {isSelected && site.audits.length > 1 ? (
                    <ol
                      className="m-0 flex list-none flex-col border-t-2 border-outline p-1"
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
                              'flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left font-sans text-xs text-ink transition-colors',
                              'hover:bg-actionPrimary/10 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                              run.id === shownAuditId && 'bg-actionPrimary/10 font-bold',
                            )}
                          >
                            <span className="opacity-80">
                              {mounted ? formatMoment(run.createdAt) : run.createdAt.slice(0, 10)}
                            </span>
                            <span className="flex items-center gap-2 tabular-nums">
                              {run.status === 'failed' ? (
                                <Badge variant="danger">Failed</Badge>
                              ) : (
                                <>
                                  <span className="font-bold">
                                    {run.overallScore === null ? '–' : Math.round(run.overallScore)}
                                  </span>
                                  <Badge variant={gradeVariant(run.grade)}>
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
      </CardContent>
    </Card>
  );
}
