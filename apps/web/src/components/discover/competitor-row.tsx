'use client';

/**
 * One thing a competitor published (blueprint section 4, story DC-7.2): a tag
 * that says where it is from (Blog, YouTube, Bluesky, Mastodon, News), its
 * title, when, then Create Post and Open, the same two actions a Wikipedia row
 * has. A News row is a story about them, not by them, so it names its
 * publisher under the title.
 *
 * The rows sit in the box the Wikipedia rows and festivals use: one inset
 * list you read, a line between rows, no shadow, no picture.
 *
 * Everything in a row is outside text: `dir="auto"` on the title, links that
 * leave with no referrer, and an address that is not http or https is never
 * made a link. `extra` is a slot after Open for a control another module adds
 * (Read, Module 08).
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { Badge, Button, cn, Link, MotionIcon } from '@postgear/ui';
import type { ReactNode } from 'react';
import type { DiscoverItem } from '@/types/discover';
import { ActionLink } from '../home/home-actions';
import {
  competitorKind,
  competitorKindLabel,
  competitorWhen,
  openHref,
  safeHref,
} from './discover-model';
import { ROW, ROW_LIST } from './discover-ui';

export interface CompetitorRowProps {
  item: DiscoverItem;
  now: Date;
  /** Opens the Create Post sheet. Without it there is no Create Post (the playground). */
  onCreatePost?: (item: DiscoverItem) => void;
  /** A control after Open. */
  extra?: ReactNode;
}

/** One item: "Blog  Five ways to cut churn  1 day ago  Create Post  Open". */
export function CompetitorRow({ item, now, onCreatePost, extra }: CompetitorRowProps) {
  const href = safeHref(openHref(item));
  const kind = competitorKind(item);
  const when = competitorWhen(item, now);

  return (
    <li
      data-testid="discover-competitor-row"
      data-kind={kind}
      className={cn(ROW, 'animate-fadeIn motion-reduce:animate-none')}
    >
      <Badge variant="outline" className="shrink-0">
        {competitorKindLabel(item)}
      </Badge>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span dir="auto" className="min-w-0 break-words font-sans text-sm text-ink">
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
        {kind === 'news' && item.source.name ? (
          <span
            dir="auto"
            className="font-sans text-xs text-ink type-muted"
            data-testid="competitor-publisher"
          >
            {item.source.name}
          </span>
        ) : null}
      </div>
      {when ? (
        <span
          className="shrink-0 font-sans text-xs text-ink type-muted"
          data-testid="competitor-when"
        >
          {when}
        </span>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {onCreatePost ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Create Post for ${item.title}`}
            onClick={() => onCreatePost(item)}
          >
            Create Post
          </Button>
        ) : null}
        {href ? (
          <ActionLink
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            // Every row has an Open; the name says which item, and that it leaves.
            aria-label={`Open ${item.title} in a new tab`}
          >
            <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
            Open
          </ActionLink>
        ) : null}
        {extra}
      </div>
    </li>
  );
}

/** A competitor's items, newest first, as the API ordered them. */
export function CompetitorRows({
  items,
  now,
  onCreatePost,
  renderExtra,
}: {
  items: readonly DiscoverItem[];
  now: Date;
  onCreatePost?: (item: DiscoverItem) => void;
  renderExtra?: (item: DiscoverItem) => ReactNode;
}) {
  return (
    <ul className={ROW_LIST}>
      {items.map((item) => (
        <CompetitorRow
          key={item.id}
          item={item}
          now={now}
          onCreatePost={onCreatePost}
          extra={renderExtra?.(item)}
        />
      ))}
    </ul>
  );
}
