import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(({ className, ...props }, ref) => (
  <a
    ref={ref}
    className={cn(
      'font-sans font-semibold text-actionPrimary underline decoration-2 underline-offset-4',
      'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
      'hover:text-actionPrimaryHover',
      className,
    )}
    {...props}
  />
));
Link.displayName = 'Link';
