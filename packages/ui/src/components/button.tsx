import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md border-2 border-outline font-display uppercase tracking-wide',
    'shadow-brutalMd transition-[transform,box-shadow] duration-100',
    'active:translate-x-[2px] active:translate-y-[2px] active:shadow-brutalPressed',
    'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-actionPrimary text-onActionPrimary hover:bg-actionPrimaryHover',
        secondary: 'bg-actionSecondary text-onActionLight hover:brightness-95',
        danger: 'bg-actionDanger text-onActionLight hover:brightness-90',
        ai: 'bg-actionAi text-onActionLight hover:brightness-90',
      },
      size: {
        sm: 'h-9 px-4 text-xs',
        md: 'h-11 px-6 text-sm',
        lg: 'h-14 px-8 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
