/**
 * Encode settings for each export quality and for Preview Export.
 *
 * Quality is data, not code paths: a short side, a frame rate, an x264 preset,
 * a CRF and a `maxrate`. The canvas keeps its shape, so a Vertical clip at
 * 720p is 720 by 1280 and a Square one 720 by 720. Every pixel number in a
 * clip document is in canvas units (the 1080 short side) and is multiplied by
 * the spec's scale exactly once, in `buildRenderPlan`.
 *
 * Figures from the cookbook (sections 9 and 10) and Module 15: libx264 High,
 * `veryfast`, CRF 21, `maxrate` 5M (720p30), 8M (720p60 and 1080p30), 12M
 * (1080p60), `bufsize` twice the `maxrate`, AAC 128k at 48 kHz stereo; the
 * proof is 360 on the short side, 30 fps, `ultrafast`, CRF 28, 2M.
 */
import type { CanvasSize } from '../canvas';
import { EXPORT_QUALITIES, type ExportQuality } from '../quality';

export type EncodePreset = 'veryfast' | 'ultrafast';

/** What one render is encoded as. Plain data, so it can sit in a JSON render plan. */
export interface EncodeSpec {
  /** The export quality, or `proof` for Preview Export. */
  id: ExportQuality | 'proof';
  /** Pixels on the canvas's short side. */
  shortSide: number;
  fps: 30 | 60;
  preset: EncodePreset;
  crf: number;
  /** Peak video bitrate in kbit/s; `bufsize` is twice this. */
  maxrateKbps: number;
  audioBitrateKbps: number;
  audioSampleRate: number;
  audioChannels: number;
  /** Seconds between key frames: a closed GOP of two seconds. */
  gopSeconds: number;
}

/** The short side every clip document is stored at (see `canvas.ts`). */
export const CANVAS_SHORT_SIDE = 1080;

const AUDIO = { audioBitrateKbps: 128, audioSampleRate: 48_000, audioChannels: 2, gopSeconds: 2 };

/** The four public qualities, in the order of `EXPORT_QUALITIES`. */
export const ENCODE_SPECS: Readonly<Record<ExportQuality, EncodeSpec>> = Object.freeze({
  '720p': {
    id: '720p',
    shortSide: 720,
    fps: 30,
    preset: 'veryfast',
    crf: 21,
    maxrateKbps: 5_000,
    ...AUDIO,
  },
  '720p60': {
    id: '720p60',
    shortSide: 720,
    fps: 60,
    preset: 'veryfast',
    crf: 21,
    maxrateKbps: 8_000,
    ...AUDIO,
  },
  '1080p': {
    id: '1080p',
    shortSide: 1080,
    fps: 30,
    preset: 'veryfast',
    crf: 21,
    maxrateKbps: 8_000,
    ...AUDIO,
  },
  '1080p60': {
    id: '1080p60',
    shortSide: 1080,
    fps: 60,
    preset: 'veryfast',
    crf: 21,
    maxrateKbps: 12_000,
    ...AUDIO,
  },
});

/** Preview Export: small and fast, never a public tile. Audio is the same as the export. */
export const PROOF_SPEC: Readonly<EncodeSpec> = Object.freeze({
  id: 'proof',
  shortSide: 360,
  fps: 30,
  preset: 'ultrafast',
  crf: 28,
  maxrateKbps: 2_000,
  ...AUDIO,
});

/**
 * The spec a render uses. A proof ignores the quality asked for: Preview
 * Export is one shape whatever the plan allows.
 */
export function encodeSpecFor(quality: ExportQuality, proof: boolean): EncodeSpec {
  if (proof) {
    return { ...PROOF_SPEC };
  }
  const spec = ENCODE_SPECS[quality];
  if (!spec) {
    throw new Error(
      `Unknown export quality ${String(quality)}; expected one of ${EXPORT_QUALITIES.join(', ')}`,
    );
  }
  return { ...spec };
}

/** The nearest even whole number (never below 2): yuv420p wants even sizes. */
export function evenSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 2;
  }
  return Math.max(2, 2 * Math.round(value / 2));
}

/**
 * The nearest even whole number (never below 0), for positions on the output
 * picture: `pad` and `overlay` round odd offsets down on yuv420p by
 * themselves, so the plan writes even ones and says exactly where things go.
 */
export function evenPosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, 2 * Math.round(value / 2));
}

/**
 * The output size of a canvas at a spec, and the one scale every canvas
 * pixel number is multiplied by. The short side is the spec's; the long side
 * keeps the canvas's shape, rounded to an even number.
 */
export function outputSizeFor(
  canvas: CanvasSize,
  spec: Pick<EncodeSpec, 'shortSide'>,
): { width: number; height: number; scale: number } {
  const short = Math.min(canvas.width, canvas.height);
  const scale = spec.shortSide / short;
  return {
    width: evenSize(canvas.width * scale),
    height: evenSize(canvas.height * scale),
    scale,
  };
}
