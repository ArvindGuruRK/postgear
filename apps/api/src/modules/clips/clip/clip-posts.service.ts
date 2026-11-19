/**
 * Which posts use which clips (Sprint 12, Module 17): the `ClipPost` rows.
 *
 * - **`syncForPost`**: every post save (`PostsService` create, update and
 *   remove) hands over the group and the media ids now on it. A clip whose
 *   exported file (`Clip.exportedMediaId`) is on the post gets a row; a row
 *   whose file left the post goes. So a clip shows Scheduled, and View Post
 *   later, however it got into the post (Send To Composer or the picker's
 *   Clips tab). Running it twice writes nothing the second time.
 * - **`publishedPostsOf`**: the live addresses of the posts a clip went out
 *   in, for the card's View Post (the address the calendar shows).
 * - **`comingUpRows`**: the waiting posts in the next 14 days that use a
 *   clip, soonest first, for the Create tab's Coming Up panel.
 *
 * Reads and writes `ClipPost` and reads `Post` only; no other module, so
 * `PostsModule` can import this one without a cycle.
 */
import { Injectable } from '@nestjs/common';
import { type PrismaTransactionClient, prisma, State } from '@postgear/db';

/** How far ahead Coming Up looks. */
export const COMING_UP_DAYS = 14;

/** One post a clip went out in, as View Post opens it. */
export interface ClipPublishedPost {
  group: string;
  channelName: string;
  providerIdentifier: string;
  /** The live post's address (https only). */
  url: string;
  publishedAt: string;
}

/** A channel a waiting post goes to. */
export interface ComingUpChannel {
  id: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
}

/** One clip in one waiting post group. */
export interface ComingUpRow {
  group: string;
  clipId: string;
  /** The group's soonest waiting post. */
  publishDate: Date;
  channels: ComingUpChannel[];
}

const SAFE_ADDRESS = /^https?:\/\//i;

/**
 * The published posts each clip went out in, newest first, one entry per
 * address: the root post of each group, PUBLISHED, not deleted, with an
 * http(s) address. A function as well as a method, so the video page reads
 * it the way it reads `scheduledClipIds`.
 */
export async function publishedPostsOf(
  orgId: string,
  clipIds: readonly string[],
  client: PrismaTransactionClient = prisma,
): Promise<Map<string, ClipPublishedPost[]>> {
  const found = new Map<string, ClipPublishedPost[]>();
  if (clipIds.length === 0) return found;
  const links = await client.clipPost.findMany({
    where: { organizationId: orgId, clipId: { in: [...clipIds] } },
    select: { clipId: true, postGroup: true },
  });
  if (links.length === 0) return found;

  const posts = await client.post.findMany({
    where: {
      organizationId: orgId,
      group: { in: [...new Set(links.map((link) => link.postGroup))] },
      state: State.PUBLISHED,
      deletedAt: null,
      parentPostId: null,
      releaseURL: { not: null },
    },
    select: {
      group: true,
      releaseURL: true,
      publishDate: true,
      integration: { select: { name: true, providerIdentifier: true } },
    },
    orderBy: [{ publishDate: 'desc' }, { id: 'asc' }],
  });

  for (const link of links) {
    const list = found.get(link.clipId) ?? [];
    for (const post of posts) {
      if (post.group !== link.postGroup || !post.releaseURL) continue;
      if (!SAFE_ADDRESS.test(post.releaseURL)) continue;
      if (list.some((entry) => entry.url === post.releaseURL)) continue;
      list.push({
        group: post.group,
        channelName: post.integration.name,
        providerIdentifier: post.integration.providerIdentifier,
        url: post.releaseURL,
        publishedAt: post.publishDate.toISOString(),
      });
    }
    found.set(link.clipId, list);
  }
  for (const [clipId, list] of found) {
    list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    if (list.length === 0) found.delete(clipId);
  }
  return found;
}

