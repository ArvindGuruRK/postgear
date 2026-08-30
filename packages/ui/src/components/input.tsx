import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const inputVariants = cva(
  [
    'flex w-full rounded-md border-2 border-outline bg-secondary text-ink shadow-brutalSm',
    'font-sans placeholder:text-ink placeholder:opacity-50',
    'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        default: '',
        error: 'border-actionDanger',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        md: 'h-11 px-4 text-sm',
        lg: 'h-14 px-5 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(inputVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
