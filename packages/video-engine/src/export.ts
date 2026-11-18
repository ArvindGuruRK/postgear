/**
 * Export as data (Module 15 section 1): what each quality tile says, the
 * size a document exports at, a planning guess at the file size, the tiles a
 * plan allows, and the fingerprint that says whether an export (or a
 * preview) still shows the clip as it is.
 *
 * Pure: no Node built-ins, so the API, the worker and the browser share it.
 * The encode settings themselves are `render/specs.ts`.
 */
import { CANVASES, type CanvasSize, RATIO_LABELS } from './canvas';
import type { ClipDocument } from './document/schema';
import { EXPORT_QUALITIES, type ExportQuality, QUALITY_LABELS, qualityAllowed } from './quality';
import { ENCODE_SPECS, outputSizeFor } from './render/specs';

/** The help line under each quality tile. */
export const QUALITY_HELP: Readonly<Record<ExportQuality, string>> = Object.freeze({
  '720p': 'Smaller file, quick',
  '720p60': 'Smoother motion',
  '1080p': 'Sharper picture',
  '1080p60': 'Sharpest and smoothest',
});

/** Exports at 60 fps look smoother only when the video itself has about this many frames a second. */
export const SMOOTH_SOURCE_FPS = 50;

export function isSixtyFps(quality: ExportQuality): boolean {
  return ENCODE_SPECS[quality].fps === 60;
}

export interface ExportShape {
  width: number;
  height: number;
  fps: 30 | 60;
  maxrateKbps: number;
}

/** The size, frame rate and peak bitrate a document exports at in `quality`. */
export function exportPlan(doc: Pick<ClipDocument, 'canvas'>, quality: ExportQuality): ExportShape {
  const spec = ENCODE_SPECS[quality];
  const canvas: CanvasSize = CANVASES[doc.canvas.ratio];
  const { width, height } = outputSizeFor(canvas, spec);
  return { width, height, fps: spec.fps, maxrateKbps: spec.maxrateKbps };
}

/** The share of the peak bitrate the size guess assumes (busy footage nears it, calm footage stays far below). */
const ESTIMATE_SHARE = 0.6;

/** A planning guess at the file's size in bytes: 60% of the peak video bitrate, plus the sound. */
export function estimateBytes(quality: ExportQuality, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  const spec = ENCODE_SPECS[quality];
  const kbps = spec.maxrateKbps * ESTIMATE_SHARE + spec.audioBitrateKbps;
  return Math.round(((kbps * 1000) / 8) * (durationMs / 1000));
}

/**
 * The highest peak video bitrate (kbit/s) that keeps a clip of `durationMs`
 * under `maxBytes` at the worst case (the encoder at its peak the whole
 * time), the sound included; null when even 500 kbit/s would not fit.
 * Module 17's platform notes use it; exports do not.
 */
export function fitsBitrate(
  durationMs: number,
  maxBytes: number,
  audioKbps = ENCODE_SPECS['1080p'].audioBitrateKbps,
): number | null {
  if (!(durationMs > 0) || !(maxBytes > 0)) return null;
  const totalKbps = (maxBytes * 8) / 1000 / (durationMs / 1000);
  const video = Math.floor(totalKbps - audioKbps);
  return video >= 500 ? video : null;
}

/** The tiles at or below the plan's `clips.export_max_quality`, low to high. */
export function allowedQualities(max: string | null | undefined): ExportQuality[] {
  if (typeof max !== 'string') return [];
  return EXPORT_QUALITIES.filter((quality) => qualityAllowed(quality, max));
}

/** The best tile the plan allows (the one preselected), or 720p when the plan is unknown. */
export function bestAllowedQuality(max: string | null | undefined): ExportQuality {
  return allowedQualities(max).at(-1) ?? '720p';
}

/** "1080p export needs a higher plan." */
export function qualityLockedSentence(quality: ExportQuality): string {
  return `${QUALITY_LABELS[quality]} export needs a higher plan.`;
}

/** "Vertical 9:16" */
export function shapeLabel(doc: Pick<ClipDocument, 'canvas'>): string {
  return `${RATIO_LABELS[doc.canvas.ratio]} ${doc.canvas.ratio}`;
}

/** "40 MB", "800 KB" (decimal units, like the file managers people use). */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 KB';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  if (bytes < 10_000_000_000) {
    const mb = bytes / 1_000_000;
    return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
  }
  return `${Math.round(bytes / 100_000_000) / 10} GB`;
}

// --- The fingerprint ------------------------------------------------------------------

/** JSON with every object's keys in order, so the same document always reads the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** cyrb53: a fast 53-bit string hash (public domain), seeded so two lanes make one longer hash. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * A fingerprint of what a document draws: the same for the same picture and
 * sound whatever the key order, different after any change to them. The
 * editor-only `meta` is left out, and the clip's name is not in the document,
 * so a rename never makes an export look out of date. Not a security hash:
 * it only tells "the same clip" from "a changed one".
 */
export function documentFingerprint(doc: ClipDocument): string {
  const { meta: _meta, ...drawn } = doc as ClipDocument & { meta?: unknown };
  const text = canonical(drawn);
  const lane = (seed: number) => cyrb53(text, seed).toString(16).padStart(14, '0');
  return `v1-${lane(1)}${lane(2)}`;
}
