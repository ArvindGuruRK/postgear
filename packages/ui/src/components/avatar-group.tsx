import { Children, forwardRef } from 'react';
import { cn } from '../lib/utils';

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Truncates to this many avatars and shows a "+N" overflow chip. */
  max?: number;
}

export const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ className, max, children, ...props }, ref) => {
    const items = Children.toArray(children);
    const visible = max ? items.slice(0, max) : items;
    const overflow = max && items.length > max ? items.length - max : 0;

    return (
      <div ref={ref} className={cn('flex items-center -space-x-3', className)} {...props}>
        {visible}
        {overflow > 0 && (
          <div className="z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-outline bg-secondary font-display text-xs text-ink">
            +{overflow}
          </div>
        )}
      </div>
    );
  },
);
AvatarGroup.displayName = 'AvatarGroup';
