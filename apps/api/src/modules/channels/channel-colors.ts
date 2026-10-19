/**
 * Which avatar colour a channel's initials are drawn in.
 *
 * ## The rule
 *
 * The colour is stored on the channel (`Integration.color`, a 0-based palette
 * slot) since 2026-10-19; before that it was computed per request from the
 * channel's creation order, and the migration that added the column wrote
 * exactly those values, so no channel changed colour on the switch.
 *
 * - **On connect** a channel takes the first slot none of the workspace's
 *   connected channels uses; once all seven are taken, the least-used one
 *   (lowest slot on a tie). `pickChannelColor` is that rule.
 * - **Reconnecting keeps the colour.** The row survives a reconnect (see
 *   `ChannelsRepository.upsertFromAuth`), and so does a page chosen again
 *   after a disconnect (`completeEntitySelection` carries it over).
 * - **An admin can change it** (`PATCH /channels/:id` with `color`).
 * - **Changing the palette never repaints a channel**: what is stored is the
 *   slot, and the slot only changes when someone picks another one.
 *
 * The web passes `color` straight to `AvatarFallback`'s `colorSeed`, where a
 * number picks the slot by position.
 */
import { type PrismaTransactionClient, prisma } from '@postgear/db';

/**
 * Mirrors the seven `--color-avatar-*` tokens in packages/ui colors.css (no
 * blue: that is the primary button's fill). Change both together; a smaller
 * palette leaves out-of-range slots for `AvatarFallback` to wrap.
 */
export const CHANNEL_COLOR_COUNT = 7;

/** Channel id to colour index (0-based, `0..CHANNEL_COLOR_COUNT - 1`). */
export type ChannelColors = ReadonlyMap<string, number>;

/**
 * The slot a new channel takes, given the slots the workspace's connected
 * channels hold: the least-used one, lowest first. An unused slot has a count
 * of zero, so "first free slot, then the least used" is this one rule.
 * Out-of-range values (from a larger palette, say) are ignored.
 */
export function pickChannelColor(taken: readonly number[]): number {
  const counts = Array.from({ length: CHANNEL_COLOR_COUNT }, () => 0);

  for (const slot of taken) {
    if (Number.isInteger(slot) && slot >= 0 && slot < CHANNEL_COLOR_COUNT) {
      counts[slot] += 1;
    }
  }

  let best = 0;
  for (let slot = 1; slot < CHANNEL_COLOR_COUNT; slot += 1) {
    if (counts[slot] < counts[best]) {
      best = slot;
    }
  }

  return best;
}

/**
 * Serializes colour assignment within one workspace for the rest of the
 * transaction, so two channels connected at the same moment cannot both read
 * the same free slot. A transaction-scoped advisory lock: released on commit
 * or rollback, and it locks nothing but this key.
 */
async function lockWorkspaceColors(tx: PrismaTransactionClient, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`channel-colors:${orgId}`}))`;
}

/**
 * The colour for a channel about to be connected. Call it inside the
 * transaction that creates the row, so the lock covers the write too.
 */
export async function nextChannelColor(
  tx: PrismaTransactionClient,
  orgId: string,
): Promise<number> {
  await lockWorkspaceColors(tx, orgId);

  const live = await tx.integration.findMany({
    where: { organizationId: orgId, deletedAt: null, color: { not: null } },
    select: { color: true },
  });

  return pickChannelColor(live.map((row) => row.color as number));
}

/**
 * A stand-in for a channel the map does not know: a row created after the
 * map was read. Stable per id, so it does not flicker between requests, and
 * only ever seen until the next load.
 */
function fallbackColor(channelId: string): number {
  let hash = 0;
  for (const char of channelId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % CHANNEL_COLOR_COUNT;
}

/** A channel's colour from the workspace's map. */
export function colorOf(colors: ChannelColors, channelId: string): number {
  return colors.get(channelId) ?? fallbackColor(channelId);
}

/**
 * The workspace's colours: every row, disconnected ones included, because post
 * payloads still name channels that have since been disconnected.
 *
 * Every row has a colour (the migration's backfill, then every create path),
 * so this is a read. Should a row ever arrive without one (a seed or a test
 * inserting directly), it is assigned here once, under the same lock and rule
 * as a connect, rather than drawn in a colour that could change later.
 */
export async function loadChannelColors(orgId: string): Promise<ChannelColors> {
  const rows = await prisma.integration.findMany({
    where: { organizationId: orgId },
    select: { id: true, color: true },
  });

  if (rows.every((row) => row.color !== null)) {
    return new Map(rows.map((row) => [row.id, row.color as number]));
  }

  return assignMissingColors(orgId);
}

async function assignMissingColors(orgId: string): Promise<ChannelColors> {
  return prisma.$transaction(async (tx) => {
    await lockWorkspaceColors(tx, orgId);

    // Read again under the lock: a concurrent request may have filled them in.
    const rows = await tx.integration.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, color: true, deletedAt: true },
    });

    const taken = rows
      .filter((row) => row.deletedAt === null && row.color !== null)
      .map((row) => row.color as number);
    const colors = new Map<string, number>();

    for (const row of rows) {
      if (row.color !== null) {
        colors.set(row.id, row.color);
        continue;
      }

      const color = pickChannelColor(taken);
      await tx.integration.updateMany({
        where: { id: row.id, organizationId: orgId, color: null },
        data: { color },
      });
      colors.set(row.id, color);
      if (row.deletedAt === null) {
        taken.push(color);
      }
    }

    return colors;
  });
}
