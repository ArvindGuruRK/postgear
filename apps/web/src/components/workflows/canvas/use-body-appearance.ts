'use client';

/**
 * The page's appearance as `<body>` carries it: the `light` or `dark` class
 * and the named theme attributes (`lib/appearance.ts`).
 *
 * React Flow always puts a `light` or `dark` class on its own wrapper, and
 * the theme tokens are declared on those classes, so a wrapper that said
 * `light` would reset the canvas to Classic light inside a dark or Lilac
 * page. The canvas hands React Flow this scheme and repeats the theme
 * attributes on the wrapper, so it resolves to the same tokens as the page,
 * and follows a theme change made while it is open.
 */
import { useSyncExternalStore } from 'react';
import { DARK_THEME_ATTRIBUTE, LIGHT_THEME_ATTRIBUTE } from '@/lib/appearance';

export interface BodyAppearance {
  scheme: 'light' | 'dark';
  lightTheme: string | undefined;
  darkTheme: string | undefined;
}

const SERVER = 'light||';

function snapshot(): string {
  const body = document.body;
  const scheme = body.classList.contains('dark') ? 'dark' : 'light';
  return `${scheme}|${body.getAttribute(LIGHT_THEME_ATTRIBUTE) ?? ''}|${body.getAttribute(DARK_THEME_ATTRIBUTE) ?? ''}`;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', LIGHT_THEME_ATTRIBUTE, DARK_THEME_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

export function useBodyAppearance(): BodyAppearance {
  const value = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const [scheme, lightTheme, darkTheme] = value.split('|');
  return {
    scheme: scheme === 'dark' ? 'dark' : 'light',
    lightTheme: lightTheme || undefined,
    darkTheme: darkTheme || undefined,
  };
}
