'use client';

/**
 * The Audio tab's rows (Module 14 section 8, the blueprint's `SoundRow`).
 *
 * Each row: a play button (ghost; one preview at a time), the name and
 * length over a small drawing of the sound's shape (its stored peaks), a
 * star, an "i" that opens the details line (source, author, licence), and
 * Add (secondary, small), which puts the sound at the playhead.
 */
import { InfoIcon } from '@animateicons/react/lucide/info-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { SquarePauseIcon } from '@animateicons/react/lucide/square-pause-icon';
import { StarIcon } from '@animateicons/react/lucide/star-icon';
import { Button, cn, MotionIcon, TooltipHint } from '@postgear/ui';
import type { LibrarySoundView } from '@postgear/video-engine';
import { useId, useState } from 'react';
import { detailsLine, lengthLabel, peaksPath } from './audio-model';

const SHAPE_W = 200;
const SHAPE_H = 20;

/** A sound's shape from its peaks, stretched to the width it is given. */
export function SoundShape({
  peaks,
  className,
  fill = 1,
}: {
  peaks: readonly number[] | null;
  className?: string;
  /** The share of the width the sound covers (an effect past its file's end). */
  fill?: number;
}) {
  const path = peaksPath(peaks, SHAPE_W, SHAPE_H, fill);
  if (!path) return null;
  return (
    <svg
      viewBox={`0 0 ${SHAPE_W} ${SHAPE_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('block', className)}
      data-testid="clip-sound-shape"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/** The ghost play button a row (and an uploaded sound) starts its preview with. */
export function PreviewButton({
  name,
  playing,
  disabled,
  onToggle,
}: {
  name: string;
  playing: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-8 shrink-0 px-0"
      aria-label={playing ? `Stop ${name}` : `Play ${name}`}
      aria-pressed={playing}
      disabled={disabled}
      onClick={onToggle}
    >
      <MotionIcon icon={playing ? SquarePauseIcon : PlayIcon} className="h-4 w-4" />
    </Button>
  );
}

export function SoundRow({
  sound,
  playing,
  onPreview,
  onFavourite,
  onAdd,
}: {
  sound: LibrarySoundView;
  playing: boolean;
  onPreview: (sound: LibrarySoundView) => void;
  onFavourite: (sound: LibrarySoundView, favourite: boolean) => void;
  onAdd: (sound: LibrarySoundView) => void;
}) {
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const star = sound.isFavourite ? 'Remove From Favourites' : 'Add To Favourites';
  return (
    <li
      className={cn(
        'flex flex-col gap-1 rounded-md border-2 bg-inset p-1.5',
        playing ? 'border-actionPrimary' : 'border-outline',
      )}
      data-testid="clip-sound-row"
    >
      <div className="flex items-center gap-1">
        <PreviewButton name={sound.name} playing={playing} onToggle={() => onPreview(sound)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span
              className="min-w-0 flex-1 truncate font-sans text-sm text-ink type-ui"
              title={sound.name}
            >
              {sound.name}
            </span>
            <span className="shrink-0 font-sans text-xs tabular-nums text-ink type-muted">
              {lengthLabel(sound.durationMs)}
            </span>
          </div>
          <SoundShape peaks={sound.peaks} className="h-4 w-full text-ink opacity-50" />
        </div>
        <TooltipHint label={star} side="top">
          <Button
            variant="ghost"
            size="sm"
            className="w-8 shrink-0 px-0"
            aria-label={star}
            aria-pressed={sound.isFavourite}
            onClick={() => onFavourite(sound, !sound.isFavourite)}
          >
            <MotionIcon
              icon={StarIcon}
              className={cn('h-4 w-4', sound.isFavourite && 'fill-current')}
            />
          </Button>
        </TooltipHint>
        <Button
          variant="ghost"
          size="sm"
          className="w-8 shrink-0 px-0"
          aria-label="Details"
          aria-expanded={details}
          aria-controls={detailsId}
          onClick={() => setDetails((open) => !open)}
        >
          <MotionIcon icon={InfoIcon} className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-label={`Add ${sound.name}`}
          onClick={() => onAdd(sound)}
        >
          Add
        </Button>
      </div>
      {details ? (
        <p
          id={detailsId}
          className="m-0 px-1 font-sans text-xs text-ink type-muted"
          data-testid="clip-sound-details"
        >
          {detailsLine(sound.details)}
        </p>
      ) : null}
    </li>
  );
}
