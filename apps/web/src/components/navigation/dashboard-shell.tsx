'use client';

// Per-icon subpaths rather than the `lucide` barrel, so dev compiles seven
// icons and not all of them.
import { CalendarDaysIcon } from '@animateicons/react/lucide/calendar-days-icon';
import { ChartColumnIcon } from '@animateicons/react/lucide/chart-column-icon';
import { ImageIcon } from '@animateicons/react/lucide/image-icon';
import { ListOrderedIcon } from '@animateicons/react/lucide/list-ordered-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { SettingsIcon } from '@animateicons/react/lucide/settings-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import type { AnimatedIcon } from '@postgear/ui';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { NotificationBell } from '../notifications/notification-bell';
import { AccountMenu } from './account-menu';
import { AppShell } from './app-shell';
import type { SidebarItem } from './sidebar';

// Client wrapper around AppShell so [orgId]/layout.tsx can stay a server
// component: the only thing that needs the client here is `usePathname`, which
// decides both which rail entry is active and what the top bar is titled.
// Deriving the title from the route keeps every page from having to pass one
// up through the layout, which App Router gives no clean way to do.

/**
 * The rail's sections, in the reference's order: the calendar first, the AI
 * second (its "Agent"), then the read-and-manage pages. `label` is what fits
 * under a 20px icon in a 64px tile; the top bar shows the page's full name.
 *
 * Composer and Channels are not here, as in the reference: both are reached
 * from the calendar's channel card (Create Post, Add Channel, the channels
 * page button and each channel's menu), and their routes stay as they were.
 */
const RAIL: Array<{ segment: string; label: string; icon: AnimatedIcon }> = [
  { segment: 'calendar', label: 'Calendar', icon: CalendarDaysIcon },
  { segment: 'ai-copilot', label: 'Copilot', icon: SparklesIcon },
  { segment: 'queue', label: 'Queue', icon: ListOrderedIcon },
  { segment: 'analytics', label: 'Analytics', icon: ChartColumnIcon },
  { segment: 'media', label: 'Media', icon: ImageIcon },
  { segment: 'seo-analyzer', label: 'SEO', icon: SearchIcon },
];

/** The top bar's h1 for each top-level page. */
const TITLES: Record<string, string> = {
  calendar: 'Calendar',
  'ai-copilot': 'AI Copilot',
  queue: 'Queue',
  analytics: 'Analytics',
  media: 'Media',
  'seo-analyzer': 'SEO Analyzer',
  channels: 'Channels',
  settings: 'Settings',
};

/** Pages that lay out their own height-filling blocks: see AppShell. */
const FULL_BLEED = new Set(['calendar']);

export function DashboardShell({ orgId, children }: { orgId: string; children: ReactNode }) {
  const pathname = usePathname();
  const base = `/${orgId}`;
  // `/acme/settings/billing` → `settings`; the org's own root → ''.
  const urlSegment = pathname.startsWith(`${base}/`)
    ? (pathname.slice(base.length + 1).split('/')[0] ?? '')
    : '';
  // The composer is a modal, not a page, so the shell follows the page beneath
  // it. Opened in-app, that is whatever page the URL showed before; loaded
  // directly, it is the calendar (`[orgId]/composer/page.tsx`). Adjusting
  // state while rendering is React's pattern for "remember the last value".
  const [pageSegment, setPageSegment] = useState(
    urlSegment === 'composer' ? 'calendar' : urlSegment,
  );
  if (urlSegment !== 'composer' && urlSegment !== pageSegment) {
    setPageSegment(urlSegment);
  }
  const segment = pageSegment;

  const navItems: SidebarItem[] = RAIL.map((item) => ({
    label: item.label,
    href: `${base}/${item.segment}`,
    animatedIcon: item.icon,
    active: segment === item.segment,
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
      accountMenu={<AccountMenu />}
      notifications={<NotificationBell />}
    >
      {children}
    </AppShell>
  );
}
