/**
 * What went wrong with the video, in the person's words. A `MediaError` code
 * becomes one of the preview's error codes; an address past its `expiresAt`
 * is named as expired whatever the browser said (an expired signed address
 * answers 403, which browsers report as "not supported" or "network").
 */
import type { PreviewError, PreviewErrorCode, PreviewSource } from './types';

const MESSAGES: Record<PreviewErrorCode, string> = {
  missing_source: 'This video is not available to play.',
  source_expired: 'The link to this video has expired. Reload to get a fresh one.',
  network: 'The video stopped loading. Check your connection.',
  decode: 'This video could not be played in this browser.',
  unsupported: 'This video could not be opened.',
  draw: 'The preview could not draw this moment.',
};

export function previewError(code: PreviewErrorCode): PreviewError {
  return { code, message: MESSAGES[code] };
}

/** When the address stops working, in epoch ms, or null when unknown or unreadable. */
export function expiryOf(source: PreviewSource | null): number | null {
  const value = source?.expiresAt;
  if (value === null || value === undefined) {
    return null;
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isExpired(source: PreviewSource | null, now: number): boolean {
  const expiry = expiryOf(source);
  return expiry !== null && now >= expiry;
}

/**
 * The preview's error for a media element's error, or null when it is not
 * one to report (no error, or `MEDIA_ERR_ABORTED`, which is what a
 * replaced or emptied address gives).
 */
export function mediaErrorOf(
  error: Pick<MediaError, 'code'> | null,
  source: PreviewSource | null,
  now: number,
): PreviewError | null {
  if (!error || error.code === 1) {
    return null;
  }
  if (isExpired(source, now)) {
    return previewError('source_expired');
  }
  switch (error.code) {
    case 2:
      return previewError('network');
    case 3:
      return previewError('decode');
    default:
      return previewError('unsupported');
  }
}
