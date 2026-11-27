/**
 * One shape for every binding's answer. The selector runs every channel and
 * every page through these before anything is cached or shown, whichever
 * lister produced it (an official API, the worker's flat list or the
 * simulation), so the web never knows the source and a binding that drifts
 * cannot put a strange field or an unbounded string in front of a person.
 *
 * A row that does not fit is dropped (logged by the caller as a count);
 * a channel that does not fit is `platform_changed`.
 */
import type { ChannelPage, ChannelRef, ChannelPlatformId, ListedItem } from '@postgear/video-engine';
import { z } from 'zod';
import { ListingFailure } from './listing-failure';

const isoTime = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)));
const pictureAddress = z
  .string()
  .max(2_048)
  .refine((value) => value.startsWith('https://'))
  .nullable();

const listedItemSchema = z.object({
  externalId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  kind: z.enum(['vod', 'highlight', 'upload', 'clip', 'short']),
  title: z.string().max(1_000),
  publishedAt: isoTime,
  durationSec: z.number().nonnegative().finite().nullable(),
  viewCount: z.number().int().nonnegative().nullable(),
  thumbnailUrl: pictureAddress,
  state: z.enum(['ready', 'live', 'upcoming', 'processing']),
  expiresAt: isoTime.optional(),
  channel: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
});

const channelRefSchema = z.object({
  handle: z.string().min(1).max(64),
  externalId: z.string().regex(/^[A-Za-z0-9@._-]{1,64}$/),
  displayName: z.string().min(1).max(200),
  avatarUrl: pictureAddress,
  uploadsListId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{2,64}$/)
    .optional(),
  broadcasterType: z.string().max(32).optional(),
});

/** A page with every row checked; rows that do not fit are dropped and counted. */
export function normalisePage(value: unknown): { page: ChannelPage; dropped: number } {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as ChannelPage).items)) {
    throw new ListingFailure('platform_changed');
  }
  const raw = value as { items: unknown[]; nextCursor?: unknown };
  const items: ListedItem[] = [];
  let dropped = 0;
  for (const row of raw.items.slice(0, 100)) {
    const parsed = listedItemSchema.safeParse(row);
    if (parsed.success) items.push(parsed.data as ListedItem);
    else dropped += 1;
  }
  const page: ChannelPage = { items };
  if (
    typeof raw.nextCursor === 'string' &&
    raw.nextCursor.length > 0 &&
    raw.nextCursor.length <= 512
  ) {
    page.nextCursor = raw.nextCursor;
  }
  return { page, dropped };
}

/** A channel the binding resolved, checked, on the platform that was asked. */
export function normaliseChannel(platform: ChannelPlatformId, value: unknown): ChannelRef {
  const parsed = channelRefSchema.safeParse(value);
  if (!parsed.success) throw new ListingFailure('platform_changed');
  const ref: ChannelRef = {
    platform,
    handle: parsed.data.handle,
    externalId: parsed.data.externalId,
    displayName: parsed.data.displayName,
    avatarUrl: parsed.data.avatarUrl,
  };
  if (parsed.data.uploadsListId !== undefined) ref.uploadsListId = parsed.data.uploadsListId;
  if (parsed.data.broadcasterType !== undefined) ref.broadcasterType = parsed.data.broadcasterType;
  return ref;
}
