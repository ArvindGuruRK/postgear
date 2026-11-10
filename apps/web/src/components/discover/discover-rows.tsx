'use client';

/**
 * Trending's two shapes that are not cards (blueprint section 4, Module 05).
 *
 * **Wikipedia rows**: a day's most-read articles as a ranked list you read,
 * so one inset box with a line between rows: the place in the list, the
 * article's title as a link to it, how many read it, then Create Post and
 * Open, the same two actions a card has.
 *
 * **Social chips**: what Bluesky and Mastodon are talking about, worldwide.
 * A chip is a link out and nothing else, so it has no Create Post. Chips
 * wrap, stand on their border with no shadow like every chip in the app, and
 * fill with the secondary button's yellow under the pointer. The two networks
 * look alike on the page, so the link's name says which one a topic is from.
 *
 * Titles and topics are outside text: `dir="auto"`, links that leave with no
 * referrer, and an address that is not http or https is never made a link.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { Button, cn, Link, MotionIcon } from '@postgear/ui';
import type { DiscoverItem } from '@/types/discover';
import { FOCUS } from '../analytics/analytics-ui';
import { ActionLink } from '../home/home-actions';
import { openHref, safeHref, socialChipLabel } from './discover-model';
import { ROW, ROW_LIST } from './discover-ui';

export interface WikipediaRowProps {
  item: DiscoverItem;
  /** Its place in the list, from 1. */
  rank: number;
  /** Opens the Create Post sheet. Without it there is no Create Post (the playground). */
  onCreatePost?: (item: DiscoverItem) => void;
}

/** One article: "1  Thirukkural  284 reads  Create Post  Open". */
export function WikipediaRow({ item, rank, onCreatePost }: WikipediaRowProps) {
  const href = safeHref(openHref(item));

  return (
    <li
      data-testid="discover-wiki-row"
      className={cn(ROW, 'animate-fadeIn motion-reduce:animate-none')}
    >
      {/* The list is ordered, so a screen reader already says the place. */}
      <span
        aria-hidden="true"
        className="w-6 shrink-0 text-center type-heading text-base text-ink tabular-nums"
      >
        {rank}
      </span>
      <span dir="auto" className="min-w-0 flex-1 basis-48 break-words font-sans text-sm text-ink">
        {href ? (
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="decoration-1 underline-offset-2"
          >
            {item.title}
          </Link>
        ) : (
          item.title
        )}
      </span>
      {item.signal?.label ? (
        <span className="shrink-0 font-sans text-xs text-ink type-muted">{item.signal.label}</span>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {onCreatePost ? (
          <Button variant="secondary" size="sm" onClick={() => onCreatePost(item)}>
            Create Post
          </Button>
        ) : null}
        {href ? (
          <ActionLink
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            // Every row has an Open; the name says which article, and that it leaves.
            aria-label={`Open ${item.title} in a new tab`}
          >
            <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
            Open
          </ActionLink>
        ) : null}
      </div>
    </li>
  );
}

/** The articles in the order the API ranked them. */
export function WikipediaRows({
  items,
  onCreatePost,
}: {
  items: readonly DiscoverItem[];
  onCreatePost?: (item: DiscoverItem) => void;
}) {
  return (
    <ol className={ROW_LIST}>
      {items.map((item, index) => (
        <WikipediaRow key={item.id} item={item} rank={index + 1} onCreatePost={onCreatePost} />
      ))}
    </ol>
  );
}

/** A chip: something you press, so the card layer, with a border and no shadow. */
const SOCIAL_CHIP =
  'inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-lg border-2 border-outline bg-secondary px-3 py-1 font-sans text-sm text-ink animate-fadeIn motion-reduce:animate-none';

/** The secondary button's fill, without its moving circle: a chip is small and there are twenty. */
const SOCIAL_CHIP_LINK =
  'transition-colors duration-100 hover:bg-actionSecondary hover:text-onActionLight active:bg-actionSecondary active:text-onActionLight';

/** One topic: the display name or `#tag`, then "4,625 posts" or "273 uses this week". */
export function SocialChip({ item }: { item: DiscoverItem }) {
  const href = safeHref(item.url);
  const words = (
    <>
      <span dir="auto" className="min-w-0 truncate type-ui">
        {item.title}
      </span>
      {item.signal?.label ? (
        <span className="shrink-0 text-xs type-muted">{item.signal.label}</span>
      ) : null}
    </>
  );

  if (!href) {
    // No address to go to: still a topic worth reading, just not a link.
    return (
      <span
        // Read-only, so the inset layer, not the one you press.
        className={cn(SOCIAL_CHIP, 'bg-inset')}
        data-testid="discover-social-chip"
        data-source={item.source.id}
      >
        {words}
        <span className="sr-only">on {item.source.name}</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={socialChipLabel(item)}
      data-testid="discover-social-chip"
      data-source={item.source.id}
      className={cn(SOCIAL_CHIP, SOCIAL_CHIP_LINK, FOCUS)}
    >
      {words}
    </a>
  );
}

/** Bluesky's topics, then Mastodon's, as the API ordered them. */
export function SocialChips({ items }: { items: readonly DiscoverItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 max-w-full">
          <SocialChip item={item} />
        </li>
      ))}
    </ul>
  );
}
