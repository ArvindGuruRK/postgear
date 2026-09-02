import { DashboardShell } from '@/components/navigation/dashboard-shell';

// Organization workspace layout: sidebar + top bar + org switcher, composed
// from the Sprint 0 app-shell chrome. `params` is a Promise in App Router, so
// this stays async — LayoutProps<'/[orgId]'> is the generated type Next.js
// validates every layout against.
//
// Sprint 2 adds the workspace context provider here (real org data, membership
// and role), which is why the org id is resolved at this level rather than
// inside the shell.
export default async function OrgLayout({ children, params }: LayoutProps<'/[orgId]'>) {
  const { orgId } = await params;

  return <DashboardShell orgId={orgId}>{children}</DashboardShell>;
}
