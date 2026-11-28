'use client';

/**
 * The emote's stretch (Sprint 13, Module 14): where it starts in the video,
 * and a 10 second close-up with one draggable window. The window moves in
 * tenths of a second and will not stretch past 3.0 seconds; its edges set
 * the start and the end. The length shows beside it. Arrow keys on the
 * window move it a tenth (Shift: a second); Up and Down make it a tenth
 * longer or shorter, so the length is set without a pointer too (Module 16).
 * The Start slider reads its place as a time, not as milliseconds.
 *
 * A long video makes a 3 second window too small to grab on a whole-video
 * bar, hence the two parts: the Start slider for the place, the close-up for
 * the exact stretch.
 */
import { EMOTE_MAX_MS, EMOTE_STEP_MS } from '@postgear/video-engine';
import { Slider } from '@postgear/ui';
import { type KeyboardEvent, type PointerEvent, useId, useRef } from 'react';
import {
  clampStretch,
  clockLabel,
  EMOTE_MAX_LINE,
  type Stretch,
  secondsLabel,
} from './emote-model';

/** The close-up's span. */
const ZOOM_MS = 10_000;

export interface TrimBarProps {
  durationMs: number;
  stretch: Stretch;
  onChange: (stretch: Stretch) => void;
  /** Where the video is, for the marker; null hides it. */
  playheadMs?: number | null;
  disabled?: boolean;
}

type Drag = { mode: 'move' | 'start' | 'end'; x: number; start: Stretch; msPerPx: number };

/** The 10 seconds shown: centred on the stretch, inside the video. */
export function zoomWindow(
  durationMs: number,
  stretch: Stretch,
): { fromMs: number; spanMs: number } {
  const spanMs = Math.min(ZOOM_MS, Math.max(EMOTE_STEP_MS, durationMs));
  const centre = stretch.startMs + stretch.lengthMs / 2;
  const fromMs = Math.min(Math.max(0, centre - spanMs / 2), Math.max(0, durationMs - spanMs));
  return { fromMs, spanMs };
}

export function TrimBar({ durationMs, stretch, onChange, playheadMs, disabled }: TrimBarProps) {
  const strip = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const startId = useId();
  const { fromMs, spanMs } = zoomWindow(durationMs, stretch);
  const at = (ms: number) => `${((ms - fromMs) / spanMs) * 100}%`;
  const endMs = stretch.startMs + stretch.lengthMs;

  const begin = (mode: Drag['mode']) => (event: PointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0) return;
    const width = strip.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, x: event.clientX, start: stretch, msPerPx: spanMs / width };
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const delta = (event.clientX - current.x) * current.msPerPx;
    const { start } = current;
    const end = start.startMs + start.lengthMs;
    if (current.mode === 'move') {
      onChange(clampStretch({ ...start, startMs: start.startMs + delta }, durationMs));
    } else if (current.mode === 'start') {
      // The end stays put; the start may not pass it or open more than 3 seconds.
      const startMs = Math.min(
        Math.max(start.startMs + delta, end - EMOTE_MAX_MS),
        end - EMOTE_STEP_MS,
      );
      const snapped = Math.round(startMs / EMOTE_STEP_MS) * EMOTE_STEP_MS;
      onChange(clampStretch({ startMs: snapped, lengthMs: end - snapped }, durationMs));
    } else {
      onChange(clampStretch({ ...start, lengthMs: start.lengthMs + delta }, durationMs));
    }
  };

  const end = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 1_000 : EMOTE_STEP_MS;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const grow = event.key === 'ArrowUp' ? EMOTE_STEP_MS : -EMOTE_STEP_MS;
      onChange(clampStretch({ ...stretch, lengthMs: stretch.lengthMs + grow }, durationMs));
      return;
    }
    const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    if (delta === 0) return;
    event.preventDefault();
    onChange(clampStretch({ ...stretch, startMs: stretch.startMs + delta }, durationMs));
  };

  const seconds: number[] = [];
  for (let ms = Math.ceil(fromMs / 1_000) * 1_000; ms <= fromMs + spanMs; ms += 1_000)
    seconds.push(ms);

  return (
    <div className="flex flex-col gap-3" data-testid="emote-trim">
      <div className="flex items-center gap-3">
        <label htmlFor={startId} className="w-12 shrink-0 font-sans text-sm font-bold text-ink">
          Start
        </label>
        <Slider
          id={startId}
          className="min-w-0 flex-1"
          min={0}
          max={Math.max(0, durationMs - stretch.lengthMs)}
          step={EMOTE_STEP_MS}
          value={[stretch.startMs]}
          disabled={disabled}
          thumbs={[{ 'aria-label': 'Start', 'aria-valuetext': clockLabel(stretch.startMs) }]}
          onValueChange={([value]) =>
            onChange(clampStretch({ ...stretch, startMs: value ?? stretch.startMs }, durationMs))
          }
        />
        <span className="w-16 shrink-0 text-right font-sans text-sm tabular-nums text-ink">
          {clockLabel(stretch.startMs)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 font-sans text-sm font-bold text-ink">Trim</span>
        <div
          ref={strip}
          className="relative h-12 min-w-0 flex-1 overflow-hidden rounded-md border-2 border-outline bg-inset"
        >
          {seconds.map((ms) => (
            <span
              key={ms}
              aria-hidden="true"
              className="absolute bottom-0 h-3 w-0.5 bg-ink/30"
              style={{ left: at(ms) }}
            />
          ))}
          {typeof playheadMs === 'number' &&
          playheadMs >= fromMs &&
          playheadMs <= fromMs + spanMs ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-0.5 bg-actionDanger"
              style={{ left: at(playheadMs) }}
              data-testid="emote-trim-playhead"
            />
          ) : null}
          <div
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Stretch"
            aria-valuemin={0}
            aria-valuemax={durationMs}
            aria-valuenow={stretch.startMs}
            aria-valuetext={`${clockLabel(stretch.startMs)} to ${clockLabel(endMs)}, ${secondsLabel(stretch.lengthMs)}`}
            aria-description="Left and right move it, up and down make it longer or shorter."
            className="absolute inset-y-1 cursor-grab touch-none rounded-sm border-2 border-outline bg-actionSecondary/60 outline-none focus-visible:ring-2 focus-visible:ring-actionPrimary"
            style={{ left: at(stretch.startMs), width: `${(stretch.lengthMs / spanMs) * 100}%` }}
            onPointerDown={begin('move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={onKeyDown}
            data-testid="emote-trim-window"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize rounded-sm bg-outline"
              onPointerDown={begin('start')}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
            <span
              aria-hidden="true"
              className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize rounded-sm bg-outline"
              onPointerDown={begin('end')}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          </div>
        </div>
        <span
          className="w-16 shrink-0 text-right font-sans text-sm font-bold tabular-nums text-ink"
          data-testid="emote-trim-length"
        >
          {secondsLabel(stretch.lengthMs)}
        </span>
      </div>
      <div className="flex gap-3">
        <span aria-hidden="true" className="w-12 shrink-0" />
        <p className="m-0 font-sans text-sm text-ink type-muted">{EMOTE_MAX_LINE}</p>
      </div>
    </div>
  );
}
