'use client';

import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@postgear/ui';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';

const DEMO_ORGS = [
  { id: '1', name: 'Acme Media' },
  { id: '2', name: 'Nova Studio' },
];

export function OrgSwitcher() {
  const [active, setActive] = useState(DEMO_ORGS[0]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-2 border-2 border-outline bg-secondary px-3 py-1.5 shadow-brutalSm outline-none',
          'font-sans text-sm font-semibold text-ink',
        )}
      >
        <Avatar size="sm">
          <AvatarFallback>{active.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        {active.name}
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DEMO_ORGS.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => setActive(org)}>
            {org.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
