import type { ReactNode } from 'react';

/** The one line Input, the settings tabs and Output share across the step editor. */
export function PaneHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header
      data-testid="pane-header"
      className="flex h-14 shrink-0 items-center justify-between gap-2 border-b-2 border-outline px-4"
    >
      <div className="flex min-w-0 items-center gap-2">{title}</div>
      {children}
    </header>
  );
}
