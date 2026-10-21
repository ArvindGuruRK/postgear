/**
 * Small pieces every Home section shares: its label, the quiet text link, and
 * the row that scrolls sideways on a phone.
 *
 * Buttons are not here on purpose. A button on Home is the design system's
 * `Button` (secondary, `sm`), and a link that acts as one is `ActionLink`
 * (`home-actions.tsx`). A hand-built button styled to match once lived here
 * and lost the secondary button's hover animation; do not add one back.
 */
import { Card, cn } from '@postgear/ui';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * A card that takes the theme's colour (2026-10-22, "by role", on trial).
 *
 * The rule being tried: what organises or summarises takes the theme colour
 * (the frame layer, `chrome`, which the sidebar and top bar use); what you read
 * or type in stays light (the card layer, `secondary`, near-white in Lilac,
 * Cream, Cool and Paper). So the KPI cards and the panels that hold lists (Up
 * next, Comments, First steps) are `HomePanel`s, while the template and blog
 * cards stay plain `Card`s. This is the one place the choice is made, so a
 * change of mind is one line here. Classic and White have the same colour in
 * both layers, so nothing differs there.
 */
export function HomePanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn('bg-chrome', className)} {...props} />;
}

export const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/** A quiet link beside a section label ("Open queue"), the onboarding "Skip" style. */
export const TEXT_LINK = cn(
  'inline-flex items-center gap-1 rounded-sm font-sans text-sm font-bold text-ink underline underline-offset-2',
  FOCUS,
);

/**
 * One Home section: its name ("First steps", "Up next") with an optional
 * link or count on its right, then the content. The name is a heading so the
 * page can be read by section; it is the section's name, never a tagline.
 *
 * Written as typed, in sentence case with the heading role (2026-10-22): the
 * small uppercase `type-label` eyebrow it used to be read as shouting.
 */
export function HomeSection({
  title,
  action,
  className,
  children,
  ...props
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  const id = `home-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;

  return (
    <section
      aria-labelledby={id}
      className={cn('flex min-w-0 flex-col gap-3', className)}
      {...props}
    >
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 id={id} className="m-0 type-heading text-lg text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A row of cards: a grid from `md`, and below it one line that scrolls
 * sideways inside itself, snapping card by card, so the document never gets
 * wider than the phone. It bleeds to the screen's edges (the page's 16px
 * gutter) so a card half in view says "there is more this way".
 */
export function CardRow({
  columns,
  className,
  children,
}: {
  columns: 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      className={cn(
        'm-0 list-none p-0',
        // Phone: one scrolling line. The padding keeps the cards' shadows and
        // focus rings inside the scroller, which would otherwise clip them.
        '-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3',
        'pg-scrollbar pg-scrollbar-primary',
        // From md: a plain grid in the page's own width.
        'md:mx-0 md:grid md:snap-none md:gap-4 md:overflow-visible md:px-0 md:pt-0 md:pb-1',
        columns === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3',
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** One card's slot in a `CardRow`: most of the phone's width, so the next one peeks in. */
export const CARD_ROW_ITEM = 'flex w-[78%] max-w-80 shrink-0 snap-start md:w-auto md:max-w-none';
