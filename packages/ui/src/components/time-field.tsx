'use client';

import { type KeyboardEvent, forwardRef, useState } from 'react';
import { cn } from '../lib/utils';
import { Input, type InputProps } from './input';

/**
 * A time as the field shows it: "0:04.0", "12:30.5", "1:02:03.5". Minutes
 * have no leading zero below an hour; seconds always two digits; then
 * `decimals` places of a second (one by default, tenths).
 */
export function formatTimeText(ms: number, decimals: 1 | 2 = 1): string {
  const unit = decimals === 2 ? 10 : 100;
  const steps = Math.round(Math.max(0, ms) / unit);
  const perSecond = 1000 / unit;
  const fraction = steps % perSecond;
  const totalSeconds = Math.floor(steps / perSecond);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const tail = `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(decimals, '0')}`;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}`
    : `${totalMinutes}:${tail}`;
}

const TIME = /^(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Reads what a person typed into a time field, in ms: "4" (seconds), "4.5",
 * "1:02.3" (minutes and seconds), "1:02:03.5" (hours too). Anything else,
 * including seconds or minutes of 60 or more after a larger part, is `null`.
 */
export function parseTimeText(text: string): number | null {
  const match = TIME.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, hoursText, minutesText, secondsText] = match;
  const hours = hoursText === undefined ? 0 : Number(hoursText);
  const minutes = minutesText === undefined ? 0 : Number(minutesText);
  const seconds = Number(secondsText);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  if (minutesText !== undefined && seconds >= 60) {
    return null;
  }
  if (hoursText !== undefined && minutes >= 60) {
    return null;
  }
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function clamp(ms: number, min: number, max: number) {
  return Math.min(max, Math.max(min, ms));
}

/** One frame on from `ms`, on the frame grid (no drift from rounding a frame to whole ms). */
function stepFrame(ms: number, direction: -1 | 1, fps: number) {
  const frame = Math.round((ms * fps) / 1000) + direction;
  return Math.round((frame * 1000) / fps);
}

export interface TimeFieldProps
  extends Omit<
    InputProps,
    'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'aria-label'
  > {
  /** The time, in ms. */
  valueMs: number;
  /** Called with the new time, in ms, only on a commit: Enter, leaving the field, or an arrow step. */
  onChange: (ms: number) => void;
  /** What a screen reader calls the field, e.g. "Playhead Time". Required: the field has no visible label of its own. */
  'aria-label': string;
  /** Bounds in ms; a typed or stepped time is held inside them. */
  min?: number;
  max?: number;
  /** Frames per second, for the arrow keys' one-frame step. */
  fps?: number;
  /** Places of a second shown: 1 ("0:04.0") or 2 ("0:04.03"). */
  decimals?: 1 | 2;
}

/**
 * A small field for a time code (Sprint 12, Clips): shows "0:04.0", takes
 * typing ("4", "4.5", "1:02.3"), and steps by one frame with the up and down
 * arrows (Shift: one second), held between `min` and `max`. Typing does not
 * move anything until it is committed with Enter or by leaving the field; text
 * that is not a time is put back to the last good value. Escape puts it back too.
 *
 * The design system's `Input`, with its plain 2 px blue focus line.
 */
export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(
  (
    {
      valueMs,
      onChange,
      min = 0,
      max = Number.POSITIVE_INFINITY,
      fps = 30,
      decimals = 1,
      size = 'sm',
      className,
      disabled,
      onBlur,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    // What the person is typing; null while the field simply shows the value.
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? formatTimeText(valueMs, decimals);

    const commit = (ms: number) => {
      const next = clamp(ms, min, max);
      setDraft(null);
      if (next !== valueMs) {
        onChange(next);
      }
    };

    const commitDraft = () => {
      if (draft === null) {
        return;
      }
      const parsed = parseTimeText(draft);
      if (parsed === null) {
        setDraft(null);
        return;
      }
      commit(parsed);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commitDraft();
      } else if (event.key === 'Escape' && draft !== null) {
        event.preventDefault();
        setDraft(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        // A good half-typed time is the base for the step; otherwise the value.
        const typed = draft === null ? null : parseTimeText(draft);
        const base = clamp(typed ?? valueMs, min, max);
        commit(event.shiftKey ? base + direction * 1000 : stepFrame(base, direction, fps));
      }
    };

    return (
      <Input
        ref={ref}
        type="text"
        role="spinbutton"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        size={size}
        disabled={disabled}
        aria-valuenow={valueMs}
        aria-valuemin={min}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        aria-valuetext={formatTimeText(valueMs, decimals)}
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          commitDraft();
          onBlur?.(event);
        }}
        className={cn('w-24 text-center tabular-nums', className)}
        {...props}
      />
    );
  },
);
TimeField.displayName = 'TimeField';
