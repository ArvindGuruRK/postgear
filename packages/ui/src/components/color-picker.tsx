'use client';

/**
 * `ColorPicker`: a swatch button that opens a picker (Clips Module 11; Studio's
 * `ColorField` can move to it later).
 *
 * Inside the popover: a grid of ready swatches and the recent ones, a shade
 * square (saturation across, brightness down) and a hue strip, a hex field,
 * and an opacity slider when `onOpacityChange` is given.
 *
 * - `onChange` fires on every step of a drag, so an editor can coalesce the
 *   steps into one undo; `onCommit` fires once when the gesture ends (pointer
 *   up, a swatch, Enter in the hex field, each arrow key).
 * - Keyboard: the square and the strip are sliders; arrows move by 1
 *   (Shift: by 10), as a percent in the square and a degree on the strip.
 * - The trigger and the open picker are flat: no shadow (dropdowns never
 *   carry one).
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { type Hsv, hexToHsv, hsvToHex, hueHex, parseHex } from '../lib/color';
import { FIELD_FOCUS, FIELD_FOCUS_ERROR } from '../lib/field';
import { cn } from '../lib/utils';
import { Slider } from './slider';

/** Ready swatches when none are given: light, dark and a few clear colours. */
export const DEFAULT_SWATCHES: readonly string[] = Object.freeze([
  '#FFFFFF',
  '#111111',
  '#FFD400',
  '#FF5A36',
  '#E8336D',
  '#7B61FF',
  '#2F80ED',
  '#21B573',
]);

export interface ColorPickerProps {
  /** What the colour is for ("Text colour"): the trigger's accessible name. */
  label: string;
  /** `#RRGGBB`. */
  value: string;
  onChange: (hex: string) => void;
  onCommit?: (hex: string) => void;
  /** 0 to 1, shown as a slider only with `onOpacityChange`. */
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  onOpacityCommit?: (opacity: number) => void;
  swatches?: readonly string[];
  /** Colours picked lately, newest first. */
  recent?: readonly string[];
  disabled?: boolean;
  id?: string;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The arrow-key step: 1, or 10 with Shift. */
function stepOf(event: React.KeyboardEvent): number {
  return event.shiftKey ? 10 : 1;
}

function SwatchGrid({
  title,
  colours,
  value,
  onPick,
}: {
  title: string;
  colours: readonly string[];
  value: string;
  onPick: (hex: string) => void;
}) {
  if (colours.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="type-label text-xs type-muted">{title}</span>
      <div className="grid grid-cols-8 gap-1.5">
        {colours.map((colour) => (
          <button
            key={colour}
            type="button"
            aria-label={colour}
            aria-pressed={colour === value}
            onClick={() => onPick(colour)}
            className={cn(
              'h-6 w-6 rounded-sm border-2 border-outline',
              'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              colour === value && 'ring-2 ring-actionPrimary ring-offset-1',
            )}
            style={{ background: colour }}
          />
        ))}
      </div>
    </div>
  );
}

/** Pointer drags over an element as fractions of it, with capture, ending in `onEnd`. */
function useDrag(onMove: (x: number, y: number) => void, onEnd: () => void) {
  const dragging = useRef(false);
  const at = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    const y = rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0;
    onMove(x, y);
  };
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      // Only the main button (jsdom leaves `button` unset).
      if (event.button > 0) return;
      dragging.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.currentTarget.focus();
      at(event);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (dragging.current) at(event);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      onEnd();
    },
    onPointerCancel: () => {
      if (!dragging.current) return;
      dragging.current = false;
      onEnd();
    },
  };
}

