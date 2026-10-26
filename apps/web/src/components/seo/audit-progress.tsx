'use client';

/**
 * Where the analysis is (revamped 2026-10-23): the four stages as a tracker
 * in their own panel, and what happened if the run did not reach the end.
 *
 * Shown only for a run started in this session: a tracker for an audit
 * loaded from the history would be four green ticks saying nothing. A stop
 * is a quiet line, not an error. A stream error is an `ErrorState` here,
 * above whatever the result still shows, so "the advice failed" does not
 * hide the crawl facts and the four scores that arrived before it. Refusals
 * that came before the stream are the form's (on the field) or the
 * analyzer's (an alert) to show.
 */
import { ErrorState, type Stage, StageTracker } from '@postgear/ui';
import { SEO_STAGES } from '@/types/seo';
import { type SeoState, STAGE_LABELS } from './seo-state';
import { SeoPanel } from './seo-ui';

export function AuditProgress({ state, onRetry }: { state: SeoState; onRetry: () => void }) {
  if (state.phase === 'idle' || !state.live || state.error?.beforeStream) {
    return null;
  }

  const stages: Stage[] = SEO_STAGES.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: state.stages[id].status,
    detail: state.stages[id].detail ?? undefined,
  }));

  const heading =
    state.phase === 'running'
      ? 'Analyzing…'
      : state.phase === 'done'
        ? 'Done'
        : state.phase === 'aborted'
          ? 'Stopped'
          : "Didn't finish";

  return (
    <SeoPanel
      aria-label="Analysis progress"
      aria-busy={state.phase === 'running'}
      className="flex flex-col gap-4 p-4 sm:p-5"
    >
      <h2 className="m-0 type-heading text-lg text-ink" aria-live="polite">
        {heading}
      </h2>

      <StageTracker stages={stages} aria-label="Analysis stages" />

      {state.phase === 'aborted' ? (
        <p className="m-0 font-sans text-sm text-ink type-muted">
          Stopped. Anything already measured is kept below; nothing was charged for advice that was
          not written.
        </p>
      ) : null}

      {state.error && !state.error.beforeStream ? (
        <ErrorState
          title="The analysis didn't finish"
          description={state.error.message}
          className="p-4"
          action={state.error.retryable ? { label: 'Try Again', onClick: onRetry } : undefined}
        />
      ) : null}
    </SeoPanel>
  );
}
