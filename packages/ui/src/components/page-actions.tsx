import { forwardRef } from 'react';
import { cn } from '../lib/utils';

/**
 * The action row at the top of a main-nav page (New post, Connect a channel,
 * a credits meter…). Deliberately no title, description or divider: the top
 * bar already names the page and the sidebar marks it active, so repeating
 * the name in the content read as filler (product decision, 2026-10-17).
 * Settings pages work the same way: `SettingsNav` marks which one is open.
 */
export const PageActions = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-wrap items-center justify-end gap-3', className)}
      {...props}
    />
  ),
);
PageActions.displayName = 'PageActions';
