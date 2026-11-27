/**
 * The one row Auto-Edit Video reads that no other Clips service hands it: a
 * workspace's own recipe's settings (Sprint 13, Module 10). Scoped on the
 * workspace, so another workspace's id reads the same as a missing one.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@postgear/db';

@Injectable()
export class ClipAutoEditRepository {
  findRecipe(orgId: string, recipeId: string): Promise<{ id: string; settings: unknown } | null> {
    return prisma.clipRecipe.findFirst({
      where: { id: recipeId, organizationId: orgId },
      select: { id: true, settings: true },
    });
  }
}
