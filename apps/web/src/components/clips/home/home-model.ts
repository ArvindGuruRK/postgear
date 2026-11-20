/**
 * The words and numbers of the Clips home (Sprint 12, Module 06), as pure
 * functions so every sentence is tested without a browser.
 *
 * - Sizes are decimal (a gigabyte is 10^9 bytes, as the plan card and the
 *   API's `clips.units.ts` count them), so "50 GB" here is the plan's 50.
 * - Dates are written in UTC and in one fixed English form ("1 December",
 *   "28 Nov"): the server and the browser render the same text, so there is
 *   no flash after hydration, and a cycle that ends at midnight UTC never
 *   reads as the day before in a western time zone.
 * - Limit sentences come from the plan values the API resolved, never a
 *   number written here.
 */
import { refusalMessage } from '@postgear/entitlements';
import { clipStorageOverLine } from '@postgear/scheduling';
import {
  CLIP_MAX_MS,
  type ClipPlatformId,
  formatVideoLength,
  PLATFORM_NAMES,
} from '@postgear/video-engine';
import type {
  ClipJobView,
  ClipsMeterView,
  ClipsStatus,
  ClipVideoCard,
  ClipVideoPlatform,
} from '@/types/clips';

const BYTES_PER_GB = 1_000_000_000;
const BYTES_PER_MB = 1_000_000;

/** "412 MB", "1.4 GB", "50 GB". Never negative, never "NaN". */
export function formatSize(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < BYTES_PER_GB) {
    return `${Math.round(safe / BYTES_PER_MB).toLocaleString('en-GB')} MB`;
  }
  const gb = safe / BYTES_PER_GB;
  const rounded = gb >= 100 ? Math.round(gb) : Math.round(gb * 10) / 10;
  return `${rounded.toLocaleString('en-GB')} GB`;
}

/** "1 December" in UTC; null for a date that does not read. */
export function formatDayMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** "28 Nov" in UTC; null for a date that does not read. */
export function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// --- The storage meter ------------------------------------------------------------

/** The meter turns to the warning colour from here (blueprint section 2). */
export const STORAGE_WARN_PERCENT = 80;

export interface StorageMeterView {
  /** "12.4 GB of 50 GB", or "12.4 GB used" when the plan has no ceiling. */
  text: string;
  /** 0 to 100, or null without a ceiling. */
  percent: number | null;
  warning: boolean;
  full: boolean;
  /** Two lines for the tooltip. */
  lines: string[];
}

export const STORAGE_HELP = 'Videos you bring in count here. Exported clips are in Media.';

/** "Import minutes this month: 120 of 900 left." (or "Unlimited import minutes this month."). */
export function importMinutesLine(meter: ClipsMeterView | null | undefined): string | null {
  if (!meter) return null;
  if (meter.limit === null || meter.remaining === null) {
    return 'Unlimited import minutes this month.';
  }
  const left = Math.max(0, meter.remaining);
  return `Import minutes this month: ${left.toLocaleString('en-GB')} of ${meter.limit.toLocaleString('en-GB')} left.`;
}

export function storageMeterView(status: ClipsStatus): StorageMeterView {
  const used = Math.max(0, status.usage?.storageBytes ?? status.storage.usedBytes);
  const limit = status.storage.limitBytes;
  const lines = [STORAGE_HELP];
  const minutes = importMinutesLine(status.meters?.importMinutes);
  if (minutes) lines.push(minutes);

  if (limit === null || limit <= 0) {
    return {
      text: limit === null ? `${formatSize(used)} used` : `${formatSize(used)} of 0 GB`,
      percent: limit === null ? null : 100,
      warning: limit !== null,
      full: limit !== null,
      lines,
    };
  }
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return {
    text: `${formatSize(used)} of ${formatSize(limit)}`,
    percent,
    warning: percent >= STORAGE_WARN_PERCENT,
    full: used >= limit,
    lines,
  };
}

/** Module 19: what the space holds, for the meter's panel ("Videos: 3.2 GB"). */
export function storageBreakdown(
  status: ClipsStatus,
): Array<{ label: string; bytes: number; text: string }> {
  const byKind = status.usage?.byKind;
  if (!byKind) return [];
  return [
    { label: 'Videos', bytes: byKind.videos },
    { label: 'Downloads', bytes: byKind.downloads },
    { label: 'Your stickers and sounds', bytes: byKind.library },
  ].map((row) => ({ ...row, text: formatSize(row.bytes) }));
}

