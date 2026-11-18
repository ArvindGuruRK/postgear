/**
 * The FFmpeg runs a fetch needs: copy a sliced HLS playlist to one file,
 * normalise a range (the exact cut), remux a download into MP4, pull the
 * sound out into M4A.
 *
 * Every run reads progress from `-progress pipe:1`, keeps stderr to errors
 * only, and has a protocol allowlist: `file` for local inputs, and the
 * network set (research 05, "FFmpeg Roles") only for the playlist copy.
 */
import { DownloaderError } from './types';

/** Protocols for reading a local playlist whose segments are on the platform's CDN. */
export const HLS_PROTOCOLS = 'file,http,https,tcp,tls,crypto';

/** The normalised range: H.264 High, AAC, constant frame rate, a 2 second closed GOP. */
export const NORMALISE = {
  preset: 'veryfast',
  crf: 18,
  gopSeconds: 2,
  audioBitrate: '192k',
  audioRate: 48000,
} as const;

const COMMON = [
  '-hide_banner',
  '-nostdin',
  '-y',
  '-nostats',
  '-progress',
  'pipe:1',
  '-loglevel',
  'error',
];

/** Seconds for an FFmpeg time option, from milliseconds, microsecond precision. */
export function ffmpegSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(6);
}

/** A whole frame rate the encoder can hold constant: 1 to 60, 30 when unknown. */
export function normaliseFps(fps: number | null | undefined): number {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) return 30;
  return Math.min(60, Math.max(1, Math.round(fps)));
}

/** Headers for FFmpeg's HTTP input: User-Agent and Referer get their own options, the rest go in `-headers`. */
function headerArgs(headers: Readonly<Record<string, string>>): string[] {
  const args: string[] = [];
  const extra: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (/[\0\r\n]/.test(name) || /[\0\r\n]/.test(value) || !/^[A-Za-z0-9-]{1,64}$/.test(name))
      continue;
    const lower = name.toLowerCase();
    if (lower === 'user-agent') args.push('-user_agent', value);
    else if (lower === 'referer') args.push('-referer', value);
    else extra.push(`${name}: ${value}\r\n`);
  }
  if (extra.length > 0) args.push('-headers', extra.join(''));
  return args;
}

/** FFmpeg can only send its requests through an HTTP proxy. */
export function ffmpegProxyArgs(proxy: string | null | undefined): string[] {
  if (!proxy) return [];
  if (!/^https?:\/\//i.test(proxy) || /[\0\r\n]/.test(proxy)) {
    throw new DownloaderError('tool_failed', {
      retryable: false,
      cause: new Error('FFmpeg can only use an HTTP proxy for playlist segments.'),
    });
  }
  return ['-http_proxy', proxy];
}

export interface HlsCopyArgsInput {
  /** The local playlist the slicer wrote. */
  playlistFile: string;
  /** An MPEG-TS file in the job's folder. */
  outFile: string;
  headers: Readonly<Record<string, string>>;
  proxy: string | null;
  /** Some VODs have audio FFmpeg will not copy (research 04, section 6): re-encode it on the second try. */
  reencodeAudio: boolean;
}

/** Copies the sliced playlist's segments into one MPEG-TS file, no re-encode of the picture. */
export function hlsCopyArgs(input: HlsCopyArgsInput): string[] {
  return [
    ...COMMON,
    '-protocol_whitelist',
    HLS_PROTOCOLS,
    ...ffmpegProxyArgs(input.proxy),
    ...headerArgs(input.headers),
    '-f',
    'hls',
    '-i',
    input.playlistFile,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-c:v',
    'copy',
    ...(input.reencodeAudio ? ['-c:a', 'aac', '-b:a', NORMALISE.audioBitrate] : ['-c:a', 'copy']),
    '-f',
    'mpegts',
    input.outFile,
  ];
}

export interface NormaliseArgsInput {
  inFile: string;
  /** MP4 output. */
  outFile: string;
  /** Where in `inFile` the range starts. */
  startMs: number;
  /** How long the result is. */
  durationMs: number;
  fps: number;
}

/**
 * The exact cut and the normalise step in one encode: a decoded seek lands
 * on the asked frame, then H.264 High at a constant frame rate with a
 * keyframe every 2 seconds and no scene-cut keyframes (a closed GOP), even
 * dimensions, square pixels, 4:2:0, AAC 48 kHz stereo, index first.
 */
export function normaliseArgs(input: NormaliseArgsInput): string[] {
  const fps = normaliseFps(input.fps);
  const gop = String(fps * NORMALISE.gopSeconds);
  if (!(input.durationMs > 0)) {
    throw new DownloaderError('tool_failed', { retryable: false });
  }
  return [
    ...COMMON,
    '-protocol_whitelist',
    'file',
    ...(input.startMs > 0 ? ['-ss', ffmpegSeconds(input.startMs)] : []),
    '-i',
    input.inFile,
    '-t',
    ffmpegSeconds(input.durationMs),
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-preset',
    NORMALISE.preset,
    '-crf',
    String(NORMALISE.crf),
    '-r',
    String(fps),
    '-fps_mode',
    'cfr',
    '-g',
    gop,
    '-keyint_min',
    gop,
    '-sc_threshold',
    '0',
    '-flags',
    '+cgop',
    '-c:a',
    'aac',
    '-b:a',
    NORMALISE.audioBitrate,
    '-ar',
    String(NORMALISE.audioRate),
    '-ac',
    '2',
    '-sn',
    '-dn',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    input.outFile,
  ];
}

/** A download in another container (or a slice of one) into MP4 without re-encoding. */
export function remuxArgs(inFile: string, outFile: string, durationMs: number | null): string[] {
  return [
    ...COMMON,
    '-protocol_whitelist',
    'file',
    '-i',
    inFile,
    ...(durationMs !== null && durationMs > 0 ? ['-t', ffmpegSeconds(durationMs)] : []),
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-c',
    'copy',
    '-sn',
    '-dn',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outFile,
  ];
}

/** The sound alone into M4A: copied when it is AAC already, else encoded to AAC. */
export function audioArgs(
  inFile: string,
  outFile: string,
  copy: boolean,
  durationMs: number | null,
): string[] {
  return [
    ...COMMON,
    '-protocol_whitelist',
    'file',
    '-i',
    inFile,
    ...(durationMs !== null && durationMs > 0 ? ['-t', ffmpegSeconds(durationMs)] : []),
    '-map',
    '0:a:0',
    '-vn',
    ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', NORMALISE.audioBitrate]),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outFile,
  ];
}
