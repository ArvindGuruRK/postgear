/**
 * The `Downloader`: everything Clips fetches from YouTube, Twitch or Kick.
 *
 * Two bindings, chosen once per process: `yt-dlp.downloader.ts` (yt-dlp and
 * FFmpeg through the `RunTool`) and `fixture.downloader.ts` (the simulation:
 * recorded probe answers and the two generated sample videos, no network).
 *
 * Every method takes a `LinkRef` that `recogniseLink` produced, never pasted
 * text, so the canonical link is the only address yt-dlp ever sees. Paths are
 * inside the caller's scratch folder. Failures are a `DownloaderError` with
 * one of our codes; a tool's text never leaves this package.
 */
import type { LinkInfo, LinkRef } from '@postgear/video-engine';

export interface FetchProgress {
  /** 0 to 100, or null for a step that reports no number (a YouTube range fetch). */
  percent: number | null;
  /** Bytes written so far, when known. */
  bytes?: number;
}

export type OnFetchProgress = (progress: FetchProgress) => void;

export interface FetchedFile {
  /** Absolute path inside the scratch folder. */
  path: string;
  bytes: number;
}

export interface FetchProxyInput {
  link: LinkRef;
  /** 720 for videos up to two hours, 480 above. */
  maxHeight: 720 | 480;
  /** Absolute path in the scratch folder; the file is MP4 (H.264 and AAC when the platform has it). */
  outFile: string;
  /** Stop past this many bytes (the plan's space left). */
  maxBytes: number;
  /** Refuse a video longer than this before fetching (the plan's longest video). */
  maxDurationMs: number;
}

export interface FetchRangeInput {
  link: LinkRef;
  /** Source time, handles already added by the caller. */
  fromMs: number;
  toMs: number;
  /** The tallest rendition worth fetching. */
  maxHeight: number;
  /** Absolute path in the scratch folder; normalised (H.264, AAC, constant frame rate, 2 s closed GOP). */
  outFile: string;
}

export interface FetchFormatInput {
  link: LinkRef;
  /** A `LinkFormat.id` from the probe: `h1080`, `h720`, `audio`. */
  formatId: string;
  /** Absolute path; MP4 for video, M4A for audio. */
  outFile: string;
  maxBytes: number;
}

export interface Downloader {
  readonly simulated: boolean;
  probe(link: LinkRef, signal: AbortSignal): Promise<LinkInfo>;
  fetchProxy(input: FetchProxyInput, onProgress: OnFetchProgress, signal: AbortSignal): Promise<FetchedFile>;
  fetchRange(input: FetchRangeInput, onProgress: OnFetchProgress, signal: AbortSignal): Promise<FetchedFile>;
  fetchFormat(input: FetchFormatInput, onProgress: OnFetchProgress, signal: AbortSignal): Promise<FetchedFile>;
}

/**
 * The codes a fetch can end with. `link_*` and `format_gone` are final;
 * `platform_resting` feeds the API's per-platform breaker; `tool_failed` is
 * everything else (and is retried once by the workflow).
 */
export type DownloaderErrorCode =
  | 'link_private'
  | 'link_not_found'
  | 'link_live'
  | 'link_not_a_video'
  | 'clips_video_too_long'
  | 'too_big'
  | 'format_gone'
  | 'platform_resting'
  | 'cancelled'
  | 'tool_failed';

export class DownloaderError extends Error {
  readonly code: DownloaderErrorCode;
  readonly retryable: boolean;

  constructor(code: DownloaderErrorCode, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(`download failed: ${code}`);
    this.name = 'DownloaderError';
    this.code = code;
    this.retryable = options.retryable ?? (code === 'tool_failed' || code === 'platform_resting');
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
