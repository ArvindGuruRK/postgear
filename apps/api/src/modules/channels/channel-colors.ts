/**
 * Which avatar colour a channel's initials are drawn in.
 *
 * ## The rule
 *
 * Colours are handed out in order, the way Slack and Jira do it: the
 * workspace's first channel gets palette slot 1 (violet), the second slot 2
 * (teal), and so on, wrapping after the seventh. A channel's position is
 * its place among **every**
 * Integration row the workspace has ever had, ordered by `createdAt` and then
 * `id`, soft-deleted rows included. Disconnecting is a soft delete, so a
 * position never changes once given: removing a channel never repaints
 * another, and a new channel takes the next colour. Two live channels can
 * only share a colour once more than seven have ever been connected.
 *
 * Computed per request rather than stored, so there is no column to migrate
 * or backfill. The web passes `color` straight to `AvatarFallback`'s
 * `colorSeed`, where a number picks the slot by position.
 */
import { prisma } from '@postgear/db';

/**
 * Mirrors the seven `--color-avatar-*` tokens in packages/ui colors.css (no
 * blue: that is the primary button's fill). Change both together.
 */
export const CHANNEL_COLOR_COUNT = 7;

/** Channel id to colour index (0-based, `0..CHANNEL_COLOR_COUNT - 1`). */
export type ChannelColors = ReadonlyMap<string, number>;

/**
 * Applies the rule to a workspace's rows. Sorts itself rather than trusting
 * the caller's order, so the tie-break is the same wherever rows come from.
 */
export function assignChannelColors(rows: { id: string; createdAt: Date }[]): ChannelColors {
  const ordered = [...rows].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return new Map(ordered.map((row, position) => [row.id, position % CHANNEL_COLOR_COUNT]));
}

/**
 * A channel's colour. An id missing from the map is a row created after the
 * map was read (a connect racing the request): it is the newest channel, so
 * it takes the next slot, which is what it will have on the next load.
 */
export function colorOf(colors: ChannelColors, channelId: string): number {
  return colors.get(channelId) ?? colors.size % CHANNEL_COLOR_COUNT;
}

/** The workspace's colours: one query, ids and creation times only. */
export async function loadChannelColors(orgId: string): Promise<ChannelColors> {
  // No `deletedAt` filter, deliberately: see the rule above.
  const rows = await prisma.integration.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, createdAt: true },
  });

  return assignChannelColors(rows);
}
