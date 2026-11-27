/**
 * The simulated channel (`acme` on Twitch and Kick, `@acme` on YouTube, with
 * `simstreamer` as an alias), read once from `fixtures/channels/acme.json`.
 * The simulated lister lists it, and the fixture downloader probes its
 * items, so "list, then import one" works end to end with no network.
 */
import type { ChannelPlatformId, ListKind } from '@postgear/video-engine';
import { z } from 'zod';
import channelsJson from '../../fixtures/channels/acme.json';

const itemSchema = z.object({
  list: z.enum(['streams', 'clips', 'uploads', 'shorts']),
  kind: z.enum(['vod', 'highlight', 'upload', 'clip', 'short']),
  externalId: z.string().min(1),
  title: z.string().min(1),
  /** Hours before "now" it was published; negative for a stream that is scheduled. */
  ageHours: z.number(),
  durationSec: z.number().nonnegative().nullable(),
  viewCount: z.number().int().nonnegative().nullable(),
  state: z.enum(['ready', 'live', 'upcoming', 'processing']),
});

const channelSchema = z.object({
  handle: z.string().min(1),
  externalId: z.string().min(1),
  displayName: z.string().min(1),
  broadcasterType: z.string().optional(),
  uploadsListId: z.string().optional(),
  items: z.array(itemSchema),
});

const fixtureSchema = z.object({
  version: z.number().int(),
  aliases: z.array(z.string()),
  channels: z.object({ twitch: channelSchema, kick: channelSchema, youtube: channelSchema }),
});

export type SimulatedItem = z.infer<typeof itemSchema>;
export type SimulatedChannel = z.infer<typeof channelSchema>;

let cache: z.infer<typeof fixtureSchema> | null = null;

function fixture(): z.infer<typeof fixtureSchema> {
  cache ??= fixtureSchema.parse(channelsJson);
  return cache;
}

/** The simulated channel on a platform. */
export function simulatedChannel(platform: ChannelPlatformId): SimulatedChannel {
  return fixture().channels[platform];
}

/**
 * True when `handle` names the simulated channel: `acme` or `simstreamer`
 * (with an `@` on YouTube, optional), any case.
 */
export function isSimulatedHandle(platform: ChannelPlatformId, handle: string): boolean {
  const bare = handle.trim().replace(/^@/, '').toLowerCase();
  const channel = simulatedChannel(platform);
  const names = [channel.handle.replace(/^@/, ''), ...fixture().aliases].map((name) =>
    name.toLowerCase(),
  );
  return names.includes(bare) || bare === channel.externalId.toLowerCase();
}

/** A listed item of the simulated channel by its id, whatever list it is on. */
export function findSimulatedItem(
  platform: ChannelPlatformId,
  externalId: string,
): SimulatedItem | null {
  return simulatedChannel(platform).items.find((item) => item.externalId === externalId) ?? null;
}

/** The items on one list of the simulated channel, in fixture order. */
export function simulatedItems(platform: ChannelPlatformId, kind: ListKind): SimulatedItem[] {
  return simulatedChannel(platform).items.filter((item) => item.list === kind);
}
