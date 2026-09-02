'use client';

import { cn } from '@postgear/ui';
import type { LucideIcon } from 'lucide-react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';

export interface SidebarItem {
  label: string;
  href: string;
  icon: LucideIcon;
  active?: boolean;
}

const STORAGE_KEY = 'postgear:sidebar-collapsed';

function NavTile({
  label,
  href,
  icon: Icon,
  active,
  collapsed,
}: SidebarItem & { collapsed: boolean }) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-md border-2 border-transparent',
        'outline-none transition-[transform,box-shadow] duration-100',
        'hover:border-outline hover:bg-primary',
        'active:translate-x-[1px] active:translate-y-[1px]',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        collapsed ? 'w-16 flex-col gap-1 px-2 py-1.5' : 'w-full gap-3 px-3 py-2.5',
        active &&
          'border-outline bg-actionPrimary shadow-brutalSm hover:bg-actionPrimary active:shadow-brutalPressed',
      )}
    >
      <Icon
        className={cn(
          'shrink-0',
          collapsed ? 'h-5 w-5' : 'h-4 w-4',
          active ? 'text-onActionPrimary' : 'text-ink',
        )}
        strokeWidth={2.5}
      />
      <span
        className={cn(
          collapsed
            ? 'line-clamp-2 w-full text-center font-display text-[10px] leading-[1.15] uppercase tracking-wide'
            : 'truncate pr-0.5 font-display text-sm uppercase leading-[1.15] tracking-wide',
          active ? 'text-onActionPrimary' : 'text-ink',
        )}
      >
        {label}
      </span>
    </Link>
  );
}

export function Sidebar({
  items,
  brand = 'P',
  brandLabel = 'PostGear',
  bottomItem,
}: {
  items: SidebarItem[];
  /** Monogram (or any short node) shown in the brand tile of the collapsed rail. */
  brand?: ReactNode;
  /** Wordmark shown in the header when the sidebar is expanded. */
  brandLabel?: ReactNode;
  /** Pinned to the bottom of the rail, below the scrollable nav list (e.g. Settings). */
  bottomItem?: SidebarItem;
}) {
  // Collapsed rail is the default; the stored preference is applied after mount
  // so server and first client render always agree.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === 'false') setCollapsed(false);
    } catch {
      // Storage unavailable (private mode, blocked cookies) — keep the default.
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Preference just won't persist.
      }
      return next;
    });
  };

  const toggleClasses = cn(
    'group flex items-center justify-center rounded-md border-2 border-outline',
    'outline-none transition-[transform,box-shadow] duration-100',
    'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
    'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
  );

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r-4 border-outline bg-secondary',
        'transition-[width] duration-150 ease-out',
        collapsed ? 'w-20 items-center' : 'w-56',
      )}
    >
      <div
        className={cn(
          'flex h-16 w-full shrink-0 items-center border-b-4 border-outline',
          collapsed ? 'justify-center' : 'justify-between gap-2 px-4',
        )}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={toggle}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            aria-expanded={false}
            className={cn(toggleClasses, 'h-11 w-11 bg-actionPrimary shadow-brutalSm')}
          >
            {/* Monogram swaps to the expand affordance on hover/focus. */}
            <span className="font-display text-xl text-onActionPrimary group-hover:hidden group-focus-visible:hidden">
              {brand}
            </span>
            <PanelLeftOpen
              className="hidden h-5 w-5 text-onActionPrimary group-hover:block group-focus-visible:block"
              strokeWidth={2.5}
            />
          </button>
        ) : (
          <>
            <span className="min-w-0 whitespace-nowrap pr-1 font-display text-2xl leading-none tracking-wide text-ink">
              {brandLabel}
            </span>
            <button
              type="button"
              onClick={toggle}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              aria-expanded={true}
              className={cn(toggleClasses, 'h-9 w-9 shrink-0 bg-primary hover:bg-actionPrimary')}
            >
              <PanelLeftClose
                className="h-4 w-4 text-ink group-hover:text-onActionPrimary"
                strokeWidth={2.5}
              />
            </button>
          </>
        )}
      </div>

      <nav
        className={cn(
          'flex w-full flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden',
          'pg-scrollbar pg-scrollbar-secondary',
          collapsed ? 'items-center py-2' : 'p-3',
        )}
      >
        {items.map((item) => (
          <NavTile key={item.href} {...item} collapsed={collapsed} />
        ))}
      </nav>

      {bottomItem && (
        <div
          className={cn(
            'flex w-full shrink-0 items-center border-t-4 border-outline',
            collapsed ? 'justify-center py-2' : 'p-3',
          )}
        >
          <NavTile {...bottomItem} collapsed={collapsed} />
        </div>
      )}
    </aside>
  );
}
