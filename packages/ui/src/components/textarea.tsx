import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { FIELD_FOCUS, FIELD_FOCUS_ERROR } from '../lib/field';
import { cn } from '../lib/utils';

const textareaVariants = cva(
  [
    'flex min-h-[6rem] w-full rounded-md border-2 border-outline bg-field p-4 text-ink shadow-surfaceSm',
    'font-sans text-sm placeholder:text-ink placeholder:opacity-50',
    FIELD_FOCUS,
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        default: '',
        error: `border-actionDanger ${FIELD_FOCUS_ERROR}`,
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
