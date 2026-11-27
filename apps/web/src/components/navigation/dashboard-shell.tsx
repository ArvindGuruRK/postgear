'use client';

// Per-icon subpaths rather than the `lucide` barrel, so dev compiles the
// rail's icons and not all of them.
import { SettingsIcon } from '@animateicons/react/lucide/settings-icon';
import { cn } from '@postgear/ui';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { NotificationBell } from '../notifications/notification-bell';
import { GlobalSearch } from '../search/global-search';
import { AccountMenu } from './account-menu';
import { AppShell } from './app-shell';
import { DayStreak } from './day-streak';
import { immersion } from './immersion';
import { railFor } from './rail';
import type { SidebarItem } from './sidebar';
import { useOptionalWorkspace } from './workspace-provider';

// Client wrapper around AppShell so [orgId]/layout.tsx can stay a server
// component: the only thing that needs the client here is `usePathname`, which
// decides both which rail entry is active and what the top bar is titled.
// Deriving the title from the route keeps every page from having to pass one
// up through the layout, which App Router gives no clean way to do.

/** The top bar's h1 for each top-level page. */
const TITLES: Record<string, string> = {
  home: 'Home',
  calendar: 'Calendar',
  'ai-copilot': 'AI Copilot',
  queue: 'Queue',
  analytics: 'Analytics',
  media: 'Media',
  studio: 'Design Studio',
  clips: 'Clips',
  workflows: 'Workflows',
  discover: 'Discover',
  'seo-analyzer': 'SEO Analyzer',
  channels: 'Channels',
  settings: 'Settings',
};

/** Pages that lay out their own height-filling blocks: see AppShell. */
const FULL_BLEED = new Set(['calendar']);

export function DashboardShell({ orgId, children }: { orgId: string; children: ReactNode }) {
  const pathname = usePathname();
  const role = useOptionalWorkspace()?.role ?? null;
  const base = `/${orgId}`;
  // `/acme/settings/billing` → `settings/billing`, whose segment is
  // `settings`; the org's own root → ''.
  const urlPage = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : '';
  const urlSegment = urlPage.split('/')[0] ?? '';
  // The composer is a modal, not a page, so the shell follows the page beneath
  // it. Opened in-app, that is whatever page the URL showed before; loaded
  // directly, it is the calendar (`[orgId]/composer/page.tsx`). Adjusting
  // state while rendering is React's pattern for "remember the last value".
  const [page, setPage] = useState(urlSegment === 'composer' ? 'calendar' : urlPage);
  if (urlSegment !== 'composer' && urlPage !== page) {
    setPage(urlPage);
  }
  const segment = page.split('/')[0] ?? '';
  const immersive = immersion(page);

  if (immersive) {
    return (
      <main
        data-immersive={immersive}
        className={cn(
          'h-dvh w-full min-w-0 bg-primary',
          immersive === 'edge' ? '' : 'p-3',
          immersive === 'scroll'
            ? 'overflow-y-auto pg-scrollbar pg-scrollbar-primary'
            : 'flex overflow-hidden',
        )}
      >
        {children}
      </main>
    );
  }

  const navItems: SidebarItem[] = railFor(role).map((item) => ({
    label: item.label,
    href: `${base}/${item.segment}`,
    animatedIcon: item.icon,
    active: segment === item.segment,
    desktopOnly: item.desktopOnly,
  }));

  // Billing lives in Settings only (2026-10-18): whether it earns a rail
  // entry of its own is still open, so Settings stays active on its page too.
  const bottomItems: SidebarItem[] = [
    {
      label: 'Settings',
      href: `${base}/settings/team`,
      animatedIcon: SettingsIcon,
      active: segment === 'settings',
    },
  ];

  return (
    <AppShell
      navItems={navItems}
      sidebarBottomItems={bottomItems}
      pageTitle={TITLES[segment] ?? 'Dashboard'}
      fullBleed={FULL_BLEED.has(segment)}
      // Both of these read WorkspaceProvider, which [orgId]/layout.tsx sets up
      // above this component. They are passed here rather than imported by
      // AppShell so the shell stays renderable without a workspace.
      streak={<DayStreak />}
      search={<GlobalSearch orgId={orgId} />}
      accountMenu={<AccountMenu />}
      notifications={<NotificationBell />}
    >
      {children}
    </AppShell>
  );
}
