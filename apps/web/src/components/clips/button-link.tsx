'use client';

/**
 * A link that looks like the design system's primary `Button` (Open, Open
 * Video, Edit): it navigates, so it is an `<a>` that can open in a new tab
 * and is announced as a link. Secondary-looking links use `ActionLink`
 * (`components/home/home-actions.tsx`), which also runs the yellow fill hover.
 */
import { buttonVariants, cn } from '@postgear/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';

export function PrimaryLink({
  className,
  size = 'sm',
  ...props
}: Omit<ComponentProps<typeof Link>, 'ref'> & { size?: 'sm' | 'md' }) {
  return (
    <Link className={cn(buttonVariants({ variant: 'primary', size }), className)} {...props} />
  );
}
