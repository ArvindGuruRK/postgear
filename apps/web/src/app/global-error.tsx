'use client';

import { Button, Card, CardContent, Container, ErrorState } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { Bangers, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

// Last-resort boundary: catches errors thrown by the root layout itself, which
// means it REPLACES that layout rather than rendering inside it. Three things
// the root layout normally provides have to be repeated here or the page
// renders unstyled:
//   1. <html>/<body> — no layout above this one supplies them.
//   2. The font variables — next/font only injects them where its className is
//      applied, and this tree never passes through layout.tsx.
//   3. A theme class on <body> — every design token in colors.css is defined
//      inside `.dark`/`.light`, so without one of those classes no token
//      resolves and every component paints with no color at all.
// The theme is read straight from localStorage rather than defaulting, so a
// dark-mode user doesn't get flashed a white page at the worst moment.

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

const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=window.localStorage.getItem('postgear-theme')||'light';document.body.classList.add(t);}catch(e){document.body.classList.add('light');}})();`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className={`${bangers.variable} ${plusJakartaSans.variable}`}>
      <body suppressHydrationWarning>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static no-flash theme script, no user input */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <Container size="sm" className="flex min-h-screen items-center py-16">
          <Card className="w-full">
            <CardContent>
              <ErrorState
                icon={TriangleAlert}
                title="PostGear couldn't start"
                description="Something failed before the app finished loading. Reloading usually fixes it."
                className="py-8"
              />
              <div className="flex justify-center pb-8">
                <Button onClick={reset}>Reload PostGear</Button>
              </div>
              {error.digest ? (
                <p className="pb-6 text-center font-sans text-xs text-ink opacity-60">
                  Reference: {error.digest}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </Container>
      </body>
    </html>
  );
}
