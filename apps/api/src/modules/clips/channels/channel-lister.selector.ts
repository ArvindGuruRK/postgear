/**
 * Which binding answers a channel question (Module 03, section 5).
 *
 * Per platform there is an official binding and the flat one:
 *
 * | Platform | Official | Flat |
 * |---|---|---|
 * | Twitch | Helix, when `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are set | the worker's yt-dlp flat list |
 * | YouTube | the Data API, with `CLIPS_YOUTUBE_API_KEY` (development may use `YOUTUBE_API_KEY`) | the same |
 * | Kick | none (Kick has no official route for videos or clips) | the same |
 *
 * With `CLIPS_SIMULATION=true` the simulated lister answers everything in
 * process: no worker, no network.
 *
 * The official binding goes first; on `platform_rate_limited`,
 * `quota_exhausted` or `lister_unconfigured` (bad or missing keys) the flat
 * one is tried. If the flat one cannot run either (the worker is off, its
 * slots are taken, the platform is resting), the official binding's reason
 * is the answer, since it says more. Every answer is checked against one
 * shape (`listed-shapes.ts`) before anyone sees it.
 *
 * A page carries the binding it came from, so the next page of a list stays
 * on that binding; a list that falls back mid-way continues on the flat list
 * from the same position.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ChannelLister,
  ChannelListQuery,
  ChannelPage,
  ChannelRef,
  ChannelPlatformId,
} from '@postgear/video-engine';
import { MAX_LIST_PAGE } from '@postgear/video-engine';
import { normaliseChannel, normalisePage } from './listers/listed-shapes';
import {
  ListingFailure,
  type ListingFailureCode,
  toListingFailure,
} from './listers/listing-failure';

export type ListingSource = 'official' | 'flat';

/** The bindings for one platform. `official` is null when it has none, or its keys are unset. */
export interface ListerSet {
  official: ChannelLister | null;
  flat: ChannelLister | null;
}

export type ListerSets = Readonly<Record<ChannelPlatformId, ListerSet>>;

export const CHANNEL_LISTER_SETS = Symbol('CHANNEL_LISTER_SETS');

/** Official failures the flat list may answer instead. */
const FALLBACK: ReadonlySet<ListingFailureCode> = new Set([
  'platform_rate_limited',
  'quota_exhausted',
  'lister_unconfigured',
]);

/** The flat list could not run at all: the official reason is the better answer. */
const FLAT_UNAVAILABLE: ReadonlySet<ListingFailureCode> = new Set([
  'tools_offline',
  'clips_busy',
  'platform_resting',
]);

/** Where the next page continues: the binding, its own cursor, and the page number (0 is the first). */
export interface PagePosition {
  source: ListingSource;
  cursor: string;
  page: number;
}

@Injectable()
export class ChannelListerSelector {
  private readonly logger = new Logger(ChannelListerSelector.name);

  constructor(@Inject(CHANNEL_LISTER_SETS) private readonly sets: ListerSets) {}

  async resolve(
    platform: ChannelPlatformId,
    handle: string,
  ): Promise<{ channel: ChannelRef; source: ListingSource }> {
    const { value, source } = await this.run(platform, 'resolve', null, (lister) =>
      lister.resolve(handle),
    );
    return { channel: normaliseChannel(platform, value), source };
  }

  /**
   * One page. `position` is where the previous page left off (absent for the
   * first page). `query.cursor` is ignored: the position carries it.
   */
  async list(
    platform: ChannelPlatformId,
    channel: ChannelRef,
    query: Omit<ChannelListQuery, 'cursor'>,
    position: PagePosition | null,
  ): Promise<{ page: ChannelPage; source: ListingSource }> {
    const { value, source } = await this.run(
      platform,
      'list',
      position?.source ?? null,
      (lister, from) => lister.list(channel, { ...query, ...cursorFor(from, position) }),
    );
    const { page, dropped } = normalisePage(value);
    if (dropped > 0) {
      this.logger.warn(
        JSON.stringify({ event: 'clips.channels.rows_dropped', platform, source, dropped }),
      );
    }
    return { page, source };
  }

  private async run<T>(
    platform: ChannelPlatformId,
    action: 'resolve' | 'list',
    stayOn: ListingSource | null,
    call: (lister: ChannelLister, source: ListingSource) => Promise<T>,
  ): Promise<{ value: T; source: ListingSource }> {
    const set = this.sets[platform];
    const chain: Array<[ListingSource, ChannelLister]> = [];
    if (set.official && stayOn !== 'flat') chain.push(['official', set.official]);
    if (set.flat) chain.push(['flat', set.flat]);
    if (chain.length === 0) throw new ListingFailure('channel_listing_failed');

    let officialFailure: ListingFailure | null = null;
    for (let index = 0; index < chain.length; index++) {
      const [source, lister] = chain[index];
      try {
        return { value: await call(lister, source), source };
      } catch (error) {
        const failure = toListingFailure(error);
        const more = index < chain.length - 1;
        if (source === 'official' && more && FALLBACK.has(failure.code)) {
          this.logger.log(
            JSON.stringify({
              event: 'clips.channels.fallback',
              platform,
              action,
              code: failure.code,
            }),
          );
          officialFailure = failure;
          continue;
        }
        if (
          officialFailure &&
          officialFailure.code !== 'lister_unconfigured' &&
          FLAT_UNAVAILABLE.has(failure.code)
        ) {
          throw officialFailure;
        }
        throw failure;
      }
    }
    throw officialFailure ?? new ListingFailure('channel_listing_failed');
  }
}

/**
 * The cursor a binding gets for the page after `position`. Its own cursor
 * when the previous page came from it; for the flat list continuing an
 * official list, the 1-based position of the next item (flat cursors are
 * positions); nothing for the first page.
 */
function cursorFor(source: ListingSource, position: PagePosition | null): { cursor?: string } {
  if (position === null) return {};
  if (position.source === source) return { cursor: position.cursor };
  return source === 'flat' ? { cursor: String(position.page * MAX_LIST_PAGE + 1) } : {};
}
