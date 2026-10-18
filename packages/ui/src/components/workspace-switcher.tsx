'use client';

import { ChevronsUpDownIcon } from '@animateicons/react/lucide/chevrons-up-down-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { cn } from '../lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { MotionIcon } from './motion-icon';

export interface WorkspaceOption {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface WorkspaceSwitcherProps {
  workspaces: WorkspaceOption[];
  activeId: string;
  onActiveChange: (id: string) => void;
  onCreate?: () => void;
  label?: string;
  createLabel?: string;
  className?: string;
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onActiveChange,
  onCreate,
  label = 'Workspaces',
  createLabel = 'Create workspace',
  className,
}: WorkspaceSwitcherProps) {
  const active = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-2 rounded-md border-2 border-outline bg-secondary px-3 py-1.5 shadow-brutalSm outline-none',
          'font-sans text-sm font-semibold text-ink',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          className,
        )}
      >
        <Avatar size="sm">
          {active?.avatarUrl && <AvatarImage src={active.avatarUrl} alt={active.name} />}
          <AvatarFallback>{active?.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        {active?.name}
        <MotionIcon icon={ChevronsUpDownIcon} size={14} className="h-3.5 w-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => onActiveChange(workspace.id)}>
            {workspace.name}
          </DropdownMenuItem>
        ))}
        {onCreate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onSelect={onCreate}>
              <MotionIcon icon={PlusIcon} className="h-4 w-4" />
              {createLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
