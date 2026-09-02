'use client';

import type { LucideIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

export interface UserMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  danger?: boolean;
}

export interface UserMenuProps {
  name: string;
  email?: string;
  avatarUrl?: string;
  items: UserMenuItem[];
}

export function UserMenu({ name, email, avatarUrl, items }: UserMenuProps) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open user menu"
          className="rounded-full outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
        >
          <Avatar size="sm">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block font-display text-sm normal-case tracking-normal text-ink">{name}</span>
          {email && (
            <span className="block font-sans text-xs font-normal normal-case tracking-normal opacity-60">
              {email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.label}
              onSelect={item.onSelect}
              className={item.danger ? 'text-actionDanger focus:bg-actionDanger focus:text-onActionLight' : undefined}
            >
              {Icon && <Icon className="h-4 w-4" strokeWidth={2.5} />}
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
