import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

/**
 * Alternate "pushable 3D button" — bottom-only shadow (a solid ink base
 * under the button) instead of Button's diagonal shadow-brutalMd, per a
 * comic component-sheet reference: hover grows the base (lift), press
 * collapses it flush (sink). Kept as its own component rather than a
 * Button variant/rewrite — this is a parallel exploration sitting next to
 * Button in the showcase for comparison, not a replacement. See
 * --shadow-brutal-btn* in colors.css and design-system-rules.md §6/§8.
 *
 * Hover is shadow/transform only, no fill change (matches Button's same
 * fix, 2026-08-30) — the color change moved to :active so it reads as
 * click confirmation, not a competing hover signal.
 */
const button2Variants = cva(
  [
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md border-2 border-outline font-display uppercase tracking-wide',
    'shadow-brutalBtn transition-[transform,box-shadow] duration-100',
    'hover:-translate-y-0.5 hover:shadow-brutalBtnHover',
    'active:translate-y-1 active:shadow-brutalPressed',
    'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-actionPrimary text-onActionPrimary active:bg-actionPrimaryHover',
        secondary: 'bg-actionSecondary text-onActionLight active:brightness-95',
        danger: 'bg-actionDanger text-onActionLight active:brightness-90',
        ai: 'bg-actionAi text-onActionLight active:brightness-90',
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

export interface Button2Props
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button2Variants> {}

export const Button2 = forwardRef<HTMLButtonElement, Button2Props>(
  ({ className, variant, size, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(button2Variants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button2.displayName = 'Button2';
