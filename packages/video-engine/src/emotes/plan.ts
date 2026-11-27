/**
 * The emote's encode steps (Module 14, B2), as plain strings and numbers.
 *
 * `planEmote` turns a request and a site's profile into one step per file;
 * `compileEmote` turns one step at one ladder rung into the FFmpeg filter
 * graph (written to `graph.txt` and passed as `-/filter_complex graph.txt`;
 * `-filter_complex_script` does not exist in FFmpeg 9.0.2) and the argument
 * array the worker hands `runTool`. Never a shell string.
 *
 * The graph, in order: the square crop in the file's own pixels, an optional
 * horizontal flip, the frame rate (capped so frames never pass the site's
 * limit; `-frames:v` stops the encoder there too), the optional colour key
 * before the crop is scaled (`format=rgba`, `colorkey`), the lanczos scale,
 * then per format: a palette for GIF (and for APNG and PNG rungs with a
 * palette), with `reserve_transparent` and `alpha_threshold=128` when keyed;
 * `yuva420p` for WebP; full `rgba` for APNG and PNG otherwise.
 *
 * The spike (Module 14, B1) checked every option here on FFmpeg 9.0.2:
 * `libwebp_anim` has no `-loop` of its own, the WebP muxer's `-loop` defaults
 * to 1 (plays once) so `-loop 0` is required; APNG needs `-plays 0` (its
 * default is 1); the GIF muxer loops by default. `colorkey` (RGB distance)
 * is used rather than `chromakey` (YUV): the eyedropper picks an RGB colour
 * and the page's preview keys the same way.
 */
import { type EmoteRung, emoteFpsCap, emoteFrames } from './ladder';
import {
  EMOTE_PROFILES,
  type EmoteOutput,
  type EmotePlatform,
  type EmoteProfile,
  emoteFileName,
  emoteOutputsFor,
  emoteZipName,
} from './profiles';
import type { EmoteCrop, EmoteFrame, EmoteKey } from './schema';

/** The graph file every encode writes in its scratch folder. */
export const EMOTE_GRAPH_FILE = 'graph.txt';
/** The edge softness of the colour key (alpha is one bit in a GIF anyway). */
export const EMOTE_KEY_BLEND = 0.08;
/** A GIF's palette treats alpha under this as transparent. */
export const EMOTE_ALPHA_THRESHOLD = 128;

export interface EmotePlanRequest {
  platform: EmotePlatform;
  startMs: number;
  endMs: number;
  crop: EmoteCrop;
  key: EmoteKey | null;
  flip: boolean;
  still: boolean;
  stillAtMs?: number | null;
}

export interface EmoteStep {
  output: EmoteOutput;
  /** `emote-twitch-112.gif`. */
  fileName: string;
  /** A still PNG (one frame at `stillAtMs`). */
  still: boolean;
  /** False for an extra: one that cannot fit is left out, the export still works. */
  required: boolean;
}

export interface EmotePlan {
  profile: EmoteProfile;
  startMs: number;
  endMs: number;
  seconds: number;
  /** The highest frame rate the site's frame limit allows for this length. */
  fpsCap: number;
  stillAtMs: number;
  crop: EmoteCrop;
  key: EmoteKey | null;
  flip: boolean;
  /** One per file, largest first; still PNGs only with the switch on. */
  steps: EmoteStep[];
  zipName: string;
}

export function planEmote(request: EmotePlanRequest, profile?: EmoteProfile): EmotePlan {
  const site = profile ?? EMOTE_PROFILES[request.platform];
  const seconds = Math.max(0, request.endMs - request.startMs) / 1_000;
  const stillAt = request.stillAtMs ?? request.startMs;
  return {
    profile: site,
    startMs: request.startMs,
    endMs: request.endMs,
    seconds,
    fpsCap: emoteFpsCap(site, seconds),
    stillAtMs: Math.min(Math.max(stillAt, request.startMs), request.endMs),
    crop: request.crop,
    key: request.key,
    flip: request.flip,
    steps: emoteOutputsFor(site, request.still).map((output) => ({
      output,
      fileName: emoteFileName(site, output),
      still: output.format === 'png',
      required: output.extra !== true,
    })),
    zipName: emoteZipName(site),
  };
}

/** The file an encode reads: where it starts in the video, and its size. */
export interface EmoteSource {
  /** A plain name inside the scratch folder. */
  file: string;
  /** Where the file starts in the video's time (a sharp range starts at its `fromMs`). */
  offsetMs: number;
  width: number;
  height: number;
}

/**
 * The crop in the file's own pixels: the request measures it in the light
 * copy's frame, and a sharp range can be taller. Kept square and inside.
 */
export function scaleEmoteCrop(
  crop: EmoteCrop,
  frame: EmoteFrame,
  file: Pick<EmoteSource, 'width' | 'height'>,
): EmoteCrop {
  const scale = frame.width > 0 ? file.width / frame.width : 1;
  const size = Math.max(1, Math.min(Math.round(crop.size * scale), file.width, file.height));
  const x = Math.min(Math.max(0, Math.round(crop.x * scale)), file.width - size);
  const y = Math.min(Math.max(0, Math.round(crop.y * scale)), file.height - size);
  return { x, y, size };
}

