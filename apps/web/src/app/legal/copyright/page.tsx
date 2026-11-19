import { Card } from '@postgear/ui';
import type { Metadata } from 'next';
import { BrandMark, BrandName } from '@/components/brand/brand-mark';
import {
  COPYRIGHT_ADDRESS,
  COPYRIGHT_INTRO,
  COPYRIGHT_SECTIONS,
  COPYRIGHT_TITLE,
} from '@/components/legal/copyright-copy';

export const metadata: Metadata = {
  title: COPYRIGHT_TITLE,
};

const PAGE =
  'mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:pt-10';

const LINK = 'font-bold text-ink underline underline-offset-2 hover:text-actionPrimary';

/**
 * How to ask for a video to be taken out of Clips (Sprint 12, Module 19
 * section 5), for anyone, signed in or not. Laid out like the other public
 * page, `/credits/clips` (there are no other legal pages yet): outside the
 * route groups, so no session is read. Linked from the rights tick box on
 * the link card. An operator acts on a request with
 * `DELETE /operator/clips/videos/:videoId` or `npm run clips:remove`.
 */
export default function CopyrightPage() {
  return (
    <main className={PAGE} data-testid="legal-copyright">
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="m-0 type-heading text-2xl text-ink">{COPYRIGHT_TITLE}</h1>
        <p className="m-0 font-sans text-sm text-ink type-muted">{COPYRIGHT_INTRO}</p>
      </header>

      {COPYRIGHT_SECTIONS.map((section) => (
        <section key={section.heading} className="flex flex-col gap-3">
          <h2 className="m-0 type-heading text-lg text-ink">{section.heading}</h2>
          <Card className="flex flex-col gap-2 p-4 shadow-surfaceSm">
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 font-sans text-sm text-ink">
              {section.lines.map((line) => (
                <li key={line}>
                  {line.includes(COPYRIGHT_ADDRESS) ? (
                    <>
                      Email{' '}
                      <a href={`mailto:${COPYRIGHT_ADDRESS}`} className={LINK}>
                        {COPYRIGHT_ADDRESS}
                      </a>
                      .
                    </>
                  ) : (
                    line
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}

      <footer className="mt-auto flex items-center justify-center gap-2 pt-4 font-sans text-xs text-ink type-muted">
        <BrandMark className="h-5 w-5" />
        <span>
          <BrandName /> Clips
        </span>
      </footer>
    </main>
  );
}
