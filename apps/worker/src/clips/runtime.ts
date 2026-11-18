/**
 * The worker's video tools, as it sees them (Module 02, sections 3 and 4).
 *
 * The doctor runs once at boot and then at most once a minute, whatever the
 * number of pages asking: `clipRuntimeCheckWorkflow` answers from this cache,
 * and concurrent checks share one run.
 *
 * Boot rules:
 * - FFmpeg or ffprobe missing or too old stops the boot (needed even in
 *   simulation: imports normalise and exports render for real).
 * - With the `render` role, FFmpeg failing a render check (`-/filter_complex`
 *   from a file, libass, libharfbuzz, libx264) stops the boot.
 * - yt-dlp missing never stops it: uploads and exports still work, and the
 *   runtime report tells the page that links are not ready. (The docs warn
 *   only in simulation; stopping a worker that also publishes posts over an
 *   optional tool would trade a small outage for a large one.)
 */
import {
  type DoctorReport,
  formatDoctorReport,
  type RunTool,
  runDoctor,
  type ToolPaths,
} from '@postgear/media-tools';
import type { ClipRuntimeReport, ClipToolCheck } from '@postgear/scheduling';
import type { ClipPlatformId } from '@postgear/video-engine';

export const DOCTOR_FRESH_MS = 60_000;

export interface ClipRuntime {
  /** The cached report, refreshed when older than a minute. */
  report(): Promise<ClipRuntimeReport>;
  /** The raw doctor answer (boot logging). */
  doctor(force?: boolean): Promise<DoctorReport>;
}

export interface ClipRuntimeOptions {
  runTool: RunTool;
  paths: ToolPaths;
  simulation: boolean;
  platforms: readonly ClipPlatformId[];
  scratchRoot: string;
  now?: () => Date;
}

export function createClipRuntime(options: ClipRuntimeOptions): ClipRuntime {
  const now = options.now ?? (() => new Date());
  let cached: { at: number; report: DoctorReport } | null = null;
  let inFlight: Promise<DoctorReport> | null = null;

  const doctor = async (force = false): Promise<DoctorReport> => {
    if (!force && cached && now().getTime() - cached.at < DOCTOR_FRESH_MS) return cached.report;
    inFlight ??= runDoctor(options.runTool, options.paths, {
      now: now(),
      tempDir: options.scratchRoot,
    })
      .then((report) => {
        cached = { at: now().getTime(), report };
        return report;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    doctor,
    async report() {
      return toRuntimeReport(await doctor(), options.simulation, options.platforms);
    },
  };
}

/** The doctor's answer as the contract's report: one line per program and render check. */
export function toRuntimeReport(
  report: DoctorReport,
  simulation: boolean,
  platforms: readonly ClipPlatformId[],
): ClipRuntimeReport {
  const render = report.ffmpeg.render;
  const checks: ClipToolCheck[] = [
    tool('ffmpeg', report.ffmpeg, true),
    tool('ffprobe', report.ffprobe, true),
    line('filter-graph', render.filterComplexFile, true),
    line('libass', render.libass, true),
    line('libharfbuzz', render.libharfbuzz, true),
    line('libx264', render.libx264, true),
    // Links are fetched from fixtures in simulation, so yt-dlp is optional there.
    tool('yt-dlp', report.ytDlp, !simulation),
    tool('js-runtime', report.jsRuntime, false),
  ];
  return {
    ok: checks.every((check) => check.ok || !check.required),
    simulation,
    platforms: [...platforms],
    checks,
    checkedAt: report.checkedAt,
  };
}

function tool(
  name: string,
  status: { ok: boolean; version: string | null; reason: string | null },
  required: boolean,
): ClipToolCheck {
  return {
    name,
    ok: status.ok,
    required,
    version: status.version,
    reason: status.ok ? null : status.reason,
  };
}

function line(
  name: string,
  status: { ok: boolean; reason: string | null },
  required: boolean,
): ClipToolCheck {
  return { name, ok: status.ok, required, version: null, reason: status.ok ? null : status.reason };
}

/** Why the boot must stop, or null to carry on. */
export function bootRefusal(report: DoctorReport, roles: { render: boolean }): string | null {
  if (!report.ffmpeg.found || !report.ffmpeg.version) {
    return 'FFmpeg is not installed or could not start. Clips needs it even in simulation (set FFMPEG_PATH, or run npm run clips:doctor).';
  }
  if (!report.ffprobe.ok) {
    return `ffprobe is not usable: ${report.ffprobe.reason ?? 'unknown reason'}`;
  }
  if (roles.render && !report.ok) {
    const failing = Object.entries(report.ffmpeg.render)
      .filter(([, check]) => !check.ok)
      .map(([name, check]) => `${name} (${check.reason ?? 'failed'})`);
    const reason =
      failing.length > 0 ? failing.join(', ') : (report.ffmpeg.reason ?? 'FFmpeg is not usable');
    return `This FFmpeg cannot render clips: ${reason}.`;
  }
  return null;
}

/** The doctor's table, one log line each, prefixed for the worker's log. */
export function doctorLogLines(
  report: DoctorReport,
  options: { simulation?: boolean } = {},
): string[] {
  return formatDoctorReport(report, options).map((text) => `[worker:clips] ${text}`);
}