/**
 * Module 19: the page's warning after a downgrade, the same sentence the API
 * refuses with (`clipStorageOverLine`), or null while under the plan.
 */
export function storageOverSentence(status: ClipsStatus): string | null {
  const limit = status.storage.limitBytes;
  if (!status.overLimit || limit === null) return null;
  const used = status.usage?.storageBytes ?? status.storage.usedBytes;
  return clipStorageOverLine(used / BYTES_PER_GB, limit / BYTES_PER_GB);
}

/** Module 19: whether the plan has Clips at all (`clips.enabled`); unknown reads as yes. */
export function clipsInPlan(status: ClipsStatus | null): boolean {
  return status?.limits?.['clips.enabled'] !== false;
}

/** The plan sentence, from the one place refusals are written. */
export const CLIPS_NOT_IN_PLAN_SENTENCE = refusalMessage('clips_not_in_plan', {});

// --- The AI minutes chip ------------------------------------------------------------

/**
 * The chip turns to the warning colour when less than this share is left
 * (Module 06's rule, which is more specific than the blueprint's "past 80%").
 */
export const AI_MINUTES_LOW_SHARE = 0.1;

export type AiMinutesTone = 'plenty' | 'low' | 'none' | 'unlimited' | 'unknown';

export interface AiMinutesChipView {
  text: string;
  tone: AiMinutesTone;
  tooltip: string;
  /** Offer See Plans beside the chip. */
  seePlans: boolean;
}

export const AI_MINUTES_HELP = 'AI minutes are used when Clips looks through a video for you.';

/** What the chip says for the `clips.ai_minutes_per_month` meter. */
export function aiMinutesChipView(
  meter: { limit: number | null; remaining: number | null; cycleEnd: string } | null,
): AiMinutesChipView {
  if (!meter) {
    return { text: 'AI minutes', tone: 'unknown', tooltip: AI_MINUTES_HELP, seePlans: false };
  }
  const day = formatDayMonth(meter.cycleEnd);
  const reset = day ? ` They reset on ${day}.` : '';

  if (meter.limit === null || meter.remaining === null) {
    return {
      text: 'Unlimited AI minutes',
      tone: 'unlimited',
      tooltip: AI_MINUTES_HELP,
      seePlans: false,
    };
  }
  const limit = Math.max(0, Math.floor(meter.limit));
  const left = Math.min(limit, Math.max(0, Math.floor(meter.remaining)));
  if (left === 0) {
    return {
      text: 'No AI minutes left',
      tone: 'none',
      tooltip: `This workspace has used all its AI minutes for this month.${reset}`,
      seePlans: true,
    };
  }
  return {
    text: `${left.toLocaleString('en-GB')} of ${limit.toLocaleString('en-GB')} AI minutes left`,
    tone: left < limit * AI_MINUTES_LOW_SHARE ? 'low' : 'plenty',
    tooltip: `${AI_MINUTES_HELP}${reset}`,
    seePlans: false,
  };
}

// --- The link box -------------------------------------------------------------------

const PLATFORM_ORDER: readonly ClipPlatformId[] = ['youtube', 'twitch', 'kick'];

