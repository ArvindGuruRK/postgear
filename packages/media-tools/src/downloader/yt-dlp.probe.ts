/**
 * yt-dlp's `-J` answer to our `LinkInfo`, and the format picker.
 *
 * The Zod shapes keep only the fields research 04 (section 2.2) lists, all
 * optional ("none of the meta fields are guaranteed"), and drop the rest.
 * Formats are reduced to at most one per height (H.264 with AAC preferred,
 * section 2.4) plus one audio-only entry, each with a stable id (`h1080`,
 * `audio`) that never contains a yt-dlp selector. The picker remembers which
 * yt-dlp ids stand behind each entry so a later fetch can ask for them.
 */
import type { LinkFormat, LinkInfo, LinkRef, ReplayedPoint } from '@postgear/video-engine';
import { z } from 'zod';
import { FORMAT_ID_PATTERN, IMPORT_EXTRACTORS } from './yt-dlp.args';
import { DownloaderError } from './types';

const rawFormatSchema = z.object({
  format_id: z.string(),
  ext: z.string().nullish(),
  vcodec: z.string().nullish(),
  acodec: z.string().nullish(),
  height: z.number().nullish(),
  width: z.number().nullish(),
  fps: z.number().nullish(),
  tbr: z.number().nullish(),
  abr: z.number().nullish(),
  filesize: z.number().nullish(),
  protocol: z.string().nullish(),
  url: z.string().nullish(),
  format_note: z.string().nullish(),
  http_headers: z.record(z.unknown()).nullish(),
});
type RawFormat = z.infer<typeof rawFormatSchema>;

const rawThumbnailSchema = z.object({
  url: z.string(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  preference: z.number().nullish(),
});

const rawHeatSchema = z.object({
  start_time: z.number(),
  end_time: z.number(),
  value: z.number(),
});

const rawInfoSchema = z.object({
  _type: z.string().nullish(),
  id: z.string().nullish(),
  extractor: z.string().nullish(),
  extractor_key: z.string().nullish(),
  title: z.string().nullish(),
  uploader: z.string().nullish(),
  uploader_id: z.string().nullish(),
  channel: z.string().nullish(),
  channel_id: z.string().nullish(),
  timestamp: z.number().nullish(),
  duration: z.number().nullish(),
  is_live: z.boolean().nullish(),
  was_live: z.boolean().nullish(),
  live_status: z.string().nullish(),
  availability: z.string().nullish(),
  age_limit: z.number().nullish(),
  thumbnail: z.string().nullish(),
  thumbnails: z.array(z.unknown()).nullish(),
  section_start: z.number().nullish(),
  section_end: z.number().nullish(),
  formats: z.array(z.unknown()).nullish(),
  heatmap: z.array(z.unknown()).nullish(),
});

/** Header names a platform may ask us to send with its playlist and segments. */
const FORWARDED_HEADERS = ['user-agent', 'referer', 'origin', 'accept', 'accept-language'];

/** One `LinkFormat` and the yt-dlp ids behind it. */
export interface PickedFormat {
  format: LinkFormat;
  /** One id, or a video id then an audio id that yt-dlp merges. */
  ytDlpIds: string[];
  /** An HLS media playlist (Twitch and Kick); `url` is that playlist. */
  hls: boolean;
  /** The video rendition's own address (the media playlist for HLS), when yt-dlp gave one. */
  url: string | null;
  /** Headers the platform wants on the playlist and segments (allowlisted names only). */
  httpHeaders: Record<string, string>;
  /** The sound comes from a file with a picture too, so it must be pulled out locally. */
  audioFromVideo: boolean;
  /** The sound is AAC already, so it can be copied into M4A. */
  aacAudio: boolean;
}

/** Everything a fetch needs from one probe. */
export interface ProbeResult {
  info: LinkInfo;
  picks: PickedFormat[];
  /** YouTube clips: the clip's range inside its parent video, in ms. */
  sectionMs: { fromMs: number; toMs: number } | null;
}

const LIVE_STATUSES = new Set(['is_live', 'is_upcoming', 'post_live']);
const PRIVATE_AVAILABILITY = new Set(['private', 'needs_auth', 'premium_only', 'subscriber_only']);
const MAX_TITLE_LENGTH = 300;

function isNone(codec: string | null | undefined): boolean {
  return codec === 'none';
}

function isH264(codec: string | null | undefined): boolean {
  return !!codec && (codec.startsWith('avc1') || codec.startsWith('avc3') || codec === 'h264');
}

function isAac(codec: string | null | undefined): boolean {
  return !!codec && (codec.startsWith('mp4a') || codec === 'aac');
}

function headersOf(format: RawFormat): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(format.http_headers ?? {})) {
    if (
      typeof value === 'string' &&
      FORWARDED_HEADERS.includes(name.toLowerCase()) &&
      value.length <= 1024 &&
      !/[\0\r\n]/.test(value)
    ) {
      headers[name] = value;
    }
  }
  return headers;
}

function httpsUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Formats we can never use: storyboards, Twitch's portrait copies, ids that could hide syntax. */
function usable(format: RawFormat): boolean {
  if (!FORMAT_ID_PATTERN.test(format.format_id)) return false;
  if (format.format_id.startsWith('portrait-')) return false;
  if (format.ext === 'mhtml' || format.protocol === 'mhtml') return false;
  if (format.format_note?.toLowerCase().includes('storyboard')) return false;
  if (isNone(format.vcodec) && isNone(format.acodec)) return false;
  return true;
}

function isAudioOnly(format: RawFormat): boolean {
  return isNone(format.vcodec) && !!format.acodec && !isNone(format.acodec);
}

function isVideo(format: RawFormat): boolean {
  return !isNone(format.vcodec) && typeof format.height === 'number' && format.height > 0;
}

/** Higher is better: H.264 first, then sound inside, AAC sound, frame rate, bitrate. */
function videoRank(format: RawFormat): number[] {
  return [
    isH264(format.vcodec) ? 1 : 0,
    !isNone(format.acodec) ? 1 : 0,
    isAac(format.acodec) ? 1 : 0,
    format.fps ?? 0,
    format.tbr ?? 0,
  ];
}

function audioRank(format: RawFormat): number[] {
  return [isAac(format.acodec) ? 1 : 0, format.abr ?? format.tbr ?? 0];
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function bestBy<T>(items: readonly T[], rank: (item: T) => number[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (best === null || compareRanks(rank(item), rank(best)) > 0) best = item;
  }
  return best;
}

function videoLabel(height: number, fps: number | null): string {
  return fps !== null && fps >= 50 ? `${height}p ${fps} fps` : `${height}p`;
}

/**
 * The format list a person can pick from, best first, with what stands
 * behind each entry. Pure; exported for the tests and the fixture binding.
 */
export function pickFormats(rawFormats: readonly unknown[]): PickedFormat[] {
  const formats: RawFormat[] = [];
  for (const raw of rawFormats) {
    const parsed = rawFormatSchema.safeParse(raw);
    if (parsed.success && usable(parsed.data)) formats.push(parsed.data);
  }
  const audioOnly = formats.filter(isAudioOnly);
  const bestAudio = bestBy(audioOnly, audioRank);

  const byHeight = new Map<number, RawFormat[]>();
  for (const format of formats.filter(isVideo)) {
    const height = Math.round(format.height as number);
    byHeight.set(height, [...(byHeight.get(height) ?? []), format]);
  }

  const picks: PickedFormat[] = [];
  const heights = [...byHeight.keys()].sort((a, b) => b - a);
  for (const height of heights) {
    const best = bestBy(byHeight.get(height) ?? [], videoRank);
    if (!best) continue;
    const muxed = !isNone(best.acodec);
    const ids = muxed || !bestAudio ? [best.format_id] : [best.format_id, bestAudio.format_id];
    const fps = typeof best.fps === 'number' && best.fps > 0 ? Math.round(best.fps) : null;
    const sizes = ids.length === 2 ? [best.filesize, bestAudio?.filesize] : [best.filesize];
    const bytes = sizes.every((size) => typeof size === 'number' && size > 0)
      ? sizes.reduce<number>((sum, size) => sum + (size as number), 0)
      : null;
    picks.push({
      format: {
        id: `h${height}`,
        label: videoLabel(height, fps),
        height,
        fps,
        ext: 'mp4',
        bytes,
        audioOnly: false,
      },
      ytDlpIds: ids,
      hls: (best.protocol ?? '').startsWith('m3u8'),
      url: httpsUrl(best.url),
      httpHeaders: headersOf(best),
      audioFromVideo: false,
      aacAudio: muxed ? isAac(best.acodec) : isAac(bestAudio?.acodec),
    });
  }

  // The sound alone: an audio-only rendition, or else the smallest file with sound in it.
  const smallestMuxed = [...formats.filter(isVideo)]
    .filter((format) => !isNone(format.acodec))
    .sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0];
  const audioSource = bestAudio ?? smallestMuxed ?? null;
  if (audioSource) {
    picks.push({
      format: {
        id: 'audio',
        label: 'Audio Only',
        height: null,
        fps: null,
        ext: 'm4a',
        bytes:
          bestAudio && typeof bestAudio.filesize === 'number' && bestAudio.filesize > 0
            ? bestAudio.filesize
            : null,
        audioOnly: true,
      },
      ytDlpIds: [audioSource.format_id],
      hls: (audioSource.protocol ?? '').startsWith('m3u8'),
      url: httpsUrl(audioSource.url),
      httpHeaders: headersOf(audioSource),
      audioFromVideo: bestAudio === null,
      aacAudio: isAac(audioSource.acodec),
    });
  }
  return picks;
}

/** The tallest video rendition at or below `maxHeight`, else the smallest there is. */
export function chooseVideo(
  picks: readonly PickedFormat[],
  maxHeight: number,
): PickedFormat | null {
  const videos = picks.filter((pick) => !pick.format.audioOnly && pick.format.height !== null);
  const fitting = videos.filter((pick) => (pick.format.height as number) <= maxHeight);
  if (fitting.length > 0) {
    return fitting.reduce((a, b) =>
      (b.format.height as number) > (a.format.height as number) ? b : a,
    );
  }
  if (videos.length === 0) return null;
  return videos.reduce((a, b) =>
    (b.format.height as number) < (a.format.height as number) ? b : a,
  );
}

