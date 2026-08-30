import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Layers the halftone dot texture on top of the panel's background. */
  halftone?: boolean;
}

/**
 * The comic-frame equivalent of Card: squarer corners and a heavier
 * shadow-brutalLg, for "full comic treatment" surfaces (marketing,
 * onboarding, empty states) — see design-system-rules.md §15. Card stays
 * the workhorse for app UI; reach for Panel only where the comic-panel
 * motif itself is the point.
 */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, halftone, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-md border-4 border-outline bg-secondary shadow-brutalLg',
        halftone && 'bg-halftone',
        className,
      )}
      {...props}
    />
  ),
);
Panel.displayName = 'Panel';
