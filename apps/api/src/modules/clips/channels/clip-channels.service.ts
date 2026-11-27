/**
 * My Channels (Module 03, section 5; research 11): add a Twitch, YouTube or
 * Kick channel by name and page through its public streams, videos and
 * clips. Metadata only: nothing is downloaded until a person presses Import,
 * and Import posts the item's canonical link to the ordinary probe.
 *
 * The rules, in the order a request meets them:
 *
 * - **Tenancy**: a channel is found only through `{ id, organizationId }`; an
 *   id that is not a UUID, or another workspace's, is 404 before anything
 *   else is said about it.
 * - **Throttles** per workspace: 30 list calls a minute, 6 adds a minute
 *   (429 `channels_throttled`), one refresh per channel per 30 seconds (429
 *   `refresh_throttled`).
 * - **Plan**: `clips.enabled` (402 `clips_not_in_plan`) and
 *   `clips.browse_channels` (402 `channel_limit`, with the plan's number),
 *   both through the resolver, never a constant.
 * - **Platform switch**: a platform off in `CLIPS_PLATFORMS` cannot be added
 *   or listed (422 `platform_paused`); its channels still show, marked
 *   `paused`, so they can be removed.
 * - **Lists**: one page of 50 through the cache and the selector; items this
 *   workspace hid are left out unless `hidden=true`; each item says whether
 *   the workspace already has it (`imported`, `videoId`); 20 pages at most.
 */
import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClipPlatform } from '@postgear/db';
import {
  type ChannelRef,
  CLIP_ERROR_MESSAGES,
  type ChannelPlatformId,
  type ListedItem,
  type ListKind,
  type ListPeriod,
  type ListSort,
  linkRefForListedItem,
  MAX_LIST_PAGE,
  PLATFORM_LIST_KINDS,
  validateHandle,
} from '@postgear/video-engine';
import type { Env } from '../../../config/env';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { RedisService } from '../../redis/redis.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { withinRate } from '../links/clip-rate-limit';
import { toDbPlatform } from '../links/clip-links.repository';
import { cursorKeyPart, decodeCursor, encodeCursor, MAX_LIST_PAGES } from './channel-cursor';
import { ChannelListCache, channelStampKey, listCacheKey } from './channel-list.cache';
import { ChannelListerSelector } from './channel-lister.selector';
import { CLIP_CHANNELS_MESSAGES, sortUnsupportedMessage } from './clip-channels.messages';
import { type ChannelRow, ClipChannelsRepository } from './clip-channels.repository';
import { type AddChannelInput, LISTED_ID, type ListStreamsQuery } from './clip-channels.schemas';
import { type ListingFailure, toListingFailure } from './listers/listing-failure';

export const LIST_CALLS_PER_MINUTE = 30;
export const ADD_CALLS_PER_MINUTE = 6;
/** The Add dialog's Check step (Module 06): a few misspellings before the add. */
export const CHECK_CALLS_PER_MINUTE = 12;
export const REFRESH_EVERY_SECONDS = 30;
/** Hidden items one channel may hold: ids only, but still a bound on what a workspace can write. */
export const MAX_HIDDEN_PER_CHANNEL = 2_000;

/** What each list offers: its sorts (the first is the default) and, for Twitch clips, periods. */
interface ListOptions {
  kind: ListKind;
  sorts: ListSort[];
  periods: ListPeriod[];
}

const ALL_PERIODS: ListPeriod[] = ['all', 'day', 'week', 'month'];

function listOptions(platform: ChannelPlatformId, kind: ListKind): ListOptions {
  if (platform === 'twitch' && kind === 'streams')
    return { kind, sorts: ['newest', 'views'], periods: [] };
  // Twitch orders clips by views itself.
  if (platform === 'twitch' && kind === 'clips')
    return { kind, sorts: ['views'], periods: ALL_PERIODS };
  // YouTube and Kick list newest first only.
  return { kind, sorts: ['newest'], periods: [] };
}

