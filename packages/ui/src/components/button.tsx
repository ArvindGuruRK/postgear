'use client';

import type { VariantProps } from 'class-variance-authority';
import { forwardRef, useCallback } from 'react';
import { fillHoverNeutralLayer } from '../lib/fill-hover-classes';
import { useFillHover } from '../lib/fill-hover';
import { cn } from '../lib/utils';
import { buttonVariants } from './button-variants';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

/** The variants whose hover is a colour wiping in from the pointer. */
const FILL_LAYER: Partial<Record<NonNullable<ButtonProps['variant']>, string>> = {
  secondary: fillHoverNeutralLayer,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', children, ...props }, ref) => {
    const layer = variant ? FILL_LAYER[variant] : undefined;
    const { rootRef, fillRef } = useFillHover({
      enabled: layer !== undefined,
      disabled: props.disabled,
    });
    const setRef = useCallback(
      (node: HTMLButtonElement | null) => {
        rootRef?.(node);
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref, rootRef],
    );

    return (
      <button
        ref={setRef}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {layer ? <span ref={fillRef} aria-hidden className={layer} /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
