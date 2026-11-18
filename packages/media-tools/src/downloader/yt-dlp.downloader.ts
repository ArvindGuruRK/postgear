/**
 * The real `Downloader`: yt-dlp for the platforms, FFmpeg for the cuts.
 *
 * Every program starts through the injected `RunTool` with an argument
 * array; yt-dlp only ever sees the canonical link after `--`. Each fetch
 * works in a fresh folder beside its output (inside the caller's scratch
 * folder), probes again first (signed addresses are short-lived, and the
 * length and live checks must happen before any byte is fetched), and
 * removes the folder whatever happens.
 *
 * Range strategies (research 04, section 6):
 * - Twitch and Kick past streams: slice the HLS media playlist ourselves,
 *   copy the kept segments with FFmpeg, then cut exactly and normalise.
 * - YouTube: `--download-sections` on a padded range with keyframes forced
 *   at the cuts (so the file starts where asked), then the exact cut.
 * - Clips (60 seconds or less): fetch the whole file, then cut.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { LinkInfo, LinkRef } from '@postgear/video-engine';
import type { RunTool, RunToolOptions, RunToolResult, ToolName } from '../run/types';
import { audioArgs, hlsCopyArgs, normaliseArgs, normaliseFps, remuxArgs } from './ffmpeg.args';
import { defaultFetchText, type FetchText } from './fetch-text';
import {
  fileBytes,
  findOutput,
  makeWorkDir,
  moveFile,
  removeDirQuietly,
  sizeWatch,
  unlinkQuietly,
} from './files';
import { MAX_PLAYLIST_BYTES, PlaylistSliceError, sliceHlsPlaylist } from './playlist-slicer';
import {
  createFfmpegProgressHandler,
  createSpanReporter,
  createYtDlpProgressHandler,
  type ProgressSpan,
} from './progress';
import {
  type Downloader,
  DownloaderError,
  type FetchedFile,
  type FetchFormatInput,
  type FetchProxyInput,
  type FetchRangeInput,
  type OnFetchProgress,
} from './types';
import {
  type SectionRange,
  type YtDlpConfig,
  ytDlpDownloadArgs,
  ytDlpProbeArgs,
} from './yt-dlp.args';
import { toDownloaderError } from './yt-dlp.errors';
import { chooseVideo, mapProbeJson, type PickedFormat, type ProbeResult } from './yt-dlp.probe';

/** Time limits for each kind of run. */
export interface YtDlpTimeouts {
  /** A probe; the activity itself has 20 seconds (Module 03). */
  probeMs: number;
  /** A whole-video download (a proxy of a six hour stream takes a while). */
  downloadMs: number;
  /** A range or format download. */
  rangeMs: number;
  /** One FFmpeg copy or encode. */
  ffmpegMs: number;
}

export const DEFAULT_TIMEOUTS: Readonly<YtDlpTimeouts> = Object.freeze({
  probeMs: 18_000,
  downloadMs: 4 * 60 * 60 * 1000,
  rangeMs: 60 * 60 * 1000,
  ffmpegMs: 60 * 60 * 1000,
});

/** A range is at most 30 minutes plus handles; this caps its working files. */
export const DEFAULT_RANGE_MAX_BYTES = 6 * 1024 * 1024 * 1024;

/** Extra seconds fetched each side of a YouTube section, cut away exactly afterwards. */
export const YOUTUBE_SECTION_PAD_MS = 2000;

export interface YtDlpDownloaderOptions extends YtDlpConfig {
  runTool: RunTool;
  /** The scratch root (`CLIPS_SCRATCH_DIR`); a probe makes and removes a folder here. */
  scratchDir: string;
  /**
   * Reads a media playlist. Defaults to Node's `fetch`, which cannot use a
   * proxy: with `YTDLP_PROXY` set and no `fetchText` given, Twitch and Kick
   * ranges fall back to yt-dlp's own section download.
   */
  fetchText?: FetchText;
  timeouts?: Partial<YtDlpTimeouts>;
  /** How often the size watch runs. */
  sizeWatchEveryMs?: number;
  rangeMaxBytes?: number;
}

/** The real binding. One per process; it holds no state between calls. */
export function createYtDlpDownloader(options: YtDlpDownloaderOptions): Downloader {
  return new YtDlpDownloader(options);
}

