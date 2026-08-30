import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Heading, Text } from './typography';

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export const SectionHeader = forwardRef<HTMLDivElement, SectionHeaderProps>(
  ({ className, title, description, actions, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <Heading level="h3" as="h2">
          {title}
        </Heading>
        {description && (
          <Text size="sm" muted>
            {description}
          </Text>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  ),
);
SectionHeader.displayName = 'SectionHeader';
