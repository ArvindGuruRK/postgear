'use client';

import { Badge, cn } from '@postgear/ui';
import { Check, Film } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MediaItem } from '@/types/media';
import { describeMedia } from './media-limits';

interface MediaTileProps {
  item: MediaItem;
  /** Present in the picker: the whole tile becomes a toggle. */
  selected?: boolean;
  onToggle?: (item: MediaItem) => void;
  /** Present in the library: actions under the caption. */
  actions?: ReactNode;
}

/**
 * One library item.
 *
 * Images show their generated thumbnail, never the full file, so a page of
 * tiles costs a few kilobytes each. Video has no generated poster yet, so the
 * browser is asked for just enough of the file to paint its first frame
 * (`preload="metadata"`).
 */
export function MediaTile({ item, selected, onToggle, actions }: MediaTileProps) {
  const preview = (
    <div className="relative aspect-square overflow-hidden bg-primary">
      {item.type === 'image' ? (
        // biome-ignore lint/performance/noImgElement: media is served from the API's own origin or a bucket, not through Next's image optimizer
        <img
          src={item.thumbnailUrl ?? item.url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          <video
            src={item.url}
            preload="metadata"
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          <span className="absolute start-2 top-2">
            <Badge variant="secondary" className="gap-1">
              <Film className="h-3 w-3" strokeWidth={3} />
              Video
            </Badge>
          </span>
        </>
      )}

      {selected ? (
        <span className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      ) : null}
    </div>
  );

  const caption = (
    <div className="flex flex-col gap-0.5 p-3 text-start">
      <span className="truncate font-sans text-sm font-bold text-ink" title={item.name}>
        {item.name}
      </span>
      <span className="font-sans text-xs font-medium text-ink opacity-70">
        {describeMedia(item)}
      </span>
    </div>
  );

  const frame = cn(
    'overflow-hidden rounded-lg border-4 border-outline bg-secondary',
    selected
      ? 'shadow-brutalPressed outline outline-[3px] outline-offset-2 outline-actionPrimary'
      : 'shadow-brutalMd',
  );

  if (onToggle) {
    return (
      <button
        type="button"
        aria-pressed={selected ?? false}
        aria-label={`${selected ? 'Deselect' : 'Select'} ${item.name}`}
        onClick={() => onToggle(item)}
        className={cn(
          frame,
          'block w-full outline-none transition-[transform,box-shadow] duration-100',
          'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        )}
      >
        {preview}
        {caption}
      </button>
    );
  }

  return (
    <figure className={cn(frame, 'm-0 flex flex-col')}>
      {preview}
      <figcaption>{caption}</figcaption>
      {actions ? <div className="mt-auto flex gap-2 px-3 pb-3">{actions}</div> : null}
    </figure>
  );
}
