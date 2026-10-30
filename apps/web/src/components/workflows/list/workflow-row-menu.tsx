'use client';

/**
 * A workflow row's "..." menu (blueprint 9): Open, Duplicate, Activate or
 * Pause for workspace admins (Module 09), and Delete (red, confirmed by the
 * list). Members see no Activate or Pause: the API refuses them.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MotionIcon,
} from '@postgear/ui';
import { Fragment } from 'react';
import type { AutomationListItem } from '@/types/workflows';
import { ROW_ACTION_LABELS, rowActions } from './workflows-view-model';

export function WorkflowRowMenu({
  workflow,
  canManage,
  busy = false,
  onOpen,
  onDuplicate,
  onActivate,
  onPause,
  onDelete,
}: {
  workflow: AutomationListItem;
  /** Workspace admins turn workflows on and off. */
  canManage: boolean;
  /** Activate is loading the workflow: the menu waits. */
  busy?: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onActivate: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const actions = rowActions(workflow, canManage);
  const handlers = {
    open: onOpen,
    duplicate: onDuplicate,
    activate: onActivate,
    pause: onPause,
    delete: onDelete,
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Actions for ${workflow.name}`}
          disabled={busy}
        >
          <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) =>
          action === 'delete' ? (
            <Fragment key={action}>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-dangerInk" onSelect={handlers.delete}>
                {ROW_ACTION_LABELS.delete}
              </DropdownMenuItem>
            </Fragment>
          ) : (
            <DropdownMenuItem key={action} onSelect={handlers[action]}>
              {ROW_ACTION_LABELS[action]}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
