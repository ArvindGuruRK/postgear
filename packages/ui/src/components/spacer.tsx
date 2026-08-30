import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export type SpacerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface SpacerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: SpacerSize;
  axis?: 'horizontal' | 'vertical';
}

const spacerClasses: Record<'vertical' | 'horizontal', Record<SpacerSize, string>> = {
  vertical: {
    xs: 'h-1 w-full',
    sm: 'h-2 w-full',
    md: 'h-4 w-full',
    lg: 'h-8 w-full',
    xl: 'h-12 w-full',
  },
  horizontal: {
    xs: 'w-1 h-full',
    sm: 'w-2 h-full',
    md: 'w-4 h-full',
    lg: 'w-8 h-full',
    xl: 'w-12 h-full',
  },
};

export const Spacer = forwardRef<HTMLDivElement, SpacerProps>(
  ({ className, size = 'md', axis = 'vertical', ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('shrink-0', spacerClasses[axis][size], className)}
      {...props}
    />
  ),
);
Spacer.displayName = 'Spacer';
