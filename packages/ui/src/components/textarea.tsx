import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const textareaVariants = cva(
  [
    'flex min-h-[6rem] w-full rounded-md border-2 border-outline bg-secondary p-4 text-ink shadow-brutalSm',
    'font-sans text-sm placeholder:text-ink placeholder:opacity-50',
    'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        default: '',
        error: 'border-actionDanger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, ...props }, ref) => (
    <textarea ref={ref} className={cn(textareaVariants({ variant }), className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
