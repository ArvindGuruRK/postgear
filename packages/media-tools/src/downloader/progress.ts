/**
 * Progress from yt-dlp and FFmpeg, turned into one rising percentage.
 *
 * yt-dlp prints our own template (`--progress-template`, research 04
 * section 2.5) so the line format is ours and stable across releases.
 * FFmpeg prints `key=value` lines with `-progress pipe:1`; only the output
 * time is read here.
 */
import type { FetchProgress, OnFetchProgress } from './types';

/** The `--progress-template` value. Fields are separated by `|`; missing numbers print `NA`. */
export const YTDLP_PROGRESS_TEMPLATE =
  'download:PG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(progress.eta)s';

/** One parsed progress line. Unknown numbers are null. */
export interface YtDlpProgressLine {
  status: string;
  downloadedBytes: number | null;
  totalBytes: number | null;
  totalBytesEstimate: number | null;
  fragmentIndex: number | null;
  fragmentCount: number | null;
  etaSec: number | null;
}

function numberOrNull(text: string | undefined): number | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === 'NA' || trimmed === 'None' || trimmed === 'null') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Reads a `PG|...` line; anything else (yt-dlp's own chatter) is null. */
export function parseYtDlpProgressLine(line: string): YtDlpProgressLine | null {
  const start = line.indexOf('PG|');
  if (start === -1) return null;
  const parts = line
    .slice(start + 3)
    .trim()
    .split('|');
  if (parts.length < 7) return null;
  const status = (parts[0] ?? '').trim();
  if (!/^[a-z_]{1,20}$/.test(status)) return null;
  return {
    status,
    downloadedBytes: numberOrNull(parts[1]),
    totalBytes: numberOrNull(parts[2]),
    totalBytesEstimate: numberOrNull(parts[3]),
    fragmentIndex: numberOrNull(parts[4]),
    fragmentCount: numberOrNull(parts[5]),
    etaSec: numberOrNull(parts[6]),
  };
}

/** 0 to 100 for one file: bytes against the total (or its estimate), else fragments; null when unknown. */
export function ytDlpLinePercent(line: YtDlpProgressLine): number | null {
  if (line.status === 'finished') return 100;
  const total = line.totalBytes ?? line.totalBytesEstimate;
  if (line.downloadedBytes !== null && total !== null && total > 0) {
    return clampPercent((line.downloadedBytes / total) * 100);
  }
  if (line.fragmentIndex !== null && line.fragmentCount !== null && line.fragmentCount > 0) {
    return clampPercent((line.fragmentIndex / line.fragmentCount) * 100);
  }
  return null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** A slice of the overall bar a step owns, for example 0 to 80 for a download then 80 to 100 for a cut. */
export interface ProgressSpan {
  from: number;
  to: number;
}

/**
 * Turns a stream of percentages into calls of `onProgress` that only rise,
 * scaled into `span`, and skips repeats so a job row is not written for
 * nothing. Returns the reporter; `null` reports "busy, no number".
 */
export function createSpanReporter(
  onProgress: OnFetchProgress,
  span: ProgressSpan,
): (percent: number | null, bytes?: number) => void {
  let best = -1;
  let sentNull = false;
  return (percent, bytes) => {
    if (percent === null) {
      if (!sentNull && best < 0) {
        sentNull = true;
        safeReport(onProgress, { percent: null, ...(bytes !== undefined ? { bytes } : {}) });
      }
      return;
    }
    const scaled = span.from + ((span.to - span.from) * clampPercent(percent)) / 100;
    const rounded = Math.round(scaled * 10) / 10;
    if (rounded <= best) return;
    best = rounded;
    safeReport(onProgress, { percent: rounded, ...(bytes !== undefined ? { bytes } : {}) });
  };
}

/** A progress callback that throws must not break a download. */
function safeReport(onProgress: OnFetchProgress, progress: FetchProgress): void {
  try {
    onProgress(progress);
  } catch {
    // The caller's bookkeeping failed; the download itself is fine.
  }
}

/**
 * The line handler for a yt-dlp download of `parts` files (2 when the video
 * and the sound come separately and are merged). Each part fills an equal
 * share of `span`; a `finished` line moves on to the next part.
 */
export function createYtDlpProgressHandler(
  parts: number,
  report: (percent: number | null, bytes?: number) => void,
): (line: string) => void {
  const total = Math.max(1, Math.floor(parts));
  let part = 0;
  return (line) => {
    const parsed = parseYtDlpProgressLine(line);
    if (!parsed) return;
    const percent = ytDlpLinePercent(parsed);
    const bytes = parsed.downloadedBytes ?? undefined;
    if (percent === null) {
      report(null, bytes);
    } else {
      report((part * 100 + percent) / total, bytes);
    }
    if (parsed.status === 'finished' && part < total - 1) {
      part += 1;
    }
  };
}

/**
 * The line handler for an FFmpeg run with `-progress pipe:1`: reads
 * `out_time_us` (or the misnamed `out_time_ms`, also microseconds) against
 * the expected output length.
 */
export function createFfmpegProgressHandler(
  expectedMs: number,
  report: (percent: number | null) => void,
): (line: string) => void {
  return (line) => {
    const match = /^out_time_(?:us|ms)=(\d+)\s*$/.exec(line.trim());
    if (match) {
      if (expectedMs <= 0) return;
      const outMs = Number(match[1]) / 1000;
      report((outMs / expectedMs) * 100);
      return;
    }
    if (line.trim() === 'progress=end') {
      report(100);
    }
  };
}
