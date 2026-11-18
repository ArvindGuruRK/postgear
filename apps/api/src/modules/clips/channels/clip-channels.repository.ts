/**
 * Persistence for My Channels: the only writer of `ClipChannel` and
 * `ClipChannelHidden`.
 *
 * Every query carries the workspace: a channel is read, changed or removed
 * only through `{ id, organizationId }`, and hidden ids only through a
 * channel of the workspace. Another workspace's id therefore reads exactly
 * like an id that does not exist.
 *
 * Adding is serializable, because the plan limit is a rule about other rows
 * (two adds at once must not both pass a limit of one); the unique index
 * `(organizationId, platform, externalId)` catches the same channel added
 * twice. Nothing about the videos is stored: "imported" is read from
 * `ClipVideo` by platform and external id when a list is shown.
 */
import { Injectable } from '@nestjs/common';
import { type ClipPlatform, Prisma, type PrismaTransactionClient, prisma } from '@postgear/db';
import type { ChannelRef } from '@postgear/video-engine';

export interface ChannelRow {
  id: string;
  platform: ClipPlatform;
  handle: string;
  externalId: string;
  displayName: string;
  avatarUrl: string | null;
  uploadsListId: string | null;
  broadcasterType: string | null;
  lastSyncedAt: Date | null;
  error: string | null;
  createdAt: Date;
}

export type CreateChannelOutcome =
  | { outcome: 'created'; channel: ChannelRow }
  | { outcome: 'exists' }
  | { outcome: 'too_many'; used: number };

export type HideOutcome = 'hidden' | 'not_found' | 'too_many';

const CHANNEL_SELECT = {
  id: true,
  platform: true,
  handle: true,
  externalId: true,
  displayName: true,
  avatarUrl: true,
  uploadsListId: true,
  broadcasterType: true,
  lastSyncedAt: true,
  error: true,
  createdAt: true,
} as const;

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 50;

@Injectable()
export class ClipChannelsRepository {
  async list(orgId: string): Promise<ChannelRow[]> {
    return prisma.clipChannel.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: CHANNEL_SELECT,
    });
  }

  async find(orgId: string, id: string): Promise<ChannelRow | null> {
    return prisma.clipChannel.findFirst({
      where: { id, organizationId: orgId },
      select: CHANNEL_SELECT,
    });
  }

  async count(orgId: string): Promise<number> {
    return prisma.clipChannel.count({ where: { organizationId: orgId } });
  }

  /** A channel already added under this handle, found before any platform is asked. */
  async findByHandle(
    orgId: string,
    platform: ClipPlatform,
    handle: string,
  ): Promise<{ id: string } | null> {
    return prisma.clipChannel.findFirst({
      where: { organizationId: orgId, platform, handle: { equals: handle, mode: 'insensitive' } },
      select: { id: true },
    });
  }

  /** Adds the channel unless the workspace is at `limit` (null: unlimited) or already has it. */
  async create(
    orgId: string,
    userId: string | null,
    platform: ClipPlatform,
    ref: ChannelRef,
    limit: number | null,
  ): Promise<CreateChannelOutcome> {
    try {
      return await serializable(async (tx) => {
        const used = await tx.clipChannel.count({ where: { organizationId: orgId } });
        if (limit !== null && used >= limit) return { outcome: 'too_many', used };
        const existing = await tx.clipChannel.findFirst({
          where: { organizationId: orgId, platform, externalId: ref.externalId },
          select: { id: true },
        });
        if (existing) return { outcome: 'exists' };
        const channel = await tx.clipChannel.create({
          data: {
            organizationId: orgId,
            platform,
            handle: ref.handle,
            externalId: ref.externalId,
            displayName: ref.displayName,
            avatarUrl: ref.avatarUrl,
            uploadsListId: ref.uploadsListId ?? null,
            broadcasterType: ref.broadcasterType ?? null,
            lastSyncedAt: new Date(),
            createdById: userId,
          },
          select: CHANNEL_SELECT,
        });
        return { outcome: 'created', channel };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { outcome: 'exists' };
      }
      throw error;
    }
  }

  /** Removes the channel and (by cascade) its hidden ids. False when it is not this workspace's. */
  async remove(orgId: string, id: string): Promise<boolean> {
    const { count } = await prisma.clipChannel.deleteMany({ where: { id, organizationId: orgId } });
    return count > 0;
  }

  async hiddenIds(orgId: string, channelId: string): Promise<Set<string>> {
    const rows = await prisma.clipChannelHidden.findMany({
      where: { channelId, channel: { organizationId: orgId } },
      select: { externalId: true },
    });
    return new Set(rows.map((row) => row.externalId));
  }

  /** Hides one item (idempotent), up to `max` hidden items per channel. */
  async hide(
    orgId: string,
    channelId: string,
    externalId: string,
    max: number,
  ): Promise<HideOutcome> {
    return serializable(async (tx) => {
      const channel = await tx.clipChannel.findFirst({
        where: { id: channelId, organizationId: orgId },
        select: { id: true },
      });
      if (!channel) return 'not_found';
      const already = await tx.clipChannelHidden.findUnique({
        where: { channelId_externalId: { channelId, externalId } },
        select: { channelId: true },
      });
      if (already) return 'hidden';
      if ((await tx.clipChannelHidden.count({ where: { channelId } })) >= max) return 'too_many';
      await tx.clipChannelHidden.create({ data: { channelId, externalId } });
      return 'hidden';
    });
  }

  /** Unhides one item (idempotent). False when the channel is not this workspace's. */
  async unhide(orgId: string, channelId: string, externalId: string): Promise<boolean> {
    const channel = await this.find(orgId, channelId);
    if (!channel) return false;
    await prisma.clipChannelHidden.deleteMany({
      where: { channelId, externalId, channel: { organizationId: orgId } },
    });
    return true;
  }

  /** This workspace's videos among `externalIds` on `platform`, by external id. */
  async importedVideos(
    orgId: string,
    platform: ClipPlatform,
    externalIds: string[],
  ): Promise<Map<string, string>> {
    if (externalIds.length === 0) return new Map();
    const rows = await prisma.clipVideo.findMany({
      where: {
        organizationId: orgId,
        platform,
        externalId: { in: externalIds },
        deletedAt: null,
        status: { not: 'REMOVED' },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, externalId: true },
    });
    const byId = new Map<string, string>();
    // The newest row wins when a video was imported twice.
    for (const row of rows) if (row.externalId) byId.set(row.externalId, row.id);
    return byId;
  }

  /** Notes the last fetch: when it worked, or the code it failed with. */
  async markSynced(orgId: string, id: string, error: string | null): Promise<void> {
    await prisma.clipChannel.updateMany({
      where: { id, organizationId: orgId },
      data: error === null ? { lastSyncedAt: new Date(), error: null } : { error },
    });
  }
}

async function serializable<T>(work: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(work, SERIALIZABLE);
    } catch (error) {
      const aborted =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!aborted || attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}
