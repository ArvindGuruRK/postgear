'use client';

/**
 * Focus after the composer (Module 17; Studio's `backFromComposer` made
 * general). Send To Composer opens the composer over the page (a modal
 * route), so the page stays and only the path changes. The composer's Back
 * closes it with nothing of the page's to give focus back to, so focus would
 * drop to the page; it goes back to the control that sent.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

function isComposerPath(path: string, orgId: string): boolean {
  const composer = `/${orgId}/composer`;
  return path === composer || path.startsWith(`${composer}/`);
}

/** Whether the address just came back from this workspace's composer to a page that is not the composer. */
export function cameBackFromComposer(previous: string, current: string, orgId: string): boolean {
  return isComposerPath(previous, orgId) && !isComposerPath(current, orgId);
}

/**
 * Puts focus on `target()` when the composer closes over this page, unless
 * something already has it (the composer's own focus handling runs first).
 */
export function useFocusAfterComposer(orgId: string, target: () => HTMLElement | null): void {
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  const latest = useRef(target);
  latest.current = target;

  useEffect(() => {
    const previous = lastPath.current;
    lastPath.current = pathname;
    if (!cameBackFromComposer(previous, pathname, orgId)) return;

    const timer = setTimeout(() => {
      const active = window.document.activeElement;
      if (active !== null && active !== window.document.body) return;
      const element = latest.current();
      if (element?.isConnected) element.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, orgId]);
}
