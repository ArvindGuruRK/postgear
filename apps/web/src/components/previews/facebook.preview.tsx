'use client';

import { Globe, MessageCircle, Share2, ThumbsUp } from 'lucide-react';
import { CommentList } from './comment-list';
import {
  ChannelAvatar,
  type PlatformPreviewProps,
  PreviewMediaGrid,
  PreviewText,
  shortDate,
} from './preview-parts';

/**
 * Facebook Pages. Long posts fold behind "See more" after about 480 characters
 * in the feed; later parts publish as the Page's own comments.
 */
export function FacebookPreview({
  channel,
  parts,
  maxLength,
  lengthMethod,
  publishAt,
}: PlatformPreviewProps) {
  const [first, ...rest] = parts;

  if (!first) {
    return null;
  }

  return (
    <article className="bg-bgFacebook font-sans text-[15px] leading-5 text-ink">
      <header className="flex items-center gap-2 px-4 pt-3">
        <ChannelAvatar channel={channel} />
        <div className="min-w-0">
          <div className="truncate font-bold">{channel.name}</div>
          <div className="flex items-center gap-1 text-xs opacity-60">
            {shortDate(publishAt)} ·{' '}
            <Globe className="h-3 w-3" strokeWidth={2.5} aria-label="Public" />
          </div>
        </div>
      </header>

      <PreviewText
        text={first.text}
        maxLength={maxLength}
        lengthMethod={lengthMethod}
        foldAfter={480}
        moreLabel="… See more"
        className="px-4 pt-2"
      />

      <PreviewMediaGrid media={first.media} className="mt-3" rounded="rounded-none" />

      <div
        className="mx-4 mt-1 flex justify-around border-t border-outline/15 py-1 opacity-70"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1.5 px-2 py-2 text-sm font-semibold">
          <ThumbsUp className="h-4 w-4" strokeWidth={2} /> Like
        </span>
        <span className="flex items-center gap-1.5 px-2 py-2 text-sm font-semibold">
          <MessageCircle className="h-4 w-4" strokeWidth={2} /> Comment
        </span>
        <span className="flex items-center gap-1.5 px-2 py-2 text-sm font-semibold">
          <Share2 className="h-4 w-4" strokeWidth={2} /> Share
        </span>
      </div>

      <CommentList
        channel={channel}
        parts={rest}
        maxLength={maxLength}
        lengthMethod={lengthMethod}
        bubbleClassName="bg-bgCommentFacebook"
      />
    </article>
  );
}
