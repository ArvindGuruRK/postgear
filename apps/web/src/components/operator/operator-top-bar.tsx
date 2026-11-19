'use client';

import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { buttonVariants, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import Link from 'next/link';
import { ThemeToggle } from '@/components/navigation/theme-toggle';

/**
 * The operator page's own top bar: a back button to the app (the root route
 * picks the active workspace), the page's name, and the theme button. No
 * workspace search and no account menu: nothing here belongs to a workspace.
 */
export function OperatorTopBar() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-1">
      <TooltipHint label="Back To The App" side="bottom">
        <Link
          href="/"
          aria-label="Back To The App"
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm' }),
            'h-9 w-9 shrink-0 px-0',
          )}
        >
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
        </Link>
      </TooltipHint>
      <h1 className="min-w-0 flex-1 truncate type-heading text-2xl text-ink">Operator</h1>
      <ThemeToggle saveToAccount />
    </header>
  );
}
