'use client';

/**
 * The filmstrip (Module 07, section 2): one `<canvas>` that draws the small
 * pictures for the time it covers, and nothing else.
 *
 * The canvas covers `fromMs` to `toMs` of the video at `pxPerMs` (the caller
 * places it, usually over the visible part of a row). Slots are one picture
 * wide at the row's height and are laid on a grid fixed to the video's time,
 * so pictures stay put under the playhead while scrolling instead of
 * sliding. Sheets load lazily through their signed addresses; the canvas
 * draws again once one arrives. All drawing goes through one
 * `requestAnimationFrame`.
 */
import { cn } from '@postgear/ui';
import { filmstripSlots } from '@postgear/video-engine';
import { useEffect, useRef } from 'react';
import type { ClipFilmstrip } from '@/types/clips';
import { forgetSheetWaiter, prepareCanvas, sheetImage } from './timeline-media';

export function Filmstrip({
  strip,
  fromMs,
  toMs,
  pxPerMs,
  widthPx,
  heightPx,
  className,
  style,
}: {
  strip: ClipFilmstrip | null;
  fromMs: number;
  toMs: number;
  pxPerMs: number;
  widthPx: number;
  heightPx: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const waiting = new Set<string>();

    const draw = () => {
      frame.current = null;
      const context = prepareCanvas(node, widthPx, heightPx);
      if (!context || !strip || !(pxPerMs > 0) || !(toMs > fromMs)) return;
      const { meta, sheets } = strip;
      const slotWidth = Math.max(8, (heightPx * meta.tileWidth) / Math.max(1, meta.tileHeight));
      const slotMs = slotWidth / pxPerMs;
      const start = Math.floor(fromMs / slotMs) * slotMs;
      const shift = (fromMs - start) * pxPerMs;
      for (const slot of filmstripSlots(meta, start, toMs, pxPerMs, slotWidth)) {
        const url = sheets[slot.tile.sheet];
        if (!url) continue;
        const image = sheetImage(url, schedule);
        if (!image) {
          waiting.add(url);
          continue;
        }
        const x = slot.offsetPx - shift;
        // Cover the slot with the tile, cut to the slot's own shape.
        const scale = heightPx / meta.tileHeight;
        const sourceWidth = Math.min(meta.tileWidth, slot.widthPx / scale);
        context.drawImage(
          image,
          slot.tile.x,
          slot.tile.y,
          sourceWidth,
          meta.tileHeight,
          x,
          0,
          sourceWidth * scale,
          heightPx,
        );
      }
    };

    function schedule() {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(draw);
    }

    schedule();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      for (const url of waiting) forgetSheetWaiter(url, schedule);
    };
  }, [strip, fromMs, toMs, pxPerMs, widthPx, heightPx]);

  return (
    // Drawn, not read: hidden from screen readers by its wrapper, which makes no box of its own.
    <span aria-hidden="true" className="contents">
      <canvas
        ref={canvas}
        className={cn('pointer-events-none block', className)}
        style={{ width: widthPx, height: heightPx, ...style }}
      />
    </span>
  );
}
