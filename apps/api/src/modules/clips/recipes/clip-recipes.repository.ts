/**
 * `ClipRecipe` rows (Sprint 13, Module 10): the workspace's own recipes. The
 * five starters have no row. Every read and write carries the workspace; an
 * id from the URL is never enough.
 *
 * The 50 a workspace cap depends on other rows, so the count and the insert
 * share one serializable transaction (`clips.tx.ts`): two saves at once can
 * never both take the last place.
 */
import { Injectable } from '@nestjs/common';
import { type ClipRecipe, type Prisma, prisma } from '@postgear/db';
import { serializable } from '../clips.tx';

export type CreateRecipeOutcome = { outcome: 'created'; recipe: ClipRecipe } | { outcome: 'limit' };

export interface RecipeWrite {
  name?: string;
  settings?: Prisma.InputJsonValue;
  brandKitId?: string | null;
}

@Injectable()
export class ClipRecipesRepository {
  /** Newest first. */
  list(orgId: string): Promise<ClipRecipe[]> {
    return prisma.clipRecipe.findMany({
      where: { organizationId: orgId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  find(orgId: string, id: string): Promise<ClipRecipe | null> {
    return prisma.clipRecipe.findFirst({ where: { id, organizationId: orgId } });
  }

  create(
    orgId: string,
    userId: string,
    data: { name: string; settings: Prisma.InputJsonValue; brandKitId: string | null },
    limit: number,
  ): Promise<CreateRecipeOutcome> {
    return serializable(async (tx) => {
      const count = await tx.clipRecipe.count({ where: { organizationId: orgId } });
      if (count >= limit) return { outcome: 'limit' as const };
      const recipe = await tx.clipRecipe.create({
        data: { organizationId: orgId, createdById: userId, ...data },
      });
      return { outcome: 'created' as const, recipe };
    });
  }

  /** The changed row, or null when the workspace has no such recipe. */
  async update(orgId: string, id: string, data: RecipeWrite): Promise<ClipRecipe | null> {
    const changed = await prisma.clipRecipe.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
    if (changed.count === 0) return null;
    return this.find(orgId, id);
  }

  /** False when the workspace has no such recipe. */
  async remove(orgId: string, id: string): Promise<boolean> {
    const removed = await prisma.clipRecipe.deleteMany({ where: { id, organizationId: orgId } });
    return removed.count > 0;
  }

  /** The makers' names by id ("Asha Rao"); a member who left is simply absent. */
  async makerNames(ids: readonly string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true, lastName: true },
    });
    const names = new Map<string, string>();
    for (const user of users) {
      const name = [user.name, user.lastName]
        .map((part) => part?.trim() ?? '')
        .filter((part) => part.length > 0)
        .join(' ');
      if (name) names.set(user.id, name);
    }
    return names;
  }

  /** The workspace's caption style and saved layout names, for `describeRecipe`. */
  async partNames(
    orgId: string,
  ): Promise<{ captionStyles: Map<string, string>; layoutPresets: Map<string, string> }> {
    const [styles, layouts] = await Promise.all([
      prisma.clipCaptionStyle.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
      prisma.clipLayoutPreset.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
    ]);
    return {
      captionStyles: new Map(styles.map((row) => [row.id, row.name])),
      layoutPresets: new Map(layouts.map((row) => [row.id, row.name])),
    };
  }
}
