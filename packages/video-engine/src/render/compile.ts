/**
 * `compileFfmpeg(plan)`: a render plan to one FFmpeg command, as data.
 *
 * Strings in, strings out: no file access and no process. The graph is
 * written to `graph.txt` by the executor and passed as `-/filter_complex
 * graph.txt` (FFmpeg 9.0.2 has no `-filter_complex_script` and no `-vsync`).
 * Deterministic: the same plan gives the same text, so a render has a
 * fingerprint.
 *
 * The graph, in order (cookbook sections 1, 2, 7, 9 and 13):
 * 1. Per segment, picture: `trim` in the input's own time, the crop in source
 *    pixels (before `setpts`, so crops stay in source time), the scale to the
 *    area, the base (pad on a colour, or the blurred copy with `overlay
 *    format=yuv420 shortest=1`), `setpts=(PTS-STARTPTS)/S`, `fps`, `setsar=1`.
 * 2. Per segment, sound: `atrim`, `asetpts`, the segment's volume, the
 *    `atempo` chain (0.5 to 100 per filter), `aresample=48000` and a fixed
 *    stereo format; silence from `anullsrc` when the file has no sound.
 * 3. `concat`, then `fps` and `format=yuv420p`; the mark; the fades.
 * 4. `apad=whole_dur` with `-t` on the output, so the sound is exactly as long
 *    as the picture (an unpadded mix was one AAC frame short).
 */

import { buildAss } from './ass';
import type { PixelRect, PlanSegment, RenderPlan } from './plan';
import { type CompiledFfmpeg, type CompiledInput, msToSeconds } from './types';

/** A number for filter text: at most six decimals, no trailing zeros, never exponent form. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot write ${String(value)} into a filter graph`);
  }
  const fixed = value.toFixed(6);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * The `atempo` filters for a speed. One filter takes 0.5 to 100 only, so a
 * speed below 0.5 is a chain: 0.25 is `atempo=0.5,atempo=0.5`. Empty at 1x.
 */
export function atempoChain(speed: number): string[] {
  if (!(speed > 0) || !Number.isFinite(speed)) {
    throw new Error(`A speed must be a positive number, not ${String(speed)}`);
  }
  const chain: string[] = [];
  let remaining = speed;
  while (remaining < 0.5) {
    chain.push('atempo=0.5');
    remaining /= 0.5;
  }
  while (remaining > 100) {
    chain.push('atempo=100');
    remaining /= 100;
  }
  if (Math.abs(remaining - 1) > 1e-9) {
    chain.push(`atempo=${formatNumber(remaining)}`);
  }
  return chain;
}

/** `setpts` for a speed: the segment starts at 0 and plays `speed` times as fast. */
export function setptsFor(speed: number): string {
  return speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${formatNumber(speed)}`;
}

/** `#RRGGBB` as FFmpeg's `0xRRGGBB`. */
export function ffmpegColour(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`A colour is #RRGGBB, not ${hex}`);
  }
  return `0x${hex.slice(1).toUpperCase()}`;
}

function cropFilter(rect: PixelRect): string {
  return `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}:exact=1`;
}

const AUDIO_FORMAT =
  'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/** The labels a segment reads from: its input's streams, split when several segments share it. */
interface SegmentSources {
  video: string;
  audio: string | null;
}

function segmentPicture(segment: PlanSegment, source: string, plan: RenderPlan): string[] {
  const { area, base, fillsOutput } = segment.picture;
  const n = segment.index;
  const { width: outW, height: outH, fps } = plan.output;
  const trim = `trim=start=${msToSeconds(segment.trimStartMs)}:end=${msToSeconds(segment.trimEndMs)}`;
  const timing = `${setptsFor(segment.speed)},fps=${fps},setsar=1`;
  const areaChain = `${cropFilter(area.crop)},scale=${area.width}:${area.height}:flags=bicubic`;

  if (base.kind === 'colour') {
    const pad = fillsOutput
      ? ''
      : `,setsar=1,pad=${outW}:${outH}:${area.x}:${area.y}:color=${ffmpegColour(base.colour)}`;
    return [`${source}${trim},${areaChain}${pad},${timing}[v${n}]`];
  }

  return [
    `${source}${trim},split=2[vb${n}][vf${n}]`,
    `[vb${n}]${cropFilter(base.crop)},scale=${base.smallWidth}:${base.smallHeight}:flags=bilinear,` +
      `gblur=sigma=3:steps=2,scale=${outW}:${outH}:flags=bicubic,setsar=1[vbb${n}]`,
    `[vf${n}]${areaChain},setsar=1[vff${n}]`,
    `[vbb${n}][vff${n}]overlay=x=${area.x}:y=${area.y}:format=yuv420:shortest=1,${timing}[v${n}]`,
  ];
}

function segmentSound(segment: PlanSegment, source: string | null): string {
  const n = segment.index;
  if (source === null) {
    const seconds = msToSeconds(segment.outEndMs - segment.outStartMs);
    return `anullsrc=r=48000:cl=stereo,atrim=duration=${seconds},asetpts=PTS-STARTPTS,${AUDIO_FORMAT}[a${n}]`;
  }
  const parts = [
    `atrim=start=${msToSeconds(segment.trimStartMs)}:end=${msToSeconds(segment.trimEndMs)}`,
    'asetpts=PTS-STARTPTS',
  ];
  if (segment.volume !== 1) {
    parts.push(`volume=${formatNumber(segment.volume)}`);
  }
  parts.push(...atempoChain(segment.speed), AUDIO_FORMAT);
  return `${source}${parts.join(',')}[a${n}]`;
}

