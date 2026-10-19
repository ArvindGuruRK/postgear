import type { ReactNode } from 'react';
import { ThemeToggle } from './theme-toggle';

/**
 * `accountMenu` and `notifications` are slots rather than imports.
 *
 * Both of their real implementations read workspace context that only exists
 * inside `[orgId]/layout.tsx`. Importing them here would make the entire app
 * shell unrenderable anywhere else, which is exactly what happened to the
 * design-system playground at /dev/components when AccountMenu was wired in
 * directly: every showcase route 500'd with "useWorkspace must be used inside
 * a WorkspaceProvider".
 *
 * As slots, the chrome stays context-free and each caller supplies whatever it
 * can: the dashboard passes the live components, the playground passes demo
 * ones.
 *
 * Layout (UI revamp, 2026-10-18), after the reference's header: the page's
 * name on the left as the one h1, and the utilities on the right (theme,
 * notifications, and the account, which also holds the workspace switcher).
 * It sits on the page ground with no frame, no rule under it and no
 * dividers between its buttons: the title's size and the spacing do that
 * work, and decorative rules read as generated UI. The search field that
 * used to sit here is gone: it searched nothing.
 */
export function TopBar({
  title,
  accountMenu,
  notifications,
}: {
  title: string;
  accountMenu?: ReactNode;
  /** The notification bell (Sprint 8): a slot for the same reason as the account menu. */
  notifications?: ReactNode;
}) {
  return (
    // Shorter on a phone, where 80px of bar is a tenth of the screen.
    <header className="flex h-16 shrink-0 items-center gap-3 px-4 md:h-20 md:gap-4 md:px-3">
      <h1 className="min-w-0 flex-1 truncate type-heading text-xl text-ink md:text-2xl">{title}</h1>
      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <ThemeToggle saveToAccount />
        {notifications}
        {accountMenu}
      </div>
    </header>
  );
}
