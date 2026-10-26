import { Heading, Text } from '@postgear/ui';
import type { ReactNode } from 'react';
import { AuthIllustration } from '@/components/auth/auth-illustration';
import { BrandMark, BrandWordmark } from '@/components/brand/brand-mark';
import { ThemeToggle } from '@/components/navigation/theme-toggle';

// Unauthenticated shell: a two-panel split; illustration on the left, form on
// the right (swapped 2026-10-18, UI revamp). The swap is visual only
// (`lg:order-first` on the illustration): the form stays first in the DOM, so
// keyboard and screen-reader order still starts at the form, and below lg,
// where the illustration is hidden, nothing moves.
//
// The "already signed in → go to the app" guard lives on the login
// and register pages rather than here: /verify and /reset-password/[token] are
// in this same group, and a signed-in user must still be able to open a
// confirmation or reset link from their email.
//
// The split replaces the centered-card shell this file used to render, so the
// three auth screens no longer wrap themselves in <Card>: the left panel IS
// their surface (bg-secondary, ink border), and a card inside it would frame
// the same content twice. Each page now supplies only its heading and form.
//
// The panels use the page's two surface tokens rather than any new colour:
// bg-secondary for the working side and bg-primary (+ halftone, §15) for the
// illustration side. They are siblings, not nested, so this is not the
// "bg-primary inside bg-secondary" bug §7 warns about; it is the two-tone the
// token pair already describes.
//
// The root layout sets `viewport-fit=cover`, so on a phone the form column
// runs under the notch and the home indicator. The padding goes inside the
// column rather than on the outer frame, so the column's own surface fills
// the space under the notch instead of a band of page colour: the header's
// top and the form's bottom grow to the safe-area insets where those are
// larger, and both sides do the same for a landscape notch.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="flex min-h-screen flex-col bg-secondary lg:min-h-0 lg:border-l-4 lg:border-outline">
        <header className="flex items-center justify-between gap-4 p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pl-[max(1.5rem,env(safe-area-inset-left))]">
          {/* The logo: the Cog Badge and the wordmark. The wordmark stays in
              text-ink, the system's normal foreground. It once forced
              text-actionPrimary, which put the page's loudest colour on
              something you only read, competing with the primary button
              below it: the one thing on these screens meant to be blue. */}
          <h1 className="flex items-center gap-2 text-ink">
            <BrandMark className="h-12 w-12" />
            <BrandWordmark className="h-6" />
            <span className="sr-only">PostGear</span>
          </h1>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(3rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))]">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>

      {/* Decorative panel, so it is the half that goes when there is only room
          for one: below lg the form takes the full width rather than shrinking
          to sit beside a squeezed illustration (§11). Sticky at full viewport
          height so the artwork stays put while a taller form (register)
          scrolls past it. */}
      <aside className="hidden bg-primary bg-halftone lg:sticky lg:top-0 lg:order-first lg:flex lg:h-screen lg:flex-col lg:items-center lg:justify-center lg:gap-8 lg:self-start lg:px-12">
        <AuthIllustration className="w-full max-w-sm" />
        <div className="max-w-sm text-center">
          <Heading level="h3">Every channel. One queue.</Heading>
          <Text muted className="mt-2">
            Schedule, publish and analyze, everywhere your audience is.
          </Text>
        </div>
      </aside>
    </div>
  );
}
