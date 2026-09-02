import { Toaster } from '@postgear/ui';
import type { Metadata, Viewport } from 'next';
import { Bangers, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const bangers = Bangers({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  // `template` lets each route set a short `title` ("Sign in") and get
  // "Sign in · PostGear" in the tab; `default` covers routes that set none.
  title: {
    default: 'PostGear',
    template: '%s · PostGear',
  },
  description: 'AI-Powered Social Media Management & SEO Platform',
  applicationName: 'PostGear',
};

// Matches the page background in each theme so mobile browser chrome doesn't
// sit against a color the app never uses. Values come from --color-primary in
// packages/ui/src/styles/colors.css; they're literals here because the browser
// reads this meta tag before any stylesheet resolves.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fff8e7' },
    { media: '(prefers-color-scheme: dark)', color: '#121212' },
  ],
};

// Runs before paint (see colors.css: `.dark`/`.light` are descendant
// selectors of `:root`, so the class must land on `<body>`, not `<html>`,
// for the CSS custom properties to resolve at all) — a plain inline script
// is the standard no-flash pattern since next-themes-style tooling isn't in
// scope for this sprint.
const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=window.localStorage.getItem('postgear-theme')||'light';document.body.classList.add(t);}catch(e){document.body.classList.add('light');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bangers.variable} ${plusJakartaSans.variable}`}>
      <body suppressHydrationWarning>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static no-flash theme script, no user input */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
