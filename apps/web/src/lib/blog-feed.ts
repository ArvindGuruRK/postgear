/**
 * The Home page's "From the blog" row (UI revamp, 2026-10-19).
 *
 * The blog does not exist yet, so these are placeholders with no link, no
 * picture and no date: a card without an `href` renders as a plain article
 * (no arrow, nothing to click), and one without an `image` gets a cover drawn
 * from the theme's tokens. A later sprint replaces `BLOG_FEED` with the real
 * feed, which only has to fill this shape.
 */

export interface BlogArticle {
  /** Stable across fetches, for React keys. */
  id: string;
  title: string;
  /** One or two sentences; the card clamps it. */
  excerpt: string;
  /** Where the article lives. Null until it is published. */
  href: string | null;
  /** A cover image URL. Null draws the token-coloured cover. */
  image: string | null;
}

export const BLOG_FEED: readonly BlogArticle[] = [
  {
    id: 'plan-a-week',
    title: 'Plan a week of posts in one sitting',
    excerpt: 'Batch the writing, schedule it once, and spend the rest of the week replying.',
    href: null,
    image: null,
  },
  {
    id: 'nothing-to-say',
    title: 'What to post when you have nothing to say',
    excerpt: 'Five prompts that turn the work you already do into something worth sharing.',
    href: null,
    image: null,
  },
  {
    id: 'read-your-numbers',
    title: 'Reading your analytics without the noise',
    excerpt: 'The three numbers that tell you what to post next, and the ones you can ignore.',
    href: null,
    image: null,
  },
];
