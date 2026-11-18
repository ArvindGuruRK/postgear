import { ToolMissingError } from '../run/runner';
import {
  type RunTool,
  type RunToolResult,
  ToolError,
  type ToolName,
  type ToolPaths,
} from '../run/types';
import {
  compareVersions,
  impersonationFrom,
  jsRuntimeFrom,
  parseFfmpegVersion,
  parseYtDlpVersion,
  runDoctor,
} from './doctor';
import { formatDoctorReport } from './format';

const PATHS: ToolPaths = {
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  ytDlp: 'yt-dlp',
  jsRuntime: 'deno',
};
const NOW = new Date('2026-11-18T12:00:00Z');

const FULL_BUILDCONF = [
  '  configuration:',
  '    --enable-gpl',
  '    --enable-libass',
  '    --enable-libharfbuzz',
  '    --enable-libfreetype',
  '    --enable-libx264',
].join('\n');

const IMPERSONATE_OK = [
  '[info] Available impersonate targets',
  'Client      OS          Source',
  '---------------------------------------',
  'Chrome-133  Macos-15    curl_cffi',
  'Safari-18.0 Macos-15    curl_cffi',
].join('\n');

interface FakeWorld {
  missing?: ToolName[];
  ffmpegVersion?: string;
  buildconf?: string;
  graphFails?: boolean;
  ytDlpVersion?: string;
  impersonate?: string;
  verboseHeader?: string;
}

function ok(stdout: string, stderrTail = ''): RunToolResult {
  return { exitCode: 0, stdout, stderrTail, durationMs: 3 };
}

/** A pretend set of programs: answers each doctor command the way the real ones print. */
function fakeTools(world: FakeWorld): {
  runTool: RunTool;
  calls: Array<{ tool: ToolName; args: readonly string[] }>;
} {
  const calls: Array<{ tool: ToolName; args: readonly string[] }> = [];
  const runTool: RunTool = async (tool, args) => {
    calls.push({ tool, args });
    if (world.missing?.includes(tool)) throw new ToolMissingError(tool);
    if (tool === 'ffmpeg' || tool === 'ffprobe') {
      if (args.includes('-version')) {
        return ok(
          `${tool} version ${world.ffmpegVersion ?? '9.0.2-full_build-www.gyan.dev'} Copyright (c) 2007-2026`,
        );
      }
      if (args.includes('-buildconf')) return ok(world.buildconf ?? FULL_BUILDCONF);
      if (args.includes('-/filter_complex')) {
        if (world.graphFails) {
          throw new ToolError({
            tool,
            exitCode: 8,
            stderrTail: "Unrecognized option '/filter_complex'",
          });
        }
        return ok('');
      }
    }
    if (tool === 'yt-dlp') {
      if (args.includes('--version')) return ok(`${world.ytDlpVersion ?? '2026.11.10'}\n`);
      if (args.includes('--list-impersonate-targets'))
        return ok(world.impersonate ?? IMPERSONATE_OK);
      if (args.includes('--verbose')) {
        throw new ToolError({
          tool,
          exitCode: 2,
          stderrTail:
            world.verboseHeader ??
            '[debug] Command-line config: []\n[debug] JS runtimes: deno-2.5.6\n',
        });
      }
    }
    throw new Error(`unexpected call ${tool} ${args.join(' ')}`);
  };
  return { runTool, calls };
}

