'use client';

/**
 * A trend or a story as a card (blueprint section 4): the picture when there
 * is one, the title, a quiet line (how many searched, or who published it, and
 * when), up to three related headlines with their publishers, then the
 * actions.
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
 * 2026-11-10). Until the sheet exists it is disabled with a reason.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { AspectRatio, Button, cn, Link, MotionIcon, TooltipHint } from '@postgear/ui';
import { type ReactNode, useId, useState } from 'react';
import type { DiscoverItem } from '@/types/discover';
import { ActionLink } from '../home/home-actions';
import { itemMeta, openHref, safeHref } from './discover-model';

export const CREATE_POST_LATER = 'Arrives in the next step of this sprint.';

/** Up to three related headlines on a card; one on a phone. */
const RELATED_SHOWN = 3;

export interface ItemCardProps {
  item: DiscoverItem;
  now: Date;
  /** Opens the Create Post sheet. Without it the button explains why it waits. */
  onCreatePost?: (item: DiscoverItem) => void;
  /** Extra controls after Open (Module 04's overflow menu). */
  extra?: ReactNode;
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

function ItemCard({ item, now, onCreatePost, extra }: ItemCardProps) {
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
          ) : (
            <TooltipHint label={CREATE_POST_LATER} disabled>
              <Button variant="secondary" size="sm" disabled>
                Create Post
              </Button>
            </TooltipHint>
          )}
          {href ? (
            <ActionLink
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              // Every card has an Open; the name says which story, and that it leaves.
              aria-label={`Open ${item.title} in a new tab`}
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
