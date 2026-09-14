'use client';

import {
  ChannelAvatar,
  MissingMedia,
  type PlatformPreviewProps,
  PreviewMediaItem,
  PreviewText,
} from './preview-parts';

/** Pin titles are capped at 100 characters; the provider trims the first line to fit. */
const TITLE_LENGTH = 100;

/**
 * Pinterest: one image, a title and a description.
 *
 * Drawn from the same split the provider makes: the first line becomes the
 * title, trimmed to 100 characters, and the remaining lines the description —
 * or the whole post, when it is a single line.
 */
export function PinterestPreview({
  channel,
  parts,
  maxLength,
  lengthMethod,
}: PlatformPreviewProps) {
  const first = parts[0];

  if (!first) {
    return null;
  }

  const [firstLine = '', ...restLines] = first.text.split('\n');
  const title = firstLine.slice(0, TITLE_LENGTH);
  const description = restLines.length > 0 ? restLines.join('\n') : first.text;
  const image = first.media[0];

  return (
    <article className="flex justify-center bg-secondary p-4 font-sans text-sm text-ink">
      <div className="w-full max-w-[16rem]">
        {image ? (
          <PreviewMediaItem item={image} className="w-full rounded-3xl object-cover" natural />
        ) : (
          <MissingMedia label="A Pin needs an image." className="aspect-[2/3] rounded-3xl" />
        )}

        {title ? <h3 className="mt-2 line-clamp-2 font-bold leading-5">{title}</h3> : null}

        <PreviewText
          text={description}
          maxLength={maxLength}
          lengthMethod={lengthMethod}
          foldAfter={120}
          moreLabel="…more"
          className="mt-1 text-xs opacity-80"
        />

        <div className="mt-2 flex items-center gap-2">
          <ChannelAvatar channel={channel} size="sm" />
          <span className="truncate text-xs font-semibold">{channel.name}</span>
        </div>
      </div>
    </article>
  );
}