function pickThumbnail(info: z.infer<typeof rawInfoSchema>): string | null {
  const direct = httpsUrl(info.thumbnail);
  if (direct) return direct;
  let best: { url: string; score: number } | null = null;
  for (const raw of info.thumbnails ?? []) {
    const parsed = rawThumbnailSchema.safeParse(raw);
    if (!parsed.success) continue;
    const url = httpsUrl(parsed.data.url);
    if (!url) continue;
    const score = (parsed.data.width ?? 0) * 1000 + (parsed.data.preference ?? 0);
    if (!best || score >= best.score) best = { url, score };
  }
  return best?.url ?? null;
}

function replayedPoints(raw: readonly unknown[] | null | undefined): ReplayedPoint[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const points: ReplayedPoint[] = [];
  for (const item of raw) {
    const parsed = rawHeatSchema.safeParse(item);
    if (!parsed.success) continue;
    const { start_time, end_time, value } = parsed.data;
    if (!(end_time > start_time) || start_time < 0) continue;
    points.push({
      startMs: Math.round(start_time * 1000),
      endMs: Math.round(end_time * 1000),
      value: Math.min(1, Math.max(0, value)),
    });
  }
  return points.length > 0 ? points : undefined;
}

/** Control characters become spaces, so a title cannot break a log line or a header. */
function withoutControl(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('');
}

function cleanTitle(title: string | null | undefined): string {
  const text = withoutControl(title ?? '').trim();
  if (text.length === 0) return 'Untitled video';
  return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…` : text;
}

function cleanName(name: string | null | undefined): string | null {
  const text = withoutControl(name ?? '').trim();
  return text.length > 0 ? text.slice(0, 200) : null;
}

/**
 * The probe answer for `link`. Throws a `DownloaderError` for a list
 * (`link_not_a_video`), a gated video (`link_private`), or an answer we
 * cannot read (`tool_failed`, not retried). A live stream is not an error
 * here: `live` is true and the API refuses it with its own sentence.
 */
export function mapProbeJson(json: unknown, link: LinkRef): ProbeResult {
  const parsed = rawInfoSchema.safeParse(json);
  if (!parsed.success) {
    throw new DownloaderError('tool_failed', { retryable: false, cause: parsed.error });
  }
  const info = parsed.data;
  if (info._type && info._type !== 'video') {
    throw new DownloaderError('link_not_a_video', { retryable: false });
  }
  const extractor = info.extractor?.toLowerCase();
  if (extractor && !IMPORT_EXTRACTORS[link.platform].includes(extractor)) {
    throw new DownloaderError('link_not_a_video', { retryable: false });
  }
  if (
    (info.availability && PRIVATE_AVAILABILITY.has(info.availability)) ||
    (typeof info.age_limit === 'number' && info.age_limit >= 18)
  ) {
    throw new DownloaderError('link_private', { retryable: false });
  }

  const live = info.is_live === true || (!!info.live_status && LIVE_STATUSES.has(info.live_status));

  let sectionMs: ProbeResult['sectionMs'] = null;
  if (
    link.platform === 'youtube' &&
    typeof info.section_start === 'number' &&
    typeof info.section_end === 'number' &&
    info.section_end > info.section_start
  ) {
    sectionMs = {
      fromMs: Math.round(Math.max(0, info.section_start) * 1000),
      toMs: Math.round(info.section_end * 1000),
    };
  }

  let durationMs = 0;
  if (sectionMs) {
    durationMs = sectionMs.toMs - sectionMs.fromMs;
  } else if (
    typeof info.duration === 'number' &&
    Number.isFinite(info.duration) &&
    info.duration > 0
  ) {
    durationMs = Math.round(info.duration * 1000);
  } else if (!live) {
    // A finished video always has a length; without one we cannot check the plan.
    throw new DownloaderError('tool_failed', { retryable: false });
  }

  const picks = pickFormats(info.formats ?? []);
  if (!live && picks.length === 0) {
    throw new DownloaderError('tool_failed', { retryable: false });
  }

  const pastStream =
    link.platform === 'youtube' &&
    link.kind === 'video' &&
    (info.live_status === 'was_live' || info.was_live === true);

  const result: LinkInfo = {
    platform: link.platform,
    kind: pastStream ? 'past_stream' : link.kind,
    externalId: link.externalId,
    canonicalUrl: link.canonicalUrl,
    ...(link.channel !== undefined ? { channel: link.channel } : {}),
    title: cleanTitle(info.title),
    channelName: cleanName(info.channel?.trim() ? info.channel : info.uploader),
    durationMs,
    live,
    thumbnailUrl: pickThumbnail(info),
    formats: picks.map((pick) => pick.format),
  };
  const replayed = replayedPoints(info.heatmap);
  if (replayed) result.replayed = replayed;
  return { info: result, picks, sectionMs };
}