/** "YouTube, Twitch or Kick", only the platforms switched on, in a fixed order. */
export function platformList(platforms: readonly ClipPlatformId[]): string {
  const names = PLATFORM_ORDER.filter((id) => platforms.includes(id)).map(
    (id) => PLATFORM_NAMES[id],
  );
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** The link field's placeholder: "Enter your YouTube, Twitch or Kick link". */
export function linkPlaceholder(platforms: readonly ClipPlatformId[]): string {
  const list = platformList(platforms);
  return list ? `Enter your ${list} link` : 'Enter your video link';
}

/**
 * Where a newly brought in video opens once it is ready (2026-11-19): an
 * upload, a platform clip or a short goes straight into the editor as one
 * whole clip (it already is the moment); a video or a past stream opens its
 * video page, where Find Clips and the moment picker are. A video longer
 * than a clip may be always opens its video page.
 */
export function openTarget(video: {
  platform: string;
  kind: string;
  durationMs: number | null;
}): 'edit' | 'video' {
  if (video.durationMs === null || video.durationMs > CLIP_MAX_MS) return 'video';
  if (video.platform === 'upload') return 'edit';
  return video.kind === 'clip' || video.kind === 'short' ? 'edit' : 'video';
}

/** What Find Clips says when it is pressed with an empty field (2026-11-19). */
export function emptyLinkSentence(platforms: readonly ClipPlatformId[]): string {
  const list = platformList(platforms);
  return list ? `Paste a video link from ${list}.` : 'Paste a video link first.';
}

/** Platforms in the order the page draws them. */
export function orderedPlatforms(platforms: readonly ClipPlatformId[]): ClipPlatformId[] {
  return PLATFORM_ORDER.filter((id) => platforms.includes(id));
}

/** What a refusal adds beside its sentence. */
export interface RefusalExtras {
  seePlans: boolean;
  upload: boolean;
}

const UPLOAD_HELPS: ReadonlySet<string> = new Set([
  'link_unsupported',
  'platform_resting',
  'platform_paused',
]);

/** A plan limit (`clips_*`, `channel_limit`) offers See Plans; a link we cannot read offers Upload A Video. */
export function refusalExtras(code: string | undefined): RefusalExtras {
  if (!code) return { seePlans: false, upload: false };
  return {
    seePlans: code.startsWith('clips_') || code === 'channel_limit',
    upload: UPLOAD_HELPS.has(code),
  };
}

// --- Cards --------------------------------------------------------------------------

export const PLATFORM_LABELS: Readonly<Record<ClipVideoPlatform, string>> = Object.freeze({
  youtube: 'YouTube',
  twitch: 'Twitch',
  kick: 'Kick',
  upload: 'Upload',
});

const KIND_WORDS: Readonly<Record<string, string>> = Object.freeze({
  video: 'Video',
  past_stream: 'Past stream',
  clip: 'Clip',
  short: 'Short',
  upload: 'Upload',
});

/** The kind in words for a link card: "Past stream". */
export function kindWords(kind: string): string {
  return KIND_WORDS[kind] ?? 'Video';
}

/** "Twitch, 3 h 42 min, 12 clips". */
export function videoMetaLine(card: ClipVideoCard, options: { withSize?: boolean } = {}): string {
  const parts: string[] = [PLATFORM_LABELS[card.video.platform] ?? 'Video'];
  if (card.video.durationMs !== null && card.video.durationMs > 0) {
    parts.push(formatVideoLength(card.video.durationMs));
  }
  if (typeof card.clipCount === 'number' && card.clipCount > 0) {
    parts.push(card.clipCount === 1 ? '1 clip' : `${card.clipCount.toLocaleString('en-GB')} clips`);
  }
  // Module 19: sorted by size, each card says what it keeps.
  if (options.withSize && typeof card.storedBytes === 'number') {
    parts.push(formatSize(card.storedBytes));
  }
  return parts.join(', ');
}

/** "Kept until 28 Nov", or null when the video has no end date. */
export function keptUntilLine(expiresAt: string | null): string | null {
  const day = formatShortDate(expiresAt);
  return day ? `Kept until ${day}` : null;
}

const DAY_MS = 86_400_000;
/** Module 19: the card warns from here, matching the bell's "removed in 3 days" notice. */
export const REMOVED_SOON_DAYS = 3;

/**
 * Module 19: the card's keeping line. "Kept until 28 Nov" while the date is
 * far; inside three days "Removed in 2 days" (or "Removed today") in the
 * warning colour, with a hint that opening the video keeps it longer.
 */
export function keptUntilView(
  expiresAt: string | null,
  now: number = Date.now(),
): { text: string; soon: boolean } | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  const left = at - now;
  if (left > REMOVED_SOON_DAYS * DAY_MS) {
    const day = formatShortDate(expiresAt);
    return day ? { text: `Kept until ${day}`, soon: false } : null;
  }
  const days = Math.ceil(left / DAY_MS);
  if (days <= 0) return { text: 'Removed today', soon: true };
  return { text: days === 1 ? 'Removed in 1 day' : `Removed in ${days} days`, soon: true };
}

/** Module 19: the hint under a soon-removed card's line. */
export const OPEN_TO_KEEP_HINT = 'Open it to keep it longer.';

