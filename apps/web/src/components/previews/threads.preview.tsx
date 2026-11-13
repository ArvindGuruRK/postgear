'use client';

import { Heart, MessageCircle, Repeat2, Send } from 'lucide-react';
import {
  ChannelAvatar,
  type PlatformPreviewProps,
  PreviewMediaGrid,
  PreviewText,
  shortDate,
} from './preview-parts';

/**
 * Threads: a multi-part post is a real thread, each part a reply to the one
 * before.
 *
 * So every part is drawn as its own post, joined by the line Threads runs down
 * the avatar column, and every part can carry its own media. The handle is the
 * name here (Threads shows no display name in the feed), and length is Threads'
 * own count, where an emoji costs its bytes.
 */
export function ThreadsPreview({
  channel,
  parts,
  maxLength,
  lengthMethod,
  publishAt,
}: PlatformPreviewProps) {
  const handle = channel.profile ?? channel.name;

  return (
    <div className="bg-secondary font-sans text-[15px] leading-[21px] text-ink">
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
              <div className="flex items-baseline gap-2">
                <span className="truncate font-bold">{handle}</span>
                <span className="shrink-0 opacity-60">{shortDate(publishAt)}</span>
              </div>

              <PreviewText
                text={part.text}
                maxLength={maxLength}
                lengthMethod={lengthMethod}
                className="mt-0.5"
              />

              <PreviewMediaGrid media={part.media} className="mt-3" />

              <div className="mt-3 flex gap-5 opacity-60" aria-hidden="true">
                <Heart className="h-[18px] w-[18px]" strokeWidth={2} />
                <MessageCircle className="h-[18px] w-[18px]" strokeWidth={2} />
                <Repeat2 className="h-[18px] w-[18px]" strokeWidth={2} />
                <Send className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
