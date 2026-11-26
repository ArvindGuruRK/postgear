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
 * 1. Per segment, picture: `trim` in the input's own time, then the layout
 *    graph (`layout-graph.ts`: the base, one crop and scale per area in
 *    source pixels, before `setpts` so crops stay in source time, rounded
 *    masks, every overlay `format=yuv420 shortest=1`), then
 *    `setpts=(PTS-STARTPTS)/S`, `fps`, `setsar=1`.
 * 2. Per segment, sound: `atrim`, `asetpts`, the segment's volume, the
 *    `atempo` chain (0.5 to 100 per filter), `aresample=48000` and a fixed
 *    stereo format; silence from `anullsrc` when the file has no sound.
 * 3. `concat`, then `fps` and `format=yuv420p`; one `perspective` per zoom
 *    window and the look's colour filters and vignette (Module 13, `zoom.ts`
 *    and `looks.ts`), so every area zooms and tints as one picture and no
 *    overlay is touched; the stickers (Module 12),
 *    each an overlay of its own input (scaled, flipped, turned with
 *    transparent corners, made see-through, shifted to start at its item);
 *    the text (one `ass` filter); the mark; the fades.
 * 4. The sound (Module 14, cookbook section 8): with sound effects or music,
 *    a silent `anullsrc` base of the clip's exact length, the video's own
 *    sound and one chain per sound go into `amix` (`normalize=0`, so every
 *    gain stays as set; `duration=first`, so the base fixes the length).
 *    Then the clip's fades, the loudness correction when the measuring pass
 *    asked for one (`loudness.ts`), back to 48 kHz, and `apad=whole_dur`
 *    with `-t` on the output, so the sound is exactly as long as the picture
 *    (an unpadded mix was one AAC frame short).
 *
 * `compileMeasure(plan)` is the measuring pass: the same sound graph alone,
 * ending in `loudnorm`'s JSON print, to `-f null -`.
 */

import { ASS_FILE, buildAss } from './ass';
import { FONTS_DIR } from './fonts';
import { ffmpegColour, formatNumber } from './filter-text';
import { layoutGraph } from './layout-graph';
import { type LoudnessDecision, loudnormApplyFilter, loudnormMeasureFilter } from './loudness';
import { lookFilters } from './looks';
import type { PlanSegment, RenderPlan } from './plan';
import { type PlanSound, planHasSound } from './sound-plan';
import type { PlanSticker } from './sticker-plan';
import { type CompiledFfmpeg, type CompiledInput, msToSeconds } from './types';
import { zoomFilter } from './zoom';

export { ffmpegColour, formatNumber };

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

const AUDIO_FORMAT =
  'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/** The labels a segment reads from: its input's streams, split when several segments share it. */
interface SegmentSources {
  video: string;
  audio: string | null;
}

/** One segment's picture: the layout graph between its `trim` and its timing filters. */
function segmentPicture(segment: PlanSegment, source: string, plan: RenderPlan): string[] {
  const trim = `trim=start=${msToSeconds(segment.trimStartMs)}:end=${msToSeconds(segment.trimEndMs)}`;
  const timing = `${setptsFor(segment.speed)},fps=${plan.output.fps},setsar=1`;
  return layoutGraph(segment, source, plan, { trim, timing });
}

/**
 * Sprint 13, Module 04: the fade at a cut. A join of two segments that do
 * not follow each other in the file (a cut out of the middle, or another
 * video) gets a 15 ms fade out before it and a 15 ms fade in after it, so it
 * never clicks (research 09 sections 6 and 11: the largest step at an
 * unfaded join was 25 times the tone's own; faded, it was normal). The
 * clip's own start and end get none here (the clip's fades are separate),
 * and a piece too short for two whole fades fades over a third of itself.
 * A join inside one run (a speed change) is continuous and is left alone.
 */
export const CUT_FADE_MS = 15;

export interface CutFades {
  inMs: number;
  outMs: number;
}

