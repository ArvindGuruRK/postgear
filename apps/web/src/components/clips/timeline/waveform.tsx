'use client';

/**
 * The sound's shape (Module 07, section 2): one `<canvas>` of mirrored bars
 * from the peaks file, drawn for the time it covers and nothing else.
 *
 * One bar per CSS pixel column (or per peak, when zoomed in past one peak a
 * pixel), the loudest peak of that column, mirrored around the middle. The
 * colour is the canvas's own `currentColor`, so it follows the theme. While
 * the peaks load, or when there is no sound, a flat line is drawn.
 */
import { cn } from '@postgear/ui';
import { useEffect, useRef } from 'react';
import type { ClipWaveform } from '@/types/clips';
import { prepareCanvas, usePeaks } from './timeline-media';

export function Waveform({
  waveform,
  fromMs,
  toMs,
  pxPerMs,
  widthPx,
  heightPx,
  className,
  style,
}: {
  waveform: ClipWaveform | null;
  fromMs: number;
  toMs: number;
  pxPerMs: number;
  widthPx: number;
  heightPx: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const peaks = usePeaks(waveform?.url ?? null);
  const perSecond = waveform?.meta.perSecond ?? 0;

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const frame = requestAnimationFrame(() => {
      const context = prepareCanvas(node, widthPx, heightPx);
      if (!context) return;
      context.fillStyle = getComputedStyle(node).color || '#000';
      const middle = heightPx / 2;
      if (!peaks || peaks.length === 0 || !(perSecond > 0) || !(pxPerMs > 0) || !(toMs > fromMs)) {
        context.fillRect(0, middle - 0.5, widthPx, 1);
        return;
      }
      const msPerPeak = 1000 / perSecond;
      const peakPx = msPerPeak * pxPerMs;
      // A bar per pixel column, or per peak when a peak is wider than a pixel.
      const barPx = Math.max(1, peakPx);
      const gap = barPx >= 4 ? 1 : 0;
      for (let x = 0; x < widthPx; x += barPx) {
        const startMs = fromMs + x / pxPerMs;
        const endMs = fromMs + (x + barPx) / pxPerMs;
        const first = Math.max(0, Math.floor(startMs / msPerPeak));
        const last = Math.min(peaks.length - 1, Math.ceil(endMs / msPerPeak) - 1);
        let loudest = 0;
        for (let index = first; index <= last; index += 1) {
          const value = peaks[index] ?? 0;
          if (value > loudest) loudest = value;
        }
        const half = Math.max(0.5, (loudest / 255) * (middle - 1));
        context.fillRect(x, middle - half, Math.max(1, barPx - gap), half * 2);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [peaks, perSecond, fromMs, toMs, pxPerMs, widthPx, heightPx]);

  return (
    // Drawn, not read: hidden from screen readers by its wrapper, which makes no box of its own.
    <span aria-hidden="true" className="contents">
      <canvas
        ref={canvas}
        className={cn('pointer-events-none block text-ink', className)}
        style={{ width: widthPx, height: heightPx, ...style }}
      />
    </span>
  );
}
