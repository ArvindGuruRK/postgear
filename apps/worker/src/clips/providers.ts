/**
 * Everything a clip activity reaches the outside world through, built once at
 * boot (Module 02, section 3).
 *
 * Real and simulated bindings sit side by side, chosen by `CLIPS_SIMULATION`:
 * - `downloader`: yt-dlp plus FFmpeg, or the fixture binding that answers the
 *   simulation links from recorded JSON and cuts the generated samples.
 * - `channelLister(platform)`: the yt-dlp flat lister (the API's fallback,
 *   and Kick always), or the simulated `simstreamer` lister.
 * - `signalProducers` and `stickerProvider`: stand-ins that refuse with the
 *   module that brings them, so a call that arrives early fails loudly.
 *
 * FFmpeg runs in both worlds (simulation still normalises, renders and cuts
 * for real); only the network is replaced.
 */

import {
  type ChannelLister,
  createFixtureDownloader,
  createSimulatedChannelLister,
  createYtDlpDownloader,
  createYtDlpFlatLister,
  type Downloader,
  defaultSamplesDir,
  type RunTool,
  type ToolPaths,
  ytDlpConfigFromEnv,
} from '@postgear/media-tools';
import type { ClipPlatformId } from '@postgear/video-engine';
import type { WorkerEnv } from '../config/env';
import { clipsSimulated } from './config';

/** A provider whose module has not landed yet. */
export class ProviderNotReadyError extends Error {
  constructor(what: string, module: string) {
    super(`${what} arrives in ${module}.`);
    this.name = 'ProviderNotReadyError';
  }
}

export interface ClipProviders {
  readonly simulated: boolean;
  downloader: Downloader;
  channelLister(platform: ClipPlatformId): ChannelLister;
  /** Module 16: loudness, scenes and chat. */
  signalProducers(): never;
  /** Module 12: stickers and GIFs. */
  stickerProvider(): never;
}

export interface ClipProviderOptions {
  env: WorkerEnv;
  runTool: RunTool;
  paths: ToolPaths;
  scratchRoot: string;
}

export function createClipProviders(options: ClipProviderOptions): ClipProviders {
  const { env, runTool, paths, scratchRoot } = options;
  const simulated = clipsSimulated(env);
  const ytDlp = ytDlpConfigFromEnv(env as unknown as Record<string, string | undefined>);

  const downloader = simulated
    ? createFixtureDownloader({ samplesDir: defaultSamplesDir(), runTool })
    : createYtDlpDownloader({ ...ytDlp, paths, runTool, scratchDir: scratchRoot });

  const listers = new Map<ClipPlatformId, ChannelLister>();
  const channelLister = (platform: ClipPlatformId): ChannelLister => {
    let lister = listers.get(platform);
    if (!lister) {
      lister = simulated
        ? createSimulatedChannelLister(platform)
        : createYtDlpFlatLister(platform, {
            paths,
            runTool,
            scratchDir: scratchRoot,
            proxy: ytDlp.proxy,
            extractorArgs: ytDlp.extractorArgs,
          });
      listers.set(platform, lister);
    }
    return lister;
  };

  return {
    simulated,
    downloader,
    channelLister,
    signalProducers: () => {
      throw new ProviderNotReadyError('Highlight signals', 'Module 16');
    },
    stickerProvider: () => {
      throw new ProviderNotReadyError('Stickers', 'Module 12');
    },
  };
}