/** The fades each segment's sound gets at its cuts, by segment place. */
export function cutFades(plan: Pick<RenderPlan, 'segments'>): CutFades[] {
  const { segments } = plan;
  return segments.map((segment, k) => {
    const length = segment.outEndMs - segment.outStartMs;
    const fade = Math.min(CUT_FADE_MS, length / 3);
    const previous = segments[k - 1];
    const next = segments[k + 1];
    return {
      inMs: previous && previous.inputIndex !== segment.inputIndex ? fade : 0,
      outMs: next && next.inputIndex !== segment.inputIndex ? fade : 0,
    };
  });
}

/** Fade lengths go into the graph in whole microseconds (`1.5` ms is `0.0015`). */
function fadeSeconds(ms: number): string {
  return formatNumber(Math.round(ms * 1000) / 1_000_000);
}

function segmentSound(
  segment: PlanSegment,
  source: string | null,
  fades: CutFades = { inMs: 0, outMs: 0 },
): string {
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
  if (fades.inMs > 0) parts.push(`afade=t=in:st=0:d=${fadeSeconds(fades.inMs)}`);
  if (fades.outMs > 0) {
    const length = segment.outEndMs - segment.outStartMs;
    parts.push(`afade=t=out:st=${fadeSeconds(length - fades.outMs)}:d=${fadeSeconds(fades.outMs)}`);
  }
  return `${source}${parts.join(',')}[a${n}]`;
}

/**
 * One sound's chain, from its input to the mix (cookbook section 8): cut to
 * the time it plays, 48 kHz stereo, its volume, its own fades (straight
 * lines, as `soundGainAt` draws them; the fade out ends where the item ends,
 * even when an effect's file ends sooner), then delayed to its start in
 * whole ms on both channels. A sound that plays straight reads its file from
 * `offsetMs` (the input's seek); music that runs past its file's end repeats
 * the decoded file with `aloop` and cuts from `offsetMs`.
 */
export function soundChain(sound: PlanSound, label: string): string {
  const parts: string[] = [];
  if (sound.wraps) {
    parts.push(
      'aloop=loop=-1:size=2147483647:start=0',
      `atrim=start=${msToSeconds(sound.offsetMs)}:duration=${msToSeconds(sound.durationMs)}`,
    );
  } else {
    parts.push(`atrim=duration=${msToSeconds(sound.durationMs)}`);
  }
  parts.push('asetpts=PTS-STARTPTS', AUDIO_FORMAT);
  if (sound.volume !== 1) parts.push(`volume=${formatNumber(sound.volume)}`);
  if (sound.fadeInMs > 0) parts.push(`afade=t=in:st=0:d=${msToSeconds(sound.fadeInMs)}`);
  if (sound.fadeOutMs > 0) {
    const start = msToSeconds(sound.itemMs - sound.fadeOutMs);
    parts.push(`afade=t=out:st=${start}:d=${msToSeconds(sound.fadeOutMs)}`);
  }
  const delay = Math.round(sound.startMs);
  if (delay > 0) parts.push(`adelay=${delay}|${delay}`);
  return `[${sound.inputIndex}:a]${parts.join(',')}${label}`;
}

/** The clip's own fades on the sound: the same times as the picture's. */
function soundFades(plan: RenderPlan): string[] {
  const fades: string[] = [];
  if (plan.fades.inMs > 0) fades.push(`afade=t=in:st=0:d=${msToSeconds(plan.fades.inMs)}`);
  if (plan.fades.outMs > 0) {
    const start = msToSeconds(plan.output.durationMs - plan.fades.outMs);
    fades.push(`afade=t=out:st=${start}:d=${msToSeconds(plan.fades.outMs)}`);
  }
  return fades;
}

/**
 * The mix after the join: the base, the video's own sound (`from`) and every
 * sound into `amix`, then the clip's fades, as the label `[am]`. With no
 * sound items it is the video's sound with the fades.
 */