/**
 * The FFmpeg command for a plan: the inputs with their seeks, the graph text,
 * the ASS files and the output options (never the output name).
 */
export function compileFfmpeg(plan: RenderPlan): CompiledFfmpeg {
  if (plan.segments.length === 0) {
    throw new Error('A render plan needs at least one segment');
  }
  const { fps, durationMs } = plan.output;
  const lines: string[] = [];

  // Inputs shared by several segments are split once, so every label is used once.
  const sources = new Map<number, SegmentSources[]>();
  for (const input of plan.inputs) {
    const count = input.segmentCount;
    const list: SegmentSources[] = [];
    if (count <= 1) {
      list.push({
        video: `[${input.index}:v]`,
        audio: input.hasAudio ? `[${input.index}:a]` : null,
      });
    } else {
      const videoLabels = Array.from({ length: count }, (_, k) => `[i${input.index}v${k}]`);
      lines.push(`[${input.index}:v]split=${count}${videoLabels.join('')}`);
      let audioLabels: string[] = [];
      if (input.hasAudio) {
        audioLabels = Array.from({ length: count }, (_, k) => `[i${input.index}a${k}]`);
        lines.push(`[${input.index}:a]asplit=${count}${audioLabels.join('')}`);
      }
      videoLabels.forEach((video, k) => {
        list.push({ video, audio: input.hasAudio ? (audioLabels[k] as string) : null });
      });
    }
    sources.set(input.index, list);
  }

  const used = new Map<number, number>();
  for (const segment of plan.segments) {
    const list = sources.get(segment.inputIndex);
    const k = used.get(segment.inputIndex) ?? 0;
    const source = list?.[k];
    if (!source) {
      throw new Error(
        `Segment ${segment.id} reads input ${segment.inputIndex}, which has no stream left`,
      );
    }
    used.set(segment.inputIndex, k + 1);
    lines.push(...segmentPicture(segment, source.video, plan));
    lines.push(segmentSound(segment, source.audio));
  }

  const pairs = plan.segments.map((s) => `[v${s.index}][a${s.index}]`).join('');
  lines.push(`${pairs}concat=n=${plan.segments.length}:v=1:a=1[vc][ac]`);

  // Picture after the join: one more fps, yuv420p, then the mark, then the fades.
  const fadeFilters: string[] = [];
  const audioFades: string[] = [];
  if (plan.fades.inMs > 0) {
    fadeFilters.push(`fade=t=in:st=0:d=${msToSeconds(plan.fades.inMs)}`);
    audioFades.push(`afade=t=in:st=0:d=${msToSeconds(plan.fades.inMs)}`);
  }
  if (plan.fades.outMs > 0) {
    const start = msToSeconds(durationMs - plan.fades.outMs);
    fadeFilters.push(`fade=t=out:st=${start}:d=${msToSeconds(plan.fades.outMs)}`);
    audioFades.push(`afade=t=out:st=${start}:d=${msToSeconds(plan.fades.outMs)}`);
  }

  const mark = plan.watermark;
  if (mark) {
    lines.push(`[vc]fps=${fps},format=yuv420p[vj]`);
    lines.push(
      `[${mark.inputIndex}:v]scale=${mark.width}:${mark.height}:flags=bicubic,format=rgba,` +
        `colorchannelmixer=aa=${formatNumber(mark.opacity)}[wm]`,
    );
    const tail = fadeFilters.length > 0 ? `,${fadeFilters.join(',')}` : '';
    lines.push(`[vj][wm]overlay=x=${mark.x}:y=${mark.y}:format=yuv420:shortest=1${tail}[vout]`);
  } else {
    const tail = fadeFilters.length > 0 ? `,${fadeFilters.join(',')}` : '';
    lines.push(`[vc]fps=${fps},format=yuv420p${tail}[vout]`);
  }

  const audioTail = audioFades.length > 0 ? `${audioFades.join(',')},` : '';
  lines.push(`[ac]${audioTail}apad=whole_dur=${msToSeconds(durationMs)}[aout]`);

  const inputs: CompiledInput[] = plan.inputs.map((input) => ({
    file: input.file,
    seekMs: input.seekMs,
    options: [],
  }));
  if (mark) {
    inputs.push({
      file: mark.file,
      seekMs: null,
      options: ['-loop', '1', '-framerate', String(fps)],
    });
  }

  return {
    inputs,
    filterComplexScript: `${lines.join(';\n')}\n`,
    assFiles: buildAss(plan),
    outputArgs: outputArgsFor(plan),
    durationMs,
  };
}

/**
 * The encode options (cookbook section 9): H.264 High, yuv420p, constant
 * frame rate, a closed two second GOP, the index first, AAC 48 kHz stereo,
 * and `-t` the exact length. `-f mp4` because the executor writes to
 * `render.mp4.part`, whose name says nothing to FFmpeg.
 */
export function outputArgsFor(plan: RenderPlan): string[] {
  const { encode } = plan;
  const fps = plan.output.fps;
  const gop = String(fps * encode.gopSeconds);
  return [
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    encode.preset,
    '-crf',
    String(encode.crf),
    '-maxrate',
    `${encode.maxrateKbps}k`,
    '-bufsize',
    `${encode.maxrateKbps * 2}k`,
    '-g',
    gop,
    '-keyint_min',
    gop,
    '-sc_threshold',
    '0',
    '-r',
    String(fps),
    '-fps_mode',
    'cfr',
    '-c:a',
    'aac',
    '-b:a',
    `${encode.audioBitrateKbps}k`,
    '-ar',
    String(encode.audioSampleRate),
    '-ac',
    String(encode.audioChannels),
    '-t',
    msToSeconds(plan.output.durationMs),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
  ];
}
