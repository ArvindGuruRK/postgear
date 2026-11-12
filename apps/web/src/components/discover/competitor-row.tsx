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
 *
 * Module 10 adds a New tag on a row published since the person last looked,
 * and the panel Research This Competitor answers with.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { Badge, Button, cn, Link, MotionIcon } from '@postgear/ui';
import { type ReactNode, useId } from 'react';
import type { Competitor, CompetitorResearch, DiscoverItem } from '@/types/discover';
import { ActionLink } from '../home/home-actions';
import { isNewSince, researchBasedOn, researchIdea } from './competitor-model';
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
  /** Published since the person last looked: a New tag after the kind's. */
  isNew?: boolean;
}

/** One item: "Blog  Five ways to cut churn  1 day ago  Create Post  Open". */
export function CompetitorRow({
  item,
  now,
  onCreatePost,
  extra,
  isNew = false,
}: CompetitorRowProps) {
  const href = safeHref(openHref(item));
  const kind = competitorKind(item);
  const when = competitorWhen(item, now);

  return (
    <li
      data-testid="discover-competitor-row"
      data-kind={kind}
      data-new={isNew ? 'true' : undefined}
      className={cn(ROW, 'animate-fadeIn motion-reduce:animate-none')}
    >
      <Badge variant="outline" className="shrink-0">
        {competitorKindLabel(item)}
      </Badge>
      {isNew ? (
        <Badge variant="primary" className="shrink-0" data-testid="competitor-new">
          New
        </Badge>
      ) : null}
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
  lastSeenAt,
}: {
  items: readonly DiscoverItem[];
  now: Date;
  onCreatePost?: (item: DiscoverItem) => void;
  renderExtra?: (item: DiscoverItem) => ReactNode;
  /** When the person last looked: a row published after it is tagged New. Null marks none. */
  lastSeenAt?: string | null;
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
          isNew={isNewSince(item, lastSeenAt)}
        />
      ))}
    </ul>
  );
}

export interface CompetitorResearchPanelProps {
  competitor: Pick<Competitor, 'id' | 'name'>;
  research: CompetitorResearch;
  now: Date;
  /** Opens the Create Post sheet on an opening. Without it there is no Create Post. */
  onCreatePost?: (item: DiscoverItem) => void;
  onClose?: () => void;
}

/**
 * What Research This Competitor found (Module 10): their themes, how often
 * they post, and a few openings to start a post of our own from. Read-only
 * inside the group's panel, so the inset layer. Every word in it is the AI's,
 * so each line reads its own direction.
 */
export function CompetitorResearchPanel({
  competitor,
  research,
  now,
  onCreatePost,
  onClose,
}: CompetitorResearchPanelProps) {
  const ids = useId();

  return (
    <section
      aria-label={`Research on ${competitor.name}`}
      className="flex flex-col gap-4 rounded-lg border-2 border-outline bg-inset p-4"
      data-testid="competitor-research"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 id={`${ids}-themes`} className="m-0 type-label text-sm text-ink">
            Themes
          </h3>
          {research.themes.length > 0 ? (
            <ul
              aria-labelledby={`${ids}-themes`}
              className="m-0 flex list-none flex-wrap gap-2 p-0"
            >
              {research.themes.map((theme) => (
                <li key={theme}>
                  <Badge variant="outline" dir="auto" className="font-normal">
                    {theme}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {onClose ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-9 shrink-0 px-0"
            aria-label={`Close research on ${competitor.name}`}
            onClick={onClose}
          >
            <MotionIcon icon={XIcon} className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="m-0 type-label text-sm text-ink">Rhythm</h3>
        <p dir="auto" className="m-0 font-sans text-sm text-ink">
          {research.rhythm}
        </p>
      </div>

      {research.openings.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 id={`${ids}-openings`} className="m-0 type-label text-sm text-ink">
            Openings
          </h3>
          <ol aria-labelledby={`${ids}-openings`} className="m-0 flex list-none flex-col gap-2 p-0">
            {research.openings.map((opening, index) => (
              <li
                // Openings can repeat word for word; the place in the list is what tells them apart.
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is never reordered
                key={index}
                className="flex flex-wrap items-center gap-x-4 gap-y-2"
                data-testid="competitor-research-opening"
              >
                <span dir="auto" className="min-w-0 flex-1 basis-56 font-sans text-sm text-ink">
                  {opening}
                </span>
                {onCreatePost ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    aria-label={`Create Post for ${opening}`}
                    onClick={() => onCreatePost(researchIdea(competitor, opening, index))}
                  >
                    Create Post
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p
        className="m-0 font-sans text-xs text-ink type-muted"
        data-testid="competitor-research-basis"
      >
        {researchBasedOn(research, now)}
      </p>
    </section>
  );
}
