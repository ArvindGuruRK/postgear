import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { FIELD_FOCUS, FIELD_FOCUS_ERROR } from '../lib/field';
import { cn } from '../lib/utils';

const inputVariants = cva(
  [
    'flex w-full rounded-md border-2 border-outline bg-field text-ink shadow-surfaceSm',
    'font-sans placeholder:text-ink placeholder:opacity-50',
    FIELD_FOCUS,
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        default: '',
        error: `border-actionDanger ${FIELD_FOCUS_ERROR}`,
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
