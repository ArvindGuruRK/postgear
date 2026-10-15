'use client';

/**
 * Where the generation is: the five stages as a tracker, and what happened
 * if it did not reach the end.
 *
 * A stop is a quiet line, not an error — the person asked for it. A stream
 * error is an `ErrorState` here, above whatever the result card still shows,
 * so "the image failed" does not hide the three parts that were written.
 * Refusals that arrived before the stream are the form's to show.
 */
import { ErrorState, type Stage, StageTracker, Text } from '@postgear/ui';
import { GENERATE_STAGES } from '@/types/ai';
import { type GenerateState, STAGE_LABELS } from './generate-state';

export function GenerateProgress({
  state,
  onRetry,
}: {
  state: GenerateState;
  onRetry: () => void;
}) {
  if (state.phase === 'idle') {
    return null;
  }

  const stages: Stage[] = GENERATE_STAGES.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: state.stages[id].status,
    detail: state.stages[id].detail ?? undefined,
  }));

  const heading =
    state.phase === 'running'
      ? 'Generating…'
      : state.phase === 'done'
        ? 'Done'
        : state.phase === 'aborted'
          ? 'Stopped'
          : "Didn't finish";

  return (
    <section
      aria-label="Generation progress"
      aria-busy={state.phase === 'running'}
      className="flex flex-col gap-4 rounded-md border-2 border-outline bg-secondary p-4"
    >
      <h2 className="type-label text-sm text-ink" aria-live="polite">
        {heading}
      </h2>

      <StageTracker stages={stages} aria-label="Generation stages" />

      {state.phase === 'aborted' ? (
        <Text size="sm" muted>
          Stopped. Anything already written is kept below; the credits for what did not run are
          refunded.
        </Text>
      ) : null}

      {state.error && !state.error.beforeStream ? (
        <ErrorState
          title="Generation didn't finish"
          description={state.error.message}
          className="p-4"
          action={state.error.retryable ? { label: 'Try again', onClick: onRetry } : undefined}
        />
      ) : null}
    </section>
  );
}
