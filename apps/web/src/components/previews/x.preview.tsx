'use client';

import { BarChart2, Bookmark, Heart, MessageCircle, Repeat2, Share } from 'lucide-react';
import {
  ChannelAvatar,
  handleOf,
  type PlatformPreviewProps,
  PreviewMediaGrid,
  PreviewText,
  shortDate,
} from './preview-parts';

/**
 * X: a thread is a chain of real posts, each replying to the one before.
 *
 * So every part is drawn as its own post, joined by the connector line X uses
 * down the avatar column — and every part can carry its own media. Length is
 * X's weighted count, so the overflow mark lands where X's own composer would
 * put it, not where a character count would.
 */
export function XPreview({
  channel,
  parts,
  maxLength,
  lengthMethod,
  publishAt,
}: PlatformPreviewProps) {
  return (
    <div className="bg-secondary font-sans text-[15px] leading-5 text-ink">
      {parts.map((part, index) => {
        const last = index === parts.length - 1;

        return (
          <article
            key={part.key}
            className="flex gap-3 px-4 pt-3"
            aria-label={`Post ${index + 1} of ${parts.length}`}
          >
            <div className="flex flex-col items-center">
              <ChannelAvatar channel={channel} />
              {last ? null : (
                <span className="mt-1 w-0.5 flex-1 bg-outline/30" aria-hidden="true" />
              )}
            </div>

            <div className={last ? 'min-w-0 flex-1 pb-3' : 'min-w-0 flex-1 pb-5'}>
              <div className="flex items-baseline gap-1 truncate">
                <span className="truncate font-bold">{channel.name}</span>
                <span className="truncate opacity-60">
                  {handleOf(channel)} · {shortDate(publishAt)}
                </span>
              </div>

              <PreviewText
                text={part.text}
                maxLength={maxLength}
                lengthMethod={lengthMethod}
                className="mt-0.5"
              />

              <PreviewMediaGrid media={part.media} className="mt-3" />

              <div className="mt-3 flex max-w-md justify-between opacity-60" aria-hidden="true">
                <MessageCircle className="h-4 w-4" strokeWidth={2} />
                <Repeat2 className="h-4 w-4" strokeWidth={2} />
                <Heart className="h-4 w-4" strokeWidth={2} />
                <BarChart2 className="h-4 w-4" strokeWidth={2} />
                <span className="flex gap-3">
                  <Bookmark className="h-4 w-4" strokeWidth={2} />
                  <Share className="h-4 w-4" strokeWidth={2} />
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
