import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const badgeVariants = cva(
  'inline-flex select-none items-center gap-1.5 rounded-full border-2 border-outline px-3 py-1 text-xs font-bold uppercase tracking-wide',
  {
    variants: {
      variant: {
        primary: 'bg-actionPrimary text-onActionPrimary',
        secondary: 'bg-actionSecondary text-onActionLight',
        danger: 'bg-actionDanger text-onActionLight',
        ai: 'bg-actionAi text-onActionAi',
        accent: 'bg-actionAccent text-onActionLight',
        // Added in Sprint 5 for "Published": the one outcome the scheduler
        // reports that is unambiguously good, and it needs to read as such next
        // to a danger badge. Same green / black-on-fill pair as Alert's success.
        success: 'bg-actionSuccess text-onActionLight',
        outline: 'bg-transparent text-ink',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  },
);
Badge.displayName = 'Badge';
