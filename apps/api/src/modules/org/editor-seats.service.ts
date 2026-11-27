import { Injectable } from '@nestjs/common';
import { type PrismaTransactionClient, prisma, Role } from '@postgear/db';
import { EntitlementResolver } from '../entitlements/entitlement-resolver';

/** What the invite dialog and the Team page show: "2 of 3 editor seats used". */
export interface EditorSeatState {
  used: number;
  limit: number;
  /** Never below 0, even for a workspace over its cap after a downgrade. */
  remaining: number;
}

/** The key that holds the cap (FREE 0, STANDARD 1, PRO 3, TEAM 10, ULTIMATE 25 by default). */
export const EDITOR_SEATS_KEY = 'members.editors_max';

/**
 * Editor seats (Sprint 13, Module 14).
 *
 * A seat is a live Editor membership: `role = EDITOR` and `disabled = false`.
 * Admins and members are not counted here, and a disabled Editor frees their
 * seat.
 *
 * ## When it is checked
 *
 * - **Soft, at invite**: `POST /orgs/:id/invites` for an Editor answers the
 *   402 when no seat is left, so an admin hears it before sending a link.
 * - **Hard, at accept**, inside the transaction that writes the membership,
 *   under a per-workspace advisory lock. Invites are signed tokens, not rows,
 *   so pending invites cannot be counted; two people accepting the last seat
 *   at the same moment queue on the lock, and the second one counts the
 *   first and is refused.
 * - The same lock and count when a role changes to Editor.
 *
 * After a downgrade nothing is disabled: existing Editors keep working, the
 * Team page says how many are over, and new Editors are refused until the
 * count is under the cap again.
 */
@Injectable()
export class EditorSeatsService {
  constructor(private readonly resolver: EntitlementResolver) {}

  /** Seats used, the plan's cap and what is left. */
  async state(orgId: string, client: PrismaTransactionClient = prisma): Promise<EditorSeatState> {
    const [used, limit] = await Promise.all([this.countEditors(orgId, client), this.limit(orgId)]);
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  /**
   * Refuses with the 402 `members_editor_seats_full` when no seat is left.
   *
   * With `tx`, takes the workspace's seat lock first and counts inside the
   * same transaction, so the answer holds until that transaction ends: the
   * caller writes the membership before committing. Without it, the check is
   * only advice (the invite's soft check).
   *
   * `excludingUserId` leaves one person out of the count: a role change of
   * someone who is already an Editor never needs a second seat.
   */
  async assertRoom(
    orgId: string,
    tx?: PrismaTransactionClient,
    excludingUserId?: string,
  ): Promise<void> {
    if (tx) {
      await lockSeats(tx, orgId);
    }
    const used = await this.countEditors(orgId, tx ?? prisma, excludingUserId);
    await this.resolver.assert(orgId, EDITOR_SEATS_KEY, (limit) => used < Number(limit), {
      used,
      needed: 1,
    });
  }

  private async limit(orgId: string): Promise<number> {
    const value = await this.resolver.get(orgId, EDITOR_SEATS_KEY);
    return Math.max(0, Math.floor(Number(value)));
  }

  private countEditors(
    orgId: string,
    client: PrismaTransactionClient,
    excludingUserId?: string,
  ): Promise<number> {
    return client.userOrganization.count({
      where: {
        organizationId: orgId,
        role: Role.EDITOR,
        disabled: false,
        ...(excludingUserId ? { userId: { not: excludingUserId } } : {}),
      },
    });
  }
}

/**
 * The workspace's seat lock, held until the transaction ends. A 64-bit hash
 * of the workspace id, so two workspaces only share a lock by a collision
 * that costs a short wait, never a wrong answer.
 */
async function lockSeats(tx: PrismaTransactionClient, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`editor-seats:${orgId}`}, 0))`;
}
