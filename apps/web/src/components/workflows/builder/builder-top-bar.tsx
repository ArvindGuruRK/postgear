'use client';

/**
 * The builder's header (after n8n, 2026-11-03): a full-width strip above the
 * edge-to-edge canvas. On the left the way back, the workflow's name (click to
 * rename), its menu and the save state in words; in the middle the Editor and
 * Runs switch; on the right the status and the Activate split
 * (`WorkflowLiveControls`).
 *
 * The page hands the live controls in as a slot, so this row only lays them
 * out. Everything else lives on the canvas: Test Workflow bottom centre, Add
 * Step and Setup on the tool rail.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
  Tabs,
  TabsList,
  TabsTrigger,
  TooltipHint,
} from '@postgear/ui';
import { CircleCheck, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import type { SaveStatus } from './builder-autosave';
import { type BuilderTab, SAVE_STATE_WORDS } from './builder-view-model';

const MAX_NAME = 80;

export function SaveState({ status, message }: { status: SaveStatus; message: string | null }) {
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
        'flex shrink-0 items-center gap-1.5 font-sans text-xs',
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
  liveControls,
  onDuplicate,
  onDelete,
}: {
  orgId: string;
  name: string;
  onRename: (name: string) => void;
  status: SaveStatus;
  message: string | null;
  /** The Editor and Runs switch (`?tab=runs`). */
  tab: BuilderTab;
  onTabChange: (tab: BuilderTab) => void;
  /** The status badge and the Activate split. */
  liveControls: ReactNode;
  onDuplicate: () => void;
  onDelete: () => void;
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
    <header
      data-testid="builder-top-bar"
      className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-b-2 border-outline bg-secondary px-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <TooltipHint label="Back To Workflows" side="bottom">
          <Link
            href={`/${orgId}/workflows`}
            aria-label="Back To Workflows"
            data-testid="builder-back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-9 shrink-0 px-0')}
          >
            <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          </Link>
        </TooltipHint>
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="shrink-0">
              <Link
                href={`/${orgId}/workflows`}
                className="font-medium muted-tone outline-none hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
              >
                Workflows
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="min-w-0">
                {/* Quiet until touched: it reads as the page's name and edits in place. */}
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
                  size="sm"
                  className="type-ui field-sizing-content max-w-sm min-w-24 truncate border-transparent bg-transparent px-2 text-sm shadow-none hover:border-outline focus:bg-field"
                  data-testid="workflow-name"
                />
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-9 shrink-0 px-0"
              aria-label="Workflow actions"
            >
              <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-dangerInk" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SaveState status={status} message={message} />
      </div>

      <Tabs value={tab} onValueChange={(value) => onTabChange(value as BuilderTab)}>
        <TabsList aria-label="Builder view" data-testid="builder-tabs">
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex min-w-0 items-center justify-end gap-3">{liveControls}</div>
    </header>
  );
}
