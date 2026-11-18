'use client';

/**
 * The Elements tab's tiles and chips (Module 12 section 9).
 *
 * - A tile is a square on a checker background (so a sticker's see-through
 *   parts read as see-through). Pressing it adds the sticker at the
 *   playhead. A moving sticker shows its first frame and plays only while
 *   the pointer is on it or it has focus.
 * - Its star (Add To Favourites, Remove From Favourites) and, where the
 *   source asks for a credit, its "i" sit on the tile as their own buttons.
 * - A chip narrows the tiles to one category; pressing it again shows all.
 *   Chips and the Follow Badge tile have no shadow (toggle-style controls).
 */
import { InfoIcon } from '@animateicons/react/lucide/info-icon';
import { StarIcon } from '@animateicons/react/lucide/star-icon';
import { cn, MotionIcon, TooltipHint } from '@postgear/ui';
import {
  BADGE,
  BADGE_PLATFORM_LOOK,
  type LibraryStickerView,
  type StickerCategory,
} from '@postgear/video-engine';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

/** The checker behind a picture with see-through parts. */
export const CHECKER: CSSProperties = {
  backgroundImage:
    'conic-gradient(rgb(127 127 127 / 0.22) 25%, transparent 0 50%, rgb(127 127 127 / 0.22) 0 75%, transparent 0)',
  backgroundSize: '14px 14px',
};

/** A moving picture held on its first frame: drawn once onto a canvas when it loads. */
export function StillFrame({ src, className }: { src: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const image = new Image();
    let live = true;
    image.decoding = 'async';
    image.onload = () => {
      const target = canvas.current;
      if (!live || !target) return;
      target.width = image.naturalWidth || 128;
      target.height = image.naturalHeight || 128;
      // Drawing a picture from another host is allowed; only reading it back is not.
      target.getContext('2d')?.drawImage(image, 0, 0, target.width, target.height);
    };
    image.src = src;
    return () => {
      live = false;
      image.onload = null;
    };
  }, [src]);
  return <canvas ref={canvas} className={className} />;
}

/** A tile's picture: the preview (or the file), still until `playing` for a moving one. */
export function TilePicture({
  src,
  animated,
  playing,
}: {
  src: string;
  animated: boolean;
  playing: boolean;
}) {
  const fit = 'h-full w-full object-contain';
  if (animated && !playing) return <StillFrame src={src} className={fit} />;
  // biome-ignore lint/performance/noImgElement: a remote sticker preview drawn as it is, no optimiser in between.
  return <img src={src} alt="" draggable={false} decoding="async" className={fit} />;
}

const TILE =
  'relative aspect-square overflow-hidden rounded-md border-2 border-outline bg-inset transition-colors';

export function StickerTile({
  sticker,
  onAdd,
  onFavourite,
}: {
  sticker: LibraryStickerView;
  onAdd: (sticker: LibraryStickerView) => void;
  onFavourite: (sticker: LibraryStickerView, favourite: boolean) => void;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const animated = sticker.kind === 'animated';
  const src = sticker.previewUrl ?? sticker.fileUrl;
  return (
    <div
      className={cn(TILE, 'group hover:border-actionPrimary')}
      style={CHECKER}
      data-testid="clip-sticker-tile"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={`Add ${sticker.name}`}
        className="absolute inset-0 flex items-center justify-center p-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focusRing"
        onClick={() => onAdd(sticker)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      >
        <TilePicture src={src} animated={animated} playing={hover || focus} />
      </button>
      <button
        type="button"
        aria-label={sticker.isFavourite ? 'Remove From Favourites' : 'Add To Favourites'}
        aria-pressed={sticker.isFavourite}
        className={cn(
          'absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-sm text-ink',
          'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
          sticker.isFavourite
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
        onClick={() => onFavourite(sticker, !sticker.isFavourite)}
      >
        <MotionIcon
          icon={StarIcon}
          className={cn('h-4 w-4 drop-shadow-sm', sticker.isFavourite && 'fill-current')}
        />
      </button>
      {sticker.credit ? (
        <TooltipHint label={sticker.credit.line} side="bottom">
          <button
            type="button"
            aria-label="Credit"
            className={cn(
              'absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-sm text-ink',
              'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
            )}
          >
            <MotionIcon icon={InfoIcon} className="h-4 w-4 drop-shadow-sm" />
          </button>
        </TooltipHint>
      ) : null}
    </div>
  );
}

/** The Follow Badge's tile: a small drawing of the badge itself, no file. */
export function BadgeTile({ onOpen }: { onOpen: () => void }) {
  const look = BADGE_PLATFORM_LOOK.twitch;
  return (
    <button
      type="button"
      aria-label="Follow Badge"
      data-testid="clip-badge-tile"
      onClick={onOpen}
      className={cn(
        TILE,
        'flex flex-col items-center justify-center gap-1 p-1.5 hover:border-actionPrimary',
        'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-full items-center gap-1 rounded-full px-1"
        style={{ background: BADGE.fill }}
      >
        <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: look.disc }} />
        <span className="h-1.5 flex-1 rounded-full bg-white/80" />
      </span>
      <span className="font-sans text-[11px] text-ink type-ui">Follow Badge</span>
    </button>
  );
}

/**
 * The category chips: only categories that have items of this kind, with
 * their counts (stickers in Module 12, sounds in Module 14).
 */
export function CategoryChips<Slug extends string = StickerCategory>({
  categories,
  value,
  onChange,
  label,
}: {
  categories: ReadonlyArray<{ slug: Slug; name: string; count: number }>;
  value: Slug | null;
  onChange: (category: Slug | null) => void;
  label: string;
}) {
  if (categories.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of toggle chips, named as a group.
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-1.5"
      data-testid="clip-sticker-chips"
    >
      {categories.map((category) => {
        const on = category.slug === value;
        return (
          <button
            key={category.slug}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : category.slug)}
            className={cn(
              'flex items-center gap-1 rounded-md border-2 px-2 py-0.5 font-sans text-xs text-ink type-ui',
              'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
              on
                ? 'border-outline bg-actionPrimary text-onActionPrimary'
                : 'border-outline bg-chrome hover:bg-secondary',
            )}
          >
            {category.name}
            <span className="tabular-nums opacity-70">{category.count}</span>
          </button>
        );
      })}
    </div>
  );
}
