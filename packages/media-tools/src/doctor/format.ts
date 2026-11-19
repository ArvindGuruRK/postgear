/**
 * The doctor's report as plain lines, for `npm run clips:doctor` and the
 * worker's boot log. One line per check, each saying OK, WARN or FAIL.
 */
import type { DoctorLine, DoctorReport, ToolStatus } from './doctor';

type Mark = 'OK' | 'WARN' | 'FAIL';

function toolLine(name: string, status: ToolStatus, optional: boolean): string {
  const mark: Mark = status.ok ? (status.warning ? 'WARN' : 'OK') : optional ? 'WARN' : 'FAIL';
  const version = status.version ? ` ${status.version}` : '';
  const why = status.reason ?? status.warning;
  return `${pad(mark)} ${name}${version}${why ? `: ${why}` : ''}`;
}

function checkLine(name: string, line: DoctorLine, optional: boolean): string {
  const mark: Mark = line.ok ? 'OK' : optional ? 'WARN' : 'FAIL';
  return `${pad(mark)} ${name}${line.reason ? `: ${line.reason}` : ''}`;
}

function pad(mark: Mark): string {
  return `[${mark}]`.padEnd(6, ' ');
}

/**
 * Formats the report. FFmpeg, ffprobe and the render checks are hard
 * requirements (FAIL); yt-dlp, its runtime and impersonation only stop link
 * imports, so they show as WARN. Under simulation links are answered from
 * recordings, so a missing yt-dlp does not make link import "not ready".
 */
export function formatDoctorReport(
  report: DoctorReport,
  options: { simulation?: boolean } = {},
): string[] {
  const { render } = report.ffmpeg;
  return [
    toolLine('FFmpeg', report.ffmpeg, false),
    checkLine('Filter graph from a file (-/filter_complex)', render.filterComplexFile, false),
    checkLine('libass (text)', render.libass, false),
    checkLine('libharfbuzz (text shaping)', render.libharfbuzz, false),
    checkLine('libx264 (H.264)', render.libx264, false),
    checkLine('libmp3lame (Audio Only downloads)', report.ffmpeg.audio.libmp3lame, true),
    toolLine('ffprobe', report.ffprobe, false),
    toolLine('yt-dlp', report.ytDlp, true),
    checkLine('yt-dlp browser impersonation (Kick)', report.ytDlp.impersonation, true),
    toolLine('JavaScript runtime for yt-dlp (YouTube)', report.jsRuntime, true),
    report.ok
      ? report.linksOk
        ? 'Video tools are ready.'
        : options.simulation
          ? 'Video tools are ready. Links come from the recorded samples (CLIPS_SIMULATION), so yt-dlp is not needed.'
          : 'Video tools are ready for uploads and exports. Link import is not ready.'
      : 'Video tools are NOT ready: fix the FAIL lines above.',
  ];
}
