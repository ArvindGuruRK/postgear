/**
 * The simulated `Downloader` (`CLIPS_SIMULATION=true`). No network, ever.
 *
 * Probes answer from recorded yt-dlp JSON through the real probe mapper, and
 * failures from recorded yt-dlp error lines through the real error mapper,
 * so the simulation exercises the same code the real binding does. Fetches
 * copy or cut the two generated sample videos (`npm run clips:samples`);
 * cuts and the range normalise run real FFmpeg through the `RunTool`, with
 * the same arguments as the real binding. Progress moves in small steps so a
 * card shows movement, and every step honours the abort signal.
 */
import { copyFile, mkdtemp } from 'node:fs/promises';
import * as path from 'node:path';
import type { LinkInfo, LinkRef } from '@postgear/video-engine';
import type { RunTool } from '../run/types';
import { audioArgs, normaliseArgs, normaliseFps, remuxArgs } from './ffmpeg.args';
import { fileBytes, hasContent, moveFile, removeDirQuietly, unlinkQuietly } from './files';
import { createFfmpegProgressHandler, createSpanReporter } from './progress';
import { sampleDurationMs, sampleFileName } from './samples';
import { resolveSimulationLink, type SimulationAnswer } from './simulation';
import {
  type Downloader,
  DownloaderError,
  type FetchedFile,
  type FetchFormatInput,
  type FetchProxyInput,
  type FetchRangeInput,
  type OnFetchProgress,
} from './types';
import { mapYtDlpError, toDownloaderError } from './yt-dlp.errors';
import { mapProbeJson, type ProbeResult } from './yt-dlp.probe';

export interface FixtureDownloaderOptions {
  /** Where `npm run clips:samples` wrote `talk.mp4` and `stream.mp4` (see `defaultSamplesDir`). */
  samplesDir: string;
  /** FFmpeg for cuts; never yt-dlp. */
  runTool: RunTool;
  /** Pause between simulated progress steps. Default 150 ms; tests pass 0. */
  stepDelayMs?: number;
  /** Simulated progress steps for a whole-file fetch. Default 8. */
  steps?: number;
  /** Time limit for one FFmpeg cut. Default 10 minutes. */
  ffmpegTimeoutMs?: number;
}

/** The simulated binding. */
export function createFixtureDownloader(options: FixtureDownloaderOptions): Downloader {
  return new FixtureDownloader(options);
}

