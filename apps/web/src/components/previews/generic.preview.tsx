'use client';

import { CommentList } from './comment-list';
import {
  ChannelAvatar,
  handleOf,
  type PlatformPreviewProps,
  PreviewMediaGrid,
  PreviewText,
} from './preview-parts';

/**
 * The fallback for a platform without its own preview.
 *
 * The reference keeps the same safety net: a provider can be added to
 * `social-core` without a bespoke preview and still be shown honestly — its
 * real text, its real limit, its media — rather than not at all.
 */
export function GenericPreview({ channel, parts, maxLength, lengthMethod }: PlatformPreviewProps) {
  const [first, ...rest] = parts;

  if (!first) {
    return null;
  }

  return (
    <article className="bg-secondary font-sans text-sm text-ink">
      <header className="flex items-center gap-2 px-4 pt-3">
        <ChannelAvatar channel={channel} />
        <div className="min-w-0">
          <div className="truncate font-bold">{channel.name}</div>
          <div className="truncate text-xs opacity-60">{handleOf(channel)}</div>
        </div>
      </header>
      <PreviewText
        text={first.text}
        maxLength={maxLength}
        lengthMethod={lengthMethod}
        className="px-4 py-2"
      />
      <PreviewMediaGrid media={first.media} className="mx-4 mb-3" />
      <CommentList
        channel={channel}
        parts={rest}
        maxLength={maxLength}
        lengthMethod={lengthMethod}
        bubbleClassName="bg-primary/60"
      />
    </article>
  );
}
