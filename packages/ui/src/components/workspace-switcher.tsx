'use client';

import { ChevronsUpDown, Plus } from 'lucide-react';
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
          'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          className,
        )}
      >
        <Avatar size="sm">
          {active?.avatarUrl && <AvatarImage src={active.avatarUrl} alt={active.name} />}
          <AvatarFallback>{active?.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        {active?.name}
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
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
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              {createLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