function abortError(): DownloaderError {
  return new DownloaderError('cancelled', { retryable: false });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

class FixtureDownloader implements Downloader {
  readonly simulated = true;
  private readonly stepDelayMs: number;
  private readonly steps: number;
  private readonly ffmpegTimeoutMs: number;

  constructor(private readonly options: FixtureDownloaderOptions) {
    this.stepDelayMs = options.stepDelayMs ?? 150;
    this.steps = Math.max(1, options.steps ?? 8);
    this.ffmpegTimeoutMs = options.ffmpegTimeoutMs ?? 10 * 60 * 1000;
  }

  async probe(link: LinkRef, signal: AbortSignal): Promise<LinkInfo> {
    return (await this.answer(link, signal)).probe.info;
  }

  async fetchProxy(
    input: FetchProxyInput,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<FetchedFile> {
    return this.guard(input.outFile, async () => {
      const { probe, answer } = await this.answer(input.link, signal);
      if (probe.info.live) throw new DownloaderError('link_live');
      if (probe.info.durationMs > input.maxDurationMs) {
        throw new DownloaderError('clips_video_too_long');
      }
      const sample = await this.samplePath(answer);
      await this.walkProgress(onProgress, signal, 90);
      await this.takeFromSample(sample, answer, input.outFile, signal);
      return this.finish(input.outFile, input.maxBytes, onProgress);
    });
  }

  async fetchRange(
    input: FetchRangeInput,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<FetchedFile> {
    return this.guard(input.outFile, async (workDir) => {
      const { probe, answer } = await this.answer(input.link, signal);
      if (probe.info.live) throw new DownloaderError('link_live');
      const sample = await this.samplePath(answer);
      const toMs = Math.min(input.toMs, answer.takeMs);
      if (!(input.fromMs >= 0) || toMs <= input.fromMs) {
        throw new DownloaderError('tool_failed', { retryable: false });
      }
      const fps = normaliseFps(
        probe.picks.find((pick) => !pick.format.audioOnly)?.format.fps ?? null,
      );
      const report = createSpanReporter(onProgress, { from: 0, to: 99 });
      const temp = path.join(workDir, 'range.mp4');
      await this.ffmpeg(
        normaliseArgs({
          inFile: sample,
          outFile: temp,
          startMs: input.fromMs,
          durationMs: toMs - input.fromMs,
          fps,
        }),
        workDir,
        signal,
        createFfmpegProgressHandler(toMs - input.fromMs, report),
      );
      await moveFile(temp, input.outFile);
      return this.finish(input.outFile, Number.MAX_SAFE_INTEGER, onProgress);
    });
  }

  async fetchFormat(
    input: FetchFormatInput,
    onProgress: OnFetchProgress,
    signal: AbortSignal,
  ): Promise<FetchedFile> {
    return this.guard(input.outFile, async () => {
      const { probe, answer } = await this.answer(input.link, signal);
      if (probe.info.live) throw new DownloaderError('link_live');
      const pick = probe.picks.find((candidate) => candidate.format.id === input.formatId);
      if (!pick) throw new DownloaderError('format_gone');
      const sample = await this.samplePath(answer);
      await this.walkProgress(onProgress, signal, 90);
      if (pick.format.audioOnly) {
        const take = answer.takeMs < sampleDurationMs(answer.sample) ? answer.takeMs : null;
        await this.ffmpeg(
          audioArgs(sample, input.outFile, true, take),
          path.dirname(input.outFile),
          signal,
        );
      } else {
        await this.takeFromSample(sample, answer, input.outFile, signal);
      }
      return this.finish(input.outFile, input.maxBytes, onProgress);
    });
  }

  // --- Steps ------------------------------------------------------------------

  private async answer(
    link: LinkRef,
    signal: AbortSignal,
  ): Promise<{ probe: ProbeResult; answer: Extract<SimulationAnswer, { type: 'video' }> }> {
    if (signal.aborted) throw abortError();
    const answer = resolveSimulationLink(link);
    if (!answer) throw new DownloaderError('link_not_found');
    if (answer.type === 'error') throw new DownloaderError(mapYtDlpError(answer.stderr));
    return { probe: mapProbeJson(answer.probeJson, link), answer };
  }

  private async samplePath(answer: { sample: 'talk' | 'stream' }): Promise<string> {
    const file = path.join(this.options.samplesDir, sampleFileName(answer.sample));
    if (!(await hasContent(file))) {
      throw new DownloaderError('tool_failed', {
        retryable: false,
        cause: new Error('The sample videos are missing: run npm run clips:samples.'),
      });
    }
    return file;
  }

  /** The whole sample is copied; a shorter video (a clip, a short) is the sample's opening, remuxed. */
  private async takeFromSample(
    sample: string,
    answer: { sample: 'talk' | 'stream'; takeMs: number },
    outFile: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (answer.takeMs >= sampleDurationMs(answer.sample)) {
      if (signal.aborted) throw abortError();
      await copyFile(sample, outFile);
      return;
    }
    await this.ffmpeg(remuxArgs(sample, outFile, answer.takeMs), path.dirname(outFile), signal);
  }

  private async walkProgress(
    onProgress: OnFetchProgress,
    signal: AbortSignal,
    upTo: number,
  ): Promise<void> {
    const report = createSpanReporter(onProgress, { from: 0, to: upTo });
    for (let step = 0; step <= this.steps; step += 1) {
      report((step / this.steps) * 100);
      if (step < this.steps) await sleep(this.stepDelayMs, signal);
    }
  }

  private async ffmpeg(
    args: string[],
    cwd: string,
    signal: AbortSignal,
    onStdoutLine?: (line: string) => void,
  ): Promise<void> {
    await this.options.runTool('ffmpeg', args, {
      cwd,
      timeoutMs: this.ffmpegTimeoutMs,
      signal,
      ...(onStdoutLine ? { onStdoutLine } : {}),
    });
  }

  /** Any failure removes the half-written output and is mapped to our codes. */
  private async guard<T>(outFile: string, step: (workDir: string) => Promise<T>): Promise<T> {
    // Working files go in a folder of our own, removed whatever happens.
    const workDir = await mkdtemp(path.join(path.dirname(outFile), '.sim-'));
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
      // Bookkeeping only.
    }
    return { path: outFile, bytes };
  }
}