export interface ChannelView {
  id: string;
  platform: ChannelPlatformId;
  handle: string;
  displayName: string;
  /** The platform's own picture address; the browser loads it, we never copy it. */
  avatarUrl: string | null;
  broadcasterType: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  createdAt: string;
  /** The platform is off in `CLIPS_PLATFORMS`: shown so it can be removed, never listed. */
  paused: boolean;
  lists: ListOptions[];
}

/** What the Add dialog's Check step shows before anything is saved. */
export interface CheckedChannelView {
  platform: ChannelPlatformId;
  handle: string;
  displayName: string;
  /** The platform's own picture address; the browser loads it, we never copy it. */
  avatarUrl: string | null;
}

export interface StreamItemView extends ListedItem {
  hidden: boolean;
  imported: boolean;
  videoId: string | null;
}

export interface StreamsView {
  kind: ListKind;
  sort: ListSort;
  period: ListPeriod | null;
  items: StreamItemView[];
  nextCursor: string | null;
  /** When the platform answered (ISO): "Updated N minutes ago". */
  updatedAt: string;
  /** An older copy answered because a new fetch failed (never older than 24 hours). */
  stale: boolean;
  /**
   * The 1,000 item limit was reached. `notice` says so, or (first, Module 20)
   * that the list could not be read and this is the last answer: the stories'
   * "This channel's list is not available right now. Try again in a few
   * minutes." beside "Updated 3 hours ago".
   */
  capped: boolean;
  notice: string | null;
}

@Injectable()
export class ClipChannelsService {
  private readonly logger = new Logger(ClipChannelsService.name);
  private readonly platforms: ReadonlySet<ChannelPlatformId>;

  constructor(
    private readonly repository: ClipChannelsRepository,
    private readonly selector: ChannelListerSelector,
    private readonly cache: ChannelListCache,
    private readonly resolver: EntitlementResolver,
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.platforms = new Set(config.get('CLIPS_PLATFORMS', { infer: true }));
  }

  async list(orgId: string): Promise<ChannelView[]> {
    const rows = await this.repository.list(orgId);
    return rows.map((row) => this.view(row));
  }

  /** `POST /clips/channels`: check, resolve on the platform, store. */
  async add(orgId: string, userId: string | null, input: AddChannelInput): Promise<ChannelView> {
    const { platform, dbPlatform, channel, limit } = await this.resolveForAdd(orgId, input, 'add');

    const outcome = await this.repository.create(orgId, userId, dbPlatform, channel, limit);
    if (outcome.outcome === 'exists')
      throw new ClipErrorException(HttpStatus.CONFLICT, 'channel_exists');
    if (outcome.outcome === 'too_many') {
      // Another add won the last place meanwhile: the same refusal, with the count it saw.
      await this.resolver.assert(orgId, 'clips.browse_channels', () => false, {
        used: outcome.used,
      });
      throw new ClipErrorException(HttpStatus.PAYMENT_REQUIRED, 'channel_limit');
    }
    this.logger.log(JSON.stringify({ event: 'clips.channels.added', orgId, platform }));
    return this.view(outcome.channel);
  }

