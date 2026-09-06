import { Input } from '@postgear/ui';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from './theme-toggle';

/**
 * `orgSwitcher` and `accountMenu` are slots rather than imports.
 *
 * Both of their real implementations read workspace context that only exists
 * inside `[orgId]/layout.tsx`. Importing them here would make the entire app
 * shell unrenderable anywhere else — which is exactly what happened to the
 * design-system playground at /dev/components when AccountMenu was wired in
 * directly: every showcase route 500'd with "useWorkspace must be used inside
 * a WorkspaceProvider".
 *
 * As slots, the chrome stays context-free and each caller supplies whatever it
 * can: the dashboard passes the live components, the playground passes demo
 * ones.
 */
export function TopBar({
  title,
  orgSwitcher,
  accountMenu,
}: {
  title: string;
  orgSwitcher?: ReactNode;
  accountMenu?: ReactNode;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b-4 border-outline bg-secondary px-6">
      {orgSwitcher}
      <h1 className="font-display text-xl tracking-wide text-ink">{title}</h1>
      <div className="ml-auto flex items-center gap-4">
        <div className="relative hidden sm:block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink opacity-50"
            strokeWidth={2.5}
          />
          <Input placeholder="Search…" className="w-64 pl-9" size="sm" />
        </div>
        <ThemeToggle />
        {accountMenu}
      </div>
    </header>
  );
}
