/**
 * The small writers every part of the FFmpeg graph shares: numbers, colours
 * and crops as filter text. Kept apart so the compiler (`compile.ts`) and the
 * layout graph (`layout-graph.ts`) both read them without importing each
 * other. `compile.ts` re-exports the public ones.
 */
import type { PixelRect } from './plan';

/** A number for filter text: at most six decimals, no trailing zeros, never exponent form. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot write ${String(value)} into a filter graph`);
  }
  const fixed = value.toFixed(6);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/** `#RRGGBB` as FFmpeg's `0xRRGGBB`. */
export function ffmpegColour(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`A colour is #RRGGBB, not ${hex}`);
  }
  return `0x${hex.slice(1).toUpperCase()}`;
}

/** An exact crop in source pixels. */
export function cropFilter(rect: PixelRect): string {
  return `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}:exact=1`;
}
