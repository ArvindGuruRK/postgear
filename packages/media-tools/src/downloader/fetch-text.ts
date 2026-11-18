/**
 * Reads one HLS media playlist as text, for the range slicer.
 *
 * The address comes from yt-dlp's probe of an allowlisted extractor, never
 * from a person. Even so: https only, no credentials, no redirects (so the
 * request cannot be moved to another host), a byte cap, and the platform's
 * answer codes mapped to ours.
 */
import { MAX_PLAYLIST_BYTES } from './playlist-slicer';
import { DownloaderError } from './types';

export interface FetchTextOptions {
  signal: AbortSignal;
  maxBytes: number;
  /** Headers the probe said the platform wants (already allowlisted). */
  headers: Readonly<Record<string, string>>;
}

/**
 * How the downloader reads a playlist. The default uses Node's `fetch`; the
 * worker passes its own when `YTDLP_PROXY` is set, so playlist requests
 * leave through the same exit as yt-dlp's.
 */
export type FetchText = (url: string, options: FetchTextOptions) => Promise<string>;

function statusError(status: number): DownloaderError {
  if (status === 404 || status === 410) return new DownloaderError('link_not_found');
  if (status === 401 || status === 403) {
    // An expired signature looks the same as a refusal; the workflow retries once.
    return new DownloaderError('tool_failed', { retryable: true });
  }
  if (status === 429) return new DownloaderError('platform_resting');
  return new DownloaderError('tool_failed', { retryable: status >= 500 });
}

/** The default `FetchText`: Node's `fetch` with the guards above. */
export const defaultFetchText: FetchText = async (url, options) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DownloaderError('tool_failed', { retryable: false });
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new DownloaderError('tool_failed', { retryable: false });
  }
  const limit = Math.min(options.maxBytes, MAX_PLAYLIST_BYTES);
  let response: Response;
  try {
    response = await fetch(parsed, {
      method: 'GET',
      headers: { ...options.headers },
      redirect: 'error',
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw new DownloaderError('cancelled', { cause: error });
    throw new DownloaderError('tool_failed', { cause: error });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw statusError(response.status);
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new DownloaderError('tool_failed', { retryable: false });
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new DownloaderError('tool_failed', { retryable: false });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
};
