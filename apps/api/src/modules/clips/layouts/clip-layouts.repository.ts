/**
 * `ClipLayoutPreset` rows (Sprint 12, Module 10 section 6). Every read and
 * write is scoped to the workspace; an id from the URL is never enough.
 *
 * The 50 a workspace cap depends on other rows, so the count and the insert
 * share one serializable transaction (`clips.tx.ts`): two saves at once can
 * never both take the last place.
 */
import { Injectable } from '@nestjs/common';
import { type ClipLayoutPreset, type Prisma, prisma } from '@postgear/db';
import { serializable } from '../clips.tx';

export type CreateLayoutOutcome =
  | { outcome: 'created'; layout: ClipLayoutPreset }
  | { outcome: 'limit' };

@Injectable()
export class ClipLayoutsRepository {
  /** Newest first, optionally one shape only. */
  list(orgId: string, ratio?: string): Promise<ClipLayoutPreset[]> {
    return prisma.clipLayoutPreset.findMany({
      where: { organizationId: orgId, ...(ratio ? { ratio } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  create(
    orgId: string,
    userId: string,
    data: { name: string; ratio: string; layout: Prisma.InputJsonValue },
    limit: number,
  ): Promise<CreateLayoutOutcome> {
    return serializable(async (tx) => {
      const count = await tx.clipLayoutPreset.count({ where: { organizationId: orgId } });
      if (count >= limit) return { outcome: 'limit' as const };
      const layout = await tx.clipLayoutPreset.create({
        data: { organizationId: orgId, createdById: userId, ...data },
      });
      return { outcome: 'created' as const, layout };
    });
  }

  /** The renamed row, or null when the workspace has no such layout. */
  async rename(orgId: string, id: string, name: string): Promise<ClipLayoutPreset | null> {
    const changed = await prisma.clipLayoutPreset.updateMany({
      where: { id, organizationId: orgId },
      data: { name },
    });
    if (changed.count === 0) return null;
    return prisma.clipLayoutPreset.findFirst({ where: { id, organizationId: orgId } });
  }

  /** False when the workspace has no such layout. */
  async remove(orgId: string, id: string): Promise<boolean> {
    const removed = await prisma.clipLayoutPreset.deleteMany({
      where: { id, organizationId: orgId },
    });
    return removed.count > 0;
  }
}