/** `#00b140` as `0x00b140`; anything else is refused (the schema already lowered and checked it). */
function keyColour(color: string): string {
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('A key colour must be #rrggbb');
  return `0x${color.slice(1)}`;
}

/** A number for the graph: finite, at most three decimals, never an exponent. */
function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error('A graph value must be a finite number');
  return String(Math.round(value * 1_000) / 1_000);
}

function int(value: number): string {
  if (!Number.isFinite(value)) throw new Error('A graph value must be a finite number');
  return String(Math.round(value));
}

function ditherOption(rung: EmoteRung): string {
  return rung.dither.mode === 'bayer'
    ? `dither=bayer:bayer_scale=${int(rung.dither.scale)}`
    : 'dither=none';
}

/** The filter graph for one file at one rung. `crop` is already in the file's pixels. */
export function emoteGraph(
  plan: EmotePlan,
  step: EmoteStep,
  rung: EmoteRung,
  crop: EmoteCrop,
): string {
  const size = step.output.size;
  const parts = [`[0:v]crop=${int(crop.size)}:${int(crop.size)}:${int(crop.x)}:${int(crop.y)}`];
  if (plan.flip) parts.push('hflip');
  if (!step.still) parts.push(`fps=${int(rung.fps)}`);
  if (plan.key) {
    parts.push('format=rgba');
    parts.push(
      `colorkey=${keyColour(plan.key.color)}:${num(plan.key.similarity)}:${num(EMOTE_KEY_BLEND)}`,
    );
  }
  parts.push(`scale=${int(size)}:${int(size)}:flags=lanczos`);
  const head = parts.join(',');

  const format = step.output.format;
  if (format === 'webp') return `${head},format=yuva420p`;
  if (rung.colours === null) return `${head},format=rgba`;

  const keyed = plan.key !== null;
  // A moving file with no key keeps only what changed between frames (smaller); a keyed one
  // needs every frame's colours, and a still has one frame.
  const stats = !step.still && !keyed ? 'diff' : 'full';
  const use = [ditherOption(rung)];
  if (keyed) use.push(`alpha_threshold=${EMOTE_ALPHA_THRESHOLD}`);
  if (!step.still && !keyed) use.push('diff_mode=rectangle');
  return (
    `${head},split[a][b];` +
    `[a]palettegen=max_colors=${int(rung.colours)}:reserve_transparent=${keyed ? 1 : 0}:stats_mode=${stats}[p];` +
    `[b][p]paletteuse=${use.join(':')}`
  );
}

/** Seconds for `-ss` and `-t`, three decimals. */
function seconds(ms: number): string {
  return (Math.max(0, Math.round(ms)) / 1_000).toFixed(3);
}

export interface CompiledEmote {
  /** Written to `EMOTE_GRAPH_FILE` before the run. */
  graph: string;
  /** Everything after FFmpeg's fixed head; the graph is passed as a file. */
  args: string[];
  /** Frames the file will hold (one for a still). */
  frames: number;
}

/**
 * The graph and arguments for one file at one rung. `-ss` comes before `-i`
 * (a fast seek, exact since FFmpeg decodes from the keyframe before it), from
 * the file's own start, so a sharp range that starts at 41 s seeks 1.4 s
 * into itself for a stretch at 42.4 s.
 */
export function compileEmote(
  plan: EmotePlan,
  step: EmoteStep,
  rung: EmoteRung,
  source: EmoteSource,
  frame: EmoteFrame,
): CompiledEmote {
  const crop = scaleEmoteCrop(plan.crop, frame, source);
  const graph = emoteGraph(plan, step, rung, crop);
  const input = step.still
    ? ['-ss', seconds(plan.stillAtMs - source.offsetMs), '-i', source.file]
    : [
        '-ss',
        seconds(plan.startMs - source.offsetMs),
        '-t',
        seconds(plan.endMs - plan.startMs),
        '-i',
        source.file,
      ];
  const frames = step.still ? 1 : emoteFrames(plan.profile, plan.seconds, rung.fps);
  const common = ['-/filter_complex', EMOTE_GRAPH_FILE, '-an', '-sn', '-map_metadata', '-1'];
  let out: string[];
  switch (step.output.format) {
    case 'gif':
      out = ['-frames:v', String(frames), '-loop', '0', '-f', 'gif'];
      break;
    case 'webp':
      out = [
        '-frames:v',
        String(frames),
        '-c:v',
        'libwebp_anim',
        '-lossless',
        '0',
        '-quality',
        int(rung.quality ?? 75),
        '-compression_level',
        '6',
        '-loop',
        '0',
        '-f',
        'webp',
      ];
      break;
    case 'apng':
      out = ['-frames:v', String(frames), '-c:v', 'apng', '-plays', '0', '-f', 'apng'];
      break;
    case 'png':
      out = ['-frames:v', '1', '-update', '1', '-c:v', 'png', '-f', 'image2'];
      break;
  }
  return { graph, args: [...input, ...common, ...out, step.fileName], frames };
}

/** Helper for the page and the tests: the profile's rungs fit `fps` under the frame cap. */
export function emoteMaxFps(platform: EmotePlatform, durationMs: number): number {
  return emoteFpsCap(EMOTE_PROFILES[platform], Math.max(0, durationMs) / 1_000);
}
