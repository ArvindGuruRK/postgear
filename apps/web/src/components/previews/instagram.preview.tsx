'use client';

import { cn } from '@postgear/ui';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
} from 'lucide-react';
import { useState } from 'react';
import { CommentList } from './comment-list';
import {
  ChannelAvatar,
  MissingMedia,
  type PlatformPreviewProps,
  PreviewMediaItem,
  PreviewText,
} from './preview-parts';

/** Instagram displays feed media between 4:5 portrait and 1.91:1 landscape. */
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

/**
 * Instagram: media first, always.
 *
 * A carousel, framed at the shape of its first item the way the feed frames
 * it, with the caption beneath — handle first, folded after about 125
 * characters. A post with no media shows where the required image would go,
 * because Instagram has no text-only post.
 */
export function InstagramPreview({
  channel,
  parts,
  maxLength,
  lengthMethod,
}: PlatformPreviewProps) {
  const [first, ...rest] = parts;
  const [index, setIndex] = useState(0);

  if (!first) {
    return null;
  }

  const media = first.media;
  const current = Math.min(index, Math.max(0, media.length - 1));
  const lead = media[0];
  const ratio =
    lead?.width && lead.height
      ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, lead.width / lead.height))
      : 1;
  const handle = channel.profile ?? channel.name;

  return (
    <article className="bg-bgInstagram font-sans text-sm leading-[18px] text-ink">
      <header className="flex items-center gap-2 px-3 py-2">
        <ChannelAvatar
          channel={channel}
          size="sm"
          className="ring-2 ring-actionAccent ring-offset-1"
        />
        <span className="flex-1 truncate font-bold">{handle}</span>
        <MoreHorizontal className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </header>

      {media.length === 0 ? (
        <MissingMedia label="Instagram posts need an image or video." className="aspect-square" />
      ) : (
        <div className="relative overflow-hidden bg-plate" style={{ aspectRatio: String(ratio) }}>
          <PreviewMediaItem item={media[current]} className="h-full w-full object-cover" natural />

          {media.length > 1 ? (
            <>
              <span className="absolute end-3 top-3 rounded-full bg-plate/70 px-2 py-0.5 text-xs font-semibold text-onPlate">
                {current + 1}/{media.length}
              </span>
              {current > 0 ? (
                <CarouselButton
                  label="Previous"
                  onClick={() => setIndex(current - 1)}
                  className="start-2"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                </CarouselButton>
              ) : null}
              {current < media.length - 1 ? (
                <CarouselButton
                  label="Next"
                  onClick={() => setIndex(current + 1)}
                  className="end-2"
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                </CarouselButton>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-4 px-3 pt-3" aria-hidden="true">
        <Heart className="h-6 w-6" strokeWidth={2} />
        <MessageCircle className="h-6 w-6" strokeWidth={2} />
        <Send className="h-6 w-6" strokeWidth={2} />
        {media.length > 1 ? (
          <span className="mx-auto flex gap-1">
            {media.map((item, dot) => (
              <span
                key={item.id}
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  dot === current ? 'bg-actionPrimary' : 'bg-outline/30',
                )}
              />
            ))}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <Bookmark className="h-6 w-6" strokeWidth={2} />
      </div>

      <div className="px-3 pb-3 pt-2">
        {first.text ? (
          <PreviewText
            text={first.text}
            maxLength={maxLength}
            lengthMethod={lengthMethod}
            foldAfter={125}
            moreLabel="… more"
            prefix={<span className="me-1 font-bold">{handle}</span>}
          />
        ) : null}
      </div>

      <CommentList
        channel={channel}
        parts={rest}
        maxLength={maxLength}
        lengthMethod={lengthMethod}
        bubbleClassName="bg-primary/40"
      />
    </article>
  );
}

function CarouselButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary/90 text-ink',
        'outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        className,
      )}
    >
      {children}
    </button>
  );
}
