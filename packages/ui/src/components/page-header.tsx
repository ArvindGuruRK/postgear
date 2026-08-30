import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Heading, Text } from './typography';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, title, description, actions, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-4 border-b-4 border-outline pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <Heading level="h1" as="h1">
          {title}
        </Heading>
        {description && <Text muted>{description}</Text>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  ),
);
PageHeader.displayName = 'PageHeader';
