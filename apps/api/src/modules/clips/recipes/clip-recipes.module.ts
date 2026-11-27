/**
 * Recipes (Sprint 13, Module 10): the recipe routes, Apply A Recipe, and the
 * server-side applier Auto-Edit and the Find Clips run use.
 *
 * Route order: `/clips/recipes` is a word route, so `ClipsModule` imports
 * this module before `ClipItemModule`. This module imports `ClipItemModule`
 * itself (the applier makes clips through `ClipItemService.insertClip` and
 * asks faces through `ClipFacesService`), which is safe only because Nest
 * scans a module before its imports: this module's controllers are
 * registered first, then `ClipItemModule`'s, and `ClipsModule`'s own import
 * of `ClipItemModule`, last in its list, finds it already scanned. So this
 * module must stay AFTER every other word-route module in `ClipsModule`'s
 * imports, and a module importing this one must come after it too.
 * `clips-routes.spec.ts` holds the order.
 *
 * Exports the applier (D2's Auto-Edit routes and the internal routes).
 */
import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { ClipBrandKitsModule } from '../brand-kits/clip-brand-kits.module';
import { ClipCaptionStylesModule } from '../captions/clip-caption-styles.module';
import { ClipItemModule } from '../clip/clip-item.module';
import { ClipsCoreModule } from '../clips-core.module';
import { ClipApplyRecipeService } from './clip-apply-recipe.service';
import { ClipRecipeApplierService } from './clip-recipe-applier.service';
import { ClipApplyRecipeController, ClipRecipesController } from './clip-recipes.controller';
import { ClipRecipesRepository } from './clip-recipes.repository';
import { ClipRecipesService } from './clip-recipes.service';

@Module({
  imports: [
    ClipsCoreModule,
    ClipBrandKitsModule,
    ClipCaptionStylesModule,
    AiModule,
    ClipItemModule,
  ],
  controllers: [ClipRecipesController, ClipApplyRecipeController],
  providers: [
    ClipRecipesRepository,
    ClipRecipesService,
    ClipApplyRecipeService,
    ClipRecipeApplierService,
  ],
  exports: [ClipRecipesService, ClipRecipeApplierService],
})
export class ClipRecipesModule {}
