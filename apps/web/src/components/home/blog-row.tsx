'use client';

/**
 * "From the blog": three article cards (Buffer's home ends with its blog).
 *
 * The blog does not exist yet, so the cards come from placeholders in
 * `lib/blog-feed.ts`. An article without an `href` is a plain card: not a
 * link, no arrow, nothing that invites a click to nowhere. Without an
 * `image`, the cover is a palette fill with a decorative icon, never a stock
 * photo. No dates are shown, since none of these were published.
 */
import { ArrowUpRightIcon } from '@animateicons/react/lucide/arrow-up-right-icon';
import { cn, MotionIcon, pressSm } from '@postgear/ui';
import { CalendarRange, ChartLine, type LucideIcon, MessageSquareText } from 'lucide-react';
import type { ReactNode } from 'react';
import { BLOG_FEED, type BlogArticle } from '@/lib/blog-feed';
import { CARD_ROW_ITEM, CardRow, FOCUS, HomeSection } from './home-ui';

/** Covers for articles without a picture, taken in turn. */
const COVERS: { icon: LucideIcon; fill: string }[] = [
  { icon: CalendarRange, fill: 'bg-avatar7 text-onAvatar7' },
  { icon: MessageSquareText, fill: 'bg-avatar5 text-onAvatar5' },
  { icon: ChartLine, fill: 'bg-avatar3 text-onAvatar3' },
];

const CARD =
  'flex w-full flex-col overflow-hidden rounded-lg border-2 border-outline bg-secondary text-ink';

export function BlogRow({ articles = BLOG_FEED }: { articles?: readonly BlogArticle[] }) {
  if (articles.length === 0) {
    return null;
  }

  return (
    <HomeSection title="From the blog" data-testid="home-blog">
      <CardRow columns={3}>
        {articles.map((article, index) => (
          <li key={article.id} className={CARD_ROW_ITEM}>
            {article.href ? (
              <a
                href={article.href}
                target="_blank"
                rel="noreferrer"
                data-testid="home-article"
                className={cn(CARD, pressSm, FOCUS)}
              >
                <ArticleBody article={article} index={index}>
                  <MotionIcon icon={ArrowUpRightIcon} className="h-4 w-4 shrink-0" />
                </ArticleBody>
              </a>
            ) : (
              <article data-testid="home-article" className={cn(CARD, 'shadow-surfaceSm')}>
                <ArticleBody article={article} index={index} />
              </article>
            )}
          </li>
        ))}
      </CardRow>
    </HomeSection>
  );
}

function ArticleBody({
  article,
  index,
  children,
}: {
  article: BlogArticle;
  index: number;
  /** The arrow, when the card is a link. */
  children?: ReactNode;
}) {
  const cover = COVERS[index % COVERS.length];
  const Icon = cover.icon;

  return (
    <>
      {article.image ? (
        // biome-ignore lint/performance/noImgElement: a feed's cover from wherever the blog hosts it, with no remote pattern for the optimizer
        <img
          src={article.image}
          alt=""
          className="h-28 w-full border-b-2 border-outline object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'flex h-28 w-full items-center justify-center border-b-2 border-outline',
            cover.fill,
          )}
        >
          <Icon className="h-8 w-8" strokeWidth={2.25} />
        </span>
      )}
      <div className="flex flex-1 flex-col gap-1 p-4 md:p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="m-0 type-ui text-base">{article.title}</h3>
          {children}
        </div>
        <p className="m-0 line-clamp-2 font-sans text-sm opacity-75">{article.excerpt}</p>
      </div>
    </>
  );
}
