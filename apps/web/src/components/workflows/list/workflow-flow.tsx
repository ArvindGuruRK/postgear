/**
 * A workflow's steps as a short flow of named rows (Workflows revamp,
 * 2026-10-31): each step is a small card with its icon and its name beside it, joined to the next by a short line. It is what a
 * workflow's card on the grid and a template's preview both show, in place of
 * the canvas drawn in miniature, which said little with only an icon on each
 * step. No texture behind it: the card's own surface is the stage.
 *
 * The steps come in the order the canvas is read (`orderSteps`), up to
 * `limit`; the rest are counted ("+4 more"). A step's line to the next is part
 * of its own row (`data-step`), so an entrance animation that moves the rows
 * moves the lines with them. A workflow with no steps yet shows a dashed blue
 * tile, visible on the dark surfaces and the light ones.
 *
 * Decorative: the card's link and title say what it is.
 */
import { Plus } from '@phosphor-icons/react';
import { cn } from '@postgear/ui';
import type { AutomationPreview } from '@/types/workflows';
import { StepMark } from './step-glyph';
import { getStepIcon } from './step-icon';
import { orderSteps, stepLabel } from './workflow-preview';

/** A line from one row's icon to the next row's: half the icon plus the row's border and padding. */
const LINE_OFFSET = 'ms-[21px]';

export function WorkflowFlow({
  preview,
  limit,
  numbered = false,
  roomy = false,
  className,
}: {
  preview: AutomationPreview;
  /** Steps shown before the rest are counted. */
  limit: number;
  /** A step's place in the flow, at the end of its row. */
  numbered?: boolean;
  /** Bigger type and padding, for the template preview. */
  roomy?: boolean;
  className?: string;
}) {
  if (preview.nodes.length === 0) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed border-actionPrimary bg-actionPrimary/15 text-actionPrimary',
          className,
        )}
      >
        <Plus className="h-7 w-7" weight="bold" />
      </span>
    );
  }

  const steps = orderSteps(preview.nodes).slice(0, limit);
  const rest = preview.stepCount - steps.length;

  return (
    <ol aria-hidden="true" className={cn('m-0 flex w-full list-none flex-col p-0', className)}>
      {steps.map((step, index) => (
        <li key={step.key} data-step className="flex flex-col">
          <div
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-lg border-2 border-outline bg-secondary px-2',
              roomy ? 'py-1.5' : 'py-1',
              step.disabled && 'opacity-50',
            )}
          >
            <StepMark icon={getStepIcon(step.type)} />
            <span
              className={cn(
                'min-w-0 flex-1 truncate type-ui text-ink',
                roomy ? 'text-sm' : 'text-xs',
              )}
            >
              {stepLabel(step)}
            </span>
            {numbered ? (
              <span className="type-ui text-xs text-ink opacity-50 tabular-nums">{index + 1}</span>
            ) : null}
          </div>
          {index < steps.length - 1 || rest > 0 ? (
            <span
              aria-hidden="true"
              className={cn('block h-1.5 w-0.5 rounded-full bg-outline opacity-40', LINE_OFFSET)}
            />
          ) : null}
        </li>
      ))}
      {rest > 0 ? (
        <li data-step className="ps-[10px] font-sans text-xs text-ink type-muted">
          +{rest} more
        </li>
      ) : null}
    </ol>
  );
}