  /**
   * `POST /clips/channels/check` (Module 06, the Add A Channel dialog's
   * Check step): every check add runs, and the channel resolved through the
   * same lister, but nothing is written. Its own throttle bucket
   * (`CHECK_CALLS_PER_MINUTE`), so checking first never halves the adds.
   */
  async check(orgId: string, input: AddChannelInput): Promise<CheckedChannelView> {
    const { channel, dbPlatform } = await this.resolveForAdd(orgId, input, 'check');
    // Add's insert refuses the same platform id under another spelling; say so now.
    if (await this.repository.findByExternalId(orgId, dbPlatform, channel.externalId)) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'channel_exists');
    }
    return {
      platform: channel.platform,
      handle: channel.handle,
      displayName: channel.displayName,
      avatarUrl: channel.avatarUrl,
    };
  }

  /** Add's checks in order, then the platform's answer: the plan, switch, handle, throttle, duplicate, limit. */
  private async resolveForAdd(orgId: string, input: AddChannelInput, call: 'add' | 'check') {
    const { platform } = input;
    await this.resolver.assert(orgId, 'clips.enabled', (enabled) => enabled === true);
    this.assertPlatformOn(platform);

    const checked = validateHandle(platform, input.handle);
    if (!checked.ok) throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, checked.code);
    const perMinute = call === 'add' ? ADD_CALLS_PER_MINUTE : CHECK_CALLS_PER_MINUTE;
    if (!(await withinRate(this.redis, `clips:channels:rate:${call}:${orgId}`, perMinute, 60))) {
      throw this.throttled();
    }

    const dbPlatform = toDbPlatform(platform);
    if (await this.repository.findByHandle(orgId, dbPlatform, checked.handle)) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'channel_exists');
    }
    // Checked before the platform is asked, and again inside the insert.
    const used = await this.repository.count(orgId);
    const limit = await this.resolver.assert(
      orgId,
      'clips.browse_channels',
      (allowed) => allowed === null || used < allowed,
      { used },
    );

    let channel: ChannelRef;
    try {
      channel = (await this.selector.resolve(platform, checked.channelId ?? checked.handle))
        .channel;
    } catch (error) {
      throw this.refusal(toListingFailure(error), platform);
    }
    return { platform, dbPlatform, channel, limit };
  }

  /** `GET /clips/channels/:id/streams`: one page of a channel's list. */
  async streams(orgId: string, id: string, query: ListStreamsQuery): Promise<StreamsView> {
    if (!isUuid(id)) throw this.gone();
    if (
      !(await withinRate(
        this.redis,
        `clips:channels:rate:list:${orgId}`,
        LIST_CALLS_PER_MINUTE,
        60,
      ))
    ) {
      throw this.throttled();
    }
    await this.resolver.assert(orgId, 'clips.enabled', (enabled) => enabled === true);
    const row = await this.repository.find(orgId, id);
    if (!row) throw this.gone();
    const platform = platformOf(row.platform);
    this.assertPlatformOn(platform);

    const kind = query.kind ?? PLATFORM_LIST_KINDS[platform][0];
    if (!PLATFORM_LIST_KINDS[platform].includes(kind)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'list_kind_unsupported', {
        message: CLIP_CHANNELS_MESSAGES.list_kind_unsupported,
      });
    }
    const options = listOptions(platform, kind);
    const sort = this.sortFor(platform, options, query.sort);
    const period = options.periods.length > 0 ? (query.period ?? 'all') : null;

    const position = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && position === null) {
      throw new ClipErrorException(HttpStatus.BAD_REQUEST, 'list_cursor_invalid', {
        message: CLIP_CHANNELS_MESSAGES.LIST_CURSOR_INVALID,
      });
    }

    const ref = toChannelRef(platform, row);
    const key = listCacheKey({
      platform,
      externalId: row.externalId,
      kind,
      sort,
      period: period ?? '-',
      cursor: cursorKeyPart(position),
    });

    let loaded: Awaited<ReturnType<ChannelListCache['load']>>;
    try {
      loaded = await this.cache.load(key, channelStampKey(platform, row.externalId), () =>
        this.selector.list(
          platform,
          ref,
          { kind, limit: MAX_LIST_PAGE, sort, ...(period ? { period } : {}) },
          position,
        ),
      );
    } catch (error) {
      const failure = toListingFailure(error);
      if (row.error !== failure.code) await this.noteSync(orgId, row.id, failure.code);
      throw this.refusal(failure, platform);
    }
    const fetchedAt = new Date(loaded.fetchedAt);
    if (
      !loaded.stale &&
      (row.error !== null || !row.lastSyncedAt || row.lastSyncedAt < fetchedAt)
    ) {
      await this.noteSync(orgId, row.id, null);
    }

    const showHidden = query.hidden === 'true';
    const [hidden, imported] = await Promise.all([
      this.repository.hiddenIds(orgId, row.id),
      this.repository.importedVideos(
        orgId,
        row.platform,
        loaded.page.items.map((item) => videoIdOf(platform, item)),
      ),
    ]);
    const items = loaded.page.items
      .filter((item) => showHidden || !hidden.has(item.externalId))
      .map((item): StreamItemView => {
        const videoId = imported.get(videoIdOf(platform, item)) ?? null;
        return {
          ...item,
          hidden: hidden.has(item.externalId),
          imported: videoId !== null,
          videoId,
        };
      });

    const pageIndex = position?.page ?? 0;
    const more = loaded.page.nextCursor;
    const capped = more !== undefined && pageIndex + 1 >= MAX_LIST_PAGES;
    const nextCursor =
      more !== undefined && !capped
        ? encodeCursor({ page: pageIndex + 1, source: loaded.source, cursor: more })
        : null;

    return {
      kind,
      sort,
      period,
      items,
      nextCursor,
      updatedAt: loaded.fetchedAt,
      stale: loaded.stale,
      capped,
      notice: loaded.stale
        ? CLIP_ERROR_MESSAGES.channel_listing_failed
        : capped
          ? CLIP_CHANNELS_MESSAGES.LIST_CAPPED
          : null,
    };
  }

  /** `PUT /clips/channels/:id/hidden/:externalId`: idempotent. */
  async hide(
    orgId: string,
    id: string,
    externalId: string,
  ): Promise<{ externalId: string; hidden: true }> {
    if (!isUuid(id) || !LISTED_ID.test(externalId)) throw this.gone();
    const outcome = await this.repository.hide(orgId, id, externalId, MAX_HIDDEN_PER_CHANNEL);
    if (outcome === 'not_found') throw this.gone();
    if (outcome === 'too_many') {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'hidden_limit', {
        message: CLIP_CHANNELS_MESSAGES.hidden_limit,
      });
    }
    return { externalId, hidden: true };
  }

  /** `DELETE /clips/channels/:id/hidden/:externalId`: idempotent. */
  async unhide(
    orgId: string,
    id: string,
    externalId: string,
  ): Promise<{ externalId: string; hidden: false }> {
    if (!isUuid(id) || !LISTED_ID.test(externalId)) throw this.gone();
    if (!(await this.repository.unhide(orgId, id, externalId))) throw this.gone();
    return { externalId, hidden: false };
  }

  /** `DELETE /clips/channels/:id`: the channel and its hidden ids. */
  async remove(orgId: string, id: string): Promise<{ message: string }> {
    if (!isUuid(id) || !(await this.repository.remove(orgId, id))) throw this.gone();
    return { message: CLIP_CHANNELS_MESSAGES.CHANNEL_REMOVED };
  }

  /** `POST /clips/channels/:id/refresh`: every cached page of the channel stops being fresh. */
  async refresh(orgId: string, id: string): Promise<{ refreshedAt: string }> {
    if (!isUuid(id)) throw this.gone();
    const row = await this.repository.find(orgId, id);
    if (!row) throw this.gone();
    const platform = platformOf(row.platform);
    // Per channel, not per workspace: the cache it drops is shared by every workspace.
    const first = await this.redis.setIfAbsent(
      `clips:channels:refresh:${platform}:${row.externalId}`,
      '1',
      REFRESH_EVERY_SECONDS,
    );
    if (!first) throw new ClipErrorException(HttpStatus.TOO_MANY_REQUESTS, 'refresh_throttled');
    await this.cache.dropChannel(channelStampKey(platform, row.externalId));
    return { refreshedAt: new Date().toISOString() };
  }

  // ---- Internals -----------------------------------------------------------

  private view(row: ChannelRow): ChannelView {
    const platform = platformOf(row.platform);
    return {
      id: row.id,
      platform,
      handle: row.handle,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      broadcasterType: row.broadcasterType,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      paused: !this.platforms.has(platform),
      lists: PLATFORM_LIST_KINDS[platform].map((kind) => listOptions(platform, kind)),
    };
  }

  private sortFor(
    platform: ChannelPlatformId,
    options: ListOptions,
    asked: ListSort | undefined,
  ): ListSort {
    if (asked === undefined) return options.sorts[0];
    // Twitch clips come by views whatever is asked; the platform has no other order.
    if (platform === 'twitch' && options.kind === 'clips') return 'views';
    if (!options.sorts.includes(asked)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'list_sort_unsupported', {
        message: sortUnsupportedMessage(platform),
      });
    }
    return asked;
  }

  private assertPlatformOn(platform: ChannelPlatformId): void {
    if (!this.platforms.has(platform)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'platform_paused', {
        platform,
      });
    }
  }

  /** The failure as an answer: one of our sentences, never a platform's. */
  private refusal(failure: ListingFailure, platform: ChannelPlatformId): ClipErrorException {
    switch (failure.code) {
      case 'channel_not_found':
        return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'channel_not_found');
      case 'list_sort_unsupported':
        return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'list_sort_unsupported', {
          message: sortUnsupportedMessage(platform),
        });
      case 'list_kind_unsupported':
        return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'list_kind_unsupported', {
          message: CLIP_CHANNELS_MESSAGES.list_kind_unsupported,
        });
      case 'platform_rate_limited':
        return new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'platform_rate_limited', {
          message: CLIP_CHANNELS_MESSAGES.platform_rate_limited,
        });
      case 'platform_resting':
        return new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'platform_resting', {
          platform,
        });
      case 'quota_exhausted':
      case 'tools_offline':
      case 'clips_busy':
        return new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, failure.code);
      case 'platform_changed':
        return new ClipErrorException(HttpStatus.BAD_GATEWAY, 'platform_changed');
      default:
        this.logger.warn(
          JSON.stringify({ event: 'clips.channels.listing_failed', platform, code: failure.code }),
        );
        return new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'channel_listing_failed');
    }
  }

  /** Best effort: a failed bookkeeping write never fails the list. */
  private async noteSync(orgId: string, id: string, error: string | null): Promise<void> {
    try {
      await this.repository.markSynced(orgId, id, error);
    } catch (cause) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.channels.sync_note_failed',
          reason: cause instanceof Error ? cause.name : 'unknown',
        }),
      );
    }
  }

  private gone(): NotFoundException {
    return new NotFoundException({
      message: CLIP_CHANNELS_MESSAGES.CHANNEL_GONE,
      code: 'channel_not_found',
    });
  }

  private throttled(): ClipErrorException {
    return new ClipErrorException(HttpStatus.TOO_MANY_REQUESTS, 'channels_throttled', {
      message: CLIP_CHANNELS_MESSAGES.channels_throttled,
    });
  }
}

function platformOf(platform: ClipPlatform): ChannelPlatformId {
  return platform.toLowerCase() as ChannelPlatformId;
}

function toChannelRef(platform: ChannelPlatformId, row: ChannelRow): ChannelRef {
  const ref: ChannelRef = {
    platform,
    handle: row.handle,
    externalId: row.externalId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
  };
  if (row.uploadsListId) ref.uploadsListId = row.uploadsListId;
  if (row.broadcasterType !== null) ref.broadcasterType = row.broadcasterType;
  return ref;
}

/** The id a `ClipVideo` row holds for a listed item (Kick video ids are kept lower case). */
function videoIdOf(platform: ChannelPlatformId, item: ListedItem): string {
  return linkRefForListedItem(platform, item)?.externalId ?? item.externalId;
}
