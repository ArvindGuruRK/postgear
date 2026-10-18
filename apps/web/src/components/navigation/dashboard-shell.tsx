'use client';

import {
  BarChart3,
  CalendarDays,
  Image as ImageIcon,
  ListOrdered,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
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
const RAIL: Array<{ segment: string; label: string; icon: SidebarItem['icon'] }> = [
  { segment: 'calendar', label: 'Calendar', icon: CalendarDays },
  { segment: 'ai-copilot', label: 'Copilot', icon: Sparkles },
  { segment: 'queue', label: 'Queue', icon: ListOrdered },
  { segment: 'analytics', label: 'Analytics', icon: BarChart3 },
  { segment: 'media', label: 'Media', icon: ImageIcon },
  { segment: 'seo-analyzer', label: 'SEO', icon: Search },
];

/** The top bar's h1 for each top-level page. */
const TITLES: Record<string, string> = {
  calendar: 'Calendar',
  'ai-copilot': 'AI Copilot',
  queue: 'Queue',
  analytics: 'Analytics',
  media: 'Media',
  'seo-analyzer': 'SEO Analyzer',
  composer: 'Composer',
  channels: 'Channels',
  settings: 'Settings',
};

/** Pages that lay out their own height-filling blocks: see AppShell. */
const FULL_BLEED = new Set(['calendar']);

export function DashboardShell({ orgId, children }: { orgId: string; children: ReactNode }) {
  const pathname = usePathname();
  const base = `/${orgId}`;
  // `/acme/settings/billing` → `settings`; the org's own root → ''.
  const segment = pathname.startsWith(`${base}/`)
    ? (pathname.slice(base.length + 1).split('/')[0] ?? '')
    : '';

  const navItems: SidebarItem[] = RAIL.map((item) => ({
    label: item.label,
    href: `${base}/${item.segment}`,
    icon: item.icon,
    active: segment === item.segment,
  }));

  // Billing lives in Settings only (2026-10-18): whether it earns a rail
  // entry of its own is still open, so Settings stays active on its page too.
  const bottomItems: SidebarItem[] = [
    {
      label: 'Settings',
      href: `${base}/settings/team`,
      icon: Settings,
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
