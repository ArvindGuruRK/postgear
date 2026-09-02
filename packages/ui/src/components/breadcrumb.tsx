import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Breadcrumb = forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'nav'>>(
  (props, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />,
);
Breadcrumb.displayName = 'Breadcrumb';

export const BreadcrumbList = forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<'ol'>>(
  ({ className, ...props }, ref) => (
    <ol
      ref={ref}
      className={cn('flex flex-wrap items-center gap-1.5 font-sans text-sm text-ink', className)}
      {...props}
    />
  ),
);
BreadcrumbList.displayName = 'BreadcrumbList';

export const BreadcrumbItem = forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<'li'>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn('inline-flex items-center gap-1.5', className)} {...props} />
  ),
);
BreadcrumbItem.displayName = 'BreadcrumbItem';

export const BreadcrumbLink = forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<'a'>>(
  ({ className, ...props }, ref) => (
    <a
      ref={ref}
      className={cn(
        'font-medium opacity-70 outline-none hover:opacity-100 hover:underline',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        className,
      )}
      {...props}
    />
  ),
);
BreadcrumbLink.displayName = 'BreadcrumbLink';

export const BreadcrumbPage = forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      aria-current="page"
      className={cn('font-display uppercase tracking-wide text-ink', className)}
      {...props}
    />
  ),
);
BreadcrumbPage.displayName = 'BreadcrumbPage';

export const BreadcrumbSeparator = ({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'li'>) => (
  <li role="presentation" aria-hidden="true" className={cn('opacity-50', className)} {...props}>
    {children ?? <ChevronRight className="h-3.5 w-3.5" strokeWidth={3} />}
  </li>
);
BreadcrumbSeparator.displayName = 'BreadcrumbSeparator';

export const BreadcrumbEllipsis = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span aria-hidden="true" className={cn('flex h-8 w-8 items-center justify-center', className)} {...props}>
    <MoreHorizontal className="h-4 w-4" strokeWidth={3} />
    <span className="sr-only">More</span>
  </span>
);
BreadcrumbEllipsis.displayName = 'BreadcrumbEllipsis';
