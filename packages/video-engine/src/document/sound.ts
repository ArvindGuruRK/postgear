/**
 * Sounds as data (Module 14): the sound an Add button puts on the timeline,
 * the sound edits, the video's own volume, and the one curve the preview and
 * the export both follow.
 *
 * - A sound item plays its file from `offsetMs` (where in the file it
 *   starts, so a sound can be trimmed from either end). The document has no
 *   loop switch: **music loops** to fill its item (a loop set to Whole Clip
 *   plays for the whole clip), **an effect plays once** and is silent after
 *   its file ends. The Add buttons never make an effect longer than its file.
 * - Gains are linear and fades are linear: the item's volume, times its own
 *   fade in and fade out, times the clip's fade (`frameState`). The preview
 *   draws these with `GainNode` ramps and the export with `volume` and
 *   `afade` (whose default curve is a straight line).
 * - Effects sit on their moment (`anchor: 'moment'`), music on the clip's
 *   clock (`anchor: 'clip'`), and a clip holds at most `MAX_SOUNDS` sounds.
 */
import { addItem, findItem, type ItemRefusalCode, removeItem, updateItem } from '../time/items';
import { outputDuration } from '../time/time-map';
import { FADE_MAX_MS, ITEM_MIN_MS, MAX_SOUNDS, VOLUME_MAX } from './limits';
import type { AudioItem, ClipDocument, SoundRef } from './schema';

/** The length of the Fade In and Fade Out switches. */
export const SOUND_FADE_MS = 1_000;

/** The facts the Add button knows about a sound's file. */
export interface SoundFileFacts {
  /** The file's own length in ms. */
  durationMs: number;
}

/** The key one sound file is fetched and cached by. */
export function soundRefKey(ref: SoundRef): string {
  return 'library' in ref ? `library:${ref.id}` : `asset:${ref.asset}`;
}

/** One sound file the clip plays, once each. */
export type SoundFileRef = { key: string; library: string } | { key: string; asset: string };

/** Every sound file the clip plays, each once, in track order. */
export function soundFilesNeeded(doc: Pick<ClipDocument, 'tracks'>): SoundFileRef[] {
  const seen = new Map<string, SoundFileRef>();
  for (const track of doc.tracks) {
    if (track.kind !== 'audio') continue;
    for (const item of track.items) {
      const key = soundRefKey(item.ref);
      if (seen.has(key)) continue;
      seen.set(
        key,
        'library' in item.ref ? { key, library: item.ref.id } : { key, asset: item.ref.asset },
      );
    }
  }
  return [...seen.values()];
}

/** Every sound item, in track order. */
export function soundItems(doc: Pick<ClipDocument, 'tracks'>): AudioItem[] {
  const items: AudioItem[] = [];
  for (const track of doc.tracks) {
    if (track.kind === 'audio') items.push(...track.items);
  }
  return items;
}

/** How many sounds the clip holds. */
export function countSounds(doc: Pick<ClipDocument, 'tracks'>): number {
  return soundItems(doc).length;
}

