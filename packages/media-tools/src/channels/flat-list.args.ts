/**
 * The yt-dlp argument builder for channel lists: `-J --flat-playlist` on a
 * channel page we build ourselves from a checked handle and a fixed host.
 *
 * The listing extractors (`kick:videos`, `kick:clips`, `twitch:videos`,
 * `twitch:videos:clips`, `youtube:tab`) are allowed here and only here: the
 * import probe and the download keep refusing lists (Module 03, section 5).
 * One extractor per call, chosen by platform and list, never by the page.
 */
import type { ChannelPlatformId, ListKind, ListPeriod, ListSort } from '@postgear/video-engine';
import {
  YTDLP_SOCKET_TIMEOUT_SEC,
  type YtDlpConfig,
  ytDlpEnvArgs,
} from '../downloader/yt-dlp.args';
import { channelKey } from './channel-key';
import { ChannelListerError } from './types';

/** The one listing extractor for each platform's list. */
export const LISTING_EXTRACTORS: Readonly<
  Record<ChannelPlatformId, Partial<Record<ListKind, string>>>
> = Object.freeze({
  twitch: Object.freeze({ streams: 'twitch:videos', clips: 'twitch:videos:clips' }),
  kick: Object.freeze({ streams: 'kick:videos', clips: 'kick:clips' }),
  youtube: Object.freeze({ uploads: 'youtube:tab', streams: 'youtube:tab', shorts: 'youtube:tab' }),
});

/** Every listing extractor, for the allowlist test. */
export const LISTING_EXTRACTOR_ALLOWLIST: readonly string[] = Object.freeze([
  'kick:videos',
  'kick:clips',
  'twitch:videos',
  'twitch:videos:clips',
  'youtube:tab',
]);

// `channelKey` lives in its own pure file so the simulated lister (served to
// the API through `@postgear/media-tools/listing`) never imports this one,
// which reaches the process runner through the yt-dlp argument base.
export { channelKey };

const TWITCH_CLIP_RANGE: Readonly<Record<ListPeriod, string>> = Object.freeze({
  day: '24hr',
  week: '7d',
  month: '30d',
  all: 'all',
});

/**
 * The channel page for one list, on the platform's fixed host. The key is
 * encoded although it was checked, so nothing in it can change the address.
 */
export function channelPageUrl(
  platform: ChannelPlatformId,
  key: string,
  kind: ListKind,
  options: { sort?: ListSort; period?: ListPeriod } = {},
): string {
  const encoded = encodeURIComponent(channelKey(platform, key));
  if (platform === 'twitch') {
    if (kind === 'streams') {
      const sort = options.sort === 'views' ? 'views' : 'time';
      return `https://www.twitch.tv/${encoded}/videos?filter=archives&sort=${sort}`;
    }
    if (kind === 'clips') {
      return `https://www.twitch.tv/${encoded}/clips?filter=clips&range=${TWITCH_CLIP_RANGE[options.period ?? 'all']}`;
    }
  } else if (platform === 'kick') {
    if (kind === 'streams') return `https://kick.com/${encoded}/videos`;
    if (kind === 'clips') return `https://kick.com/${encoded}/clips`;
  } else {
    if (options.sort === 'views') {
      // YouTube lists newest first only; sorting what is loaded would mislead (research 11, section 8).
      throw new ChannelListerError('list_sort_unsupported', { retryable: false });
    }
    const tab =
      kind === 'uploads'
        ? 'videos'
        : kind === 'streams'
          ? 'streams'
          : kind === 'shorts'
            ? 'shorts'
            : null;
    if (tab) {
      const raw = channelKey(platform, key);
      const base = raw.startsWith('@')
        ? `https://www.youtube.com/${encodeURIComponent(raw).replace('%40', '@')}`
        : `https://www.youtube.com/channel/${encoded}`;
      return `${base}/${tab}`;
    }
  }
  throw new ChannelListerError('list_kind_unsupported', { retryable: false });
}

export interface FlatListArgsInput {
  platform: ChannelPlatformId;
  /** A Twitch login, Kick slug, YouTube handle or channel id. */
  key: string;
  kind: ListKind;
  sort?: ListSort;
  period?: ListPeriod;
  /** 1-based position of the first item. */
  start: number;
  /** How many items, at most 51 (a page and one more to know there is a next page). */
  count: number;
}

/** The argument array for one flat list call. Cookies are never sent for a list. */
export function flatListArgs(config: YtDlpConfig, input: FlatListArgsInput): string[] {
  const extractor = LISTING_EXTRACTORS[input.platform][input.kind];
  if (!extractor || !LISTING_EXTRACTOR_ALLOWLIST.includes(extractor)) {
    throw new ChannelListerError('list_kind_unsupported', { retryable: false });
  }
  const start = Math.max(1, Math.floor(input.start));
  const count = Math.min(51, Math.max(1, Math.floor(input.count)));
  const url = channelPageUrl(input.platform, input.key, input.kind, {
    ...(input.sort ? { sort: input.sort } : {}),
    ...(input.period ? { period: input.period } : {}),
  });
  const args = [
    '-J',
    '--flat-playlist',
    '--ignore-config',
    '--no-warnings',
    '--use-extractors',
    extractor,
    '-I',
    `${start}:${start + count - 1}`,
    '--color',
    'never',
    '--socket-timeout',
    String(YTDLP_SOCKET_TIMEOUT_SEC),
    '--retries',
    '2',
    ...ytDlpEnvArgs(config, null),
  ];
  if (input.platform === 'youtube') {
    // Flat YouTube entries carry no date without this (research 11, section 5).
    args.push('--extractor-args', 'youtubetab:approximate_date');
  }
  args.push('--', url);
  return args;
}
