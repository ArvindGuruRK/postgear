'use client';

/**
 * A trend, a story or a video as a card (blueprint section 4): the picture
 * when there is one, the title, a quiet line (how many searched, who
 * published it or how many watched, and when), up to three related headlines
 * with their publishers, then the actions. A video names its channel under
 * the title, and its title goes to YouTube.
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
 * overflow menu at the end of the row holds Draft In Copilot (`card-menu.tsx`).
 *
 * **Read** (Module 08) follows it on a trend and a story that have an address
 * of their own: it opens the page in the reader sheet without leaving
 * Discover. A video has none, since a video page is not an article.
 *
 * ## Module 10
 *
 * - **Rank**: Trends and stories come in the order their source ranked them,
 *   so a card carries its place in that order, and the first one in a group
 *   is the **lead**: two columns wide, a larger title, its picture beside the
 *   words. The order is information, so it is shown, never invented.
 * - **Search volume**: a trend with Google's approximate traffic gets a bar
 *   measured against the busiest trend in its group, so "which of these is
 *   big" reads at a glance. The number itself stays in words beside it.
 * - **Save**: a bookmark at the end of the action row keeps the card in the
 *   workspace's Saved tab. It sits with the overflow menu in a group that
 *   never wraps, so the menu no longer drops onto a row of its own.
 * - **The title is the way out**: it links to the story, the trend's top
 *   story or the video, in a new tab, as a headline does on any news page.
 *   Open was a third button doing the same, and pushed the row onto two
 *   lines on a card a quarter of the page wide.
 * - **A lead needs its picture**: one with none, or whose picture fails, is
 *   drawn as an ordinary card rather than a wide box that is mostly empty.
 */
import { BookmarkCheckIcon } from '@animateicons/react/lucide/bookmark-check-icon';
import { BookmarkIcon } from '@animateicons/react/lucide/bookmark-icon';
import { Button, cn, Link, MotionIcon } from '@postgear/ui';
import { type ReactNode, useId, useState } from 'react';
import type { DiscoverItem } from '@/types/discover';
import { itemMeta, openHref, readHref, safeHref } from './discover-model';

/** Up to three related headlines on a card; one on a phone. */
const RELATED_SHOWN = 3;

/** What the bookmark on a card does: the card is in the Saved tab, or can be put there. */
export interface SaveControl {
  saved: boolean;
  /** While the save or the removal is on its way, so a double press is one request. */
  busy?: boolean;
  onToggle: () => void;
}

export interface ItemCardProps {
  item: DiscoverItem;
  now: Date;
  /** Opens the Create Post sheet. Without it there is no Create Post (the playground). */
  onCreatePost?: (item: DiscoverItem) => void;
  /** Opens the reader sheet on the item's page (Module 08). Without it there is no Read. */
  onRead?: (item: DiscoverItem) => void;
  /** Extra controls at the end of the row (Module 04's overflow menu). */
  extra?: ReactNode;
  /** Module 10: its place in the source's order, from 1. Without it no rank is shown. */
  rank?: number;
  /** Module 10: the first of its group, drawn wide. */
  lead?: boolean;
  /** Module 10: its search volume against the busiest in its group, from 0 to 1. */
  volume?: number | null;
  /** Module 10: the bookmark. Without it the card has none (the playground, a saved idea). */
  save?: SaveControl;
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
    <Button
      variant="secondary"
      size="sm"
      // Every card has a Read; the name says which story.
      aria-label={`Read ${item.title}`}
      onClick={() => onRead(item)}
    >
      Read
    </Button>
  );
}

/**
 * The bookmark. A toggle (`aria-pressed`), so a screen reader says whether the
 * card is saved, and its name says which card.
 */
export function SaveButton({ item, save }: { item: DiscoverItem; save: SaveControl }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('w-9 px-0', save.saved && 'text-actionPrimary')}
      aria-pressed={save.saved}
      aria-label={save.saved ? `Remove ${item.title} from Saved` : `Save ${item.title}`}
      title={save.saved ? 'Saved for your workspace' : 'Save for later'}
      disabled={save.busy}
      onClick={save.onToggle}
      data-testid="discover-save"
    >
      <MotionIcon icon={save.saved ? BookmarkCheckIcon : BookmarkIcon} className="h-4 w-4" />
    </Button>
  );
}

/**
 * The card's picture, 16:9 above the words. On the lead card at desktop width
 * it sits beside them instead and fills its half from top to bottom, so the
 * card has no dark gap under a short picture. A plain box with the ratio (not
 * `AspectRatio`, whose outer box always takes the full width).
 */
