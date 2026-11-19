'use client';

/**
 * A video's picture in a Media grid tile (Sprint 12, Module 19), shared by
 * the Media page's `LibraryTile` and the composer picker's `MediaTile`.
 *
 * The poster the media worker made (a small WebP, `thumbnailUrl`) when there
 * is one; otherwise, or when the poster will not load, the browser is asked
 * for just enough of the file to paint its first frame (`preload="metadata"`),
 * as before posters existed. The length sits in the bottom corner ("0:42")
 * once it is known. Fills its parent, which must be `relative`.
 */
import { Badge } from '@postgear/ui';
import { useState } from 'react';
import type { MediaItem } from '@/types/media';
import { lengthOf } from './media-details';

export function VideoStill({
  item,
}: {
  item: Pick<MediaItem, 'id' | 'url' | 'thumbnailUrl' | 'type' | 'durationMs'>;
}) {
  // Keyed by the poster, so a tile reused for another file tries its poster afresh.
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const poster = item.thumbnailUrl && item.thumbnailUrl !== failedPoster ? item.thumbnailUrl : null;
  const length = lengthOf(item);

  return (
    <>
      {poster ? (
        // biome-ignore lint/performance/noImgElement: media is served from the API's own origin or a bucket, not through Next's image optimizer
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailedPoster(poster)}
        />
      ) : (
        <video
          src={item.url}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
        />
      )}
      {length ? (
        <span className="absolute end-2 bottom-2">
          <Badge variant="secondary" className="tabular-nums" data-testid="media-length">
            {length}
          </Badge>
        </span>
      ) : null}
    </>
  );
}
