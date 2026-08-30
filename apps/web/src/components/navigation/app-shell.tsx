import { cn } from '@postgear/ui';
import type { ReactNode } from 'react';
import { OrgSwitcher } from './org-switcher';
import { Sidebar, type SidebarItem } from './sidebar';
import { TopBar } from './topbar';

export function AppShell({
  navItems,
  sidebarBottomItem,
  pageTitle,
  children,
}: {
  navItems: SidebarItem[];
  sidebarBottomItem?: SidebarItem;
  pageTitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-primary">
      <Sidebar items={navItems} bottomItem={sidebarBottomItem} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title={pageTitle} orgSwitcher={<OrgSwitcher />} />
        <main className={cn('flex-1 overflow-y-auto p-6', 'pg-scrollbar pg-scrollbar-primary')}>
          {children}
        </main>
      </div>
    </div>
  );
}
