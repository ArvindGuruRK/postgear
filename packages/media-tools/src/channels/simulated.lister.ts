/**
 * `SimulatedLister` (`CLIPS_SIMULATION=true`): lists the fixture channel
 * `acme` (`@acme` on YouTube, `simstreamer` as an alias) from
 * `fixtures/channels/acme.json`. Nothing reaches the network: thumbnails are
 * null, dates are counted back from the moment of the call, and every item's
 * canonical link answers the fixture downloader's probe.
 *
 * Behaves like the real listers where the UI can tell: pages with cursors,
 * newest or most viewed (refused for YouTube), a period filter for Twitch
 * clips, Twitch expiry dates, and `channel_not_found` for any other name.
 */
import type {
  ChannelPage,
  ChannelRef,
  ClipPlatformId,
  ListedItem,
  ListPeriod,
} from '@postgear/video-engine';
import { channelKey } from './channel-key';
import {
  isSimulatedHandle,
  type SimulatedItem,
  simulatedChannel,
  simulatedItems,
} from './simulation-fixture';
import {
  assertListKind,
  type ChannelLister,
  type ChannelListQuery,
  ChannelListerError,
  cursorStart,
  nextCursorAfter,
  pageLimit,
  twitchArchiveExpiry,
} from './types';

export interface SimulatedListerOptions {
  /** The clock; tests pass a fixed one. */
  now?: () => Date;
}

/** The simulated lister for one platform. */
export function createSimulatedChannelLister(
  platform: ClipPlatformId,
  options: SimulatedListerOptions = {},
): ChannelLister {
  return new SimulatedLister(platform, options.now ?? (() => new Date()));
}

const HOUR_MS = 60 * 60 * 1000;
const PERIOD_HOURS: Readonly<Record<ListPeriod, number>> = Object.freeze({
  day: 24,
  week: 24 * 7,
  month: 24 * 30,
  all: Number.POSITIVE_INFINITY,
});

class SimulatedLister implements ChannelLister {
  constructor(
    readonly platform: ClipPlatformId,
    private readonly now: () => Date,
  ) {}

  async resolve(handle: string, signal?: AbortSignal): Promise<ChannelRef> {
    if (signal?.aborted) throw new ChannelListerError('cancelled', { retryable: false });
    // The same handle rules as the real listers, so a bad name fails the same way.
    channelKey(this.platform, handle);
    if (!isSimulatedHandle(this.platform, handle)) {
      throw new ChannelListerError('channel_not_found', { retryable: false });
    }
    const channel = simulatedChannel(this.platform);
    const ref: ChannelRef = {
      platform: this.platform,
      handle: channel.handle,
      externalId: channel.externalId,
      displayName: channel.displayName,
      avatarUrl: null,
    };
    if (channel.uploadsListId !== undefined) ref.uploadsListId = channel.uploadsListId;
    if (channel.broadcasterType !== undefined) ref.broadcasterType = channel.broadcasterType;
    return ref;
  }

  async list(
    channel: ChannelRef,
    query: ChannelListQuery,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    if (signal?.aborted) throw new ChannelListerError('cancelled', { retryable: false });
    assertListKind(this.platform, query.kind);
    if (
      !isSimulatedHandle(this.platform, channel.handle) &&
      !isSimulatedHandle(this.platform, channel.externalId)
    ) {
      throw new ChannelListerError('channel_not_found', { retryable: false });
    }
    if (this.platform === 'youtube' && query.sort === 'views') {
      throw new ChannelListerError('list_sort_unsupported', { retryable: false });
    }
    const limit = pageLimit(query.limit);
    const start = cursorStart(query.cursor);
    if (start === null) return { items: [] };

    let items = simulatedItems(this.platform, query.kind);
    if (this.platform === 'twitch' && query.kind === 'clips' && query.period) {
      const maxAge = PERIOD_HOURS[query.period];
      items = items.filter((item) => item.ageHours <= maxAge);
    }
    // Twitch lists clips by views; everything else newest first unless asked.
    const byViews =
      query.sort === 'views' || (this.platform === 'twitch' && query.kind === 'clips');
    const sorted = [...items].sort((a, b) =>
      byViews ? (b.viewCount ?? 0) - (a.viewCount ?? 0) : a.ageHours - b.ageHours,
    );
    const nowMs = this.now().getTime();
    const page = sorted
      .slice(start - 1, start - 1 + limit)
      .map((item) => this.toListed(item, nowMs, channel));
    const result: ChannelPage = { items: page };
    const next = nextCursorAfter(start, limit, sorted.length > start - 1 + limit);
    if (next !== undefined) result.nextCursor = next;
    return result;
  }

  private toListed(item: SimulatedItem, nowMs: number, channel: ChannelRef): ListedItem {
    const publishedAt = new Date(nowMs - item.ageHours * HOUR_MS).toISOString();
    const listed: ListedItem = {
      externalId: item.externalId,
      kind: item.kind,
      title: item.title,
      publishedAt,
      durationSec: item.durationSec,
      viewCount: item.viewCount,
      thumbnailUrl: null,
      state: item.state,
    };
    if (this.platform === 'twitch' && item.kind === 'vod') {
      const expiresAt = twitchArchiveExpiry(
        publishedAt,
        channel.broadcasterType ?? simulatedChannel('twitch').broadcasterType,
      );
      if (expiresAt) listed.expiresAt = expiresAt;
    }
    // Kick links always name the channel; Twitch only for clips.
    if (this.platform === 'kick' || (this.platform === 'twitch' && item.kind === 'clip')) {
      listed.channel = simulatedChannel(this.platform).handle;
    }
    return listed;
  }
}