function ItemImage({
  src,
  className,
  onFail,
}: {
  src: string;
  className?: string;
  /** The picture did not load, or was a pixel: the card draws itself without one. */
  onFail: () => void;
}) {
  return (
    <div
      className={cn(
        'relative aspect-video min-w-0 overflow-hidden border-outline bg-chrome',
        className,
      )}
    >
      {/* biome-ignore lint/performance/noImgElement: a picture from the publisher's own host, with no remote pattern for the optimizer */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        // A tracking pixel or a favicon is not a picture of the story.
        onLoad={(event) => {
          if (event.currentTarget.naturalWidth < 80) onFail();
        }}
        onError={onFail}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
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

/** A trend's search volume against the busiest in its group. The words beside it say the number. */
function VolumeBar({ volume }: { volume: number }) {
  const width = Math.max(4, Math.round(Math.min(1, Math.max(0, volume)) * 100));
  return (
    <div
      aria-hidden="true"
      data-testid="discover-volume"
      className="h-2 w-full overflow-hidden rounded-full border-2 border-outline bg-chrome"
    >
      <div className="h-full rounded-full bg-actionPrimary" style={{ width: `${width}%` }} />
    </div>
  );
}

/** Its place in the source's order. The list is not an `<ol>`, so the number is read out. */
function Rank({ rank, lead }: { rank: number; lead?: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 type-heading text-ink tabular-nums leading-none',
        lead ? 'text-4xl md:text-5xl' : 'text-xl',
      )}
    >
      <span className="sr-only">Number </span>
      {rank}
    </span>
  );
}

function ItemCard({
  item,
  now,
  onCreatePost,
  onRead,
  extra,
  byline,
  opensWhere = 'opens in a new tab',
  rank,
  lead: leadAsked = false,
  volume,
  save,
}: ItemCardProps & {
  /** A name under the title: a video's channel. */
  byline?: string;
  /** What a screen reader hears after the title, which is the link out. */
  opensWhere?: string;
}) {
  const titleId = useId();
  const hintId = useId();
  const href = safeHref(openHref(item));
  const [pictureFailed, setPictureFailed] = useState(false);
  const image = pictureFailed ? null : safeHref(item.image);
  // A lead is drawn wide around its picture. Without one (a Google News story,
  // a picture that never loads) it is an ordinary card, not a wide empty box.
  const lead = leadAsked && image !== null;
  const meta = itemMeta(item, now);
  const showVolume = typeof volume === 'number' && Number.isFinite(volume) && volume > 0;

  const words = (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start gap-3">
        {rank !== undefined ? <Rank rank={rank} lead={lead} /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3
            id={titleId}
            dir="auto"
            className={cn(
              'm-0 break-words type-heading text-ink',
              lead ? 'text-xl md:text-2xl' : 'text-base',
            )}
          >
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                dir="auto"
                // A description, not part of the name: the card and its heading
                // are still called by the title alone.
                aria-describedby={hintId}
                className="rounded-sm text-ink no-underline decoration-2 underline-offset-4 outline-none hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
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
      </div>

      {showVolume ? <VolumeBar volume={volume} /> : null}
      {lead && item.summary && item.kind !== 'video' ? (
        <p dir="auto" className="m-0 line-clamp-3 font-sans text-sm text-ink">
          {item.summary}
        </p>
      ) : null}

      <RelatedHeadlines item={item} />
      {href ? (
        <span id={hintId} hidden>
          {opensWhere}
        </span>
      ) : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {onCreatePost ? (
            <Button
              variant="secondary"
              size="sm"
              // Every card has a Create Post; the name says which item it is for.
              aria-label={`Create Post for ${item.title}`}
              onClick={() => onCreatePost(item)}
            >
              Create Post
            </Button>
          ) : null}
          {onRead ? <ReadButton item={item} onRead={onRead} /> : null}
        </div>
        {save || extra ? (
          // Together and never wrapped, so the menu stays at the end of the row.
          <div className="flex shrink-0 items-center gap-1 self-end">
            {save ? <SaveButton item={item} save={save} /> : null}
            {extra}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <article
      aria-labelledby={titleId}
      data-testid="discover-card"
      data-kind={item.kind}
      data-lead={lead || undefined}
      className={cn(
        'flex min-w-0 animate-fadeIn flex-col overflow-hidden rounded-lg border-2 border-outline bg-inset motion-reduce:animate-none',
        lead && 'sm:col-span-2 xl:flex-row',
      )}
    >
      {image ? (
        <ItemImage
          src={image}
          onFail={() => setPictureFailed(true)}
          className={cn(
            'border-b-2',
            lead &&
              'xl:aspect-auto xl:w-1/2 xl:shrink-0 xl:self-stretch xl:border-e-2 xl:border-b-0',
          )}
        />
      ) : null}
      {words}
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
      opensWhere={`opens on ${item.source.name} in a new tab`}
    />
  );
}