export function ColorPicker({
  label,
  value,
  onChange,
  onCommit,
  opacity,
  onOpacityChange,
  onOpacityCommit,
  swatches = DEFAULT_SWATCHES,
  recent = [],
  disabled = false,
  id,
  className,
}: ColorPickerProps) {
  const current = parseHex(value) ?? '#000000';
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(current));
  const [hexText, setHexText] = useState(current);
  const latest = useRef(current);
  const hexId = useId();

  // A new value from outside resets the square, unless it is the colour already shown
  // (so dragging to black keeps its hue).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an outside change resets the shown hue
  useEffect(() => {
    if (hsvToHex(hsv) !== current) setHsv(hexToHsv(current));
    setHexText(current);
    latest.current = current;
  }, [current]);

  const set = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      setHexText(hex);
      if (hex !== latest.current) {
        latest.current = hex;
        onChange(hex);
      }
    },
    [onChange],
  );
  const commit = useCallback(() => onCommit?.(latest.current), [onCommit]);
  const pick = (hex: string) => {
    setHsv(hexToHsv(hex));
    setHexText(hex);
    latest.current = hex;
    onChange(hex);
    onCommit?.(hex);
  };

  const square = useDrag((x, y) => set({ h: hsv.h, s: x, v: 1 - y }), commit);
  const strip = useDrag((x) => set({ ...hsv, h: x * 360 }), commit);

  const onSquareKey = (event: React.KeyboardEvent) => {
    const step = stepOf(event) / 100;
    const moves: Record<string, Hsv> = {
      ArrowLeft: { ...hsv, s: clamp(hsv.s - step, 0, 1) },
      ArrowRight: { ...hsv, s: clamp(hsv.s + step, 0, 1) },
      ArrowUp: { ...hsv, v: clamp(hsv.v + step, 0, 1) },
      ArrowDown: { ...hsv, v: clamp(hsv.v - step, 0, 1) },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    set(next);
    commit();
  };
  const onStripKey = (event: React.KeyboardEvent) => {
    const step = stepOf(event);
    const h =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? clamp(hsv.h - step, 0, 360)
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? clamp(hsv.h + step, 0, 360)
          : null;
    if (h === null) return;
    event.preventDefault();
    set({ ...hsv, h });
    commit();
  };

  const typed = parseHex(hexText);
  const applyTyped = () => {
    if (typed) {
      if (typed !== latest.current) pick(typed);
      else setHexText(typed);
    }
  };
  const percent = Math.round((opacity ?? 1) * 100);

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-label={`${label}: ${current}`}
          className={cn(
            'flex h-11 w-full items-center gap-2 rounded-md border-2 border-outline bg-field px-3',
            'font-sans text-sm text-ink',
            FIELD_FOCUS,
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span
            aria-hidden
            className="h-6 w-6 shrink-0 rounded-sm border-2 border-outline"
            style={{ background: current, opacity: opacity ?? 1 }}
          />
          <span className="tabular-nums">{current}</span>
          {onOpacityChange ? (
            <span className="ml-auto tabular-nums type-muted">{percent}%</span>
          ) : null}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          aria-label={label}
          className={cn(
            'z-50 flex w-64 flex-col gap-3 rounded-lg border-2 border-outline bg-secondary p-3',
            'font-sans text-sm text-ink outline-none data-[state=open]:animate-fadeIn',
          )}
        >
          <SwatchGrid title="Colours" colours={swatches} value={current} onPick={pick} />
          <SwatchGrid title="Recent" colours={recent} value={current} onPick={pick} />

          <div
            role="slider"
            tabIndex={0}
            aria-label="Shade"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
            onKeyDown={onSquareKey}
            {...square}
            className={cn(
              'relative h-36 w-full cursor-crosshair touch-none rounded-md border-2 border-outline',
              'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            )}
            style={{
              background: `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #FFFFFF, transparent), ${hueHex(hsv.h)}`,
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-2 ring-black/60"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }}
            />
          </div>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            onKeyDown={onStripKey}
            {...strip}
            className={cn(
              'relative h-4 w-full cursor-pointer touch-none rounded-full border-2 border-outline',
              'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            )}
            style={{
              background:
                'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-outline"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex(hsv.h) }}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={hexId} className="type-label text-xs type-muted">
              Hex
            </label>
            <input
              id={hexId}
              value={hexText}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              placeholder="Enter your colour"
              aria-invalid={typed ? undefined : true}
              onChange={(event) => setHexText(event.target.value)}
              onBlur={applyTyped}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyTyped();
                }
              }}
              className={cn(
                'h-9 min-w-0 flex-1 rounded-md border-2 border-outline bg-field px-2 tabular-nums',
                FIELD_FOCUS,
                !typed && `border-actionDanger ${FIELD_FOCUS_ERROR}`,
              )}
            />
          </div>

          {onOpacityChange ? (
            <div className="flex items-center gap-2">
              <span className="type-label w-14 text-xs type-muted">Opacity</span>
              <Slider
                value={[percent]}
                min={0}
                max={100}
                step={1}
                onValueChange={([next]) => onOpacityChange((next ?? 100) / 100)}
                onValueCommit={([next]) => onOpacityCommit?.((next ?? 100) / 100)}
                thumbs={[{ 'aria-label': 'Opacity', 'aria-valuetext': `${percent}%` }]}
              />
              <span className="w-10 text-right tabular-nums text-xs">{percent}%</span>
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
