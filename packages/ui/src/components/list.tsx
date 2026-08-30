import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const List = forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul
      ref={ref}
      className={cn(
        'flex flex-col divide-y-2 divide-outline overflow-hidden rounded-md border-2 border-outline bg-secondary',
        className,
      )}
      {...props}
    />
  ),
);
List.displayName = 'List';

export const ListItem = forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      className={cn('flex items-center gap-3 px-4 py-3 font-sans text-sm text-ink', className)}
      {...props}
    />
  ),
);
ListItem.displayName = 'ListItem';
