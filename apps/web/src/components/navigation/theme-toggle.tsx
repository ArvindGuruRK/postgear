'use client';

import { cn } from '@postgear/ui';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Single brutal icon tile that swaps sun <-> moon.
 *
 * The two glyphs are shown/hidden by the `dark:` variant (see tailwind.css:
 * `&:where(.dark, .dark *)`), not by React state, so the correct icon is
 * painted on the very first frame alongside the body class the no-flash
 * script in layout.tsx sets. State is kept only for the label.
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.body.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.body.classList.contains('dark');
    document.body.classList.toggle('dark', next);
    document.body.classList.toggle('light', !next);
    setIsDark(next);
    try {
      window.localStorage.setItem('postgear-theme', next ? 'dark' : 'light');
    } catch {
      // Preference just won't persist.
    }
  }

  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  const iconBase =
    'absolute h-4 w-4 text-ink transition-[transform,opacity] duration-200 ease-out group-hover:text-onActionPrimary';

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      suppressHydrationWarning
      className={cn(
        'group relative flex h-9 w-9 shrink-0 items-center justify-center',
        'rounded-md border-2 border-outline bg-secondary shadow-brutalSm',
        'outline-none transition-[transform,box-shadow] duration-100',
        'hover:bg-actionPrimary',
        'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
      )}
    >
      <Sun
        className={cn(
          iconBase,
          'rotate-0 scale-100 opacity-100',
          'dark:-rotate-90 dark:scale-0 dark:opacity-0',
        )}
        strokeWidth={2.5}
      />
      <Moon
        className={cn(
          iconBase,
          'rotate-90 scale-0 opacity-0',
          'dark:rotate-0 dark:scale-100 dark:opacity-100',
        )}
        strokeWidth={2.5}
      />
    </button>
  );
}
