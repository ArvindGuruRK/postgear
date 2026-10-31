'use client';

/**
 * The builder's PageActions row (blueprint 3): the workflow's name (click
 * to rename), the save state in words, the Editor and Runs switch, the
 * issues chip (its list lands on the step's field,
 * `panel/issues-popover.tsx`), Test Workflow (Module 08), the live state
 * and the Activate switch (Module 09's `WorkflowLiveControls`), and a menu
 * with Versions, Duplicate and Delete. The top bar above already says
 * Workflows, so there is no page title.
 *
 * The page hands Test Workflow and the live controls in as slots, so this
 * row only lays them out.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { PanelLeftOpenIcon } from '@animateicons/react/lucide/panel-left-open-icon';
import type { AutomationGraph, ValidationIssue } from '@postgear/automation';
import {
  Button,
  buttonVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  MotionIcon,
  PageActions,
  Tabs,
  TabsList,
  TabsTrigger,
  TooltipHint,
} from '@postgear/ui';
import { CircleCheck, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { IssuesPopover } from '../panel/issues-popover';
import type { SaveStatus } from './builder-autosave';
import { type BuilderTab, SAVE_STATE_WORDS } from './builder-view-model';

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
  orgId,
  name,
  onRename,
  status,
  message,
  tab,
  onTabChange,
  issues,
  graph,
  onOpenIssue,
  issuesSignal = 0,
  testControls,
  liveControls,
  onVersions,
  onDuplicate,
  onDelete,
  stepsHidden,
  onShowSteps,
}: {
  orgId: string;
  name: string;
  onRename: (name: string) => void;
  status: SaveStatus;
  message: string | null;
  /** The Editor and Runs switch (`?tab=runs`). */
  tab: BuilderTab;
  onTabChange: (tab: BuilderTab) => void;
  issues: ValidationIssue[];
  graph: AutomationGraph;
  onOpenIssue: (issue: ValidationIssue) => void;
  /** Bumped to open the issues list (a test refused for them). */
  issuesSignal?: number;
  /** Test Workflow, or Stop while a test runs. */
  testControls: ReactNode;
  /** The status badge, Unpublished Changes, Run Now and the Activate switch. */
  liveControls: ReactNode;
  onVersions: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Below `lg` the Steps panel is a drawer, opened from here. */
  stepsHidden: boolean;
  onShowSteps: () => void;
}) {
  const [draft, setDraft] = useState(name);

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
      <TooltipHint label="Back To Workflows" side="bottom">
        <Link
          href={`/${orgId}/workflows`}
          aria-label="Back To Workflows"
          data-testid="builder-back"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'w-9 shrink-0 px-0')}
        >
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
        </Link>
      </TooltipHint>
      {stepsHidden && tab === 'editor' ? (
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
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as BuilderTab)}>
          <TabsList aria-label="Builder view" data-testid="builder-tabs">
            <TabsTrigger value="editor" className="px-3 py-1.5">
              Editor
            </TabsTrigger>
            <TabsTrigger value="runs" className="px-3 py-1.5">
              Runs
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <IssuesPopover
          issues={issues}
          graph={graph}
          onOpenIssue={onOpenIssue}
          openSignal={issuesSignal}
        />
        {testControls}
        {liveControls}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" aria-label="Workflow actions">
              <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onVersions}>Versions</DropdownMenuItem>
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
