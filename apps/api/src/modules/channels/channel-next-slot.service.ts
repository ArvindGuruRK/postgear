/**
 * Next Available (Sprint 13 Module 13): the next free posting slot of the
 * first chosen channel, placed at a natural minute inside that slot's window
 * (`placeInFreeSlot`), and each chosen channel's own next slot for the
 * tooltip.
 *
 * Read in the browser's zone (the slots are wall-clock minutes, as Add To
 * Queue reads them). Queued posts on every chosen channel count as taken, so
 * the answer never lands on another post's minute or hands out a slot twice;
 * the composer asks again on save if the slot was taken meanwhile.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { findFreeSlot, isValidTimeZone, placeInFreeSlot } from '@postgear/automation';
import { CHANNEL_MESSAGES } from './channels.messages';
import { ChannelsRepository } from './channels.repository';
import { channelIdsOf, type NextSlotQuery } from './dto/channels.schema';

export interface ChannelNextSlot {
  channelId: string;
  /** ISO time, or null when nothing is free within a year. */
  at: string | null;
  /** The window of the slot it was placed in (0 is exact). */
  windowMinutes: number;
}

export interface NextSlotAnswer {
  /** Where the post goes: the first channel's next slot, jittered. Null when none is free. */
  at: string | null;
  /** The channel whose slots were used (the first one chosen). */
  channelId: string;
  windowMinutes: number;
  /** Each chosen channel's own next slot. */
  channels: ChannelNextSlot[];
}

@Injectable()
export class ChannelNextSlotService {
  constructor(private readonly repository: ChannelsRepository) {}

  async nextSlot(orgId: string, query: NextSlotQuery, now = Date.now()): Promise<NextSlotAnswer> {
    if (!isValidTimeZone(query.timeZone)) {
      throw new UnprocessableEntityException({
        message: CHANNEL_MESSAGES.BAD_TIME_ZONE,
        code: 'bad_time_zone',
      });
    }
    const all = await this.repository.listForOrg(orgId);
    const byId = new Map(all.map((channel) => [channel.id, channel]));
    // Another workspace's channel, or a deleted one, is simply not there.
    const chosen = channelIdsOf(query)
      .map((id) => byId.get(id))
      .filter((channel): channel is NonNullable<typeof channel> => channel !== undefined);
    const first = chosen[0];
    if (!first) {
      throw new UnprocessableEntityException({
        message: CHANNEL_MESSAGES.NO_CHANNEL_FOR_SLOT,
        code: 'no_channel',
      });
    }

    const taken = await this.repository.queuedTimes(
      orgId,
      chosen.map((channel) => channel.id),
      new Date(now - 60 * 60_000),
    );
    const seed = query.seed ?? randomUUID();
    const base = { taken, from: now, timeZone: query.timeZone };

    // A channel with no posting times has no next slot here (the composer's
    // button says so), unlike Add To Queue, which falls back to the defaults.
    const slotOf = (postingTimes: typeof first.postingTimes) =>
      postingTimes.length === 0
        ? { found: null, placed: null }
        : {
            found: findFreeSlot({ ...base, postingTimes }),
            placed: placeInFreeSlot({ ...base, postingTimes, seed }),
          };

    const { found, placed: at } = slotOf(first.postingTimes);

    const channels = chosen.map((channel) => {
      const { found: own, placed } = slotOf(channel.postingTimes);
      return {
        channelId: channel.id,
        at: placed === null ? null : new Date(placed).toISOString(),
        windowMinutes: own?.windowMinutes ?? 0,
      };
    });

    return {
      at: at === null ? null : new Date(at).toISOString(),
      channelId: first.id,
      windowMinutes: found?.windowMinutes ?? 0,
      channels,
    };
  }
}
