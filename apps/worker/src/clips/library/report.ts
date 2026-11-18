/**
 * The licence report every ingest run writes (Module 12): one line per
 * accepted item with its evidence, and each rejection reason counted, as
 * JSON and as Markdown, into the private bucket. The operator reads a sample
 * (at least 20 items or 10 percent) before `clips:library:publish`.
 */
import type { RejectionReason, StickerCategory, StickerLicence } from './types';

export interface AcceptedItem {
  id: string | null;
  name: string;
  category: StickerCategory;
  licence: StickerLicence;
  creator: string;
  sourceUrl: string;
  originId: string;
  animated: boolean;
  width: number;
  height: number;
  bytes: number;
  fileKey: string;
}

export interface RejectedItem {
  name: string;
  originId: string;
  reason: RejectionReason;
  detail: string;
}

export interface LicenceReport {
  runId: string;
  origin: string;
  source: string;
  dryRun: boolean;
  autoPublished: boolean;
  startedAt: string;
  finishedAt: string;
  accepted: AcceptedItem[];
  rejected: RejectedItem[];
  rejectionsByReason: Partial<Record<RejectionReason, number>>;
}

export function countReasons(
  rejected: readonly RejectedItem[],
): Partial<Record<RejectionReason, number>> {
  const counts: Partial<Record<RejectionReason, number>> = {};
  for (const item of rejected) counts[item.reason] = (counts[item.reason] ?? 0) + 1;
  return counts;
}

/** A table cell: one line, no pipes. */
function cell(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/');
}

export function reportMarkdown(report: LicenceReport): string {
  const lines = [
    `# Licence Report: ${report.source}`,
    '',
    `Run ${report.runId} (${report.origin}${report.dryRun ? ', dry run, nothing stored' : ''}), ${report.startedAt} to ${report.finishedAt}.`,
    '',
    `Accepted: ${report.accepted.length}. Rejected: ${report.rejected.length}. ${
      report.dryRun
        ? 'Nothing was written.'
        : report.autoPublished
          ? 'Published straight away (--auto-publish).'
          : 'Waiting in STAGED until clips:library:publish.'
    }`,
    '',
    '## Rejections By Reason',
    '',
    '| Reason | Count |',
    '| --- | --- |',
    ...Object.entries(report.rejectionsByReason).map(
      ([reason, count]) => `| ${reason} | ${count} |`,
    ),
    '',
    '## Accepted',
    '',
    '| Name | Category | Licence | Creator | Kind | Size | Source |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.accepted.map(
      (item) =>
        `| ${cell(item.name)} | ${item.category} | ${item.licence} | ${cell(item.creator)} | ${
          item.animated ? 'moving' : 'still'
        } | ${item.width} x ${item.height}, ${Math.round(item.bytes / 1024)} KB | ${cell(item.sourceUrl)} |`,
    ),
    '',
    '## Rejected',
    '',
    '| Name | Id | Reason | Detail |',
    '| --- | --- | --- | --- |',
    ...report.rejected.map(
      (item) =>
        `| ${cell(item.name)} | ${cell(item.originId)} | ${item.reason} | ${cell(item.detail)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

// --- Sounds (Module 14) ---------------------------------------------------------

/** One accepted sound: the evidence the doc asks for (name, licence, author, source, retrieved date, checksum). */
export interface AcceptedSound {
  id: string | null;
  name: string;
  kind: 'sfx' | 'music';
  category: string;
  licence: string;
  creator: string;
  sourceUrl: string;
  originId: string;
  retrievedAt: string;
  /** SHA-256 of the file as the source served it. */
  sourceChecksum: string;
  durationMs: number;
  loudnessLufs: number;
  truePeakDb: number;
  bytes: number;
  fileKey: string;
}

export interface SoundLicenceReport extends Omit<LicenceReport, 'accepted'> {
  kind: 'sound';
  accepted: AcceptedSound[];
}

export function soundReportMarkdown(report: SoundLicenceReport): string {
  const review = report.rejected.filter((item) => item.reason === 'needs_review');
  const refused = report.rejected.filter((item) => item.reason !== 'needs_review');
  const lines = [
    `# Sound Licence Report: ${report.source}`,
    '',
    `Run ${report.runId} (${report.origin}${report.dryRun ? ', dry run, nothing stored' : ''}), ${report.startedAt} to ${report.finishedAt}.`,
    '',
    `Accepted: ${report.accepted.length}. Rejected: ${report.rejected.length} (${review.length} need a review). ${
      report.dryRun
        ? 'Nothing was written.'
        : report.autoPublished
          ? 'Published straight away (--auto-publish).'
          : 'Waiting in STAGED until clips:library:publish.'
    }`,
    '',
    '## Rejections By Reason',
    '',
    '| Reason | Count |',
    '| --- | --- |',
    ...Object.entries(report.rejectionsByReason).map(
      ([reason, count]) => `| ${reason} | ${count} |`,
    ),
    '',
    '## Accepted',
    '',
    '| Name | Kind | Category | Licence | Author | Source | Retrieved | Checksum | Length | Loudness |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.accepted.map(
      (item) =>
        `| ${cell(item.name)} | ${item.kind} | ${item.category} | ${item.licence} | ${cell(item.creator)} | ${cell(
          item.sourceUrl,
        )} | ${item.retrievedAt.slice(0, 10)} | ${item.sourceChecksum.slice(0, 16)} | ${(item.durationMs / 1000).toFixed(
          1,
        )} s | ${item.loudnessLufs.toFixed(1)} LUFS, ${item.truePeakDb.toFixed(1)} dBTP |`,
    ),
    '',
    '## Needs A Review',
    '',
    'The source does not show these are original works. They were not added; a person looks at each before any later run.',
    '',
    '| Name | Id | Detail |',
    '| --- | --- | --- |',
    ...review.map((item) => `| ${cell(item.name)} | ${cell(item.originId)} | ${cell(item.detail)} |`),
    '',
    '## Rejected',
    '',
    '| Name | Id | Reason | Detail |',
    '| --- | --- | --- | --- |',
    ...refused.map(
      (item) =>
        `| ${cell(item.name)} | ${cell(item.originId)} | ${item.reason} | ${cell(item.detail)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