function mixLines(plan: RenderPlan, from: string): string[] {
  const fades = soundFades(plan);
  const sounds = plan.sounds ?? [];
  if (sounds.length === 0) {
    return [`${from}${fades.length > 0 ? fades.join(',') : 'anull'}[am]`];
  }
  const lines = [
    `anullsrc=r=48000:cl=stereo,atrim=duration=${msToSeconds(plan.output.durationMs)},asetpts=PTS-STARTPTS,${AUDIO_FORMAT}[abase]`,
  ];
  const labels = sounds.map((_, k) => `[as${k}]`);
  sounds.forEach((sound, k) => {
    lines.push(soundChain(sound, labels[k] as string));
  });
  const tail = fades.length > 0 ? `,${fades.join(',')}` : '';
  lines.push(
    `[abase]${from}${labels.join('')}amix=inputs=${sounds.length + 2}:normalize=0:duration=first:dropout_transition=0${tail}[am]`,
  );
  return lines;
}

/** The inputs after the video's: stickers, the mark, then the sounds, each checked against its index. */
function extraInputs(plan: RenderPlan, inputs: CompiledInput[]): void {
  for (const sticker of plan.stickers ?? []) {
    if (sticker.inputIndex !== inputs.length) {
      throw new Error(
        `Sticker ${sticker.id} reads input ${sticker.inputIndex}, not ${inputs.length}`,
      );
    }
    inputs.push({ file: sticker.file, seekMs: null, options: [] });
  }
  const mark = plan.watermark;
  if (mark) {
    inputs.push({
      file: mark.file,
      seekMs: null,
      options: ['-loop', '1', '-framerate', String(plan.output.fps)],
    });
  }
  for (const sound of plan.sounds ?? []) {
    if (sound.inputIndex !== inputs.length) {
      throw new Error(`Sound ${sound.id} reads input ${sound.inputIndex}, not ${inputs.length}`);
    }
    const seek = !sound.wraps && sound.offsetMs > 0 ? sound.offsetMs : null;
    inputs.push({ file: sound.file, seekMs: seek, options: [] });
  }
}

/** How the main render treats the sound's loudness (`decideLoudness`); none leaves it as mixed. */
export interface CompileOptions {
  loudness?: LoudnessDecision | null;
}

/**
 * The measuring pass (Module 14): the inputs, the video's sound joined, the
 * mix and the clip's fades, ending in `loudnorm`'s JSON print, mapped to
 * `-f null`. Null when the clip has no sound at all (nothing to measure).
 * The executor runs it with `-` as the output, at the `info` log level.
 */
export function compileMeasure(plan: RenderPlan): CompiledFfmpeg | null {
  if (plan.segments.length === 0 || !planHasSound(plan)) return null;
  const lines: string[] = [];
  const audio = new Map<number, Array<string | null>>();
  for (const input of plan.inputs) {
    const count = input.segmentCount;
    if (!input.hasAudio) {
      audio.set(
        input.index,
        Array.from({ length: Math.max(1, count) }, () => null),
      );
    } else if (count <= 1) {
      audio.set(input.index, [`[${input.index}:a]`]);
    } else {
      const labels = Array.from({ length: count }, (_, k) => `[i${input.index}a${k}]`);
      lines.push(`[${input.index}:a]asplit=${count}${labels.join('')}`);
      audio.set(input.index, labels);
    }
  }
  const used = new Map<number, number>();
  const fades = cutFades(plan);
  plan.segments.forEach((segment, place) => {
    const k = used.get(segment.inputIndex) ?? 0;
    used.set(segment.inputIndex, k + 1);
    lines.push(segmentSound(segment, audio.get(segment.inputIndex)?.[k] ?? null, fades[place]));
  });
  const pairs = plan.segments.map((s) => `[a${s.index}]`).join('');
  lines.push(`${pairs}concat=n=${plan.segments.length}:v=0:a=1[ac]`);
  lines.push(...mixLines(plan, '[ac]'));
  lines.push(`[am]${loudnormMeasureFilter()}[aout]`);

  const inputs: CompiledInput[] = plan.inputs.map((input) => ({
    file: input.file,
    seekMs: input.seekMs,
    options: [],
  }));
  extraInputs(plan, inputs);
  return {
    inputs,
    filterComplexScript: `${lines.join(';\n')}\n`,
    assFiles: [],
    outputArgs: ['-map', '[aout]', '-f', 'null'],
    durationMs: plan.output.durationMs,
    fonts: null,
    logLevel: 'info',
  };
}

