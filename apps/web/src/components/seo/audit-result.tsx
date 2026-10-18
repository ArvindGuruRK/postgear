'use client';

/**
 * The audit as it stands: the hero, the crawl facts, what to fix, the
 * breakdown, and the three things to do with it.
 *
 * Rendered from the reducer's partial fields rather than the final detail,
 * so the facts strip appears the moment the crawl lands, the gauge the
 * moment the scores do, and a run that failed at the advice stage still
 * shows everything measured before it. Each section draws its own skeleton
 * while the run is live and its data has not arrived, in the footprint the
 * data will take, so nothing jumps.
 *
 * "Analyze again" sends the same URL; "Copy report" puts `reportAsText` on
 * the clipboard (the complete audit only: partial results are on screen,
 * not in a report); "Delete" asks first. The actions wait for the run to
 * end: deleting an audit the API is still writing is a race nobody wins.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { Button, MotionIcon, Text, useToast } from '@postgear/ui';
import { CrawlFacts } from './crawl-facts';
import { Recommendations } from './recommendations';
import { ScoreBreakdown } from './score-breakdown';
import { ScoreHero } from './score-hero';
import type { SeoState } from './seo-state';
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
    <section aria-label="Audit result" aria-busy={running} className="flex flex-col gap-6">
      {url ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 truncate type-heading text-2xl text-ink">
            {hostOf(url)}
          </h2>
          {pathOf(url) ? (
            <Text size="sm" muted className="truncate">
              {pathOf(url)}
            </Text>
          ) : null}
        </div>
      ) : null}

      <ScoreHero
        scores={state.scores}
        categories={state.categories}
        previous={state.previous}
        running={running}
      />

      <CrawlFacts
        crawl={state.crawl}
        durationMs={state.audit?.durationMs ?? null}
        running={running}
      />

      <Recommendations
        advice={state.advice}
        running={running}
        advising={state.stages.advise.status === 'active'}
      />

      <ScoreBreakdown categories={state.categories} crawl={state.crawl} running={running} />

      {!running && (state.detail || state.audit) ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onAnalyzeAgain}>
            <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
            Analyze again
          </Button>
          {state.detail ? (
            <Button variant="secondary" onClick={() => void copy()}>
              <MotionIcon icon={CopyIcon} className="h-4 w-4" />
              Copy report
            </Button>
          ) : null}
          {state.audit ? (
            <Button variant="secondary" onClick={onDelete} className="sm:ms-auto">
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
