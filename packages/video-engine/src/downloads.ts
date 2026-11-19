/**
 * Download in any format (Sprint 12, Module 18): the rules the API, the
 * worker and the web share, kept pure so each side reads them the same way.
 *
 * - **What is offered**: the probe's formats up to 1080p (Module 03 already
 *   keeps one per height, H.264 with AAC preferred), tallest first, then
 *   Audio Only. Nothing above 1080p in this sprint.
 * - **What is delivered**: video as MP4, Audio Only as MP3.
 * - **The saved file's name**: the video's title made safe for every file
 *   system, with the right extension.
 * - **How long it is kept**: 24 hours from when it finished; the row says
 *   "Expires in 23 hours" until then.
 */
import { formatBytes } from './export';
import type { LinkFormat } from './links/types';

/** The tallest picture a download offers this sprint. */
export const DOWNLOAD_MAX_HEIGHT = 1080;

/** What the worker delivers. */
export type DownloadExtension = 'mp4' | 'mp3';

/** The longest saved file name, extension included. */
const MAX_FILE_NAME = 150;

/** Downloads being prepared at once in one workspace: a fixed safety cap, not a plan value. */
export const MAX_OPEN_DOWNLOADS = 3;

/**
 * The `stage` a DOWNLOAD row takes when someone deletes it. The file and its
 * asset row go, the job row stays as the rights record (research 07: the row
 * and its rights record stay after the files are deleted), and the Downloads
 * tab no longer lists it. A terminal row's stage is never shown as a step.
 */
export const DOWNLOAD_REMOVED_STAGE = 'removed';

/**
 * The formats a person may download: every video height up to 1080p,
 * tallest first, then Audio Only. Anything taller, or a format with no
 * height that is not the audio entry, is left out.
 */
export function downloadableFormats(formats: readonly LinkFormat[]): LinkFormat[] {
  const video = formats
    .filter(
      (format) =>
        !format.audioOnly && format.height !== null && format.height <= DOWNLOAD_MAX_HEIGHT,
    )
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const audio = formats.find((format) => format.audioOnly);
  return audio ? [...video, audio] : video;
}

/** "1080p (412 MB)", "720p", "Audio Only": the menu's words (a size only when the platform gave one). */
export function downloadMenuLabel(format: Pick<LinkFormat, 'label' | 'bytes' | 'audioOnly'>): string {
  if (format.audioOnly) return 'Audio Only';
  return typeof format.bytes === 'number' && format.bytes > 0
    ? `${format.label} (${formatBytes(format.bytes)})`
    : format.label;
}

/** MP3 for Audio Only, MP4 for everything else. */
export function downloadExtension(audioOnly: boolean): DownloadExtension {
  return audioOnly ? 'mp3' : 'mp4';
}

/**
 * The saved file's name: the title without control characters, path
 * separators, quotes or characters Windows refuses, spaces collapsed, no
 * leading dots, at most 150 characters with the extension. "Download" when
 * nothing is left. `ext` is ours (`mp4`, `mp3`, or an upload's own `mov`),
 * never typed by a person.
 */
export function downloadFileName(title: string, ext: DownloadExtension | string): string {
  const cleaned = Array.from(title.normalize('NFC'))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[\\/:*?"<>|;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  const room = MAX_FILE_NAME - ext.length - 1;
  const stem = Array.from(cleaned).slice(0, room).join('').replace(/[.\s]+$/, '');
  return `${stem === '' ? 'Download' : stem}.${ext}`;
}

/**
 * "Expires in 23 hours", "Expires in 1 hour", "Expires in 40 minutes",
 * "Expires in less than a minute"; null once it has expired (or the date
 * does not read). Whole hours round down, so the row never promises time
 * that is not there.
 */
export function expiresInLine(expiresAt: string | null, now: Date = new Date()): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  const left = at - now.getTime();
  if (left <= 0) return null;
  const minutes = Math.floor(left / 60_000);
  if (minutes < 1) return 'Expires in less than a minute';
  if (minutes < 60) return `Expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** True once the download's 24 hours are over. A row with no date is not expired. */
export function isDownloadExpired(expiresAt: Date | string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const at = (expiresAt instanceof Date ? expiresAt : new Date(expiresAt)).getTime();
  return !Number.isNaN(at) && at <= now.getTime();
}
