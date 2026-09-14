'use client';

import { Bookmark, Heart, MessageCircle, Share } from 'lucide-react';
import {
  ChannelAvatar,
  handleOf,
  MissingMedia,
  type PlatformPreviewProps,
  PreviewText,
} from './preview-parts';

/**
 * TikTok: a full-height vertical video, the caption over its lower edge.
 *
 * The caption is the whole post — the provider sends it as the video's title
 * field, which TikTok displays as the caption.
 */
export function TikTokPreview({ channel, parts, maxLength, lengthMethod }: PlatformPreviewProps) {
  const first = parts[0];

  if (!first) {
    return null;
  }

  const video = first.media.find((item) => item.type === 'video');

  return (
    <article className="flex justify-center bg-bgTiktokItem p-4 font-sans text-sm">
      <div className="relative aspect-[9/16] w-full max-w-[18rem] overflow-hidden rounded-2xl bg-plate text-onPlate">
        {video ? (
          <video
            src={video.url}
            className="h-full w-full object-cover"
            muted
            playsInline
            controls
            preload="metadata"
            aria-label={video.name}
          />
        ) : (
          <MissingMedia label="TikTok posts need a video." className="h-full border-onPlate/40" />
        )}

        <div
          className="pointer-events-none absolute end-2 bottom-24 flex flex-col items-center gap-4"
          aria-hidden="true"
        >
          <ChannelAvatar channel={channel} size="sm" />
          <Heart className="h-7 w-7" strokeWidth={2} />
          <MessageCircle className="h-7 w-7" strokeWidth={2} />
          <Bookmark className="h-7 w-7" strokeWidth={2} />
          <Share className="h-7 w-7" strokeWidth={2} />
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-plate/75 p-3 pe-12">
          <div className="font-bold">{handleOf(channel)}</div>
          <PreviewText
            text={first.text}
            maxLength={maxLength}
            lengthMethod={lengthMethod}
            foldAfter={80}
            moreLabel="more"
            className="text-[13px] leading-[18px]"
          />
        </div>
      </div>
    </article>
  );
}