/**
 * One sticker's picture chain, from its input to the overlay (cookbook
 * section 5): RGBA, scaled to its even size, flipped, turned in a box the
 * size of its diagonal with transparent corners (`c=none`, a positive angle
 * is clockwise), its opacity, then its timing.
 *
 * - A still picture is drawn once and repeated by `loop`, so the scale and
 *   the turn run once, not every frame.
 * - A moving one is timed by its frame number at its own constant rate
 *   (`N / fps`, from the item's start), the same rule as `stickerFrameAt`.
 *   A looping one repeats its frames with `loop` before the scale, so what
 *   is kept is the normalised picture (at most `STICKER_FRAMES_MAX` frames
 *   of 512 px), never the output size. `-stream_loop -1` is not used: on
 *   FFmpeg 9.0.2 it makes the APNG decoder fail on the second pass and the
 *   render never ends (found by the sticker parity test).
 */
export function stickerChain(sticker: PlanSticker, fps: number): string {
  const parts = ['format=rgba'];
  if (sticker.animated && sticker.loop) {
    parts.push(`loop=loop=-1:size=${sticker.frames ?? 1}:start=0`);
  }
  parts.push(`scale=${sticker.width}:${sticker.height}:flags=bicubic`);
  if (sticker.flipX) parts.push('hflip');
  if (sticker.rotationDeg !== 0) {
    const radians = formatNumber((sticker.rotationDeg * Math.PI) / 180);
    parts.push(`rotate=a=${radians}:c=none:ow=${sticker.boxWidth}:oh=${sticker.boxHeight}`);
  }
  if (sticker.opacity < 1) parts.push(`colorchannelmixer=aa=${formatNumber(sticker.opacity)}`);
  if (sticker.animated) {
    parts.push(
      `setpts=N/(${formatNumber(sticker.fps ?? fps)}*TB)+${msToSeconds(sticker.startMs)}/TB`,
    );
  } else {
    parts.push('loop=loop=-1:size=1:start=0', `setpts=N/(${fps}*TB)`);
  }
  return parts.join(',');
}

/**
 * The overlay that draws one sticker inside its window (`B` is a millisecond
 * before its end). A still or looping sticker is an endless stream, so
 * `shortest=1` ends it with the picture; one that plays once is not, and
 * its last frame stays (the default `eof_action`) until the window closes.
 */
export function stickerOverlay(sticker: PlanSticker): string {
  const from = msToSeconds(sticker.startMs);
  const to = msToSeconds(Math.max(sticker.startMs, sticker.endMs - 1));
  const endless = !sticker.animated || sticker.loop;
  return (
    `overlay=x=${sticker.x}:y=${sticker.y}:enable='between(t,${from},${to})'` +
    `${endless ? ':shortest=1' : ''}:format=yuv420`
  );
}

/**
 * The FFmpeg command for a plan: the inputs with their seeks, the graph text,
 * the ASS files and the output options (never the output name).
 */
