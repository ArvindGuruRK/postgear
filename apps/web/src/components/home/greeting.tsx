'use client';

/**
 * The greeting that opens Home in place of a page title (Buffer's home, the
 * Claude desktop app's wording): "Good morning, Arvind" over today's date.
 *
 * Both lines are the viewer's own clock and locale, which the server does not
 * share, so they render once mounted; until then each line keeps one line's
 * height (`min-h-lh`), and nothing below moves when the words arrive. The
 * clock ticks on the minute, so a tab left open across noon or midnight
 * changes its greeting and its date by itself.
 *
 * The waving hand is an animated WebP; under reduced motion the `<picture>`
 * swaps in its first frame. A plain `<img>`, not `next/image`: the optimizer
 * would flatten the animation to one frame for everyone. It stands on its
 * own, without a tile, at about the greeting's cap height (both the user's
 * call), centred on the two lines beside it; `block` so an inline image's
 * baseline gap cannot push it off centre.
 */
import { formatToday, greeting } from './home-model';

export function Greeting({ now, name }: { now: Date | null; name: string | null }) {
  return (
    <div className="flex items-center gap-2 md:gap-3">
      <picture className="block shrink-0">
        <source srcSet="/logo/waving-hand-still.webp" media="(prefers-reduced-motion: reduce)" />
        <img
          src="/logo/waving-hand.webp"
          alt=""
          width={36}
          height={36}
          className="block h-8 w-8 md:h-9 md:w-9"
          decoding="async"
        />
      </picture>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p
          className="min-h-lh truncate type-heading text-xl text-ink md:text-2xl"
          data-testid="home-greeting"
        >
          {now ? greeting(now, name) : null}
        </p>
        <p className="min-h-lh font-sans text-sm text-ink type-muted" data-testid="home-date">
          {now ? formatToday(now) : null}
        </p>
      </div>
    </div>
  );
}
