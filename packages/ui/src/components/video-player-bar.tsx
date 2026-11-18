'use client';

import { FastForwardIcon } from '@animateicons/react/lucide/fast-forward-icon';
import { PauseIcon } from '@animateicons/react/lucide/pause-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { RewindIcon } from '@animateicons/react/lucide/rewind-icon';
import type { HTMLAttributes, ReactNode } from 'react';
import type { AnimatedIcon } from '../lib/icon-animation';
import { cn } from '../lib/utils';
import { Button } from './button';
import { Kbd, KbdGroup } from './kbd';
import { MotionIcon } from './motion-icon';
import { TooltipHint } from './tooltip';

export interface VideoPlayerBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Whether the video is playing: the middle button then pauses. */
  playing: boolean;
  onTogglePlay: () => void;
  onBack: () => void;
  onForward: () => void;
  /** The time as the person reads it, e.g. "12:04 / 3:42:10". Shown as given. */
  timeText: string;
  /** Title Case names, also the tooltips. The editor passes "Back One Frame" and "Forward One Frame". */
  backLabel?: string;
  forwardLabel?: string;
  playLabel?: string;
  pauseLabel?: string;
  /** Keys shown in each tooltip, pressed together, e.g. ['Shift', '←']. An empty list shows none. */
  backShortcut?: readonly string[];
  forwardShortcut?: readonly string[];
  playShortcut?: readonly string[];
  /** Icons for the step buttons; rewind and fast forward by default. */
  backIcon?: AnimatedIcon;
  forwardIcon?: AnimatedIcon;
  /** Turns every button off, e.g. while the video loads. */
  disabled?: boolean;
  backDisabled?: boolean;
  forwardDisabled?: boolean;
  /** The right side: the I and O buttons, the range length, Create Clip, or the timeline zoom. */
  children?: ReactNode;
}

/** Keys as key caps, pressed together. */
function Shortcut({ keys }: { keys?: readonly string[] }) {
  if (!keys || keys.length === 0) {
    return null;
  }
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

function BarButton({
  label,
  shortcut,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: readonly string[];
  icon: AnimatedIcon;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipHint label={label} shortcut={<Shortcut keys={shortcut} />} disabled={disabled}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        className="w-9 px-0"
        disabled={disabled}
        onClick={onClick}
      >
        <MotionIcon icon={icon} className="h-4 w-4" />
      </Button>
    </TooltipHint>
  );
}

/**
 * Our own transport controls under a video (Sprint 12, Clips): back, play or
 * pause, forward, the time, and a slot on the right for whatever the screen
 * adds. Presentational: it knows nothing about the video, only what to show
 * and whom to tell. The video page steps 5 seconds; the editor reuses it with
 * one-frame steps by passing its own labels, keys and icons.
 *
 * It sits on a surface that has its own border, so it has no shadow and its
 * icon buttons are ghost buttons.
 */
export function VideoPlayerBar({
  playing,
  onTogglePlay,
  onBack,
  onForward,
  timeText,
  backLabel = 'Back 5 Seconds',
  forwardLabel = 'Forward 5 Seconds',
  playLabel = 'Play',
  pauseLabel = 'Pause',
  backShortcut = ['Shift', '←'],
  forwardShortcut = ['Shift', '→'],
  playShortcut = ['Space'],
  backIcon = RewindIcon,
  forwardIcon = FastForwardIcon,
  disabled = false,
  backDisabled = false,
  forwardDisabled = false,
  className,
  children,
  ...props
}: VideoPlayerBarProps) {
  return (
    <div className={cn('flex min-h-11 items-center gap-3 px-2 py-1', className)} {...props}>
      <div className="flex items-center gap-1">
        <BarButton
          label={backLabel}
          shortcut={backShortcut}
          icon={backIcon}
          disabled={disabled || backDisabled}
          onClick={onBack}
        />
        <BarButton
          label={playing ? pauseLabel : playLabel}
          shortcut={playShortcut}
          icon={playing ? PauseIcon : PlayIcon}
          disabled={disabled}
          onClick={onTogglePlay}
        />
        <BarButton
          label={forwardLabel}
          shortcut={forwardShortcut}
          icon={forwardIcon}
          disabled={disabled || forwardDisabled}
          onClick={onForward}
        />
      </div>
      <span className="whitespace-nowrap font-sans text-sm font-bold tabular-nums text-ink">
        {timeText}
      </span>
      {children ? <div className="ml-auto flex min-w-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}
