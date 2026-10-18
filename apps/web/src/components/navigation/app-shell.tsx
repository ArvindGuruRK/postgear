import { cn } from '@postgear/ui';
import type { ReactNode } from 'react';
import { Sidebar, type SidebarItem } from './sidebar';
import { TopBar } from './topbar';

/**
 * The chrome: rail, top bar, one main region.
 *
 * Deliberately knows nothing about sessions or workspaces. The top-bar
 * controls that do (the account menu, the notification bell) arrive as slots,
 * so this component still renders outside a workspace, including in the
 * design-system playground. See the note in topbar.tsx for what broke when
 * they were imported directly.
 *
 * Layout (UI revamp, 2026-10-18): the rail is the one framed block, inset by
 * a 12px margin; the top bar and the page sit on the page ground itself, with
 * a single line under the bar, so the content reads as the page rather than
 * a card on it.
 *
 * `fullBleed` is for pages that lay out their own blocks to fill the height
 * (the calendar's channel card beside its grid): the region does not scroll,
 * and each block scrolls itself. Every other page scrolls as one.
 */
export function AppShell({
  navItems,
  sidebarBottomItems,
  pageTitle,
  accountMenu,
  notifications,
  fullBleed = false,
  children,
}: {
  navItems: SidebarItem[];
  sidebarBottomItems?: SidebarItem[];
  pageTitle: string;
  accountMenu?: ReactNode;
  notifications?: ReactNode;
  fullBleed?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-app-shell className="flex h-screen w-full gap-3 overflow-hidden bg-primary p-3">
      <Sidebar items={navItems} bottomItems={sidebarBottomItems} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar title={pageTitle} accountMenu={accountMenu} notifications={notifications} />
        <main
          className={cn(
            'min-h-0 flex-1 px-3 pt-5',
            fullBleed
              ? 'flex overflow-hidden pb-1'
              : 'overflow-y-auto pb-6 pg-scrollbar pg-scrollbar-primary',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