describe('runDoctor', () => {
  it('passes a full FFmpeg 9.0.2 with yt-dlp, Deno and impersonation', async () => {
    const { runTool, calls } = fakeTools({});
    const report = await runDoctor(runTool, PATHS, { now: NOW });
    expect(report.ok).toBe(true);
    expect(report.linksOk).toBe(true);
    expect(report.ffmpeg).toMatchObject({
      ok: true,
      found: true,
      version: '9.0.2',
      reason: null,
      warning: null,
    });
    expect(Object.values(report.ffmpeg.render).every((line) => line.ok)).toBe(true);
    expect(report.ffprobe).toMatchObject({ ok: true, version: '9.0.2' });
    expect(report.ytDlp).toMatchObject({ ok: true, version: '2026.11.10', warning: null });
    expect(report.ytDlp.impersonation.ok).toBe(true);
    expect(report.jsRuntime).toMatchObject({ ok: true, version: 'deno 2.5.6' });
    const verbose = calls.find((c) => c.args.includes('--verbose'));
    expect(verbose?.args).toEqual(['--ignore-config', '--verbose', '--js-runtimes', 'deno:deno']);
  });

  it('fails a build without libass, with a plain reason', async () => {
    const { runTool } = fakeTools({
      buildconf: FULL_BUILDCONF.replace('    --enable-libass\n', ''),
    });
    const report = await runDoctor(runTool, PATHS, { now: NOW });
    expect(report.ok).toBe(false);
    expect(report.ffmpeg.ok).toBe(false);
    expect(report.ffmpeg.render.libass).toEqual({
      ok: false,
      reason: 'This FFmpeg cannot draw text: it has no libass.',
    });
    expect(report.ffmpeg.render.libx264.ok).toBe(true);
  });

  it('fails a build that cannot read a graph from a file', async () => {
    const { runTool } = fakeTools({ graphFails: true });
    const report = await runDoctor(runTool, PATHS, { now: NOW });
    expect(report.ok).toBe(false);
    expect(report.ffmpeg.render.filterComplexFile.ok).toBe(false);
    expect(report.ffmpeg.render.filterComplexFile.reason).not.toContain('Unrecognized');
  });

  it('fails an FFmpeg that is too old and warns on a newer one', async () => {
    const old = await runDoctor(fakeTools({ ffmpegVersion: '6.1.1' }).runTool, PATHS, { now: NOW });
    expect(old.ffmpeg.ok).toBe(false);
    expect(old.ffmpeg.reason).toContain('too old');
    const newer = await runDoctor(fakeTools({ ffmpegVersion: '9.1' }).runTool, PATHS, { now: NOW });
    expect(newer.ffmpeg.ok).toBe(true);
    expect(newer.ffmpeg.version).toBe('9.1.0');
    expect(newer.ffmpeg.warning).toContain('9.0.2');
  });

  it('reports a missing FFmpeg without throwing', async () => {
    const report = await runDoctor(fakeTools({ missing: ['ffmpeg'] }).runTool, PATHS, { now: NOW });
    expect(report.ok).toBe(false);
    expect(report.ffmpeg).toMatchObject({ ok: false, found: false });
    expect(report.ffmpeg.reason).toContain('not installed');
    expect(report.ffmpeg.render.libass.ok).toBe(false);
    expect(report.ffprobe.ok).toBe(true);
  });

  it('reports a missing yt-dlp as not ready for links, and skips its sub-checks', async () => {
    const { runTool, calls } = fakeTools({ missing: ['yt-dlp'] });
    const report = await runDoctor(runTool, PATHS, { now: NOW });
    expect(report.ok).toBe(true);
    expect(report.linksOk).toBe(false);
    expect(report.ytDlp).toMatchObject({ ok: false, found: false });
    expect(report.ytDlp.impersonation.ok).toBe(false);
    expect(report.jsRuntime.ok).toBe(false);
    expect(calls.filter((c) => c.tool === 'yt-dlp')).toHaveLength(1);
  });

  it('warns about an old yt-dlp and refuses one below the minimum', async () => {
    const stale = await runDoctor(fakeTools({ ytDlpVersion: '2026.10.26' }).runTool, PATHS, {
      now: new Date('2027-01-30T00:00:00Z'),
    });
    expect(stale.ytDlp.ok).toBe(true);
    expect(stale.ytDlp.warning).toContain('days old');
    const tooOld = await runDoctor(fakeTools({ ytDlpVersion: '2025.06.01' }).runTool, PATHS, {
      now: NOW,
    });
    expect(tooOld.ytDlp.ok).toBe(false);
    expect(tooOld.linksOk).toBe(false);
  });

  it('warns when impersonation is missing but keeps links on', async () => {
    const report = await runDoctor(
      fakeTools({ impersonate: 'Chrome-133  Macos-15    curl_cffi (unavailable)' }).runTool,
      PATHS,
      { now: NOW },
    );
    expect(report.ytDlp.impersonation.ok).toBe(false);
    expect(report.ytDlp.impersonation.reason).toContain('Kick');
    expect(report.linksOk).toBe(true);
  });

  it('says so when no runtime is set', async () => {
    const report = await runDoctor(
      fakeTools({}).runTool,
      { ...PATHS, jsRuntime: null },
      { now: NOW },
    );
    expect(report.jsRuntime.ok).toBe(false);
    expect(report.jsRuntime.reason).toContain('YTDLP_JS_RUNTIME');
  });
});

