import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@postgear/ui';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from './theme-toggle';

export function TopBar({ title, orgSwitcher }: { title: string; orgSwitcher?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b-4 border-outline bg-secondary px-6">
      {orgSwitcher}
      <h1 className="font-display text-xl tracking-wide text-ink">{title}</h1>
      <div className="ml-auto flex items-center gap-4">
        <div className="relative hidden sm:block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink opacity-50"
            strokeWidth={2.5}
          />
          <Input placeholder="Search…" className="w-64 pl-9" size="sm" />
        </div>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger className="outline-none">
            <Avatar size="sm">
              <AvatarFallback>PG</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
