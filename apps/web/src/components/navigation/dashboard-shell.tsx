'use client';

import {
  BarChart3,
  CalendarDays,
  Image as ImageIcon,
  ListOrdered,
  PenSquare,
  Radio,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from './app-shell';
import type { SidebarItem } from './sidebar';

// Client wrapper around AppShell so [orgId]/layout.tsx can stay a server
// component: the only thing that needs the client here is `usePathname`, which
// decides both which nav tile is active and what the top bar is titled.
// Deriving the title from the route keeps every page from having to pass one
// up through the layout, which App Router gives no clean way to do.

const NAV: Array<{ segment: string; label: string; icon: SidebarItem['icon'] }> = [
  { segment: 'calendar', label: 'Calendar', icon: CalendarDays },
  { segment: 'queue', label: 'Queue', icon: ListOrdered },
  { segment: 'composer', label: 'Composer', icon: PenSquare },
  { segment: 'channels', label: 'Channels', icon: Radio },
  { segment: 'media', label: 'Media', icon: ImageIcon },
  { segment: 'analytics', label: 'Analytics', icon: BarChart3 },
  { segment: 'seo-analyzer', label: 'SEO Analyzer', icon: Search },
  { segment: 'ai-copilot', label: 'AI Copilot', icon: Sparkles },
];

export function DashboardShell({ orgId, children }: { orgId: string; children: ReactNode }) {
  const pathname = usePathname();
  const base = `/${orgId}`;

  const navItems: SidebarItem[] = NAV.map((item) => ({
    label: item.label,
    href: `${base}/${item.segment}`,
    icon: item.icon,
    active: pathname === `${base}/${item.segment}`,
  }));

  const settingsItem: SidebarItem = {
    label: 'Settings',
    href: `${base}/settings/team`,
    icon: Settings,
    active: pathname.startsWith(`${base}/settings`),
  };

  const pageTitle = pathname.startsWith(`${base}/settings`)
    ? 'Settings'
    : (NAV.find((item) => pathname === `${base}/${item.segment}`)?.label ?? 'Dashboard');

  return (
    <AppShell navItems={navItems} sidebarBottomItem={settingsItem} pageTitle={pageTitle}>
      {children}
    </AppShell>
  );
}