@Injectable()
export class ClipPostsService {
  /** Brings a post group's `ClipPost` rows in line with the media on it now. */
  async syncForPost(
    orgId: string,
    group: string,
    mediaIds: readonly string[],
    client: PrismaTransactionClient = prisma,
  ): Promise<{ added: number; removed: number }> {
    const ids = [...new Set(mediaIds)];
    const [existing, clips] = await Promise.all([
      client.clipPost.findMany({
        where: { organizationId: orgId, postGroup: group },
        select: { id: true, clipId: true, mediaId: true },
      }),
      ids.length > 0
        ? client.clip.findMany({
            where: { organizationId: orgId, exportedMediaId: { in: ids } },
            select: { id: true, exportedMediaId: true },
          })
        : Promise.resolve([]),
    ]);

    const stale = existing.filter((row) => !ids.includes(row.mediaId));
    const have = new Set(
      existing
        .filter((row) => ids.includes(row.mediaId))
        .map((row) => `${row.clipId}:${row.mediaId}`),
    );
    const fresh: { id: string; mediaId: string }[] = [];
    for (const clip of clips) {
      const mediaId = clip.exportedMediaId;
      if (mediaId !== null && !have.has(`${clip.id}:${mediaId}`))
        fresh.push({ id: clip.id, mediaId });
    }

    if (stale.length > 0) {
      await client.clipPost.deleteMany({
        where: { organizationId: orgId, id: { in: stale.map((row) => row.id) } },
      });
    }
    if (fresh.length > 0) {
      await client.clipPost.createMany({
        data: fresh.map((clip) => ({
          organizationId: orgId,
          clipId: clip.id,
          postGroup: group,
          mediaId: clip.mediaId,
        })),
      });
    }
    return { added: fresh.length, removed: stale.length };
  }

  /** The published posts each clip went out in (see `publishedPostsOf`). */
  publishedPostsOf(
    orgId: string,
    clipIds: readonly string[],
    client: PrismaTransactionClient = prisma,
  ): Promise<Map<string, ClipPublishedPost[]>> {
    return publishedPostsOf(orgId, clipIds, client);
  }

  /**
   * The clips in post groups with a post still waiting (QUEUE, not deleted)
   * between `now` and 14 days ahead, soonest first. Drafts, published and
   * failed posts are never waiting, so they never show.
   */
  async comingUpRows(
    orgId: string,
    now: Date = new Date(),
    client: PrismaTransactionClient = prisma,
  ): Promise<ComingUpRow[]> {
    const links = await client.clipPost.findMany({
      where: { organizationId: orgId },
      select: { clipId: true, postGroup: true },
    });
    if (links.length === 0) return [];

    const until = new Date(now.getTime() + COMING_UP_DAYS * 24 * 60 * 60 * 1000);
    const waiting = await client.post.findMany({
      where: {
        organizationId: orgId,
        group: { in: [...new Set(links.map((link) => link.postGroup))] },
        state: State.QUEUE,
        deletedAt: null,
        parentPostId: null,
        publishDate: { gte: now, lte: until },
      },
      select: {
        group: true,
        publishDate: true,
        integration: {
          select: { id: true, name: true, providerIdentifier: true, picture: true },
        },
      },
      orderBy: [{ publishDate: 'asc' }, { id: 'asc' }],
    });

    const groups = new Map<string, { publishDate: Date; channels: ComingUpChannel[] }>();
    for (const post of waiting) {
      const entry = groups.get(post.group) ?? { publishDate: post.publishDate, channels: [] };
      if (post.publishDate < entry.publishDate) entry.publishDate = post.publishDate;
      if (!entry.channels.some((channel) => channel.id === post.integration.id)) {
        entry.channels.push({
          id: post.integration.id,
          name: post.integration.name,
          providerIdentifier: post.integration.providerIdentifier,
          picture: post.integration.picture ?? null,
        });
      }
      groups.set(post.group, entry);
    }

    const seen = new Set<string>();
    const rows: ComingUpRow[] = [];
    for (const link of links) {
      const group = groups.get(link.postGroup);
      const key = `${link.postGroup}:${link.clipId}`;
      if (!group || seen.has(key)) continue;
      seen.add(key);
      rows.push({ group: link.postGroup, clipId: link.clipId, ...group });
    }
    return rows.sort(
      (a, b) =>
        a.publishDate.getTime() - b.publishDate.getTime() ||
        a.group.localeCompare(b.group) ||
        a.clipId.localeCompare(b.clipId),
    );
  }
}