describe('the doctor parsers', () => {
  it('reads FFmpeg versions', () => {
    expect(parseFfmpegVersion('ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright')).toBe(
      '9.0.2',
    );
    expect(parseFfmpegVersion('ffprobe version n9.0 Copyright')).toBe('9.0.0');
    expect(parseFfmpegVersion('ffmpeg version N-118000-g1234abcd Copyright')).toBeNull();
  });

  it('reads yt-dlp versions', () => {
    expect(parseYtDlpVersion('2026.10.26\n')).toBe('2026.10.26');
    expect(parseYtDlpVersion('2026.11.01.233115')).toBe('2026.11.01.233115');
    expect(parseYtDlpVersion('nonsense')).toBeNull();
  });

  it('reads impersonation targets', () => {
    expect(impersonationFrom(IMPERSONATE_OK).ok).toBe(true);
    expect(impersonationFrom('Chrome  Windows  curl_cffi (unavailable)').ok).toBe(false);
    expect(impersonationFrom('').ok).toBe(false);
  });

  it('reads the runtime line', () => {
    expect(jsRuntimeFrom('[debug] JS runtimes: deno-2.3.1')).toMatchObject({
      ok: true,
      version: 'deno 2.3.1',
    });
    expect(jsRuntimeFrom('[debug] JS runtimes: deno-2.2.0')).toMatchObject({ ok: false });
    expect(jsRuntimeFrom('[debug] JS runtimes: node-22.11.0')).toMatchObject({
      ok: true,
      version: 'node 22.11.0',
    });
    expect(jsRuntimeFrom('[debug] JS runtimes: none')).toMatchObject({ ok: false, found: false });
    expect(jsRuntimeFrom('no header at all')).toMatchObject({ ok: false });
  });

  it('compares versions', () => {
    expect(compareVersions('9.0.2', '9.0.0')).toBeGreaterThan(0);
    expect(compareVersions('2026.10.26', '2026.10.26')).toBe(0);
    expect(compareVersions('8.1', '9.0.0')).toBeLessThan(0);
  });
});

describe('formatDoctorReport', () => {
  it('prints one plain line per check and a verdict', async () => {
    const report = await runDoctor(fakeTools({ missing: ['yt-dlp'] }).runTool, PATHS, { now: NOW });
    const lines = formatDoctorReport(report);
    expect(lines[0]).toBe('[OK]   FFmpeg 9.0.2');
    expect(lines).toContain('[OK]   libass (text)');
    expect(lines.some((line) => line.startsWith('[WARN] yt-dlp'))).toBe(true);
    expect(lines[lines.length - 1]).toContain('Link import is not ready');
    // Under simulation links come from recordings: a missing yt-dlp is no gap.
    const simulated = formatDoctorReport(report, { simulation: true });
    expect(simulated[simulated.length - 1]).toContain('yt-dlp is not needed');
    expect(simulated[simulated.length - 1]).not.toContain('not ready');
    const banned = [String.fromCharCode(0x2014), String.fromCharCode(0xb7)];
    for (const line of lines) {
      for (const mark of banned) expect(line.includes(mark)).toBe(false);
    }
  });
});
