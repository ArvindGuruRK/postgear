/**
 * The look, the vignette and their filter text (Module 13, cookbook section 7).
 *
 * They run on the joined picture after the zoom and before the stickers, so
 * a sticker keeps its own colours and the text is never tinted.
 *
 * - The look is one `colorchannelmixer` on RGBA: the matrix's offset goes in
 *   the alpha column (`ra`, `ga`, `ba`), which against an alpha of 255 adds
 *   it, and the sum is clamped once, as the editor's `feColorMatrix` does
 *   (`effects/looks.ts`). A look at Strength 0 writes nothing.
 * - The vignette's angle is `v x PI/4` (a bigger angle darkens more). It runs
 *   in `gbrp`: there it multiplies each channel by `cos(angle x d)^4`, exactly
 *   what the editor's black gradient does (measured on 9.0.2 at `PI/4` on a
 *   flat 95,144,191: the corner 23,36,47, the side 70,106,141, the top
 *   34,51,68). On YUV it scales the raw luma code instead, so the same frame
 *   went to 7,21,31 in the corner and shifted the colour. A `format` before
 *   the filter is not enough: 9.0.2 negotiated YUV through it when the next
 *   filter wanted YUV, so the format is pinned after it too.
 * - The chain ends in `format=yuv420p` for the overlays and the encoder.
 */
import type { Looks } from '../document/schema';
import { type LookMatrix, lookMatrix, vignetteAngle } from '../effects/looks';
import { formatNumber } from './filter-text';

/** What the plan carries for the look: plain data the compiler writes. */
export interface PlanLook {
  /** Null when the look draws nothing (None, or Strength 0). */
  matrix: LookMatrix | null;
  /** Radians; 0 for no vignette. */
  vignetteAngle: number;
}

export function planLook(looks: Looks): PlanLook {
  return { matrix: lookMatrix(looks), vignetteAngle: vignetteAngle(looks.vignette) };
}

/** The look's matrix as one `colorchannelmixer` (run on RGBA). */
export function lookMixerFilter(matrix: LookMatrix): string {
  const n = formatNumber;
  const [r, g, b] = matrix;
  return (
    `colorchannelmixer=rr=${n(r[0])}:rg=${n(r[1])}:rb=${n(r[2])}:ra=${n(r[3])}` +
    `:gr=${n(g[0])}:gg=${n(g[1])}:gb=${n(g[2])}:ga=${n(g[3])}` +
    `:br=${n(b[0])}:bg=${n(b[1])}:bb=${n(b[2])}:ba=${n(b[3])}`
  );
}

/** The look's filters and the vignette, in order; empty when the clip has neither. */
export function lookFilters(look: PlanLook | undefined): string[] {
  if (!look) return [];
  const filters: string[] = [];
  // Each filter is pinned on both sides: FFmpeg 9.0.2 negotiates formats along the whole chain
  // and, with only `format=gbrp` before it, ran the vignette on YUV anyway.
  if (look.matrix) {
    filters.push('format=rgba', lookMixerFilter(look.matrix), 'format=rgba');
  }
  if (look.vignetteAngle > 0) {
    filters.push(
      'format=gbrp',
      `vignette=angle=${formatNumber(look.vignetteAngle)}`,
      'format=gbrp',
    );
  }
  if (filters.length > 0) filters.push('format=yuv420p');
  return filters;
}
