import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const alertVariants = cva(
  'flex items-start gap-3 rounded-md border-2 border-outline p-4 font-sans text-sm shadow-surfaceSm',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-ink',
        // The primary button's blue (2026-10-22): for a notice that asks for a
        // step without anything being wrong, such as "Connect a channel".
        // Warning orange is for something that is stopping work.
        info: 'bg-actionPrimary text-onActionPrimary',
        success: 'bg-actionSuccess text-onActionLight',
        danger: 'bg-actionDanger text-onActionLight',
        warning: 'bg-actionAccent text-onActionLight',
        ai: 'bg-actionAi text-onActionAi',
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

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

export const AlertTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('type-label text-sm', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('font-sans text-sm font-medium opacity-90', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';