export function compileFfmpeg(plan: RenderPlan, options: CompileOptions = {}): CompiledFfmpeg {
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
  const fades = cutFades(plan);
  for (const [place, segment] of plan.segments.entries()) {
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
    lines.push(segmentSound(segment, source.audio, fades[place]));
  }

  const pairs = plan.segments.map((s) => `[v${s.index}][a${s.index}]`).join('');
  lines.push(`${pairs}concat=n=${plan.segments.length}:v=1:a=1[vc][ac]`);

  // Picture after the join: one more fps, yuv420p, then the mark, then the fades.
  const fadeFilters: string[] = [];
  if (plan.fades.inMs > 0) {
    fadeFilters.push(`fade=t=in:st=0:d=${msToSeconds(plan.fades.inMs)}`);
  }
  if (plan.fades.outMs > 0) {
    const start = msToSeconds(durationMs - plan.fades.outMs);
    fadeFilters.push(`fade=t=out:st=${start}:d=${msToSeconds(plan.fades.outMs)}`);
  }

  // The joined picture: the zooms (every area as one picture), then the look and the vignette.
  const interpolation = plan.proof ? 'linear' : 'cubic';
  const joined = [
    `fps=${fps}`,
    'format=yuv420p',
    ...(plan.zooms ?? []).map((zoom) => zoomFilter(zoom, plan.output, interpolation)),
    ...lookFilters(plan.look),
  ];

  // Stickers draw on the joined picture, bottom first, after the layout and before the text.
  const stickers = plan.stickers ?? [];
  let picture = '[vc]';
  const pictureFilters: string[] = [];
  if (stickers.length > 0) {
    lines.push(`[vc]${joined.join(',')}[sp0]`);
    stickers.forEach((sticker, k) => {
      lines.push(`[${sticker.inputIndex}:v]${stickerChain(sticker, fps)}[st${k}]`);
      lines.push(`[sp${k}][st${k}]${stickerOverlay(sticker)}[sp${k + 1}]`);
    });
    picture = `[sp${stickers.length}]`;
  } else {
    pictureFilters.push(...joined);
  }

  // The text is burned in last on the picture, after stickers and looks, before the mark and the fades.
  const assFiles = buildAss(plan);
  if (assFiles.length > 0) {
    pictureFilters.push(`ass=filename=${ASS_FILE}:fontsdir=${plan.fonts.dir ?? FONTS_DIR}`);
  }
  const chain = (filters: string[]): string => (filters.length > 0 ? filters.join(',') : 'null');

  const mark = plan.watermark;
  if (mark) {
    lines.push(`${picture}${chain(pictureFilters)}[vj]`);
    lines.push(
      `[${mark.inputIndex}:v]scale=${mark.width}:${mark.height}:flags=bicubic,format=rgba,` +
        `colorchannelmixer=aa=${formatNumber(mark.opacity)}[wm]`,
    );
    const tail = fadeFilters.length > 0 ? `,${fadeFilters.join(',')}` : '';
    lines.push(`[vj][wm]overlay=x=${mark.x}:y=${mark.y}:format=yuv420:shortest=1${tail}[vout]`);
  } else {
    lines.push(`${picture}${chain([...pictureFilters, ...fadeFilters])}[vout]`);
  }

  // The sound: the mix (when there are sound items), the clip's fades, the loudness correction, the pad.
  const pad = `apad=whole_dur=${msToSeconds(durationMs)}`;
  const correct = options.loudness?.apply
    ? `${loudnormApplyFilter(options.loudness.measured)},${AUDIO_FORMAT},`
    : '';
  if ((plan.sounds ?? []).length === 0 && !correct) {
    const fades = soundFades(plan);
    const audioTail = fades.length > 0 ? `${fades.join(',')},` : '';
    lines.push(`[ac]${audioTail}${pad}[aout]`);
  } else {
    lines.push(...mixLines(plan, '[ac]'));
    lines.push(`[am]${correct}${pad}[aout]`);
  }

  const inputs: CompiledInput[] = plan.inputs.map((input) => ({
    file: input.file,
    seekMs: input.seekMs,
    options: [],
  }));
  extraInputs(plan, inputs);

  return {
    inputs,
    filterComplexScript: `${lines.join(';\n')}\n`,
    assFiles,
    outputArgs: outputArgsFor(plan),
    durationMs,
    fonts:
      assFiles.length > 0
        ? { dir: plan.fonts.dir ?? FONTS_DIR, files: plan.fonts.files, psNames: plan.fonts.psNames }
        : null,
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
