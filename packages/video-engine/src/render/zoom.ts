/**
 * Zoom as filter text (Module 13, cookbook section 4): one `perspective` per
 * window of `zoomWindows`, run on the joined picture after the layout (so
 * every area zooms as one picture) and before the look, the stickers and the
 * text (so overlays never zoom).
 *
 * The recipe, measured on FFmpeg 9.0.2 on a 1080 by 1920 canvas with six
 * discs (mean error 0.30 px, worst 0.72 px, no jitter):
 * - The four source corners of the window `[F(1 - 1/Z), F + (C - F)/Z]` are
 *   stretched to the frame, so a point `p` shows at `F + (p - F) Z` and the
 *   focus never moves.
 * - `Z = 1 + (S - 1) u u (3 - 2u)`, `u = min(clip((TT - A)/D), clip((B - TT)/D))`,
 *   with `TT = (in - 1)/FPS`: `in` counts from 1 in 9.0.2 and `t` is not
 *   defined inside `perspective` (the wrong form was a frame late and up to
 *   49 px off).
 * - Always limited with `enable`: 5.4 s against 15.6 s for 180 frames with it
 *   on everywhere. An eased window is enabled 20 ms either side so the ease is
 *   covered; a Snap window (no ease) is enabled exactly over `[A, B)` and
 *   writes the constant `S`.
 * - `interpolation=linear` for Preview Export, `cubic` for the final export
 *   (about twice the cost inside the window).
 */
import { formatNumber } from './filter-text';
import { msToSeconds } from './types';

/** One zoom window as the plan carries it: clip ms and output pixels. */
export interface PlanZoom {
  id: string;
  startMs: number;
  /** Exclusive. */
  endMs: number;
  easeMs: number;
  scale: number;
  /** The focus point in output pixels. */
  focusX: number;
  focusY: number;
}

/** How far the `enable` window reaches past an eased zoom, in seconds. */
export const ZOOM_ENABLE_MARGIN_S = 0.02;

/** The `perspective` filter for one window. */
export function zoomFilter(
  zoom: PlanZoom,
  output: { width: number; height: number; fps: number },
  interpolation: 'linear' | 'cubic',
): string {
  const n = formatNumber;
  const a = msToSeconds(zoom.startMs);
  const b = msToSeconds(zoom.endMs);
  const fx = n(zoom.focusX);
  const fy = n(zoom.focusY);
  const rightOfFocus = n(output.width - zoom.focusX);
  const belowFocus = n(output.height - zoom.focusY);

  let z: string;
  let enable: string;
  if (zoom.easeMs > 0) {
    const d = msToSeconds(zoom.easeMs);
    const tt = `((in-1)/${output.fps})`;
    const u = `min(clip((${tt}-${a})/${d},0,1),clip((${b}-${tt})/${d},0,1))`;
    z = `(1+${n(zoom.scale - 1)}*${u}*${u}*(3-2*${u}))`;
    const from = n(Math.max(0, zoom.startMs / 1000 - ZOOM_ENABLE_MARGIN_S));
    const to = n(zoom.endMs / 1000 + ZOOM_ENABLE_MARGIN_S);
    enable = `between(t,${from},${to})`;
  } else {
    z = n(zoom.scale);
    enable = `gte(t,${a})*lt(t,${b})`;
  }
  const left = `${fx}-${fx}/${z}`;
  const right = `${fx}+${rightOfFocus}/${z}`;
  const top = `${fy}-${fy}/${z}`;
  const bottom = `${fy}+${belowFocus}/${z}`;
  return (
    `perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}'` +
    `:x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}'` +
    `:interpolation=${interpolation}:eval=frame:enable='${enable}'`
  );
}
