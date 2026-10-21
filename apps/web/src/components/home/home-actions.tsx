'use client';

/**
 * A link that looks and moves like the design system's secondary `Button`.
 *
 * Home's actions used to be a hand-built lookalike (`PLAIN_ACTION`) with a
 * plain CSS hover, so the soft circle that grows from the pointer, which every
 * secondary button has, never ran on this page. A real `Button` covers the
 * actions that are buttons; this is for the ones that must be an `<a>` (they
 * navigate, so they can open in a new tab and are announced as links).
 *
 * It is `buttonVariants` for the look, plus the same `useFillHover` hook and
 * circle that `Button` uses, wired the way the calendar's channel card wires
 * its own links. Without a real mouse, or under reduced motion, the hook
 * stays off and the class's plain hover fill takes over, as on `Button`.
 */
import { buttonVariants, cn, fillHoverNeutralLayer, useFillHover } from '@postgear/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';

export function ActionLink({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'ref'>) {
  const { rootRef, fillRef } = useFillHover();

  return (
    <Link
      ref={rootRef}
      className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), className)}
      {...props}
    >
      <span ref={fillRef} aria-hidden className={fillHoverNeutralLayer} />
      {children}
    </Link>
  );
}
