import type { ReactNode } from 'react';
import { OrgSwitcher } from './org-switcher';
import { type SidebarItem, Sidebar } from './sidebar';
import { TopBar } from './topbar';

export function AppShell({
  navItems,
  pageTitle,
  children,
}: {
  navItems: SidebarItem[];
  pageTitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-primary">
      <Sidebar items={navItems} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title={pageTitle} orgSwitcher={<OrgSwitcher />} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
