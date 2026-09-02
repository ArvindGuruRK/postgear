import type { ReactNode } from 'react';

// The (dashboard) group exists to separate authenticated routes from (auth) in
// the URL structure; the visible shell lives one level down in [orgId]/layout,
// which is where the org id needed to build the navigation links first exists.
// Sprint 2 adds the auth guard here — it belongs above the org context, since
// an unauthenticated visitor shouldn't reach an org at all.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
