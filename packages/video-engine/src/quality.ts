/**
 * Export qualities: the ids the export route, the job and the plan value
 * (`clips.export_max_quality`) share. Ordered low to high, so "at or below
 * the plan's quality" is an index comparison. 4K is listed in the plan
 * registry as reserved and is not offered here.
 *
 * The encode settings for each id are in `render/quality.ts`.
 */

export const EXPORT_QUALITIES = ['720p', '720p60', '1080p', '1080p60'] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];

export const QUALITY_LABELS: Readonly<Record<ExportQuality, string>> = Object.freeze({
  '720p': '720p',
  '720p60': '720p 60 fps',
  '1080p': '1080p',
  '1080p60': '1080p 60 fps',
});

export function isExportQuality(value: unknown): value is ExportQuality {
  return typeof value === 'string' && (EXPORT_QUALITIES as readonly string[]).includes(value);
}

/** Whether `wanted` is at or below `allowed` in the quality ladder. */
export function qualityAllowed(wanted: ExportQuality, allowed: string): boolean {
  const ceiling = (EXPORT_QUALITIES as readonly string[]).indexOf(allowed);
  return ceiling >= 0 && EXPORT_QUALITIES.indexOf(wanted) <= ceiling;
}