/**
 * Time left in words, from the job's estimate: whole minutes rounded up,
 * "Less than a minute left" under 90 seconds, nothing when unknown.
 */
export function etaLabel(etaSeconds: number | null | undefined): string | null {
  if (etaSeconds === null || etaSeconds === undefined || !Number.isFinite(etaSeconds)) return null;
  if (etaSeconds < 0) return null;
  if (etaSeconds < 90) return 'Less than a minute left';
  const minutes = Math.ceil(etaSeconds / 60);
  return `About ${minutes.toLocaleString('en-GB')} minutes left`;
}

/** The step in words for a busy card (the API's label, which already says "Waiting for its turn"). */
export function stageLabel(job: Pick<ClipJobView, 'stageLabel'> | null): string {
  return job?.stageLabel?.trim() || 'Getting ready';
}

/** The delete dialog's sentence, counting the clips that go with the video. */
export function deleteVideoSentence(unexportedClips: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(unexportedClips) ? unexportedClips : 0));
  if (n === 0) return 'Delete this video? Exported clips stay in Media.';
  if (n === 1) {
    return 'Delete this video and its 1 clip that was never exported? Exported clips stay in Media.';
  }
  return `Delete this video and its ${n.toLocaleString('en-GB')} clips that were never exported? Exported clips stay in Media.`;
}

// --- Uploads ------------------------------------------------------------------------

/** The containers an upload may be (the API's own list). */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'video/mp4': 'mp4',
  'video/x-m4v': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
});

const EXTENSION_TYPES: Readonly<Record<string, string>> = Object.freeze({
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
});

export const UPLOAD_ACCEPT =
  '.mp4,.m4v,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm';

export const UPLOAD_NOT_VIDEO = 'This file is not a video we can read. Use MP4, MOV, MKV or WebM.';

/**
 * The type to declare for a file: its own when it is one we take, else the
 * one its name says (Windows often reports MKV as nothing at all). Null when
 * neither is a video we read.
 */
export function uploadTypeOf(file: { name: string; type: string }): string | null {
  const own = file.type.toLowerCase();
  if (own && UPLOAD_TYPES[own]) return own;
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? (EXTENSION_TYPES[extension] ?? null) : null;
}

/** The plan's upload cap in bytes, from `clips.upload_max_gb`, or null when unknown or unlimited. */
export function uploadMaxBytes(status: ClipsStatus | null): number | null {
  const gb = status?.limits?.['clips.upload_max_gb'];
  return typeof gb === 'number' && Number.isFinite(gb) && gb >= 0 ? gb * BYTES_PER_GB : null;
}

/** The plan's longest video in milliseconds, from `clips.max_video_minutes`, or null. */
export function maxVideoMs(status: ClipsStatus | null): number | null {
  const minutes = status?.limits?.['clips.max_video_minutes'];
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0
    ? minutes * 60_000
    : null;
}

/** "MP4, MOV, MKV or WebM, up to 2 GB". */
export function uploadHelpLine(status: ClipsStatus | null): string {
  const max = uploadMaxBytes(status);
  return max === null ? 'MP4, MOV, MKV or WebM' : `MP4, MOV, MKV or WebM, up to ${formatSize(max)}`;
}

/**
 * Why a file will be refused before a byte is sent, or null. Advice, not a
 * control: the API checks the real bytes again.
 */
export function preflightClipUpload(
  file: { name: string; type: string; size: number },
  status: ClipsStatus | null,
): string | null {
  if (!uploadTypeOf(file)) return UPLOAD_NOT_VIDEO;
  if (file.size <= 0) return UPLOAD_NOT_VIDEO;
  const max = uploadMaxBytes(status);
  if (max !== null && file.size > max) {
    const gb = (status?.limits?.['clips.upload_max_gb'] as number) ?? 0;
    return `This file is ${formatSize(file.size)}. ${refusalMessage('clips_upload_too_big', { n: gb })}`;
  }
  return null;
}

/** The plan's sentence for a file longer than it allows, or null. */
export function preflightLength(
  durationMs: number | null,
  status: ClipsStatus | null,
): string | null {
  const max = maxVideoMs(status);
  if (durationMs === null || max === null || durationMs <= max) return null;
  return refusalMessage('clips_video_too_long', { n: Math.round(max / 60_000) });
}
