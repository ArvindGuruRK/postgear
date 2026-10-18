'use client';

import { useEffect, useLayoutEffect } from 'react';
import { applyAppearance, currentAppearance } from '@/lib/appearance';

/**
 * Keeps `<body>` in the right scheme after the no-flash script has run.
 * Mounted once, in the root layout; renders nothing.
 *
 * Two jobs:
 *
 * 1. **Re-apply on mount.** React's Strict Mode remount in development resets
 *    `<body>` to the attributes it manages from JSX, wiping the class and the
 *    `data-light-theme` / `data-dark-theme` attributes the inline script set.
 *    A layout effect puts them back
 *    before paint (Next's "Preventing flash" guide). In production this is a
 *    no-op that writes the same values again.
 * 2. **Follow the device while the mode is `system`.** The script resolves
 *    `prefers-color-scheme` once, at parse time; this listens for the OS
 *    switching (a sunset schedule, a quick-settings toggle) and swaps the
 *    class live. The cookie is re-read on each change, so a mode chosen after
 *    mount (`light` from the toggle) stops it following without any
 *    unsubscribing.
 */
export function AppearanceRuntime() {
  useLayoutEffect(() => {
    applyAppearance(currentAppearance());
  }, []);

  useEffect(() => {
    let query: MediaQueryList;

    try {
      query = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }

    const follow = () => {
      const appearance = currentAppearance();

      if (appearance.mode === 'system') {
        applyAppearance(appearance);
      }
    };

    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  return null;
}
