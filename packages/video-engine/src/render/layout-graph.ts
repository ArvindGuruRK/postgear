/**
 * `layoutGraph`: one segment's picture as FFmpeg filter text, for every
 * layout (research 09, section 2, each recipe run on FFmpeg 9.0.2).
 *
 * The plan has already turned every fraction into output pixels (even sizes,
 * even positions, the radius scaled to the output); this file only writes
 * those numbers. Strings in, strings out.
 *
 * The parts:
 * - **Base**. The Blurred base splits the picture, crops a canvas-shaped
 *   part, scales it to a tenth of the output (even), blurs it with
 *   `gblur=sigma=3:steps=2` and scales it back up: a small blur, so it costs
 *   almost nothing and no companion file is made. A solid base is the first
 *   area padded onto the canvas colour (no base at all when that area covers
 *   the output), or, when the first area is rounded, a 2 by 2 corner of the
 *   picture padded and filled with the colour. Every base is made from the
 *   segment's own picture so its frames carry the video's timestamps (a
 *   `color` source would start at 0 while the trimmed video starts later).
 * - **Areas**. `crop` first and `scale` second, so the scaled picture stays
 *   small; `setsar=1`. A contain area is already sized and placed by the plan
 *   (centred inside its frame), so it is drawn like a cover one.
 * - **Rounded corners**. The area is made `yuv420p`, an anti-aliased alpha
 *   mask is drawn once with `geq` on a short grey `color` source, looped
 *   forever with `loop=loop=-1:size=1:start=0`, and joined with `alphamerge`.
 *   The main picture never becomes `rgba`.
 * - **Overlays**. Every `overlay` carries `format=yuv420` (an `rgba` or
 *   `auto` overlay made the same graph 2.4 times slower) and `shortest=1`
 *   (the looped mask is infinite; without it the Gameplay graph never ended).
 *
 * A single square-cornered area keeps Module 05's exact text (a `pad` on a
 * colour, or the Blurred `split`), so those renders did not change.
 */
import { cropFilter, ffmpegColour } from './filter-text';
import type { PlanArea, PlanSegment, RenderPlan } from './plan';

/** The parts of a segment's chain the compiler writes around the picture. */
export interface SegmentChain {
  /** `trim=start=...:end=...` in the input's own time. */
  trim: string;
  /** `setpts=...,fps=...,setsar=1`: written after the picture is composed. */
  timing: string;
}

/** `crop`, then `scale` to the area's output size. */
function areaScale(area: PlanArea): string {
  return `${cropFilter(area.crop)},scale=${area.width}:${area.height}:flags=bicubic`;
}

/**
 * The anti-aliased rounded-corner mask of a `width` by `height` box with a
 * corner `radius`, as a `geq` luma expression (cookbook section 2): 255
 * inside, 0 outside, a one pixel soft edge on the curve.
 */
export function roundedMaskExpression(width: number, height: number, radius: number): string {
  const hw = width / 2;
  const hh = height / 2;
  return (
    `clip((${radius}-hypot(max(abs(X-${hw}+0.5)-${hw - radius},0),` +
    `max(abs(Y-${hh}+0.5)-${hh - radius},0)))+0.5,0,1)*255`
  );
}

/** The looped mask chain for one rounded area, labelled `label`. */
export function roundedMaskChain(area: PlanArea, fps: number, label: string): string {
  const expression = roundedMaskExpression(area.width, area.height, area.radius);
  return (
    `color=c=gray:s=${area.width}x${area.height}:r=${fps}:d=0.04,format=gray,` +
    `geq=lum='${expression}',loop=loop=-1:size=1:start=0,setpts=N/(${fps}*TB)${label}`
  );
}

/** One overlay, with the two rules every overlay follows. */
export function overlayFilter(x: number, y: number): string {
  return `overlay=x=${x}:y=${y}:format=yuv420:shortest=1`;
}

