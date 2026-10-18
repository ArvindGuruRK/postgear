'use client';

import { cn, toast } from '@postgear/ui';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { APPEARANCE_EVENT, currentAppearance, setAppearance } from '@/lib/appearance';

/**
 * Single brutal icon tile that swaps sun <-> moon.
 *
 * The two glyphs are shown/hidden by the `dark:` variant (see tailwind.css:
 * `&:where(.dark, .dark *)`), not by React state, so the correct icon is
 * painted on the very first frame alongside the body class the no-flash
 * script in layout.tsx sets. State is kept only for the label.
 *
 * What it shows is the **effective** scheme (with the mode on System, that is
 * whatever the device resolves to), and a press always sets an explicit mode,
 * the opposite of what is showing: from System-on-a-dark-device it means
 * "light", which is what the person pressing it wants. System is chosen back
 * in Settings → Appearance. The light and dark themes are left as they are.
 *
 * `saveToAccount` (the dashboard top bar) also saves the mode to the account,
 * in the background; the auth pages have no account to save to, so there the
 * choice lives in this browser's cookie only.
 */
export function ThemeToggle({ saveToAccount = false }: { saveToAccount?: boolean }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.body.classList.contains('dark'));
    // Follows the scheme changing elsewhere: the Appearance page, or the OS
    // while the mode is System.
    const follow = (event: Event) => {
      setIsDark((event as CustomEvent<{ scheme: 'light' | 'dark' }>).detail.scheme === 'dark');
    };
    window.addEventListener(APPEARANCE_EVENT, follow);
    return () => window.removeEventListener(APPEARANCE_EVENT, follow);
  }, []);

  function toggle() {
    const mode = document.body.classList.contains('dark') ? 'light' : 'dark';
    setAppearance({ ...currentAppearance(), mode });

    if (saveToAccount) {
      api('/users/me/appearance', { method: 'PATCH', body: { mode } }).catch(() => {
        toast({
          title: "Couldn't save the theme",
          description: 'It applies on this device for now. It will not follow you to others.',
          variant: 'danger',
        });
      });
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
      data-testid="theme-toggle"
      suppressHydrationWarning
      className={cn(
        'group relative flex h-9 w-9 shrink-0 items-center justify-center',
        'rounded-md border-2 border-outline bg-secondary shadow-brutalSm',
        'outline-none transition-[transform,box-shadow] duration-100',
        'hover:bg-actionPrimary',
        'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
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
