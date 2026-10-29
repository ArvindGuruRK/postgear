'use client';

/**
 * A workflow row's "..." menu: Open, Duplicate, Delete (red, confirmed by
 * the list). Activate and Pause join it with Module 09, when turning a
 * workflow on exists; a menu item that does nothing yet is left out.
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
import type { AutomationListItem } from '@/types/workflows';

export function WorkflowRowMenu({
  workflow,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  workflow: AutomationListItem;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Actions for ${workflow.name}`}>
          <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-dangerInk" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
