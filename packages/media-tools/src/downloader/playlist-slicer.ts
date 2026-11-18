/**
 * Cuts an HLS media playlist down to the segments that cover a time window.
 *
 * Why: `--download-sections` lands in the wrong place on Kick playlists with
 * discontinuities (yt-dlp issue 16054) and asks FFmpeg to seek over the
 * network. Summing `#EXTINF` ourselves is exact and is what TwitchDownloader
 * does (research 04, section 6). Cumulative `EXTINF` time is the one clock:
 * the proxy and the sharp range are both measured on it.
 *
 * Pure: text in, text out. Times are kept in whole microseconds so long
 * playlists (10,000 segments) do not drift.
 */

/** Why a playlist could not be sliced. None of these are retried. */
export type PlaylistSliceErrorCode =
  | 'bad_playlist'
  | 'not_media_playlist'
  | 'encrypted'
  | 'byte_range'
  | 'empty_window'
  | 'too_large';

export class PlaylistSliceError extends Error {
  readonly code: PlaylistSliceErrorCode;

  constructor(code: PlaylistSliceErrorCode) {
    super(`playlist slice failed: ${code}`);
    this.name = 'PlaylistSliceError';
    this.code = code;
  }
}

export interface SlicePlaylistInput {
  /** The media playlist as text. */
  text: string;
  /** Where it came from: relative segment and map addresses resolve against it. */
  playlistUrl: string;
  /** The window in playlist time. */
  fromMs: number;
  toMs: number;
}

export interface SlicedPlaylist {
  /** A complete VOD playlist with absolute addresses, ready for FFmpeg. */
  text: string;
  /** Playlist time where the first kept segment starts (may be before `fromMs`). */
  coveredStartMs: number;
  /** Playlist time where the last kept segment ends (may be after `toMs`, or before it at the end). */
  coveredEndMs: number;
  /** `fromMs - coveredStartMs`: how far into the sliced file the window starts. */
  offsetMs: number;
  /** The whole playlist's length. */
  totalMs: number;
  segmentCount: number;
}

/** A 37 hour Kick playlist is about 10,800 entries, well under this. */
export const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const MAX_SEGMENT_SEC = 3600;

interface Segment {
  startUs: number;
  durationUs: number;
  uri: string;
  /** A discontinuity tag came right before this segment. */
  discontinuity: boolean;
  /** The `#EXT-X-MAP` line (absolute) in force for this segment, if any. */
  mapLine: string | null;
}

function resolveHttps(uri: string, base: string): string {
  let url: URL;
  try {
    url = new URL(uri, base);
  } catch {
    throw new PlaylistSliceError('bad_playlist');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new PlaylistSliceError('bad_playlist');
  }
  return url.href;
}

/** `KEY="value"` or `KEY=value` from a tag's attribute list. */
function attribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|,)${name}=(?:"([^"]*)"|([^,]*))`);
  const match = pattern.exec(attributes);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function microseconds(seconds: string): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0 || value > MAX_SEGMENT_SEC) {
    throw new PlaylistSliceError('bad_playlist');
  }
  return Math.round(value * 1_000_000);
}

