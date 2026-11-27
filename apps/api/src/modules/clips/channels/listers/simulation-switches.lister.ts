/**
 * Module 20's forcing channels for My Channels, under `CLIPS_SIMULATION=true`
 * only (the factory wraps the simulated lister with this and nothing else).
 * Each is a made-up channel name a hand check types into Add A Channel to
 * reach a state the fixture channel never shows:
 *
 * | Name       | Platforms        | What the list does                                   |
 * |------------|------------------|------------------------------------------------------|
 * | `simempty` | all three        | answers an empty list: "This channel has no public videos yet." |
 * | `simquota` | YouTube          | the day's list allowance is used (`quota_exhausted`) |
 * | `simflaky` | all three        | answers the fixture list once per list kind, then cannot be read (`channel_listing_failed`), so the cache serves its last answer marked stale |
 *
 * Every other name goes to the simulated lister as before (`acme`,
 * `simstreamer`, and `channel_not_found` for the rest). Nothing here reaches
 * the network.
 */
import {
  type ChannelLister,
  ChannelListerError,
  type ChannelListQuery,
  type ChannelPage,
  type ChannelRef,
  type ChannelPlatformId,
} from '@postgear/video-engine';
import { ListingFailure } from './listing-failure';

export type SimulationChannelName = 'simempty' | 'simquota' | 'simflaky';

const NAMES: readonly SimulationChannelName[] = ['simempty', 'simquota', 'simflaky'];

/** The made-up ids, per platform, in each platform's own shape. */
const TWITCH_IDS: Readonly<Record<SimulationChannelName, string>> = {
  simempty: '900000910',
  simquota: '900000911',
  simflaky: '900000912',
};

const DISPLAY_NAMES: Readonly<Record<SimulationChannelName, string>> = {
  simempty: 'Sample: No Public Videos',
  simquota: 'Sample: List Allowance Used',
  simflaky: 'Sample: List Goes Down',
};

/** The channel a forcing name stands for on `platform`, or null when it is not one there. */
export function simulationChannel(
  platform: ChannelPlatformId,
  handleOrId: string,
): { name: SimulationChannelName; ref: ChannelRef } | null {
  const bare = handleOrId.trim().replace(/^@/, '').toLowerCase();
  for (const name of NAMES) {
    if (name === 'simquota' && platform !== 'youtube') continue;
    const ref = refFor(platform, name);
    if (bare === name || bare === ref.externalId.toLowerCase()) return { name, ref };
  }
  return null;
}

function refFor(platform: ChannelPlatformId, name: SimulationChannelName): ChannelRef {
  const displayName = DISPLAY_NAMES[name];
  if (platform === 'youtube') {
    const tail = name.padEnd(22, '0');
    return {
      platform,
      handle: `@${name}`,
      externalId: `UC${tail}`,
      displayName,
      avatarUrl: null,
      uploadsListId: `UU${tail}`,
    };
  }
  if (platform === 'twitch') {
    return {
      platform,
      handle: name,
      externalId: TWITCH_IDS[name],
      displayName,
      avatarUrl: null,
      broadcasterType: 'affiliate',
    };
  }
  return { platform, handle: name, externalId: name, displayName, avatarUrl: null };
}

/** The simulated lister with the forcing channels in front of it. */
export function withSimulationSwitches(inner: ChannelLister): ChannelLister {
  return new SimulationSwitchesLister(inner);
}

class SimulationSwitchesLister implements ChannelLister {
  readonly platform: ChannelPlatformId;
  /** `simflaky`'s list kinds that have answered once in this process. */
  private readonly answered = new Set<string>();

  constructor(private readonly inner: ChannelLister) {
    this.platform = inner.platform;
  }

  async resolve(handle: string, signal?: AbortSignal): Promise<ChannelRef> {
    const forced = simulationChannel(this.platform, handle);
    if (!forced) return this.inner.resolve(handle, signal);
    if (signal?.aborted) throw new ChannelListerError('cancelled', { retryable: false });
    return { ...forced.ref };
  }

  async list(
    channel: ChannelRef,
    query: ChannelListQuery,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    const forced =
      simulationChannel(this.platform, channel.externalId) ??
      simulationChannel(this.platform, channel.handle);
    if (!forced) return this.inner.list(channel, query, signal);
    if (signal?.aborted) throw new ChannelListerError('cancelled', { retryable: false });

    switch (forced.name) {
      case 'simempty':
        return { items: [] };
      case 'simquota':
        throw new ListingFailure('quota_exhausted');
      case 'simflaky': {
        if (this.answered.has(query.kind)) {
          throw new ChannelListerError('channel_listing_failed');
        }
        // The first answer is the fixture channel's list, so its rows import as usual.
        const fixture = await this.inner.resolve('acme', signal);
        const page = await this.inner.list(fixture, query, signal);
        this.answered.add(query.kind);
        return page;
      }
    }
  }
}