/** The single-area picture Module 05 wrote; kept byte for byte. */
function singleAreaGraph(
  segment: PlanSegment,
  source: string,
  plan: RenderPlan,
  chain: SegmentChain,
): string[] {
  const { base, fillsOutput } = segment.picture;
  const area = segment.picture.areas[0] as PlanArea;
  const n = segment.index;
  const { width: outW, height: outH } = plan.output;
  const areaChain = areaScale(area);

  if (base.kind === 'colour') {
    const pad = fillsOutput
      ? ''
      : `,setsar=1,pad=${outW}:${outH}:${area.x}:${area.y}:color=${ffmpegColour(base.colour)}`;
    return [`${source}${chain.trim},${areaChain}${pad},${chain.timing}[v${n}]`];
  }

  return [
    `${source}${chain.trim},split=2[vb${n}][vf${n}]`,
    `[vb${n}]${cropFilter(base.crop)},scale=${base.smallWidth}:${base.smallHeight}:flags=bilinear,` +
      `gblur=sigma=3:steps=2,scale=${outW}:${outH}:flags=bicubic,setsar=1[vbb${n}]`,
    `[vf${n}]${areaChain},setsar=1[vff${n}]`,
    `[vbb${n}][vff${n}]${overlayFilter(area.x, area.y)},${chain.timing}[v${n}]`,
  ];
}

/**
 * The picture of one segment, ending in `[v<n>]`: the base, every area in
 * order (bottom first), and the timing filters after the last overlay.
 */
export function layoutGraph(
  segment: PlanSegment,
  source: string,
  plan: RenderPlan,
  chain: SegmentChain,
): string[] {
  const { base, areas, fillsOutput } = segment.picture;
  const first = areas[0];
  if (!first) {
    throw new Error(`Segment ${segment.id} has no area to draw`);
  }
  if (areas.length === 1 && first.radius === 0) {
    return singleAreaGraph(segment, source, plan, chain);
  }

  const n = segment.index;
  const { width: outW, height: outH, fps } = plan.output;
  const lines: string[] = [];

  // Which areas are drawn by overlay: all of them, unless the first one is the base.
  const firstIsBase = base.kind === 'colour' && first.radius === 0;
  const overlaid = firstIsBase ? areas.slice(1) : areas;
  const streams = overlaid.length + 1;
  const labels = Array.from({ length: streams }, (_, k) => `[l${n}s${k}]`);
  lines.push(`${source}${chain.trim},split=${streams}${labels.join('')}`);

  // The base, from the first stream.
  const baseIn = labels[0] as string;
  const baseLabel = `[l${n}b]`;
  if (base.kind === 'blurred') {
    lines.push(
      `${baseIn}${cropFilter(base.crop)},scale=${base.smallWidth}:${base.smallHeight}:flags=bilinear,` +
        `gblur=sigma=3:steps=2,scale=${outW}:${outH}:flags=bicubic,setsar=1${baseLabel}`,
    );
  } else if (firstIsBase) {
    const pad = fillsOutput
      ? ''
      : `,pad=${outW}:${outH}:${first.x}:${first.y}:color=${ffmpegColour(base.colour)}`;
    lines.push(`${baseIn}${areaScale(first)},setsar=1${pad}${baseLabel}`);
  } else {
    const colour = ffmpegColour(base.colour);
    lines.push(
      `${baseIn}crop=2:2:0:0:exact=1,setsar=1,pad=${outW}:${outH}:0:0:color=${colour},` +
        `drawbox=x=0:y=0:w=2:h=2:color=${colour}:t=fill${baseLabel}`,
    );
  }

  // Each overlaid area: its own stream, cropped and scaled, rounded when asked.
  const areaLabels = overlaid.map((area, i) => {
    const k = i + 1;
    const input = labels[k] as string;
    const out = `[l${n}a${k}]`;
    if (area.radius > 0) {
      const square = `[l${n}r${k}]`;
      const mask = `[l${n}m${k}]`;
      lines.push(`${input}${areaScale(area)},setsar=1,format=yuv420p${square}`);
      lines.push(roundedMaskChain(area, fps, mask));
      lines.push(`${square}${mask}alphamerge=shortest=1${out}`);
    } else {
      lines.push(`${input}${areaScale(area)},setsar=1${out}`);
    }
    return out;
  });

  // The overlays, bottom first; the last one carries the timing.
  if (areaLabels.length === 0) {
    // Only reachable with one area on a colour base, which the single-area path takes.
    throw new Error(`Segment ${segment.id} has nothing to draw over its base`);
  }
  let previous = baseLabel;
  overlaid.forEach((area, i) => {
    const last = i === overlaid.length - 1;
    const out = last ? `[v${n}]` : `[l${n}o${i + 1}]`;
    const tail = last ? `,${chain.timing}` : '';
    lines.push(`${previous}${areaLabels[i]}${overlayFilter(area.x, area.y)}${tail}${out}`);
    previous = out;
  });
  return lines;
}
