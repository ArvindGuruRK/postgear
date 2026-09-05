import { Heading, Text } from '@postgear/ui';
import type { ReactNode } from 'react';
import { AuthIllustration } from '@/components/auth/auth-illustration';
import { ThemeToggle } from '@/components/navigation/theme-toggle';

// Unauthenticated shell: a two-panel split — form on the left, illustration on
// the right. Sprint 2 adds the "already signed in → redirect to the dashboard"
// guard here, once there is a session to check.
//
// The split replaces the centered-card shell this file used to render, so the
// three auth screens no longer wrap themselves in <Card>: the left panel IS
// their surface (bg-secondary, ink border), and a card inside it would frame
// the same content twice. Each page now supplies only its heading and form.
//
// The panels use the page's two surface tokens rather than any new colour —
// bg-secondary for the working side and bg-primary (+ halftone, §15) for the
// illustration side. They are siblings, not nested, so this is not the
// "bg-primary inside bg-secondary" bug §7 warns about; it is the two-tone the
// token pair already describes.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="flex min-h-screen flex-col bg-secondary lg:min-h-0 lg:border-r-4 lg:border-outline">
        <header className="flex items-center justify-between gap-4 p-6">
          {/* No colour override: Heading already defaults to text-ink, the
              system's normal foreground. The wordmark previously forced
              text-actionPrimary, which put the page's loudest colour on
              something you only read, competing with the primary button
              below it — the one thing on these screens meant to be blue. */}
          <Heading as="h1" level="h4">
            PostGear
          </Heading>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-6 pb-12">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>

      {/* Decorative panel, so it is the half that goes when there is only room
          for one: below lg the form takes the full width rather than shrinking
          to sit beside a squeezed illustration (§11). Sticky at full viewport
          height so the artwork stays put while a taller form — register — 
          scrolls past it. */}
      <aside className="hidden bg-primary bg-halftone lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:items-center lg:justify-center lg:gap-8 lg:self-start lg:px-12">
        <AuthIllustration className="w-full max-w-sm" />
        <div className="max-w-sm text-center">
          <Heading level="h3">Every channel. One queue.</Heading>
          <Text muted className="mt-2">
            Schedule, publish and analyze — everywhere your audience is.
          </Text>
        </div>
      </aside>
    </div>
  );
}
