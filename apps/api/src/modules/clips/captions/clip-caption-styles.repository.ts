/** A workspace's own caption styles (Sprint 13, Module 03). Every query is scoped by workspace. */
import { Injectable } from '@nestjs/common';
import { type ClipCaptionStyle, type Prisma, prisma } from '@postgear/db';
import { serializable } from '../clips.tx';

export type CreateCaptionStyleOutcome =
  | { outcome: 'created'; style: ClipCaptionStyle }
  | { outcome: 'limit' };

@Injectable()
export class ClipCaptionStylesRepository {
  /** Oldest first, so a new style lands at the end of the row of tiles. */
  list(orgId: string): Promise<ClipCaptionStyle[]> {
    return prisma.clipCaptionStyle.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  find(orgId: string, id: string): Promise<ClipCaptionStyle | null> {
    return prisma.clipCaptionStyle.findFirst({ where: { id, organizationId: orgId } });
  }

  /** The count and the insert share one serializable transaction, so two tabs cannot pass the limit. */
  create(
    orgId: string,
    userId: string,
    data: { name: string; look: Prisma.InputJsonValue },
    limit: number,
  ): Promise<CreateCaptionStyleOutcome> {
    return serializable(async (tx) => {
      const count = await tx.clipCaptionStyle.count({ where: { organizationId: orgId } });
      if (count >= limit) return { outcome: 'limit' as const };
      const style = await tx.clipCaptionStyle.create({
        data: { organizationId: orgId, createdById: userId, ...data },
      });
      return { outcome: 'created' as const, style };
    });
  }

  /** The changed row, or null when the workspace has no such style. */
  async update(
    orgId: string,
    id: string,
    data: { name?: string; look?: Prisma.InputJsonValue },
  ): Promise<ClipCaptionStyle | null> {
    const changed = await prisma.clipCaptionStyle.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
    if (changed.count === 0) return null;
    return this.find(orgId, id);
  }

  /** False when the workspace has no such style. */
  async remove(orgId: string, id: string): Promise<boolean> {
    const removed = await prisma.clipCaptionStyle.deleteMany({
      where: { id, organizationId: orgId },
    });
    return removed.count > 0;
  }
}
