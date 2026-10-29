'use client';

/**
 * The builder's PageActions row (blueprint 3): the workflow's name (click
 * to rename), the save state in words, the status badge, the issues chip
 * (its list lands on the step's field, `panel/issues-popover.tsx`), and a
 * menu with Duplicate and Delete. The top
 * bar above already says Workflows, so there is no page title.
 *
 * Test Workflow, the Activate switch and the Editor and Runs switch arrive
 * with Modules 08 and 09; until then they are left out rather than shown
 * disabled.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { PanelLeftOpenIcon } from '@animateicons/react/lucide/panel-left-open-icon';
import type { AutomationGraph, ValidationIssue } from '@postgear/automation';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  MotionIcon,
  PageActions,
} from '@postgear/ui';
import { CircleCheck, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AutomationStatus } from '@/types/workflows';
import { WORKFLOW_STATUS } from '../list/workflows-view-model';
import { IssuesPopover } from '../panel/issues-popover';
import type { SaveStatus } from './builder-autosave';
import { SAVE_STATE_WORDS } from './builder-view-model';

const MAX_NAME = 80;

function SaveState({ status, message }: { status: SaveStatus; message: string | null }) {
  const Icon =
    status === 'saved'
      ? CircleCheck
      : status === 'offline'
        ? CloudOff
        : status === 'conflict' || status === 'failed' || status === 'retrying'
          ? TriangleAlert
          : LoaderCircle;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="save-state"
      data-status={status}
      title={message ?? undefined}
      className={cn(
        'flex items-center gap-1.5 font-sans text-xs',
        status === 'conflict' || status === 'failed' ? 'text-dangerInk' : 'text-ink type-muted',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'h-3.5 w-3.5',
          status === 'saving' || status === 'pending' ? 'motion-safe:animate-spin' : '',
        )}
        strokeWidth={2.5}
      />
      {SAVE_STATE_WORDS[status]}
    </span>
  );
}

export function BuilderTopBar({
  name,
  onRename,
  status,
  message,
  workflowStatus,
  hasUnpublishedChanges,
  issues,
  graph,
  onOpenIssue,
  onDuplicate,
  onDelete,
  stepsHidden,
  onShowSteps,
}: {
  name: string;
  onRename: (name: string) => void;
  status: SaveStatus;
  message: string | null;
  workflowStatus: AutomationStatus;
  hasUnpublishedChanges: boolean;
  issues: ValidationIssue[];
  graph: AutomationGraph;
  onOpenIssue: (issue: ValidationIssue) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Below `lg` the Steps panel is a drawer, opened from here. */
  stepsHidden: boolean;
  onShowSteps: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const state = WORKFLOW_STATUS[workflowStatus];

  useEffect(() => {
    setDraft(name);
  }, [name]);

  function commit() {
    const next = draft.trim().slice(0, MAX_NAME);
    if (!next) {
      setDraft(name);
      return;
    }
    if (next !== name) onRename(next);
  }

  return (
    <PageActions className="justify-start">
      {stepsHidden ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onShowSteps}
          aria-label="Show Steps"
          className="lg:hidden"
        >
          <MotionIcon icon={PanelLeftOpenIcon} className="h-4 w-4" />
          Steps
        </Button>
      ) : null}
      {/* On a phone the name takes the first line; Steps and the rest wrap below it. */}
      <div className="order-first flex min-w-0 flex-1 basis-full flex-wrap items-center gap-3 sm:order-none sm:basis-auto">
        <Input
          value={draft}
          maxLength={MAX_NAME}
          aria-label="Workflow name"
          placeholder="Enter your workflow name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(name);
              event.currentTarget.blur();
            }
          }}
          className="h-9 w-full max-w-xs type-ui sm:w-72"
          data-testid="workflow-name"
        />
        <SaveState status={status} message={message} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={state.variant}>{state.label}</Badge>
        {hasUnpublishedChanges ? <Badge variant="outline">Unpublished Changes</Badge> : null}
        <IssuesPopover issues={issues} graph={graph} onOpenIssue={onOpenIssue} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" aria-label="Workflow actions">
              <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-dangerInk" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </PageActions>
  );
}
