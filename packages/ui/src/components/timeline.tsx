import { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Timeline = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('flex flex-col', className)} {...props} />,
);
Timeline.displayName = 'Timeline';

export interface TimelineItemProps extends React.HTMLAttributes<HTMLDivElement> {
  isLast?: boolean;
}

export const TimelineItem = forwardRef<HTMLDivElement, TimelineItemProps>(
  ({ className, isLast, children, ...props }, ref) => (
    // pb-8 lives on the content column, not the row: the dot column stretches to match the
    // row's full height (cross-axis stretch), so keeping the gap-after-item spacing inside the
    // content column lets the connector line extend all the way down to the next dot instead of
    // stopping at the bottom of this item's content and leaving a visible break in the line.
    <div ref={ref} className={cn('relative flex gap-4', className)} {...props}>
      <div className="flex flex-col items-center">
        <span className="z-10 h-3 w-3 shrink-0 rounded-full border-2 border-outline bg-actionPrimary" />
        {!isLast && <span className="w-0.5 flex-1 bg-outline" />}
      </div>
      <div className="flex-1 pb-8">{children}</div>
    </div>
  ),
);
TimelineItem.displayName = 'TimelineItem';

export const TimelineTitle = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('font-display text-sm uppercase tracking-wide text-ink', className)} {...props} />
  ),
);
TimelineTitle.displayName = 'TimelineTitle';

export const TimelineDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('font-sans text-sm text-ink opacity-70', className)} {...props} />
));
TimelineDescription.displayName = 'TimelineDescription';

export const TimelineTimestamp = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('font-sans text-xs text-ink opacity-50', className)} {...props} />
));
TimelineTimestamp.displayName = 'TimelineTimestamp';