/** Music loops to fill its item; an effect plays once. */
export function soundLoops(item: Pick<AudioItem, 'type'>): boolean {
  return item.type === 'music';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The item's own gain `localMs` after it starts: its volume times its fade
 * in and fade out, each a straight line. The clip's fade is applied on top
 * (`frameState` multiplies it in; the export fades the whole mix).
 */
export function soundGainAt(
  item: Pick<AudioItem, 'volume' | 'fadeInMs' | 'fadeOutMs' | 'duration'>,
  localMs: number,
): number {
  if (localMs < 0 || localMs >= item.duration) return 0;
  const fadeIn = item.fadeInMs > 0 ? clamp(localMs / item.fadeInMs, 0, 1) : 1;
  const fadeOut = item.fadeOutMs > 0 ? clamp((item.duration - localMs) / item.fadeOutMs, 0, 1) : 1;
  return item.volume * fadeIn * fadeOut;
}

/**
 * Where in the sound file playback is, `localMs` after the item starts, or
 * null when nothing plays there (an effect past its file's end). Music wraps
 * to the file's start. With the file's length unknown, the plain position.
 */
export function soundFileMsAt(
  item: Pick<AudioItem, 'type' | 'offsetMs'>,
  localMs: number,
  fileMs: number | null,
): number | null {
  const at = item.offsetMs + Math.max(0, localMs);
  if (fileMs === null || !(fileMs > 0)) return at;
  if (soundLoops(item)) return at % fileMs;
  return at < fileMs ? at : null;
}

/**
 * The longest an item may last from its start: an effect up to the end of
 * its file (never past the clip), music to the clip's end (it loops).
 */
export function soundMaxDuration(
  item: Pick<AudioItem, 'type' | 'offsetMs' | 'start'>,
  fileMs: number | null,
  totalMs: number,
): number {
  const room = Math.max(0, totalMs - item.start);
  if (soundLoops(item) || fileMs === null) return room;
  return Math.max(Math.min(ITEM_MIN_MS, room), Math.min(room, fileMs - item.offsetMs));
}

export type SoundRefusalCode = ItemRefusalCode | 'too_many_sounds';

export type SoundEditResult =
  | { ok: true; doc: ClipDocument; itemId?: string }
  | { ok: false; code: SoundRefusalCode };

/**
 * The sound an Add button puts at `atMs`: an effect for its file's length
 * on its moment, no fades; music from `atMs` to the clip's end on the
 * clip's clock with one second fades in and out (it loops to fill). Volume
 * 100%. `addItem` gives it its id and keeps it inside the clip.
 */
export function defaultSoundItem(
  doc: ClipDocument,
  atMs: number,
  ref: SoundRef,
  type: AudioItem['type'],
  file: SoundFileFacts,
  id = type === 'music' ? 'mus_new' : 'snd_new',
): AudioItem {
  const total = outputDuration(doc);
  const fileMs = Math.max(ITEM_MIN_MS, Math.round(file.durationMs));
  const at = clamp(
    Math.round(Number.isFinite(atMs) ? atMs : 0),
    0,
    Math.max(0, total - ITEM_MIN_MS),
  );
  const music = type === 'music';
  const wanted = music ? total - at : fileMs;
  const duration = clamp(wanted, Math.min(ITEM_MIN_MS, total), Math.max(0, total - at));
  const fade = music ? Math.min(SOUND_FADE_MS, Math.floor(duration / 2)) : 0;
  return {
    id,
    type,
    start: at,
    duration,
    anchor: music ? 'clip' : 'moment',
    ref,
    offsetMs: 0,
    volume: 1,
    fadeInMs: fade,
    fadeOutMs: fade,
    duck: false,
  };
}

/** Adds a sound on the first sound row with room (or a new one). Refused past `MAX_SOUNDS`. */
export function addSound(
  doc: ClipDocument,
  ref: SoundRef,
  type: AudioItem['type'],
  atMs: number,
  file: SoundFileFacts,
): SoundEditResult {
  if (countSounds(doc) >= MAX_SOUNDS) return { ok: false, code: 'too_many_sounds' };
  return addItem(doc, defaultSoundItem(doc, atMs, ref, type, file));
}

/** What the Audio panel changes on a sound (`duck`, Module 17 item 9: music only). */
export type SoundPatch = Partial<
  Pick<AudioItem, 'volume' | 'fadeInMs' | 'fadeOutMs' | 'offsetMs' | 'duck'>
>;

function roundVolume(value: number): number {
  return Math.round(clamp(value, 0, VOLUME_MAX) * 100) / 100;
}

/**
 * Changes a sound's volume, fades or start in its file, each kept in range
 * (volume 0 to 2, fades 0 to 5 s and never longer than the item). Returns
 * the same document when nothing changed; refuses an id that is not a sound.
 */
export function updateSound(doc: ClipDocument, itemId: string, patch: SoundPatch): SoundEditResult {
  const found = findItem(doc, itemId);
  if (!found || (found.item.type !== 'sfx' && found.item.type !== 'music')) {
    return { ok: false, code: 'item_not_found' };
  }
  return updateItem<AudioItem>(doc, itemId, (item) => {
    const fadeCap = Math.min(FADE_MAX_MS, item.duration);
    const next: AudioItem = {
      ...item,
      volume: patch.volume === undefined ? item.volume : roundVolume(patch.volume),
      fadeInMs:
        patch.fadeInMs === undefined
          ? item.fadeInMs
          : Math.round(clamp(patch.fadeInMs, 0, fadeCap)),
      fadeOutMs:
        patch.fadeOutMs === undefined
          ? item.fadeOutMs
          : Math.round(clamp(patch.fadeOutMs, 0, fadeCap)),
      offsetMs:
        patch.offsetMs === undefined ? item.offsetMs : Math.max(0, Math.round(patch.offsetMs)),
      // Only music is lowered under speech; an effect keeps `duck` off.
      duck: patch.duck === undefined || item.type !== 'music' ? item.duck : patch.duck,
    };
    const same =
      next.volume === item.volume &&
      next.fadeInMs === item.fadeInMs &&
      next.fadeOutMs === item.fadeOutMs &&
      next.offsetMs === item.offsetMs &&
      next.duck === item.duck;
    return same ? item : next;
  });
}

/** Removes a sound. Nothing else moves. */
export function removeSound(doc: ClipDocument, itemId: string): SoundEditResult {
  const found = findItem(doc, itemId);
  if (!found || (found.item.type !== 'sfx' && found.item.type !== 'music')) {
    return { ok: false, code: 'item_not_found' };
  }
  return removeItem(doc, itemId);
}

/** One part's own sound: 0 (muted) to 2 (twice as loud), to the hundredth. */
export function setSegmentVolume(
  doc: ClipDocument,
  segmentId: string,
  volume: number,
): ClipDocument {
  if (!Number.isFinite(volume)) return doc;
  const next = roundVolume(volume);
  let changed = false;
  const segments = doc.segments.map((segment) => {
    if (segment.id !== segmentId || segment.volume === next) return segment;
    changed = true;
    return { ...segment, volume: next };
  });
  return changed ? { ...doc, segments } : doc;
}

/** Every part's own sound at once (Video Volume with no part selected). */
export function setVideoVolume(doc: ClipDocument, volume: number): ClipDocument {
  if (!Number.isFinite(volume)) return doc;
  const next = roundVolume(volume);
  if (doc.segments.every((segment) => segment.volume === next)) return doc;
  return { ...doc, segments: doc.segments.map((segment) => ({ ...segment, volume: next })) };
}

/**
 * The volume Video Volume shows: the selected part's, or with none selected
 * the first part's when every part agrees, else null (a mixed clip).
 */
export function videoVolumeOf(doc: ClipDocument, segmentId: string | null): number | null {
  if (segmentId) return doc.segments.find((segment) => segment.id === segmentId)?.volume ?? null;
  const first = doc.segments[0]?.volume ?? 1;
  return doc.segments.every((segment) => segment.volume === first) ? first : null;
}
