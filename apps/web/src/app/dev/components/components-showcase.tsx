'use client';

import { UserMenu, WorkspaceSwitcher } from '@postgear/ui';
import { BarChart3, Calendar, LayoutGrid, Palette, Search, Settings, Users } from 'lucide-react';
import { useState } from 'react';
import { AppShell } from '@/components/navigation/app-shell';
import type { SidebarItem } from '@/components/navigation/sidebar';
import { ButtonsSection } from './sections/buttons-section';
import { DataDisplaySection } from './sections/data-display-section';
import { FeedbackSection } from './sections/feedback-section';
import { FormControlsSection } from './sections/form-controls-section';
import { FoundationsSection } from './sections/foundations-section';
import { LayoutSection } from './sections/layout-section';
import { NavigationSection } from './sections/navigation-section';
import { OverlaysSection } from './sections/overlays-section';
import { SaasPatternsSection } from './sections/saas-patterns-section';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '#dashboard', icon: LayoutGrid },
  { label: 'Calendar', href: '#calendar', icon: Calendar },
  { label: 'Analytics', href: '#analytics', icon: BarChart3 },
  { label: 'SEO', href: '#seo', icon: Search },
  { label: 'Team', href: '#team', icon: Users },
  { label: 'Design System', href: '/dev/components', icon: Palette, active: true },
];

const SETTINGS_ITEM: SidebarItem = { label: 'Settings', href: '#settings', icon: Settings };

// Demo data for the two top-bar slots. The playground showcases the *UI
// components* (WorkspaceSwitcher, UserMenu) rather than the app-wired
// containers, which read a WorkspaceProvider that only exists inside
// /[orgId]. Wiring those in directly is what made every playground route 500.
const DEMO_WORKSPACES = [
  { id: '1', name: 'Acme Media' },
  { id: '2', name: 'Nova Studio' },
];

export function ComponentsShowcase() {
  const [activeWorkspace, setActiveWorkspace] = useState(DEMO_WORKSPACES[0].id);

  return (
    <AppShell
      navItems={NAV_ITEMS}
      sidebarBottomItem={SETTINGS_ITEM}
      pageTitle="Design System"
      orgSwitcher={
        <WorkspaceSwitcher
          workspaces={DEMO_WORKSPACES}
          activeId={activeWorkspace}
          onActiveChange={setActiveWorkspace}
          label="Organizations"
          createLabel="Create organization"
          onCreate={() => {}}
        />
      }
      accountMenu={
        <UserMenu
          name="Ada Lovelace"
          email="ada@postgear.local"
          items={[{ label: 'Log out', danger: true }]}
        />
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-10 pb-16">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-ink">Component Playground</h1>
          <p className="mt-2 max-w-2xl font-sans text-sm text-ink opacity-70">
            Every primitive in <code>@postgear/ui</code>, every variant, every state — light and
            dark. Flip the theme toggle in the top bar to check parity. Dev-only: excluded from
            production builds.
          </p>
        </div>

        <FoundationsSection />
        <LayoutSection />
        <ButtonsSection />
        <FormControlsSection />
        <NavigationSection />
        <OverlaysSection />
        <FeedbackSection />
        <DataDisplaySection />
        <SaasPatternsSection />
      </div>
    </AppShell>
  );
}
