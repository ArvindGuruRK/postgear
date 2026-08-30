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

export function Sidebar({ items, footer }: { items: SidebarItem[]; footer?: ReactNode }) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r-4 border-outline bg-secondary">
      <div className="flex h-16 shrink-0 items-center border-b-4 border-outline px-6">
        <span className="font-display text-2xl tracking-wide text-ink">PostGear</span>
      </div>
      <nav
        className={cn(
          'flex flex-1 flex-col gap-1 overflow-y-auto p-3',
          'pg-scrollbar pg-scrollbar-secondary',
        )}
      >
        {items.map(({ label, href, icon: Icon, active }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 border-2 border-transparent px-3 py-2.5 font-sans text-sm font-medium text-ink',
              'hover:border-outline hover:bg-primary',
              active &&
                'border-outline bg-actionPrimary text-onActionPrimary shadow-brutalSm hover:bg-actionPrimary',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            {label}
          </Link>
        ))}
      </nav>
      {footer ? <div className="border-t-4 border-outline p-3">{footer}</div> : null}
    </aside>
  );
}
