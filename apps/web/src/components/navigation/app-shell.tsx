import { cn } from '@postgear/ui';
import type { ReactNode } from 'react';
import { Sidebar, type SidebarItem } from './sidebar';
import { TopBar } from './topbar';

/**
 * The chrome: sidebar, top bar, one scrolling main region.
 *
 * Deliberately knows nothing about sessions or workspaces. The two top-bar
 * controls that do — the workspace switcher and the account menu — arrive as
 * slots, so this component still renders outside a workspace, including in the
 * design-system playground. See the note in topbar.tsx for what broke when
 * they were imported directly.
 */
export function AppShell({
  navItems,
  sidebarBottomItem,
  pageTitle,
  orgSwitcher,
  accountMenu,
  children,
}: {
  navItems: SidebarItem[];
  sidebarBottomItem?: SidebarItem;
  pageTitle: string;
  orgSwitcher?: ReactNode;
  accountMenu?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-app-shell className="flex h-screen w-full overflow-hidden bg-primary">
      <Sidebar items={navItems} bottomItem={sidebarBottomItem} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title={pageTitle} orgSwitcher={orgSwitcher} accountMenu={accountMenu} />
        <main className={cn('flex-1 overflow-y-auto p-6', 'pg-scrollbar pg-scrollbar-primary')}>
          {children}
        </main>
      </div>
    </div>
  );
}
