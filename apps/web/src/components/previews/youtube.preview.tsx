'use client';

import { ThumbsUp } from 'lucide-react';
import {
  ChannelAvatar,
  MissingMedia,
  type PlatformPreviewProps,
  PreviewMediaItem,
  PreviewText,
} from './preview-parts';

/** YouTube truncates a title past 100 characters; the provider does the same. */
const TITLE_LENGTH = 100;

/**
 * YouTube: one video, with the first line as its title.
 *
 * The provider sends the first line as the title and the whole post as the
 * description, so that is exactly what is drawn. Only the first part is ever
 * published — the composer reports any others as an issue.
 */
export function YouTubePreview({ channel, parts, maxLength, lengthMethod }: PlatformPreviewProps) {
  const first = parts[0];

  if (!first) {
    return null;
  }

  const video = first.media.find((item) => item.type === 'video');
  const title = (first.text.split('\n')[0]?.trim() || 'Untitled').slice(0, TITLE_LENGTH);

  return (
    <article className="bg-bgYoutube p-3 font-sans text-sm text-ink">
      {video ? (
        <PreviewMediaItem
          item={video}
          className="aspect-video w-full rounded-xl bg-plate object-contain"
        />
      ) : (
        <MissingMedia label="YouTube posts need a video." className="aspect-video rounded-xl" />
      )}

      <h3 className="mt-3 line-clamp-2 text-lg font-bold leading-6">{title}</h3>

      <div className="mt-2 flex items-center gap-2">
        <ChannelAvatar channel={channel} size="sm" />
        <span className="flex-1 truncate font-semibold">{channel.name}</span>
        <span className="rounded-full bg-youtubeButton px-3 py-1.5 text-xs font-bold text-bgYoutube">
          Subscribe
        </span>
        <span
          className="flex items-center gap-1 rounded-full bg-youtubeBgAction px-3 py-1.5 text-xs font-bold"
          aria-hidden="true"
        >
          <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      </div>

      {first.text ? (
        <div className="mt-3 rounded-xl bg-youtubeBgAction p-3">
          <PreviewText
            text={first.text}
            maxLength={maxLength}
            lengthMethod={lengthMethod}
            foldAfter={160}
            moreLabel="...more"
          />
        </div>
      ) : null}
    </article>
  );
}
