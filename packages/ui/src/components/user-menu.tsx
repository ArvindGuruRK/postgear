'use client';

import { Check, type LucideIcon } from 'lucide-react';
import type { AnimatedIcon } from '../lib/icon-animation';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { MotionIcon } from './motion-icon';
import { TooltipHint } from './tooltip';

export interface UserMenuItem {
  label: string;
  icon?: LucideIcon;
  /** Played as the item is hovered or reached by keyboard; wins over `icon`. */
  animatedIcon?: AnimatedIcon;
  onSelect?: () => void;
  danger?: boolean;
  /** Marks the current choice within a group, e.g. the active workspace. */
  checked?: boolean;
}

/** A titled section above the main items, e.g. the workspaces to switch between. */
export interface UserMenuGroup {
  label: string;
  items: UserMenuItem[];
}

export interface UserMenuProps {
  name: string;
  email?: string;
  avatarUrl?: string;
  items: UserMenuItem[];
  groups?: UserMenuGroup[];
  /** The avatar's hover label. */
  tooltip?: string;
}

function MenuItem({ item }: { item: UserMenuItem }) {
  const Icon = item.icon;
  return (
    <DropdownMenuItem
      onSelect={item.onSelect}
      aria-current={item.checked ? 'true' : undefined}
      className={
        item.danger ? 'text-dangerInk focus:bg-actionDanger focus:text-onActionLight' : undefined
      }
    >
      {item.animatedIcon ? (
        <MotionIcon icon={item.animatedIcon} className="h-4 w-4" />
      ) : (
        Icon && <Icon className="h-4 w-4" strokeWidth={2.5} />
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.checked && (
        <Check className="ms-2 h-4 w-4 shrink-0" strokeWidth={3} aria-hidden="true" />
      )}
    </DropdownMenuItem>
  );
}

export function UserMenu({
  name,
  email,
  avatarUrl,
  items,
  groups = [],
  tooltip = 'Account',
}: UserMenuProps) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <TooltipHint label={tooltip} side="bottom" align="end">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open user menu"
            className="rounded-full outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          >
            <Avatar size="md">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
              <AvatarFallback colorSeed={name}>{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block type-ui text-sm text-ink">{name}</span>
          {email && (
            <span className="block font-sans text-xs font-normal normal-case tracking-normal opacity-60">
              {email}
            </span>
          )}
        </DropdownMenuLabel>
        {groups.map((group) => (
          <DropdownMenuGroup key={group.label} aria-label={group.label}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.items.map((item, index) => (
              // Index keys: two workspaces may share a name.
              // biome-ignore lint/suspicious/noArrayIndexKey: labels are not unique within a group
              <MenuItem key={index} item={item} />
            ))}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        {items.map((item) => (
          <MenuItem key={item.label} item={item} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
