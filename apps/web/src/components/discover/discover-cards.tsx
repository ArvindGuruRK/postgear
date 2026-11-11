'use client';

/**
 * A trend, a story or a video as a card (blueprint section 4): the picture
 * when there is one, the title, a quiet line (how many searched, who
 * published it or how many watched, and when), up to three related headlines
 * with their publishers, then the actions. A video names its channel under
 * the title, and its Open goes to YouTube.
 *
 * The card is a box you read, so it sits on `bg-inset` inside its group and
 * does not move; its buttons do. Everything that came from a feed carries
 * `dir="auto"`, so an Arabic or Hebrew headline reads right to left, and a
 * script Sora lacks falls back to the system's font (research 03, section 8).
 * Links leave with no referrer, and an address that is not http or https is
 * never made a link.
 *
 * **Create Post** is the neutral secondary, not blue: the same action on every
 * card is not the one call to action, and Draft With AI is (Arvind's pick on
 * 2026-11-10). It opens the Create Post sheet (`create-post-sheet.tsx`); the
 * overflow menu after Open holds Draft In Copilot (`card-menu.tsx`).
 *
 * **Read** (Module 08) sits between the two on a trend and a story that have
 * an address of their own: it opens the page in the reader sheet without
 * leaving Discover. A video has none, since a video page is not an article.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { AspectRatio, Button, cn, Link, MotionIcon } from '@postgear/ui';
import { type ReactNode, useId, useState } from 'react';
import type { DiscoverItem } from '@/types/discover';
import { ActionLink } from '../home/home-actions';
import { itemMeta, openHref, readHref, safeHref } from './discover-model';

/** Up to three related headlines on a card; one on a phone. */
const RELATED_SHOWN = 3;

export interface ItemCardProps {
  item: DiscoverItem;
  now: Date;
  /** Opens the Create Post sheet. Without it there is no Create Post (the playground). */
  onCreatePost?: (item: DiscoverItem) => void;
  /** Opens the reader sheet on the item's page (Module 08). Without it there is no Read. */
  onRead?: (item: DiscoverItem) => void;
  /** Extra controls after Open (Module 04's overflow menu). */
  extra?: ReactNode;
}

/**
 * Read, for anything with a page of its own to read: a card, or a competitor's
 * row. It draws nothing for an item with no web address, so a `javascript:`
 * link in a feed never becomes something to press.
 */
export function ReadButton({
  item,
  onRead,
}: {
  item: DiscoverItem;
  onRead: (item: DiscoverItem) => void;
}) {
  if (readHref(item) === null) return null;

  return (
    <Button variant="secondary" size="sm" onClick={() => onRead(item)}>
      Read
    </Button>
  );
}

function ItemImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <AspectRatio ratio={16 / 9} className="overflow-hidden border-b-2 border-outline">
      {/* biome-ignore lint/performance/noImgElement: a picture from the publisher's own host, with no remote pattern for the optimizer */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </AspectRatio>
  );
}

function RelatedHeadlines({ item }: { item: DiscoverItem }) {
  const related = (item.related ?? [])
    .map((headline) => ({ ...headline, href: safeHref(headline.url) }))
    .filter((headline) => headline.href !== null)
    .slice(0, RELATED_SHOWN);
  if (related.length === 0) return null;

  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {related.map((headline, index) => (
        <li
          key={`${headline.href}|${headline.title}`}
          dir="auto"
          className={cn(
            'line-clamp-1 font-sans text-xs sm:line-clamp-2',
            index > 0 && 'hidden sm:block',
          )}
        >
          <Link
            href={headline.href ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="decoration-1 underline-offset-2"
          >
            {headline.title}
          </Link>
          {headline.source ? (
            <span className="text-ink type-muted">, {headline.source}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ItemCard({
  item,
  now,
  onCreatePost,
  onRead,
  extra,
  byline,
  openLabel,
}: ItemCardProps & {
  /** A name under the title: a video's channel. */
  byline?: string;
  /** What a screen reader says for Open, when "in a new tab" is not the whole story. */
  openLabel?: string;
}) {
  const titleId = useId();
  const href = safeHref(openHref(item));
  const image = safeHref(item.image);
  const meta = itemMeta(item, now);

  return (
    <article
      aria-labelledby={titleId}
      data-testid="discover-card"
      data-kind={item.kind}
      className="flex min-w-0 animate-fadeIn flex-col overflow-hidden rounded-lg border-2 border-outline bg-inset motion-reduce:animate-none"
    >
      {image ? <ItemImage src={image} /> : null}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h3 id={titleId} dir="auto" className="m-0 break-words type-heading text-base text-ink">
            {item.title}
          </h3>
          {byline ? (
            <p dir="auto" className="m-0 break-words type-ui text-xs text-ink">
              {byline}
            </p>
          ) : null}
          {meta ? (
            <p dir="auto" className="m-0 font-sans text-xs text-ink type-muted">
              {meta}
            </p>
          ) : null}
        </div>

        <RelatedHeadlines item={item} />

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {onCreatePost ? (
            <Button variant="secondary" size="sm" onClick={() => onCreatePost(item)}>
              Create Post
            </Button>
          ) : null}
          {onRead ? <ReadButton item={item} onRead={onRead} /> : null}
          {href ? (
            <ActionLink
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              // Every card has an Open; the name says which story, and that it leaves.
              aria-label={openLabel ?? `Open ${item.title} in a new tab`}
            >
              <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
              Open
            </ActionLink>
          ) : null}
          {extra}
        </div>
      </div>
    </article>
  );
}

/** A rising search: the term, "500+ searches, 2 hours ago", and the stories behind it. */
export function TrendCard(props: ItemCardProps) {
  return <ItemCard {...props} />;
}

/** A story: the headline, "The Hindu, 2 hours ago", and related coverage when Google gives it. */
export function StoryCard(props: ItemCardProps) {
  return <ItemCard {...props} />;
}

/**
 * A trending video (Module 05): the thumbnail, the title as the uploader
 * wrote it, the channel, "1.2M views, 3 days ago", and Open to YouTube. It
 * never has Read: a video page is not an article.
 */
export function VideoCard({ onRead: _noRead, ...props }: ItemCardProps) {
  const { item } = props;
  return (
    <ItemCard
      {...props}
      byline={item.summary}
      openLabel={`Open ${item.title} on ${item.source.name} in a new tab`}
    />
  );
}
