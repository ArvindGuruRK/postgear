'use client';

// Per-icon subpaths rather than the `lucide` barrel, so dev compiles eight
// icons and not all of them.
import { CalendarDaysIcon } from '@animateicons/react/lucide/calendar-days-icon';
import { ChartColumnIcon } from '@animateicons/react/lucide/chart-column-icon';
import { HouseIcon } from '@animateicons/react/lucide/house-icon';
import { ImageIcon } from '@animateicons/react/lucide/image-icon';
import { ListOrderedIcon } from '@animateicons/react/lucide/list-ordered-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { SettingsIcon } from '@animateicons/react/lucide/settings-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { WorkflowIcon } from '@animateicons/react/lucide/workflow-icon';
import { type AnimatedIcon, cn } from '@postgear/ui';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { NotificationBell } from '../notifications/notification-bell';
import { GlobalSearch } from '../search/global-search';
import { AccountMenu } from './account-menu';
import { AppShell } from './app-shell';
import { DayStreak } from './day-streak';
import type { SidebarItem } from './sidebar';

// Client wrapper around AppShell so [orgId]/layout.tsx can stay a server
// component: the only thing that needs the client here is `usePathname`, which
// decides both which rail entry is active and what the top bar is titled.
// Deriving the title from the route keeps every page from having to pass one
// up through the layout, which App Router gives no clean way to do.

/**
 * The rail's sections: Home first (2026-10-19, the Buffer-style dashboard
 * and the page sign-in lands on), then the reference's order: the calendar,
 * the AI (its "Agent"), then the read-and-manage pages. `label` is what fits
 * under a 20px icon in a 64px tile; the top bar shows the page's full name.
 *
 * Studio (Sprint 9) sits right after Media: it makes the images Media keeps.
 * Workflows (Sprint 10) follows Studio: it puts the other pages to work.
 *
 * Composer and Channels are not here, as in the reference: both are reached
 * from the calendar's channel card (Create Post, Add Channel, the channels
 * page button and each channel's menu) and from Home, and their routes stay
 * as they were.
 */
const RAIL: Array<{ segment: string; label: string; icon: AnimatedIcon }> = [
  { segment: 'home', label: 'Home', icon: HouseIcon },
  { segment: 'calendar', label: 'Calendar', icon: CalendarDaysIcon },
  { segment: 'ai-copilot', label: 'Copilot', icon: SparklesIcon },
  { segment: 'queue', label: 'Queue', icon: ListOrderedIcon },
  { segment: 'analytics', label: 'Analytics', icon: ChartColumnIcon },
  { segment: 'media', label: 'Media', icon: ImageIcon },
  { segment: 'studio', label: 'Studio', icon: PaletteIcon },
  { segment: 'workflows', label: 'Workflows', icon: WorkflowIcon },
  { segment: 'seo-analyzer', label: 'SEO', icon: SearchIcon },
];

/** The top bar's h1 for each top-level page. */
const TITLES: Record<string, string> = {
  home: 'Home',
  calendar: 'Calendar',
  'ai-copilot': 'AI Copilot',
  queue: 'Queue',
  analytics: 'Analytics',
  media: 'Media',
  studio: 'Design Studio',
  workflows: 'Workflows',
  'seo-analyzer': 'SEO Analyzer',
  channels: 'Channels',
  settings: 'Settings',
};

/** Pages that lay out their own height-filling blocks: see AppShell. */
const FULL_BLEED = new Set(['calendar']);

/**
 * Whether a page is its own module and so takes the whole window: no rail, no
 * top bar (2026-10-31). Creating a workflow or a design moves into a separate
 * place, the way Figma or n8n open a file, so the app frame steps out of the
 * way and the page brings its own way back.
 *
 * - `'fixed'`: a workspace that fills the height and scrolls its own panels
 *   (the workflow builder, `workflows/{id}`, and Studio's editor,
 *   `studio/{designId}`).
 * - `'scroll'`: a page that scrolls as one (Studio's Create Design wizard,
 *   `studio/new`).
 *
 * The lists (`workflows`, `studio`) keep the frame.
 */
function immersion(page: string): 'fixed' | 'scroll' | null {
  const [segment, child, ...deeper] = page.split('/');
  if (segment !== 'studio' && segment !== 'workflows') return null;
  if (!child || deeper.length > 0) return null;
  if (segment === 'studio') return child === 'new' ? 'scroll' : 'fixed';
  return 'fixed';
}

export function DashboardShell({ orgId, children }: { orgId: string; children: ReactNode }) {
  const pathname = usePathname();
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
          'h-dvh w-full min-w-0 bg-primary p-3',
          immersive === 'fixed'
            ? 'flex overflow-hidden'
            : 'overflow-y-auto pg-scrollbar pg-scrollbar-primary',
        )}
      >
        {children}
      </main>
    );
  }

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
      streak={<DayStreak />}
      search={<GlobalSearch orgId={orgId} />}
      accountMenu={<AccountMenu />}
      notifications={<NotificationBell />}
    >
      {children}
    </AppShell>
  );
}
