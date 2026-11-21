/**
 * The Export tab's words and pure helpers (Module 15 section 7): the notes,
 * the summary line, the time left, the loudness line, and which exports are
 * still current. The UI never says render, job or fingerprint: a person
 * sees an export, a preview, and whether the clip changed since.
 */
import {
  type AudioItem,
  type ClipDocument,
  type ExportQuality,
  estimateBytes,
  fingerprintMatches,
  formatBytes,
  formatClipLength,
  isSixtyFps,
  outputDuration,
  QUALITY_LABELS,
  SMOOTH_SOURCE_FPS,
  type StickerItem,
  shapeLabel,
} from '@postgear/video-engine';
import type { ClipExportLoudness, ClipExportView, ClipJobView } from '@/types/clips';

export const EXPORT_UNSAVED_SENTENCE =
  'Your latest changes are not saved yet, so the export would leave them out. Try again once they are saved.';
export const EXPORT_UNREACHABLE_SENTENCE =
  'We could not start the export. Check your connection and try again.';
export const EXPORT_FAILED_SENTENCE =
  'We could not export this clip. Nothing was charged. Try again.';
export const PREVIEW_FAILED_SENTENCE = 'We could not make the preview. Try again.';
export const PREVIEW_LINE = 'The editor is a fast preview. Preview Export shows the real result.';
export const PREVIEW_SMALLER = 'This preview is a smaller copy. Your export will be sharper.';
export const PREVIEW_STALE = 'You changed this clip after the last preview.';
export const OUT_OF_DATE = 'You changed this clip after the last export.';
/** Module 17: the toast when an export this editor watched is done. */
export const EXPORT_DONE_SENTENCE = 'Your clip is exported.';
export const MARK_LINE = 'Exports on this plan carry a small PostGear mark.';
export const SIXTY_FPS_LINE = 'This video is 30 fps, so 60 fps will not look smoother.';
export const SHARP_GONE_LINE =
  'The sharp video is no longer online. This clip will export at 720p from the copy we kept.';
export const SHARP_FETCHING_LINE =
  'We are still getting the sharp video. An export now waits for it before it starts.';
export const ZOOM_LINE = 'Exports are sharper than the preview.';
export const SHARP_LOCK_LINE = 'The copy we kept is 720p, so this clip exports at 720p.';
export const LEAVE_OUT_TITLE = 'Leave Out Removed Items';

/** The 402 code the API answers above the plan's quality. */
export const QUALITY_LOCK_CODE = 'clips_quality_requires_plan';

/** "Vertical 9:16, 0:42, 1080p, about 26 MB" */
export function summaryLine(doc: ClipDocument, quality: ExportQuality): string {
  const ms = outputDuration(doc);
  return `${shapeLabel(doc)}, ${formatClipLength(ms)}, ${QUALITY_LABELS[quality]}, about ${formatBytes(estimateBytes(quality, ms))}`;
}

/** The notes under the summary, each only when true, in a fixed order. */
export function exportNotes(input: {
  doc: ClipDocument;
  quality: ExportQuality;
  mark: boolean;
  sourceFps: number | null;
  sharp: 'ready' | 'fetching' | 'gone';
}): string[] {
  const notes: string[] = [];
  if (input.mark) notes.push(MARK_LINE);
  if (
    isSixtyFps(input.quality) &&
    input.sourceFps !== null &&
    input.sourceFps < SMOOTH_SOURCE_FPS
  ) {
    notes.push(SIXTY_FPS_LINE);
  }
  if (input.sharp === 'gone') notes.push(SHARP_GONE_LINE);
  if (input.sharp === 'fetching') notes.push(SHARP_FETCHING_LINE);
  if (input.doc.zooms.length > 0) notes.push(ZOOM_LINE);
  return notes;
}

/** "About 3 minutes left", or null when there is no honest answer yet. */
export function timeLeft(etaSeconds: number | null): string | null {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds < 0) return null;
  if (etaSeconds < 60) return 'Less than a minute left';
  const minutes = Math.round(etaSeconds / 60);
  return minutes === 1 ? 'About 1 minute left' : `About ${minutes} minutes left`;
}

/** "Evened out to about -14 LUFS.", or null when the export had no sound to even out. */
export function loudnessLine(loudness: ClipExportLoudness | null): string | null {
  if (!loudness || loudness.finalLufs === null) return null;
  if (loudness.mode === 'skipped') {
    return loudness.inputLufs === null
      ? null
      : `Already even, at about ${Math.round(loudness.finalLufs)} LUFS.`;
  }
  return `Evened out to about ${Math.round(loudness.finalLufs)} LUFS.`;
}

const RUNNING = new Set<ClipJobView['status']>(['QUEUED', 'RUNNING']);

export function isRunning(job: ClipJobView | null | undefined): boolean {
  return job ? RUNNING.has(job.status) : false;
}

/** The newest export that is still going, to follow on open. */
export function runningExport(exports: readonly ClipExportView[]): ClipExportView | null {
  return exports.find((row) => isRunning(row.job)) ?? null;
}

/** The newest finished export with its file. */
export function latestDone(exports: readonly ClipExportView[]): ClipExportView | null {
  return exports.find((row) => row.job.status === 'DONE' && row.media !== null) ?? null;
}

/** Whether the clip changed after `fingerprint` was taken (null: nothing to compare). */
export function changedSince(doc: ClipDocument, fingerprint: string | null): boolean {
  return fingerprint !== null && !fingerprintMatches(doc, fingerprint);
}

/** "Nov 19, 10:42" in the person's own locale. */
export function exportDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** The stickers and sounds whose files are gone (removed from the library, or a deleted upload). */
export function goneItems(
  doc: ClipDocument,
  stickerGone: (item: StickerItem) => boolean,
  soundGone: (item: AudioItem) => boolean,
): { stickers: string[]; sounds: string[] } {
  const stickers: string[] = [];
  const sounds: string[] = [];
  for (const track of doc.tracks) {
    if (track.kind === 'captions') continue;
    for (const item of track.items) {
      if (item.type === 'sticker' && stickerGone(item)) stickers.push(item.id);
      if ((item.type === 'sfx' || item.type === 'music') && soundGone(item)) sounds.push(item.id);
    }
  }
  return { stickers, sounds };
}

/** The sentence that asks before an export leaves out what left the library. */
export function leaveOutSentence(stickers: number, sounds: number): string {
  const parts: string[] = [];
  if (sounds > 0) parts.push(sounds === 1 ? 'a sound' : `${sounds} sounds`);
  if (stickers > 0) parts.push(stickers === 1 ? 'a sticker' : `${stickers} stickers`);
  const total = stickers + sounds;
  const were = total === 1 ? 'was' : 'were';
  const them = total === 1 ? 'it' : 'them';
  return `This clip uses ${parts.join(' and ')} that ${were} removed. Export without ${them}?`;
}