class YtDlpDownloader implements Downloader {
  readonly simulated = false;
  private readonly timeouts: YtDlpTimeouts;
  private readonly fetchText: FetchText;
  private readonly canSliceHls: boolean;

  constructor(private readonly options: YtDlpDownloaderOptions) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.fetchText = options.fetchText ?? defaultFetchText;
    // Our own playlist and segment requests must leave through the same exit as yt-dlp's.
    this.canSliceHls =
      !options.proxy || (options.fetchText !== undefined && /^https?:\/\//i.test(options.proxy));
  }

  async probe(link: LinkRef, signal: AbortSignal): Promise<LinkInfo> {
    const workDir = await this.tempDir();
    try {
      return (await this.probeIn(link, signal, workDir)).info;
    } catch (error) {
      throw toDownloaderError(error);
    } finally {
      await removeDirQuietly(workDir);
    }
  }

  async fetchProxy(
    input: FetchProxyInput,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<FetchedFile> {
    return this.inWorkDir(input.outFile, async (workDir) => {
      const probe = await this.probeIn(input.link, signal, workDir);
      if (probe.info.live) throw new DownloaderError('link_live');
      if (probe.info.durationMs > input.maxDurationMs) {
        throw new DownloaderError('clips_video_too_long');
      }
      const pick = chooseVideo(probe.picks, input.maxHeight);
      if (!pick) throw new DownloaderError('format_gone');
      const report = createSpanReporter(onProgress, { from: 0, to: 97 });
      const downloaded = await this.download(input.link, pick, {
        workDir,
        stem: 'media',
        signal,
        report,
        mergeFormat: 'mp4',
        maxBytes: input.maxBytes,
        maxDurationSec: input.maxDurationMs / 1000,
        section: this.clipSection(probe),
        timeoutMs: this.timeouts.downloadMs,
      });
      await this.toMp4(downloaded, input.outFile, workDir, signal, null);
      return this.finish(input.outFile, input.maxBytes, onProgress);
    });
  }

  async fetchRange(
    input: FetchRangeInput,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<FetchedFile> {
    if (!(Number.isFinite(input.fromMs) && Number.isFinite(input.toMs)) || input.fromMs < 0) {
      throw new DownloaderError('tool_failed', { retryable: false });
    }
    const maxBytes = this.options.rangeMaxBytes ?? DEFAULT_RANGE_MAX_BYTES;
    return this.inWorkDir(input.outFile, async (workDir) => {
      const probe = await this.probeIn(input.link, signal, workDir);
      if (probe.info.live) throw new DownloaderError('link_live');
      const pick = chooseVideo(probe.picks, input.maxHeight);
      if (!pick) throw new DownloaderError('format_gone');
      const toMs =
        probe.info.durationMs > 0 ? Math.min(input.toMs, probe.info.durationMs) : input.toMs;
      const fromMs = input.fromMs;
      if (toMs <= fromMs) throw new DownloaderError('tool_failed', { retryable: false });
      const range = { fromMs, toMs };
      const fps = normaliseFps(pick.format.fps);
      const link = input.link;

      if (
        link.kind !== 'clip' &&
        link.platform !== 'youtube' &&
        pick.hls &&
        pick.url &&
        this.canSliceHls
      ) {
        await this.rangeFromPlaylist(
          pick,
          range,
          fps,
          workDir,
          input.outFile,
          maxBytes,
          onProgress,
          signal,
        );
      } else if (link.platform === 'youtube' || link.kind !== 'clip') {
        // YouTube always; Twitch and Kick past streams when we cannot slice the playlist ourselves
        // (a proxy without a proxy-aware playlist reader): yt-dlp's own section download.
        await this.rangeFromSection(
          link,
          probe,
          pick,
          range,
          fps,
          workDir,
          input.outFile,
          maxBytes,
          onProgress,
          signal,
        );
      } else {
        await this.rangeFromWhole(
          link,
          pick,
          range,
          fps,
          workDir,
          input.outFile,
          maxBytes,
          onProgress,
          signal,
        );
      }
      return this.finish(input.outFile, maxBytes, onProgress);
    });
  }

  async fetchFormat(
    input: FetchFormatInput,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<FetchedFile> {
    return this.inWorkDir(input.outFile, async (workDir) => {
      const probe = await this.probeIn(input.link, signal, workDir);
      if (probe.info.live) throw new DownloaderError('link_live');
      const pick = probe.picks.find((candidate) => candidate.format.id === input.formatId);
      if (!pick) throw new DownloaderError('format_gone');
      const report = createSpanReporter(onProgress, { from: 0, to: 95 });
      const downloaded = await this.download(input.link, pick, {
        workDir,
        stem: 'media',
        signal,
        report,
        mergeFormat: pick.format.audioOnly ? null : 'mp4',
        maxBytes: input.maxBytes,
        maxDurationSec: null,
        section: this.clipSection(probe),
        timeoutMs: this.timeouts.downloadMs,
      });
      if (pick.format.audioOnly) {
        await this.ffmpeg(
          audioArgs(downloaded, path.join(workDir, 'audio.m4a'), pick.aacAudio, null),
          workDir,
          signal,
        );
        await moveFile(path.join(workDir, 'audio.m4a'), input.outFile);
      } else {
        await this.toMp4(downloaded, input.outFile, workDir, signal, null);
      }
      return this.finish(input.outFile, input.maxBytes, onProgress);
    });
  }

  // --- Range strategies -----------------------------------------------------

  /** Twitch and Kick past streams: our own playlist slice, an FFmpeg copy, then the exact cut. */
  private async rangeFromPlaylist(
    pick: PickedFormat,
    range: { fromMs: number; toMs: number },
    fps: number,
    workDir: string,
    outFile: string,
    maxBytes: number,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<void> {
    const report = createSpanReporter(onProgress, { from: 0, to: 75 });
    report(0);
    const text = await this.fetchText(pick.url as string, {
      signal,
      maxBytes: MAX_PLAYLIST_BYTES,
      headers: pick.httpHeaders,
    });
    let slice: ReturnType<typeof sliceHlsPlaylist>;
    try {
      slice = sliceHlsPlaylist({ text, playlistUrl: pick.url as string, ...range });
    } catch (error) {
      if (error instanceof PlaylistSliceError) {
        throw new DownloaderError(error.code === 'empty_window' ? 'tool_failed' : 'format_gone', {
          retryable: false,
          cause: error,
        });
      }
      throw error;
    }
    const playlistFile = path.join(workDir, 'range.m3u8');
    const tsFile = path.join(workDir, 'range.ts');
    await writeFile(playlistFile, slice.text, 'utf8');
    const expectedMs = slice.coveredEndMs - slice.coveredStartMs;
    const copyOnce = (reencodeAudio: boolean): Promise<void> =>
      this.ffmpeg(
        hlsCopyArgs({
          playlistFile,
          outFile: tsFile,
          headers: pick.httpHeaders,
          proxy: this.options.proxy ?? null,
          reencodeAudio,
        }),
        workDir,
        signal,
        {
          expectedMs,
          report,
          timeoutMs: this.timeouts.rangeMs,
          watch: sizeWatch(workDir, maxBytes, this.options.sizeWatchEveryMs),
        },
      );
    try {
      await copyOnce(false);
    } catch (error) {
      if (
        error instanceof DownloaderError &&
        (error.code === 'cancelled' || error.code === 'too_big')
      ) {
        throw error;
      }
      // Some past streams carry audio FFmpeg refuses to copy: try once more with the sound re-encoded.
      await unlinkQuietly(tsFile);
      await copyOnce(true);
    }
    const durationMs = Math.min(range.toMs, slice.coveredEndMs) - range.fromMs;
    await this.normalise(
      tsFile,
      slice.offsetMs,
      durationMs,
      fps,
      workDir,
      outFile,
      onProgress,
      signal,
      {
        from: 75,
        to: 99,
      },
    );
  }

  /** YouTube: a padded section with keyframes forced at the cuts, then the exact cut. No number while it fetches. */
  private async rangeFromSection(
    link: LinkRef,
    probe: ProbeResult,
    pick: PickedFormat,
    range: { fromMs: number; toMs: number },
    fps: number,
    workDir: string,
    outFile: string,
    maxBytes: number,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<void> {
    const base = probe.sectionMs?.fromMs ?? 0;
    const limit =
      probe.sectionMs?.toMs ??
      (probe.info.durationMs > 0 ? probe.info.durationMs : Number.POSITIVE_INFINITY);
    const sectionFromMs = Math.max(0, base + range.fromMs - YOUTUBE_SECTION_PAD_MS);
    const sectionToMs = Math.min(limit, base + range.toMs + YOUTUBE_SECTION_PAD_MS);
    try {
      onProgress({ percent: null });
    } catch {
      // Bookkeeping only.
    }
    const downloaded = await this.download(link, pick, {
      workDir,
      stem: 'section',
      signal,
      // The FFmpeg downloader reports nothing until it ends (research 04, section 2.5).
      report: () => undefined,
      mergeFormat: 'mkv',
      maxBytes: null,
      maxDurationSec: null,
      section: { fromSec: sectionFromMs / 1000, toSec: sectionToMs / 1000 },
      timeoutMs: this.timeouts.rangeMs,
      watchMaxBytes: maxBytes,
    });
    const offsetMs = base + range.fromMs - sectionFromMs;
    await this.normalise(
      downloaded,
      offsetMs,
      range.toMs - range.fromMs,
      fps,
      workDir,
      outFile,
      () => undefined,
      signal,
      { from: 0, to: 0 },
    );
  }

  /** A clip (60 seconds or less) or a rendition with no playlist: the whole file, then the cut. */
  private async rangeFromWhole(
    link: LinkRef,
    pick: PickedFormat,
    range: { fromMs: number; toMs: number },
    fps: number,
    workDir: string,
    outFile: string,
    maxBytes: number,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<void> {
    const report = createSpanReporter(onProgress, { from: 0, to: 75 });
    const downloaded = await this.download(link, pick, {
      workDir,
      stem: 'whole',
      signal,
      report,
      mergeFormat: 'mkv',
      maxBytes,
      maxDurationSec: null,
      section: null,
      timeoutMs: this.timeouts.rangeMs,
    });
    await this.normalise(
      downloaded,
      range.fromMs,
      range.toMs - range.fromMs,
      fps,
      workDir,
      outFile,
      onProgress,
      signal,
      { from: 75, to: 99 },
    );
  }

  // --- Steps ------------------------------------------------------------------

  private async probeIn(link: LinkRef, signal: AbortSignal, workDir: string): Promise<ProbeResult> {
    const cookiesPath = await this.copyCookies(workDir);
    const result = await this.run('yt-dlp', ytDlpProbeArgs(this.options, link, cookiesPath), {
      cwd: workDir,
      timeoutMs: this.timeouts.probeMs,
      signal,
      maxStdoutBytes: 32 * 1024 * 1024,
    });
    const line = result.stdout
      .split(/\r?\n/)
      .map((text) => text.trim())
      .filter((text) => text.startsWith('{'))
      .pop();
    if (!line) throw new DownloaderError('tool_failed');
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (error) {
      throw new DownloaderError('tool_failed', { cause: error });
    }
    return mapProbeJson(json, link);
  }

  private async download(
    link: LinkRef,
    pick: PickedFormat,
    step: {
      workDir: string;
      stem: string;
      signal: AbortSignal;
      report: (percent: number | null, bytes?: number) => void;
      mergeFormat: 'mp4' | 'mkv' | null;
      maxBytes: number | null;
      maxDurationSec: number | null;
      section: SectionRange | null;
      timeoutMs: number;
      /** The size cap for the watch when `maxBytes` is not passed to yt-dlp. */
      watchMaxBytes?: number;
    },
  ): Promise<string> {
    const cookiesPath = await this.copyCookies(step.workDir);
    const handler = createYtDlpProgressHandler(pick.ytDlpIds.length, step.report);
    const watchCap = step.maxBytes ?? step.watchMaxBytes ?? null;
    await this.run(
      'yt-dlp',
      ytDlpDownloadArgs(this.options, link, {
        formatIds: pick.ytDlpIds,
        outTemplate: path.join(step.workDir, `${step.stem}.%(ext)s`),
        mergeFormat: pick.ytDlpIds.length > 1 ? step.mergeFormat : null,
        maxDurationSec: step.maxDurationSec,
        maxBytes: step.maxBytes,
        section: step.section,
        cookiesPath,
      }),
      {
        cwd: step.workDir,
        timeoutMs: step.timeoutMs,
        signal: step.signal,
        onStdoutLine: handler,
        onStderrLine: handler,
        ...(watchCap !== null
          ? { watch: sizeWatch(step.workDir, watchCap, this.options.sizeWatchEveryMs) }
          : {}),
      },
    );
    const output = await findOutput(step.workDir, step.stem);
    // yt-dlp exits 0 when the match filter skips the video: it went live or changed under us.
    if (!output) throw new DownloaderError('link_live');
    return output;
  }

  private async normalise(
    inFile: string,
    startMs: number,
    durationMs: number,
    fps: number,
    workDir: string,
    outFile: string,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
    span: ProgressSpan,
  ): Promise<void> {
    const temp = path.join(workDir, 'normalised.mp4');
    const report = createSpanReporter(onProgress, span);
    await this.ffmpeg(
      normaliseArgs({ inFile, outFile: temp, startMs, durationMs, fps }),
      workDir,
      signal,
      {
        expectedMs: durationMs,
        report,
        timeoutMs: this.timeouts.ffmpegMs,
      },
    );
    await moveFile(temp, outFile);
  }

  /** An MP4 download is moved into place; anything else is remuxed into MP4. */
  private async toMp4(
    file: string,
    outFile: string,
    workDir: string,
    signal: AbortSignal,
    durationMs: number | null,
  ): Promise<void> {
    if (path.extname(file).toLowerCase() === '.mp4' && durationMs === null) {
      await moveFile(file, outFile);
      return;
    }
    const temp = path.join(workDir, 'remuxed.mp4');
    await this.ffmpeg(remuxArgs(file, temp, durationMs), workDir, signal);
    await moveFile(temp, outFile);
  }

  private async ffmpeg(
    args: string[],
    workDir: string,
    signal: AbortSignal,
    extra: {
      expectedMs?: number;
      report?: (percent: number | null) => void;
      timeoutMs?: number;
      watch?: RunToolOptions['watch'];
    } = {},
  ): Promise<void> {
    const handler =
      extra.expectedMs !== undefined && extra.report
        ? createFfmpegProgressHandler(extra.expectedMs, extra.report)
        : undefined;
    await this.run('ffmpeg', args, {
      cwd: workDir,
      timeoutMs: extra.timeoutMs ?? this.timeouts.ffmpegMs,
      signal,
      ...(handler ? { onStdoutLine: handler } : {}),
      ...(extra.watch ? { watch: extra.watch } : {}),
    });
  }

  private async run(
    tool: ToolName,
    args: string[],
    options: RunToolOptions,
  ): Promise<RunToolResult> {
    return this.options.runTool(tool, args, options);
  }

  /** yt-dlp reads and writes its cookies file, so every run gets its own copy. */
  private async copyCookies(workDir: string): Promise<string | null> {
    if (!this.options.cookiesFile) return null;
    const target = path.join(workDir, 'cookies.txt');
    try {
      await copyFile(this.options.cookiesFile, target);
    } catch (error) {
      throw new DownloaderError('tool_failed', { retryable: false, cause: error });
    }
    return target;
  }

  private clipSection(probe: ProbeResult): SectionRange | null {
    if (!probe.sectionMs) return null;
    return { fromSec: probe.sectionMs.fromMs / 1000, toSec: probe.sectionMs.toMs / 1000 };
  }

  private async tempDir(): Promise<string> {
    await mkdir(this.options.scratchDir, { recursive: true });
    return makeWorkDir(path.join(this.options.scratchDir, 'probe'));
  }

  /** Runs `step` in a fresh folder beside `outFile`; any failure removes the half-written output. */
  private async inWorkDir<T>(outFile: string, step: (workDir: string) => Promise<T>): Promise<T> {
    const workDir = await makeWorkDir(outFile);
    try {
      return await step(workDir);
    } catch (error) {
      await unlinkQuietly(outFile);
      throw toDownloaderError(error);
    } finally {
      await removeDirQuietly(workDir);
    }
  }

  private async finish(
    outFile: string,
    maxBytes: number,
    onProgress: OnFetchProgress,
  ): Promise<FetchedFile> {
    const bytes = await fileBytes(outFile);
    if (bytes > maxBytes) throw new DownloaderError('too_big', { retryable: false });
    try {
      onProgress({ percent: 100, bytes });
    } catch {
      // The caller's bookkeeping failed; the file is fine.
    }
    return { path: outFile, bytes };
  }
}
