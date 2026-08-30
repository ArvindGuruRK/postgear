import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const alertVariants = cva(
  'flex items-start gap-3 rounded-md border-2 border-outline p-4 font-sans text-sm shadow-brutalSm',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-ink',
        success: 'bg-actionSuccess text-onActionLight',
        danger: 'bg-actionDanger text-onActionLight',
        warning: 'bg-actionAccent text-onActionLight',
        ai: 'bg-actionAi text-onActionLight',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

export const AlertTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('font-display text-sm uppercase tracking-wide', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('font-sans text-sm opacity-90', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';
