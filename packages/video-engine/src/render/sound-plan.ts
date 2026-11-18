/**
 * Sounds in the render plan (Module 14): every sound item as the numbers its
 * chain needs, in whole ms of the clip.
 *
 * - The file is the `.m4a` the worker fetched (keyed by `soundRefKey`): a
 *   library sound from the public space, or a workspace's checked upload.
 * - An effect plays its file once from `offsetMs`, for at most what is left
 *   of the file; music loops (`-stream_loop -1` on its input) and is cut to
 *   its item. A window that runs past the clip is cut to the clip.
 * - The gains are the item's volume and its own fades (`soundGainAt`); the
 *   clip's fades are applied to the whole mix, as `frameState` multiplies
 *   them into every sound.
 */
import { soundItems, soundLoops, soundRefKey } from '../document/sound';
import type { ClipDocument } from '../document/schema';
import { RenderCompileError } from './errors';

/** Whether the clip has any sound at all: a sound item, or a part with sound that is not muted. */
export function planHasSound(plan: {
  sounds: readonly unknown[];
  inputs: ReadonlyArray<{ index: number; hasAudio: boolean }>;
  segments: ReadonlyArray<{ inputIndex: number; volume: number }>;
}): boolean {
  if (plan.sounds.length > 0) return true;
  return plan.segments.some(
    (segment) =>
      segment.volume > 0 && plan.inputs.some((input) => input.index === segment.inputIndex && input.hasAudio),
  );
}

/** The file the worker has for one sound (keyed by `soundRefKey`). */
export interface RenderSoundAsset {
  /** A plain relative name inside the scratch folder. */
  file: string;
  /** The file's own length in ms. */
  durationMs: number;
}

/** One sound, ready for its chain. */
export interface PlanSound {
  id: string;
  /** The `-i` it reads. */
  inputIndex: number;
  file: string;
  /** Music: the input loops forever and the chain cuts it. */
  loop: boolean;
  /** Where in the file it starts (the input's seek), whole ms. */
  offsetMs: number;
  /** Clip ms where it starts, and how long it plays (an effect stops at its file's end). */
  startMs: number;
  durationMs: number;
  volume: number;
  /** The item's own fades, each at most the time it plays. */
  fadeInMs: number;
  /** The fade out ends where the item ends, so it starts `durationMs`-relative at `itemMs - fadeOutMs`. */
  fadeOutMs: number;
  /** The item's whole length (its fade out ends here, even when an effect's file ends sooner). */
  itemMs: number;
  /** The file's own length. */
  fileMs: number;
  /**
   * Music that runs past its file's end: the chain repeats the decoded file
   * with `aloop` (gapless, exact) instead of seeking into it. Measured on
   * FFmpeg 9.0.2, `-stream_loop -1` left a 10 ms gap at every wrap of an
   * AAC file and broke `atrim`'s length.
   */
  wraps: boolean;
}

/**
 * Every sound with a usable window, in track order, its input index counted
 * from `firstInput`. Throws `sound_missing` when the worker did not hand in
 * a file the clip plays (a sound removed from the library, a deleted upload).
 */
export function planSounds(
  doc: ClipDocument,
  assets: Readonly<Record<string, RenderSoundAsset>>,
  durationMs: number,
  firstInput: number,
): PlanSound[] {
  const sounds: PlanSound[] = [];
  for (const item of soundItems(doc)) {
    const key = soundRefKey(item.ref);
    const asset = assets[key];
    if (!asset) {
      throw new RenderCompileError('sound_missing', 'A sound the clip plays was not handed in', {
        itemId: item.id,
        ref: key,
      });
    }
    const bad = (what: string): never => {
      throw new RenderCompileError('invalid_context', `Sound ${item.id}: ${what}`, {
        itemId: item.id,
        ref: key,
      });
    };
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(asset.file) || asset.file.length > 120) {
      bad('the file must be a plain relative name');
    }
    if (!(Number.isInteger(asset.durationMs) && asset.durationMs > 0)) bad('bad durationMs');
    const startMs = Math.max(0, item.start);
    const itemEnd = Math.min(durationMs, item.start + item.duration);
    const itemMs = itemEnd - startMs;
    if (itemMs <= 0) continue;
    const loop = soundLoops(item);
    // An item that starts before the clip (never written by the edits) skips that part of its file.
    const skipped = startMs - item.start;
    const offsetMs = loop
      ? (item.offsetMs + skipped) % asset.durationMs
      : item.offsetMs + skipped;
    const plays = loop ? itemMs : Math.min(itemMs, asset.durationMs - offsetMs);
    if (plays <= 0 || item.volume === 0) continue;
    sounds.push({
      id: item.id,
      inputIndex: firstInput + sounds.length,
      file: asset.file,
      loop,
      offsetMs,
      startMs,
      durationMs: plays,
      volume: item.volume,
      fadeInMs: Math.min(item.fadeInMs, itemMs),
      fadeOutMs: Math.min(item.fadeOutMs, itemMs),
      itemMs,
      fileMs: asset.durationMs,
      wraps: loop && offsetMs + plays > asset.durationMs,
    });
  }
  return sounds;
}
