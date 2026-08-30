import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';

const headingVariants = cva('font-display tracking-wide text-ink', {
  variants: {
    level: {
      h1: 'text-5xl md:text-6xl',
      h2: 'text-3xl md:text-4xl',
      h3: 'text-2xl md:text-3xl',
      h4: 'text-lg md:text-xl',
    },
  },
  defaultVariants: {
    level: 'h2',
  },
});

export interface HeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  /** Overrides the rendered tag without changing the visual size (e.g. an h1-sized h2 for SEO). */
  as?: 'h1' | 'h2' | 'h3' | 'h4';
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, level = 'h2', as, ...props }, ref) => {
    const Comp = (as ?? level ?? 'h2') as React.ElementType;
    return (
      <Comp ref={ref} className={cn(headingVariants({ level }), className)} {...props} />
    );
  },
);
Heading.displayName = 'Heading';

const textVariants = cva('font-sans text-ink', {
  variants: {
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
    weight: {
      normal: 'font-normal',
      medium: 'font-medium',
      bold: 'font-bold',
    },
    muted: {
      true: 'opacity-70',
      false: '',
    },
  },
  defaultVariants: {
    size: 'md',
    // Slightly bolder than plain regular (400) by default — Plus Jakarta
    // Sans is a real variable font, so font-medium (500) is a genuine
    // loaded weight, not synthetic. Matches the confidence of the bold
    // label/chrome text (Badge, table headers, Row labels) it sits next
    // to. Dense data surfaces (Table/DataTable) deliberately don't use
    // Text and keep their own lighter weight — see design-system-rules.md
    // §15/§1.
    weight: 'medium',
    muted: false,
  },
});

export interface TextProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof textVariants> {
  as?: 'p' | 'span' | 'div';
}

export const Text = forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, size, weight, muted, as = 'p', ...props }, ref) => {
    const Comp = as as React.ElementType;
    return (
      <Comp ref={ref} className={cn(textVariants({ size, weight, muted }), className)} {...props} />
    );
  },
);
Text.displayName = 'Text';
