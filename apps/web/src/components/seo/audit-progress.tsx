'use client';

/**
 * Where the analysis is: the four stages as a tracker, and what happened if
 * it did not reach the end.
 *
 * Shown only for a run started in this session — a tracker for an audit
 * loaded from the history would be four green ticks saying nothing. A stop
 * is a quiet line, not an error. A stream error is an `ErrorState` here,
 * above whatever the result still shows, so "the advice failed" does not
 * hide the crawl facts and the four scores that arrived before it. Refusals
 * that came before the stream are the form's (on the field) or the
 * analyzer's (an alert) to show.
 */
import { ErrorState, type Stage, StageTracker, Text } from '@postgear/ui';
import { SEO_STAGES } from '@/types/seo';
import { type SeoState, STAGE_LABELS } from './seo-state';

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
    <section
      aria-label="Analysis progress"
      aria-busy={state.phase === 'running'}
      className="flex flex-col gap-4 rounded-md border-2 border-outline bg-secondary p-4"
    >
      <h2 className="font-display text-sm uppercase tracking-wide text-ink" aria-live="polite">
        {heading}
      </h2>

      <StageTracker stages={stages} aria-label="Analysis stages" />

      {state.phase === 'aborted' ? (
        <Text size="sm" muted>
          Stopped. Anything already measured is kept below; nothing was charged for advice that was
          not written.
        </Text>
      ) : null}

      {state.error && !state.error.beforeStream ? (
        <ErrorState
          title="The analysis didn't finish"
          description={state.error.message}
          className="p-4"
          action={state.error.retryable ? { label: 'Try again', onClick: onRetry } : undefined}
        />
      ) : null}
    </section>
  );
}
