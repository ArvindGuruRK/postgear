'use client';

/**
 * The audit as it stands (revamped 2026-10-23): a header naming the page with
 * its crawl facts and the three things to do with it, then the scores, what
 * to fix, and the breakdown, each its own panel.
 *
 * Rendered from the reducer's partial fields rather than the final detail,
 * so the facts appear the moment the crawl lands, the gauge the moment the
 * scores do, and a run that failed at the advice stage still shows
 * everything measured before it. Each section draws its own skeleton while
 * the run is live and its data has not arrived, in the footprint the data
 * will take, so nothing jumps.
 *
 * "Analyze Again" sends the same URL; "Copy Report" puts `reportAsText` on
 * the clipboard (the complete audit only: partial results are on screen,
 * not in a report); "Delete" asks first. The actions wait for the run to
 * end: deleting an audit the API is still writing is a race nobody wins.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { Button, MotionIcon, useToast } from '@postgear/ui';
import { CrawlFacts } from './crawl-facts';
import { Recommendations } from './recommendations';
import { ScoreBreakdown } from './score-breakdown';
import { ScoreHero } from './score-hero';
import type { SeoState } from './seo-state';
import { SeoPanel } from './seo-ui';
import { hostOf, pathOf, reportAsText } from './seo-view-model';

export function AuditResult({
  state,
  onAnalyzeAgain,
  onDelete,
}: {
  state: SeoState;
  onAnalyzeAgain: () => void;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const running = state.phase === 'running';
  const url = state.url ?? state.audit?.targetUrl ?? null;
  const settled = !running && (state.detail || state.audit);

  async function copy() {
    if (!state.detail) {
      return;
    }
    try {
      await navigator.clipboard.writeText(reportAsText(state.detail));
      toast({ title: 'Copied', description: 'The report is on the clipboard as plain text.' });
    } catch {
      toast({ title: "Couldn't copy", description: 'Select the text and copy it by hand.' });
    }
  }

  return (
    <section aria-label="Audit result" aria-busy={running} className="flex flex-col gap-4">
      {url ? (
        <SeoPanel className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="m-0 truncate type-heading text-2xl text-ink">{hostOf(url)}</h2>
              {pathOf(url) ? (
                <span className="truncate font-sans text-sm text-ink type-muted">
                  {pathOf(url)}
                </span>
              ) : null}
            </div>

            {settled ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={onAnalyzeAgain}>
                  <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
                  Analyze Again
                </Button>
                {state.detail ? (
                  <Button variant="secondary" size="sm" onClick={() => void copy()}>
                    <MotionIcon icon={CopyIcon} className="h-4 w-4" />
                    Copy Report
                  </Button>
                ) : null}
                {state.audit ? (
                  <Button variant="danger" size="sm" onClick={onDelete}>
                    <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                    Delete
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <CrawlFacts
            crawl={state.crawl}
            durationMs={state.audit?.durationMs ?? null}
            running={running}
          />
        </SeoPanel>
      ) : null}

      <ScoreHero
        scores={state.scores}
        categories={state.categories}
        previous={state.previous}
        running={running}
      />

      <Recommendations
        advice={state.advice}
        running={running}
        advising={state.stages.advise.status === 'active'}
      />

      <ScoreBreakdown categories={state.categories} crawl={state.crawl} running={running} />
    </section>
  );
}
