'use client';

/**
 * One workflow in the list's grid (Workflows revamp, 2026-10-31), built like
 * Studio's design card: the workflow's first steps, by name, on a plain
 * stage, then its name, its status badges and two muted lines. The steps are
 * the preview the list API returns (`workflow-flow.tsx`).
 *
 * The card opens the builder. The corner menu is a sibling of the link, so it
 * is its own tab stop and a click on it never follows the link.
 */
import { Badge, cn } from '@postgear/ui';
import Link from 'next/link';
import type { AutomationListItem } from '@/types/workflows';
import { showsUnpublishedChanges } from '../activation/activation-model';
import { AppIcon } from '../app-icon';
import { FOCUS } from './template-gallery';
import { WorkflowFlow } from './workflow-flow';
import { WorkflowRowMenu } from './workflow-row-menu';
import {
  ago,
  lastRunText,
  runsText,
  stepCountText,
  triggerText,
  WORKFLOW_STATUS,
} from './workflows-view-model';

/** Steps the stage names before it counts the rest; four rows fit it. */
const CARD_STEPS = 4;

export function WorkflowCard({
  workflow,
  href,
  now,
  canManage,
  busy,
  onOpen,
  onDuplicate,
  onActivate,
  onPause,
  onDelete,
}: {
  workflow: AutomationListItem;
  href: string;
  /** One clock for the whole grid, so every "Updated" agrees; null while hydrating. */
  now: number | null;
  canManage: boolean;
  /** Activate is loading this workflow. */
  busy: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onActivate: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const state = WORKFLOW_STATUS[workflow.status];
  const trigger = triggerText(workflow.triggerType);
  const run = lastRunText(workflow);

  return (
    <li
      data-testid="workflow-row"
      data-workflow-id={workflow.id}
      className="group relative min-w-0"
    >
      <Link
        href={href}
        aria-label={`Open ${workflow.name}`}
        className={cn(
          'flex h-full flex-col overflow-hidden rounded-card border-2 border-outline bg-secondary shadow-surfaceMd',
          FOCUS,
        )}
      >
        {/* A fixed height, so the cards in a row line up whatever their length. */}
        <div className="flex h-56 flex-col items-center justify-center border-b-2 border-outline bg-inset p-3">
          <WorkflowFlow preview={workflow.preview} limit={CARD_STEPS} />
        </div>

        <span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <span className="line-clamp-2 break-words type-ui text-sm text-ink" title={workflow.name}>
            {workflow.name}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={state.variant}>{state.label}</Badge>
            {showsUnpublishedChanges(workflow) ? (
              <Badge variant="accent">Unpublished Changes</Badge>
            ) : null}
            {run ? (
              <span title={workflow.lastRunError ?? undefined}>
                <Badge variant={run.variant}>{run.label}</Badge>
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 font-sans text-xs text-ink type-muted">
            {trigger.icon ? <AppIcon icon={trigger.icon} className="h-3.5 w-3.5" /> : null}
            <span className="truncate">{trigger.title}</span>
          </span>
          <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-sans text-xs text-ink type-muted">
            <span>{stepCountText(workflow.preview.stepCount)}</span>
            <span>{runsText(workflow.runs30d)}</span>
            {now !== null ? <span>{ago(workflow.updatedAt, now)}</span> : null}
          </span>
        </span>
      </Link>

      <span className="absolute end-2 top-2">
        <WorkflowRowMenu
          workflow={workflow}
          variant="secondary"
          canManage={canManage}
          busy={busy}
          onOpen={onOpen}
          onDuplicate={onDuplicate}
          onActivate={onActivate}
          onPause={onPause}
          onDelete={onDelete}
        />
      </span>
    </li>
  );
}
