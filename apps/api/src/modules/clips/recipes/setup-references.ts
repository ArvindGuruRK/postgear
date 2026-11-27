/**
 * Clip Setup's recipe and brand kit (Sprint 13, Module 10), checked before a
 * Find Clips run is priced or started: the setup travels in the request, so
 * the ids it names must be this workspace's. A starter id is always fine; a
 * uuid must be one of the workspace's own recipes (404 `recipe_not_found`),
 * and a kit one of its live kits (422 `brand_kit_not_found`). The run then
 * keeps the setup, `recipeId` with it, in its params; the run's clips get
 * the recipe through `ClipRecipeApplierService.applyToRun`.
 *
 * Reads Prisma directly (scoped by workspace) so the highlights service
 * needs no new dependency.
 */
import { HttpStatus } from '@nestjs/common';
import { prisma } from '@postgear/db';
import { isStarterRecipeId } from '@postgear/video-engine';
import { ClipErrorException } from '../clip-error.exception';
import { isBrandKitId, isUuid } from '../clips.ids';

export async function assertSetupReferences(
  orgId: string,
  setup: { recipeId?: string | null; brandKitId?: string | null },
): Promise<void> {
  const { recipeId, brandKitId } = setup;
  if (recipeId && !isStarterRecipeId(recipeId)) {
    const own = isUuid(recipeId)
      ? await prisma.clipRecipe.findFirst({
          where: { id: recipeId, organizationId: orgId },
          select: { id: true },
        })
      : null;
    if (!own) throw new ClipErrorException(HttpStatus.NOT_FOUND, 'recipe_not_found');
  }
  if (brandKitId) {
    const kit = isBrandKitId(brandKitId)
      ? await prisma.brandKit.findFirst({
          where: { id: brandKitId, organizationId: orgId, deletedAt: null },
          select: { id: true },
        })
      : null;
    if (!kit) throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'brand_kit_not_found');
  }
}
