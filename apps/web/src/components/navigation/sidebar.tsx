import { cn } from '@postgear/ui';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface SidebarItem {
  label: string;
  href: string;
  icon: LucideIcon;
  active?: boolean;
}

function NavTile({ label, href, icon: Icon, active }: SidebarItem) {
  return (
    <Link
      href={href}
      title={label}
      className={cn(
        'flex w-16 flex-col items-center gap-1 rounded-md border-2 border-transparent px-2 py-1.5',
        'outline-none transition-[transform,box-shadow] duration-100',
        'hover:border-outline hover:bg-primary',
        'active:translate-x-[1px] active:translate-y-[1px]',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
        active &&
          'border-outline bg-actionPrimary shadow-brutalSm hover:bg-actionPrimary active:shadow-brutalPressed',
      )}
    >
      <Icon
        className={cn('h-5 w-5 shrink-0', active ? 'text-onActionPrimary' : 'text-ink')}
        strokeWidth={2.5}
      />
      <span
        className={cn(
          'line-clamp-2 w-full text-center font-display text-[10px] leading-[1.15] uppercase tracking-wide',
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
  bottomItem,
}: {
  items: SidebarItem[];
  /** Monogram (or any short node) shown in the brand tile at the top of the rail. */
  brand?: ReactNode;
  /** Pinned to the bottom of the rail, below the scrollable nav list (e.g. Settings). */
  bottomItem?: SidebarItem;
}) {
  return (
    <aside className="flex h-full w-20 shrink-0 flex-col items-center border-r-4 border-outline bg-secondary">
      <div className="flex h-16 w-full shrink-0 items-center justify-center border-b-4 border-outline">
        <div className="flex h-11 w-11 items-center justify-center rounded-md border-2 border-outline bg-actionPrimary shadow-brutalSm">
          <span className="font-display text-xl text-onActionPrimary">{brand}</span>
        </div>
      </div>

      <nav
        className={cn(
          'flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-2',
          'pg-scrollbar pg-scrollbar-secondary',
        )}
      >
        {items.map((item) => (
          <NavTile key={item.href} {...item} />
        ))}
      </nav>

      {bottomItem && (
        <div className="flex w-full shrink-0 items-center justify-center border-t-4 border-outline py-2">
          <NavTile {...bottomItem} />
        </div>
      )}
    </aside>
  );
}
