/**
 * The Audio tab's words and pure helpers (Module 14 section 8): the tabs,
 * the sentences, which kind each tab lists, the sound files a clip plays as
 * the preview wants them, a sound's shape as a drawing, and the level
 * meter's scale.
 *
 * The UI never says file, asset, render or upload check: a person sees
 * sound effects, music, their own sounds, and "Checking".
 */
import {
  type AudioItem,
  type ClipDocument,
  type LibrarySoundDetails,
  type LibrarySoundView,
  MAX_SOUNDS,
  type SoundFileView,
  type SoundKind,
  type SoundUploadView,
  soundFilesNeeded,
  soundRefKey,
} from '@postgear/video-engine';
import { METER_WARN_LEVEL } from '@postgear/video-preview';

export type AudioTab = 'effects' | 'music' | 'favourites' | 'uploaded';

export const AUDIO_TABS: ReadonlyArray<{ value: AudioTab; label: string }> = [
  { value: 'effects', label: 'Sound Effects' },
  { value: 'music', label: 'Music' },
  { value: 'favourites', label: 'Favourites' },
  { value: 'uploaded', label: 'Uploaded' },
];

export function isAudioTab(value: string): value is AudioTab {
  return AUDIO_TABS.some((tab) => tab.value === value);
}

/** Sound Effects lists effects, Music music; Favourites holds both. */
export function kindOfAudioTab(tab: AudioTab): SoundKind | undefined {
  if (tab === 'effects') return 'sfx';
  if (tab === 'music') return 'music';
  return undefined;
}

/** Rows loaded at a time. */
export const SOUNDS_PAGE = 24;

export const SOUND_FAVOURITES_EMPTY = 'No favourites yet. Star a sound to keep it here.';
export const REMOVED_SOUND = 'This sound was removed from the library.';
export const SOUND_UPLOAD_GONE = 'This sound was deleted from your workspace.';
export const SOUNDS_LOAD_FAILED = 'We could not load the sounds. Try again in a moment.';
export const SOUND_UPLOADS_EMPTY =
  'No sounds of your own yet. Upload an MP3, WAV, M4A or AAC file.';
export const TOO_MANY_SOUNDS = `A clip holds up to ${MAX_SOUNDS} sounds. Remove one to add another.`;
export const DELETE_SOUND_SENTENCE =
  'It leaves your workspace for good. A clip that still uses it has to drop it first.';
export const SOUND_PREVIEW_FAILED = 'This sound would not play. Try again in a moment.';
export const MIXED_VOLUME = 'Parts differ';

/** A sound's length as the rows show it: "0:03", "1:05". */
export function lengthLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const LICENCE_WORDS: Readonly<Record<string, string>> = {
  'CC0-1.0': 'CC0, free to use',
  'PDM-1.0': 'Public domain',
  OWN: 'Made for PostGear, free to use in your clips',
};

/** The "i" line: where the sound came from, who made it, and its licence. */
export function detailsLine(details: LibrarySoundDetails): string {
  const licence = LICENCE_WORDS[details.licence] ?? details.licence;
  const by = details.author && details.author !== details.source ? ` by ${details.author}` : '';
  return `From ${details.source}${by}. ${licence}.`;
}

// --- What the preview plays --------------------------------------------------------

/** One sound file as the editor keeps it: what the preview plays, and what the panel shows. */
export interface SoundFileInfo {
  missing: boolean;
  /** A library sound taken out after a rights request (the panel says so). */
  removed: boolean;
  name: string | null;
  kind: SoundKind | null;
  durationMs: number | null;
  fileUrl: string | null;
  /** `SOUND_PEAKS` values, 0 to 255. */
  peaks: readonly number[] | null;
}

export function soundInfoOf(file: SoundFileView): SoundFileInfo {
  if (file.missing) {
    return {
      missing: true,
      removed: file.removed,
      name: null,
      kind: null,
      durationMs: null,
      fileUrl: null,
      peaks: null,
    };
  }
  return {
    missing: false,
    removed: false,
    name: file.name,
    kind: file.kind,
    durationMs: file.durationMs,
    fileUrl: file.fileUrl,
    peaks: file.peaks,
  };
}

