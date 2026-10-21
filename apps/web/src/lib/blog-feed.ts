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
  /** What the article is about, one or two words ("Planning"): the card's eyebrow. */
  topic: string;
  /** Minutes to read it, rounded up. */
  readMinutes: number;
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
    topic: 'Planning',
    readMinutes: 4,
    title: 'Plan A Week Of Posts In One Sitting',
    excerpt: 'Batch the writing, schedule it once, and spend the rest of the week replying.',
    href: null,
    image: null,
  },
  {
    id: 'nothing-to-say',
    topic: 'Ideas',
    readMinutes: 5,
    title: 'What To Post When You Have Nothing To Say',
    excerpt: 'Five prompts that turn the work you already do into something worth sharing.',
    href: null,
    image: null,
  },
  {
    id: 'read-your-numbers',
    topic: 'Analytics',
    readMinutes: 6,
    title: 'Reading Your Analytics Without The Noise',
    excerpt: 'The three numbers that tell you what to post next, and the ones you can ignore.',
    href: null,
    image: null,
  },
];
