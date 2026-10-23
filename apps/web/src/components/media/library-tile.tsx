'use client';

/**
 * One file in the Media page's grid (2026-10-23 revamp).
 *
 * Mostly picture: a square preview, the name on one line and "JPEG, 776 KB"
 * under it. Pressing the tile opens the viewer, which holds everything else.
 * The two things people do straight from the grid, using the file in a post
 * and deleting it, sit in the tile's corner: shown on hover and keyboard
 * focus, and always on a touch screen, which has no hover. They are siblings
 * of the tile's button, not inside it, so each is its own tab stop.
 *
 * The composer's picker keeps `MediaTile`, whose whole tile is a toggle.
 */
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { Button, buttonVariants, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import { Film, Play } from 'lucide-react';
import Link from 'next/link';
import type { MediaItem } from '@/types/media';
import { stickerOf, tileLine } from './media-details';

/**
 * The corner buttons sit on a picture, where a hard shadow and the sink-on-
 * hover press read as clutter (owner's call, 2026-10-23): flat, colour and
 * border only, and still.
 */
const FLAT =
  'h-8 w-8 px-0 shadow-none transition-none hover:translate-x-0 hover:translate-y-0 hover:shadow-none active:translate-x-0 active:translate-y-0 active:shadow-none';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function LibraryTile({
  orgId,
  item,
  onOpen,
  onDelete,
}: {
  orgId: string;
  item: MediaItem;
  onOpen: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}) {
  const sticker = stickerOf(item);

  return (
    <li data-testid="media-tile" data-media={item.id} className="group relative min-w-0">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`Open ${item.name}`}
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-lg border-2 border-outline bg-secondary text-start shadow-surfaceMd',
          FOCUS,
        )}
      >
        <span className="relative block aspect-square overflow-hidden border-b-2 border-outline bg-halftone">
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
              {/* No poster is generated yet: just enough of the file for its first frame. */}
              <video
                src={item.url}
                preload="metadata"
                muted
                playsInline
                className="h-full w-full object-cover"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-outline bg-secondary text-ink shadow-surfaceSm">
                  <Play className="ms-0.5 h-5 w-5 fill-current" strokeWidth={2.5} />
                </span>
              </span>
            </>
          )}

          {sticker ? (
            <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full border-2 border-outline bg-actionSecondary px-2 py-0.5 font-sans text-xs font-bold text-onActionLight">
              {sticker === 'Video' ? (
                <Film aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
              ) : null}
              {sticker}
            </span>
          ) : null}
        </span>

        <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
          <span className="truncate font-sans text-sm font-bold text-ink" title={item.name}>
            {item.name}
          </span>
          <span className="font-sans text-xs text-ink type-muted">{tileLine(item)}</span>
        </span>
      </button>

      <span
        className={cn(
          'absolute end-2 top-2 flex gap-1.5 transition-opacity duration-150',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
          'motion-reduce:transition-none',
        )}
      >
        <TooltipHint label="Use In A Post">
          <Link
            href={`/${orgId}/composer?media=${item.id}`}
            aria-label="Use In A Post"
            className={cn(buttonVariants({ size: 'sm' }), FLAT)}
          >
            <MotionIcon icon={SquarePenIcon} className="h-4 w-4" />
          </Link>
        </TooltipHint>
        <TooltipHint label="Delete">
          <Button
            size="sm"
            variant="danger"
            className={FLAT}
            aria-label={`Delete ${item.name}`}
            onClick={() => onDelete(item)}
          >
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
      </span>
    </li>
  );
}