/** What a row already says about its file, so a sound plays the moment it is added. */
export function rowSoundInfo(
  view: LibrarySoundView | SoundUploadView,
  kind: SoundKind,
): SoundFileInfo {
  return {
    missing: false,
    removed: false,
    name: view.name,
    kind,
    durationMs: view.durationMs,
    fileUrl: 'previewUrl' in view ? view.previewUrl : view.fileUrl,
    peaks: view.peaks,
  };
}

/** The key a row's sound is known by (`soundRefKey` of the ref it adds). */
export function rowSoundKey(view: { id: string }, from: 'library' | 'upload'): string {
  return from === 'library' ? `library:${view.id}` : `asset:${view.id}`;
}

/** The files the clip plays that the editor does not know yet. */
export function unknownSoundFiles(
  doc: Pick<ClipDocument, 'tracks'>,
  known: ReadonlyMap<string, SoundFileInfo>,
): { library: string[]; asset: string[] } {
  const library: string[] = [];
  const asset: string[] = [];
  for (const ref of soundFilesNeeded(doc)) {
    if (known.has(ref.key)) continue;
    if ('library' in ref) library.push(ref.library);
    else asset.push(ref.asset);
  }
  return { library, asset };
}

/** The addresses the preview's audio layer fetches, by key. */
export function layerFiles(known: ReadonlyMap<string, SoundFileInfo>): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (const [key, info] of known) {
    if (!info.missing && info.fileUrl) files.push([key, info.fileUrl]);
  }
  return files;
}

export function soundInfoOfItem(
  item: Pick<AudioItem, 'ref'>,
  known: ReadonlyMap<string, SoundFileInfo>,
): SoundFileInfo | null {
  return known.get(soundRefKey(item.ref)) ?? null;
}

// --- Drawings -----------------------------------------------------------------------

/**
 * A sound's shape as one closed SVG path, mirrored around the middle:
 * `peaks` (0 to 255) across `width`, at most `height` tall. `fill` (0 to 1)
 * draws only that share of the width, for an effect whose bar runs past
 * its file's end (silent there).
 */
export function peaksPath(
  peaks: readonly number[] | null,
  width: number,
  height: number,
  fill = 1,
): string {
  if (!peaks || peaks.length < 2 || !(width > 0) || !(height > 0)) return '';
  const drawn = Math.max(0, Math.min(1, fill)) * width;
  if (drawn <= 0) return '';
  const middle = height / 2;
  const step = drawn / (peaks.length - 1);
  const amp = (value: number) => Math.max(0.5, (Math.max(0, Math.min(255, value)) / 255) * middle);
  const round = (value: number) => Math.round(value * 100) / 100;
  const top = peaks.map((value, index) => `${round(index * step)} ${round(middle - amp(value))}`);
  const bottom = peaks
    .map((value, index) => `${round(index * step)} ${round(middle + amp(value))}`)
    .reverse();
  return `M${top.join(' L')} L${bottom.join(' L')} Z`;
}

/** The meter's floor: quieter than this reads as empty. */
const METER_FLOOR_DB = -48;

/** The level meter's fill, 0 to 100, on a decibel scale (0 dBFS is full). */
export function meterPercent(level: number): number {
  if (!(level > 0) || !Number.isFinite(level)) return 0;
  const db = 20 * Math.log10(level);
  return Math.round(Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB)) * 100);
}

/** Whether the mix peaks (the meter turns to the warning colour). */
export function meterWarns(level: number): boolean {
  return level >= METER_WARN_LEVEL;
}

/** A volume (0 to 2) as the slider's percent. */
export function volumePercent(volume: number): number {
  return Math.round(Math.max(0, Math.min(2, volume)) * 100);
}
