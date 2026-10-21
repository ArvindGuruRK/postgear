import { Toaster, TooltipProvider } from '@postgear/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppearanceRuntime } from '@/components/appearance/appearance-runtime';
import { NO_FLASH_APPEARANCE_SCRIPT } from '@/lib/appearance';
import { brandFont } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  // `template` lets each route set a short `title` ("Sign in") and get
  // "Sign in - PostGear" in the tab; `default` covers routes that set none.
  title: {
    default: 'PostGear',
    template: '%s - PostGear',
  },
  description: 'AI-Powered Social Media Management & SEO Platform',
  applicationName: 'PostGear',
};

// Matches the page background in each mode so mobile browser chrome doesn't
// sit against a color the app never uses. Values come from the Classic
// themes' --color-primary in packages/ui/src/styles/colors.css (the other
// themes keep these: one meta tag cannot follow a per-user choice); they're
// literals here because the browser reads this meta tag before any stylesheet
// resolves.
//
// `viewportFit: 'cover'` lets the page draw edge to edge on a phone with a
// notch or a home indicator, so the page ground runs under them rather than
// stopping at white bars. In exchange, every surface that touches a screen
// edge pads itself by that edge's `env(safe-area-inset-*)`: the app shell
// (navigation/app-shell.tsx), the tab bar, Sheet, the toast viewport, the
// auth layout and onboarding. Next merges this with its default
// `width=device-width, initial-scale=1`.
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fff8e7' },
    { media: '(prefers-color-scheme: dark)', color: '#121212' },
  ],
};

// The no-flash script (lib/appearance.ts) runs first thing in <body>, before
// paint: it reads the `pg_appearance` cookie, resolves `system` against
// prefers-color-scheme, and sets the `light`/`dark` class plus
// `data-light-theme` and `data-dark-theme` on <body> (on body, not <html>,
// because colors.css scopes every token under `.dark`/`.light` as
// descendants of `:root`).
// Reading the cookie in the script rather than with `cookies()` here keeps the
// root layout from forcing every route dynamic. `AppearanceRuntime` then
// keeps body right after hydration and follows the OS while the mode is
// System.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning` on <html> as well as <body>: browser extensions
    // (a custom cursor, a dark-mode tool, a translator) add attributes such as
    // `style` and `data-*` to <html> before React loads, and React then reports
    // a mismatch that no code of ours caused. It only silences this element's
    // own attributes, not anything inside it.
    <html lang="en" className={brandFont.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static no-flash theme script, no user input */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_APPEARANCE_SCRIPT }} />
        <AppearanceRuntime />
        {/* One provider for every tooltip in the app: see TooltipProvider. */}
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