function parse(input: SlicePlaylistInput): {
  segments: Segment[];
  version: number | null;
  independent: boolean;
} {
  const lines = input.text.split(/\r?\n/).map((line) => line.trim());
  const first = lines.find((line) => line.length > 0);
  if (first !== '#EXTM3U') throw new PlaylistSliceError('bad_playlist');

  const segments: Segment[] = [];
  let version: number | null = null;
  let independent = false;
  let mapLine: string | null = null;
  let pendingDuration: number | null = null;
  let pendingDiscontinuity = false;
  let clockUs = 0;

  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-STREAM-INF') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
        throw new PlaylistSliceError('not_media_playlist');
      }
      if (line.startsWith('#EXT-X-BYTERANGE')) throw new PlaylistSliceError('byte_range');
      if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) {
        const method = attribute(line.slice(line.indexOf(':') + 1), 'METHOD');
        if (method !== 'NONE') throw new PlaylistSliceError('encrypted');
        continue;
      }
      if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = line.slice('#EXT-X-MAP:'.length);
        if (attribute(attrs, 'BYTERANGE') !== null) throw new PlaylistSliceError('byte_range');
        const uri = attribute(attrs, 'URI');
        if (!uri) throw new PlaylistSliceError('bad_playlist');
        mapLine = `#EXT-X-MAP:URI="${resolveHttps(uri, input.playlistUrl)}"`;
        continue;
      }
      if (line.startsWith('#EXT-X-VERSION:')) {
        const value = Number(line.slice('#EXT-X-VERSION:'.length));
        if (Number.isInteger(value) && value > 0 && value < 20) version = value;
        continue;
      }
      if (line === '#EXT-X-INDEPENDENT-SEGMENTS') {
        independent = true;
        continue;
      }
      if (line === '#EXT-X-DISCONTINUITY') {
        pendingDiscontinuity = true;
        continue;
      }
      if (line.startsWith('#EXTINF:')) {
        const value = line.slice('#EXTINF:'.length).split(',')[0] ?? '';
        pendingDuration = microseconds(value);
        continue;
      }
      // Everything else (program dates, vendor tags, the end tag) is not needed for a VOD slice.
      continue;
    }
    // A segment address.
    if (pendingDuration === null) throw new PlaylistSliceError('bad_playlist');
    segments.push({
      startUs: clockUs,
      durationUs: pendingDuration,
      uri: resolveHttps(line, input.playlistUrl),
      discontinuity: pendingDiscontinuity,
      mapLine,
    });
    clockUs += pendingDuration;
    pendingDuration = null;
    pendingDiscontinuity = false;
  }
  return { segments, version, independent };
}

function formatSeconds(us: number): string {
  return (us / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

/**
 * The segments whose time overlaps `[fromMs, toMs)`: a segment is kept when
 * it ends after `fromMs` and starts before `toMs`. Discontinuity tags are
 * kept between kept segments; the map tag is repeated where it changes.
 * Refuses master playlists, encryption and byte ranges.
 */
export function sliceHlsPlaylist(input: SlicePlaylistInput): SlicedPlaylist {
  if (input.text.length > MAX_PLAYLIST_BYTES) throw new PlaylistSliceError('too_large');
  if (
    !Number.isFinite(input.fromMs) ||
    !Number.isFinite(input.toMs) ||
    input.fromMs < 0 ||
    input.toMs <= input.fromMs
  ) {
    throw new PlaylistSliceError('empty_window');
  }
  const { segments, version, independent } = parse(input);
  const fromUs = Math.round(input.fromMs * 1000);
  const toUs = Math.round(input.toMs * 1000);
  const kept = segments.filter(
    (segment) => segment.startUs + segment.durationUs > fromUs && segment.startUs < toUs,
  );
  const firstKept = kept[0];
  const lastKept = kept[kept.length - 1];
  if (!firstKept || !lastKept) throw new PlaylistSliceError('empty_window');

  const targetSec = Math.max(1, Math.ceil(Math.max(...kept.map((s) => s.durationUs)) / 1_000_000));
  const out = [
    '#EXTM3U',
    `#EXT-X-VERSION:${Math.max(version ?? 3, firstKept.mapLine ? 6 : 3)}`,
    `#EXT-X-TARGETDURATION:${targetSec}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  if (independent) out.push('#EXT-X-INDEPENDENT-SEGMENTS');
  let lastMap: string | null = null;
  kept.forEach((segment, index) => {
    if (index > 0 && segment.discontinuity) out.push('#EXT-X-DISCONTINUITY');
    if (segment.mapLine && segment.mapLine !== lastMap) {
      out.push(segment.mapLine);
      lastMap = segment.mapLine;
    }
    out.push(`#EXTINF:${formatSeconds(segment.durationUs)},`, segment.uri);
  });
  out.push('#EXT-X-ENDLIST', '');

  const coveredStartUs = firstKept.startUs;
  const coveredEndUs = lastKept.startUs + lastKept.durationUs;
  const last = segments[segments.length - 1];
  return {
    text: out.join('\n'),
    coveredStartMs: coveredStartUs / 1000,
    coveredEndMs: coveredEndUs / 1000,
    offsetMs: (fromUs - coveredStartUs) / 1000,
    totalMs: last ? (last.startUs + last.durationUs) / 1000 : 0,
    segmentCount: kept.length,
  };
}
