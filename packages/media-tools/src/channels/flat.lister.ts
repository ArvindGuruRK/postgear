/**
 * `YtDlpFlatLister`: lists a channel with `yt-dlp -J --flat-playlist`.
 *
 * Runs in the worker (activity `clipListChannel` on the media queue); the
 * API waits for it as it waits for a probe. Kick always uses it (Kick has no
 * official route for videos or clips); Twitch and YouTube use it when their
 * official lister is off or out of quota. yt-dlp pages by index, so page 3
 * walks pages 1 to 3 again; that is accepted for a fallback (research 11).
 *
 * Twitch ids here are logins, not Helix user ids, and there is no avatar:
 * the flat answer does not carry one.
 */
import { mkdir, mkdtemp } from 'node:fs/promises';
import * as path from 'node:path';
import type { ChannelPage, ChannelRef, ChannelPlatformId } from '@postgear/video-engine';
import { removeDirQuietly } from '../downloader/files';
import type { YtDlpConfig } from '../downloader/yt-dlp.args';
import { mapYtDlpError } from '../downloader/yt-dlp.errors';
import { ToolError } from '../run/types';
import type { RunTool } from '../run/types';
import { channelKey, flatListArgs } from './flat-list.args';
import { parseFlatList } from './flat-list.parse';
import {
  assertListKind,
  type ChannelLister,
  type ChannelListQuery,
  ChannelListerError,
  cursorStart,
  nextCursorAfter,
  pageLimit,
  PLATFORM_LIST_KINDS,
} from './types';

export interface FlatListerOptions extends Omit<YtDlpConfig, 'cookiesFile'> {
  runTool: RunTool;
  /** The scratch root; each call makes and removes a folder here. */
  scratchDir: string;
  /** One list call; the API waits 25 seconds in all. Default 22 seconds. */
  timeoutMs?: number;
}

/** The yt-dlp flat lister for one platform. */
export function createYtDlpFlatLister(
  platform: ChannelPlatformId,
  options: FlatListerOptions,
): ChannelLister {
  return new YtDlpFlatLister(platform, options);
}

const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** A failed run, as our code: a missing channel, a resting platform, or a site that changed. */
export function flatListError(error: unknown): ChannelListerError {
  if (error instanceof ChannelListerError) return error;
  if (error instanceof ToolError) {
    if (error.aborted)
      return new ChannelListerError('cancelled', { retryable: false, cause: error });
    if (error.timedOut) return new ChannelListerError('channel_listing_failed', { cause: error });
    const code = mapYtDlpError(error.stderrTail);
    if (code === 'link_not_found' || code === 'link_not_a_video') {
      return new ChannelListerError('channel_not_found', { retryable: false, cause: error });
    }
    if (code === 'platform_resting')
      return new ChannelListerError('platform_rate_limited', { cause: error });
    if (code === 'link_private')
      return new ChannelListerError('channel_listing_failed', { retryable: false, cause: error });
    return new ChannelListerError('platform_changed', { retryable: false, cause: error });
  }
  return new ChannelListerError('channel_listing_failed', { cause: error });
}

class YtDlpFlatLister implements ChannelLister {
  constructor(
    readonly platform: ChannelPlatformId,
    private readonly options: FlatListerOptions,
  ) {}

  async resolve(handle: string, signal?: AbortSignal): Promise<ChannelRef> {
    const key = channelKey(this.platform, handle);
    const kind = PLATFORM_LIST_KINDS[this.platform][0] ?? 'streams';
    const { facts } = await this.run({ key, kind, start: 1, count: 1 }, signal);
    const channelId =
      facts.channelId && YOUTUBE_CHANNEL_ID.test(facts.channelId) ? facts.channelId : null;
    const ref: ChannelRef = {
      platform: this.platform,
      handle: key,
      externalId: this.platform === 'youtube' ? (channelId ?? key) : key,
      displayName: facts.channelName ?? key.replace(/^@/, ''),
      avatarUrl: null,
    };
    return ref;
  }

  async list(
    channel: ChannelRef,
    query: ChannelListQuery,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    assertListKind(this.platform, query.kind);
    const limit = pageLimit(query.limit);
    const start = cursorStart(query.cursor);
    if (start === null) return { items: [] };
    const key =
      this.platform === 'youtube' && YOUTUBE_CHANNEL_ID.test(channel.externalId)
        ? channel.externalId
        : channel.handle;
    const { items } = await this.run(
      {
        key,
        kind: query.kind,
        start,
        count: limit + 1,
        ...(query.sort ? { sort: query.sort } : {}),
        ...(query.period ? { period: query.period } : {}),
        ...(channel.broadcasterType !== undefined
          ? { broadcasterType: channel.broadcasterType }
          : {}),
      },
      signal,
    );
    const page: ChannelPage = { items: items.slice(0, limit) };
    const next = nextCursorAfter(start, limit, items.length > limit);
    if (next !== undefined) page.nextCursor = next;
    return page;
  }

  private async run(
    input: {
      key: string;
      kind: ChannelListQuery['kind'];
      start: number;
      count: number;
      sort?: ChannelListQuery['sort'];
      period?: ChannelListQuery['period'];
      broadcasterType?: string;
    },
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof parseFlatList>> {
    const args = flatListArgs(this.options, {
      platform: this.platform,
      key: input.key,
      kind: input.kind,
      start: input.start,
      count: input.count,
      ...(input.sort ? { sort: input.sort } : {}),
      ...(input.period ? { period: input.period } : {}),
    });
    await mkdir(this.options.scratchDir, { recursive: true });
    const workDir = await mkdtemp(path.join(this.options.scratchDir, '.list-'));
    try {
      const result = await this.options.runTool('yt-dlp', args, {
        cwd: workDir,
        timeoutMs: this.options.timeoutMs ?? 22_000,
        ...(signal ? { signal } : {}),
        maxStdoutBytes: 16 * 1024 * 1024,
      });
      const line = result.stdout
        .split(/\r?\n/)
        .map((text) => text.trim())
        .filter((text) => text.startsWith('{'))
        .pop();
      if (!line) throw new ChannelListerError('platform_changed', { retryable: false });
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new ChannelListerError('platform_changed', { retryable: false, cause: error });
      }
      return parseFlatList(json, {
        platform: this.platform,
        kind: input.kind,
        channelKey: channelKey(this.platform, input.key),
        ...(input.broadcasterType !== undefined ? { broadcasterType: input.broadcasterType } : {}),
      });
    } catch (error) {
      throw flatListError(error);
    } finally {
      await removeDirQuietly(workDir);
    }
  }
}
