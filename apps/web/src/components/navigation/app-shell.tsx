import { cn } from '@postgear/ui';
import type { ReactNode } from 'react';
import { Sidebar, type SidebarItem, TabBar } from './sidebar';
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
 * On a phone (below `md`) the same items move to a tab bar along the bottom
 * and the page runs edge to edge under a shorter top bar.
 *
 * The root layout sets `viewport-fit=cover`, so the frame draws under a
 * notch and a home indicator. Its own padding keeps the content out of them:
 * on a phone the top inset (the top bar starts below the notch) and the side
 * insets (a landscape notch), with the tab bar clearing the bottom itself;
 * from `md` the 12px margin grows to the inset wherever the inset is larger,
 * which is a landscape phone's notch beside the rail. `env()` is 0 on every
 * screen without one, so nothing moves there.
 *
 * `fullBleed` is for pages that lay out their own blocks to fill the height
 * (the calendar's channel card beside its grid): the region does not scroll,
 * and each block scrolls itself. Every other page scrolls as one.
 *
 * `saveThemeToAccount` is the top bar's theme button saving the mode to the
 * signed-in account, as it does in the dashboard. The /dev playgrounds pass
 * false: they may have no session, and the button there only switches the
 * theme in this browser.
 */
export function AppShell({
  navItems,
  sidebarBottomItems,
  pageTitle,
  streak,
  search,
  accountMenu,
  notifications,
  fullBleed = false,
  saveThemeToAccount = true,
  children,
}: {
  navItems: SidebarItem[];
  sidebarBottomItems?: SidebarItem[];
  pageTitle: string;
  /** The posting-streak flame (2026-10-22), a slot like the ones below. */
  streak?: ReactNode;
  /** The workspace search (2026-10-21), a slot like the two below. */
  search?: ReactNode;
  accountMenu?: ReactNode;
  notifications?: ReactNode;
  fullBleed?: boolean;
  /** Whether the theme button also saves the mode to the account (default true); false on /dev. */
  saveThemeToAccount?: boolean;
  children: ReactNode;
}) {
  return (
    // `dvh`, not `vh`: on a phone `100vh` is the height with the browser's
    // toolbars hidden, which would push the tab bar under them.
    <div
      data-app-shell
      className={cn(
        'flex h-dvh w-full flex-col overflow-hidden bg-primary',
        'pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]',
        'md:flex-row md:gap-3',
        'md:pt-[max(0.75rem,env(safe-area-inset-top))] md:pr-[max(0.75rem,env(safe-area-inset-right))]',
        'md:pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pl-[max(0.75rem,env(safe-area-inset-left))]',
      )}
    >
      <Sidebar items={navItems} bottomItems={sidebarBottomItems} className="hidden md:flex" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          title={pageTitle}
          streak={streak}
          search={search}
          accountMenu={accountMenu}
          notifications={notifications}
          saveThemeToAccount={saveThemeToAccount}
        />
        <main
          className={cn(
            'min-h-0 flex-1 px-4 pt-2 md:px-3 md:pt-5',
            fullBleed
              ? 'flex overflow-hidden pb-3 md:pb-1'
              : 'overflow-y-auto pb-6 pg-scrollbar pg-scrollbar-primary',
          )}
        >
          {children}
        </main>
      </div>
      {/* Below `md` the rail becomes a bottom tab bar: see TabBar. */}
      <TabBar items={navItems} bottomItems={sidebarBottomItems} className="md:hidden" />
    </div>
  );
}
