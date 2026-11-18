'use client';

/**
 * The transport under the stage (Module 08 section 4): back one frame, play
 * or pause, forward one frame (ghost buttons with tooltips and shortcuts),
 * the time with tenths ("0:12.4 / 0:42.0"), and the timeline's zoom on the
 * right.
 *
 * The play button and the time read the clock through `PlaybackStore`, each
 * on its own, so a new frame re-renders them and nothing else.
 */
import { MinusIcon } from '@animateicons/react/lucide/minus-icon';
import { PauseIcon } from '@animateicons/react/lucide/pause-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { ScanIcon } from '@animateicons/react/lucide/scan-icon';
import { StepBackIcon } from '@animateicons/react/lucide/step-back-icon';
import { StepForwardIcon } from '@animateicons/react/lucide/step-forward-icon';
import { Button, MotionIcon, TooltipHint } from '@postgear/ui';
import { formatTimecode } from '@postgear/video-engine';
import type { RefObject } from 'react';
import type { PlaybackStore } from './playback';

export interface DockControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

const ICON_BUTTON = 'h-9 w-9 shrink-0 px-0';

/** "0:12.4 / 0:42.0". */
export function transportTimeText(currentMs: number, durationMs: number): string {
  return `${formatTimecode(currentMs)} / ${formatTimecode(durationMs)}`;
}

export function TransportBar({
  playback,
  dock,
  disabled = false,
}: {
  playback: PlaybackStore;
  /** The timeline dock's zoom, reached through a ref so the bar never waits on the dock. */
  dock: RefObject<DockControls | null>;
  disabled?: boolean;
}) {
  return (
    <div
      data-testid="clip-transport"
      className="flex shrink-0 items-center justify-between gap-3 px-1"
    >
      <div className="w-36" aria-hidden="true" />
      <div className="flex items-center gap-2">
        <TooltipHint label="Back One Frame" shortcut={['←']}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Back One Frame"
            className={ICON_BUTTON}
            disabled={disabled}
            onClick={() => playback.stepFrames(-1)}
          >
            <MotionIcon icon={StepBackIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <PlayButton playback={playback} disabled={disabled} />
        <TooltipHint label="Forward One Frame" shortcut={['→']}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Forward One Frame"
            className={ICON_BUTTON}
            disabled={disabled}
            onClick={() => playback.stepFrames(1)}
          >
            <MotionIcon icon={StepForwardIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <TimeText playback={playback} />
      </div>
      <div className="flex w-36 items-center justify-end gap-1">
        <TooltipHint label="Zoom Out" shortcut={['-']}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom Out"
            className={ICON_BUTTON}
            onClick={() => dock.current?.zoomOut()}
          >
            <MotionIcon icon={MinusIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <TooltipHint label="Zoom In" shortcut={['+']}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Zoom In"
            className={ICON_BUTTON}
            onClick={() => dock.current?.zoomIn()}
          >
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <TooltipHint label="Show The Whole Clip">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Show The Whole Clip"
            className={ICON_BUTTON}
            onClick={() => dock.current?.fit()}
          >
            <MotionIcon icon={ScanIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
      </div>
    </div>
  );
}

function PlayButton({ playback, disabled }: { playback: PlaybackStore; disabled: boolean }) {
  const playing = playback.usePlaying();
  const label = playing ? 'Pause' : 'Play';
  return (
    <TooltipHint label={label} shortcut={['Space']}>
      <Button
        variant="secondary"
        size="sm"
        aria-label={label}
        data-testid="clip-play"
        data-playing={playing}
        className={ICON_BUTTON}
        disabled={disabled}
        onClick={() => playback.toggle()}
      >
        <MotionIcon icon={playing ? PauseIcon : PlayIcon} className="h-4 w-4" />
      </Button>
    </TooltipHint>
  );
}

function TimeText({ playback }: { playback: PlaybackStore }) {
  const currentMs = playback.useCurrentMs();
  const durationMs = playback.useDurationMs();
  return (
    <span
      data-testid="clip-time"
      className="min-w-32 text-center font-sans text-sm text-ink tabular-nums type-ui"
    >
      {transportTimeText(currentMs, durationMs)}
    </span>
  );
}
