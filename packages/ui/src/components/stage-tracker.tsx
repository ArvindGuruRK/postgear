import { Check, Minus, X } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Spinner } from './spinner';

/**
 * Progress through a multi-stage pipeline (Sprint 6: research → classify →
 * hook → content → image) where stages can be skipped or fail independently,
 * which is why this is not `OnboardingStepper`; that one has a single
 * "current step" index and every earlier step is implicitly complete.
 *
 * Status colours reuse the Sprint 5 tone vocabulary rather than a new set
 * (design-system-rules.md §16a/§16b): `actionAi` for the stage the model is
 * on, `actionSuccess` for done, `actionDanger` for failed; pending stays on
 * the plain surface and skipped is the same surface with a dashed outline,
 * so "didn't run" reads as an absence, not an outcome.
 *
 * Layout is responsive by CSS alone: the vertical structure is the base and
 * `horizontal` adds `sm:` overrides, so a tracker that is a row on desktop
 * stacks on a phone with no JS. Each stage carries a half-connector on both
 * sides of its badge, which keeps the line centred on the badge in either
 * axis without measuring anything; the outer halves of the first and last
 * stage are transparent spacers.
 */
export type StageStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface Stage {
  id: string;
  label: string;
  status: StageStatus;
  /** One short line under the label: "4 sources found", "Skipped: no key". */
  detail?: string;
}

export interface StageTrackerProps
  extends Omit<React.HTMLAttributes<HTMLOListElement>, 'children'> {
  stages: readonly Stage[];
  /** `horizontal` is a row from `sm` up and stacks below it. */
  orientation?: 'horizontal' | 'vertical';
}

const BADGE: Record<StageStatus, string> = {
  pending: 'bg-secondary text-ink',
  active: 'bg-actionAi text-onActionAi',
  done: 'bg-actionSuccess text-onActionLight',
  skipped: 'border-dashed bg-secondary text-ink opacity-60',
  failed: 'bg-actionDanger text-onActionLight',
};

/** Read out after the label so a screen reader hears the outcome, not an icon. */
const STATUS_TEXT: Record<StageStatus, string> = {
  pending: 'Pending',
  active: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
  failed: 'Failed',
};

function StatusGlyph({ status, index }: { status: StageStatus; index: number }) {
  switch (status) {
    case 'active':
      // Spinner is border-outline by default; on the violet fill it should
      // match the on-fill text, the same way the Check does below.
      return <Spinner size="sm" className="border-onActionAi border-t-transparent" />;
    case 'done':
      return <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />;
    case 'skipped':
      return <Minus className="h-4 w-4" strokeWidth={3} aria-hidden="true" />;
    case 'failed':
      return <X className="h-4 w-4" strokeWidth={3} aria-hidden="true" />;
    default:
      return <>{index + 1}</>;
  }
}

export const StageTracker = forwardRef<HTMLOListElement, StageTrackerProps>(
  (
    {
      className,
      stages,
      orientation = 'horizontal',
      'aria-label': ariaLabel = 'Progress',
      ...props
    },
    ref,
  ) => {
    const row = orientation === 'horizontal';

    return (
      <ol
        ref={ref}
        aria-label={ariaLabel}
        className={cn('flex flex-col', row && 'sm:flex-row sm:items-start', className)}
        {...props}
      >
        {stages.map((stage, index) => {
          const isFirst = index === 0;
          const isLast = index === stages.length - 1;
          const connector = cn('w-0.5 flex-1', row && 'sm:h-0.5 sm:w-auto');

          return (
            <li
              key={stage.id}
              data-testid="ai-stage"
              data-stage={stage.id}
              data-status={stage.status}
              aria-current={stage.status === 'active' ? 'step' : undefined}
              className={cn(
                'flex gap-3',
                row && 'sm:flex-1 sm:flex-col sm:items-center sm:gap-2 sm:text-center',
              )}
            >
              <div
                className={cn('flex flex-col items-center', row && 'sm:w-full sm:flex-row')}
                aria-hidden="true"
              >
                <span className={cn(connector, !isFirst && 'bg-outline')} />
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-outline type-ui text-sm',
                    BADGE[stage.status],
                  )}
                >
                  <StatusGlyph status={stage.status} index={index} />
                </span>
                <span className={cn(connector, !isLast && 'bg-outline')} />
              </div>
              <div className={cn('flex min-w-0 flex-col justify-center py-3', row && 'sm:py-0')}>
                <span className="type-label text-xs text-ink">
                  {stage.label}
                  <span className="sr-only">, {STATUS_TEXT[stage.status]}</span>
                </span>
                {stage.detail && (
                  <span className="font-sans text-xs font-medium text-ink muted-tone">
                    {stage.detail}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );
  },
);
StageTracker.displayName = 'StageTracker';
