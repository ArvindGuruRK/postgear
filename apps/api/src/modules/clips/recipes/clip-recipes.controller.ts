/**
 * Recipes (Sprint 13, Module 10): `GET` and `POST /clips/recipes`, `PATCH`
 * and `DELETE /clips/recipes/:id`, `POST /clips/recipes/:id/duplicate`, and
 * Apply A Recipe's `POST /clips/:clipId/apply-recipe`.
 *
 * `/clips/recipes` is a word route: `ClipRecipesModule` is imported by
 * `ClipsModule` before `ClipItemModule`, so `GET /clips/:clipId` never
 * swallows it (`clips-routes.spec.ts`). `@Roles(ADMIN, USER)` like every
 * Clips route: any member saves, renames and deletes the workspace's
 * recipes, as with saved layouts and caption styles.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { ClipApplyRecipeService } from './clip-apply-recipe.service';
import {
  type ApplyRecipeInput,
  applyRecipeSchema,
  type CreateRecipeInput,
  createRecipeSchema,
  type UpdateRecipeInput,
  updateRecipeSchema,
} from './clip-recipes.schema';
import { ClipRecipesService } from './clip-recipes.service';

@Controller('clips/recipes')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipRecipesController {
  constructor(private readonly recipes: ClipRecipesService) {}

  /** `{ recipes, own, max }`: the five starters first, then the workspace's own, newest first. */
  @Get()
  list(@CurrentOrg() org: ActiveOrg) {
    return this.recipes.list(org.id);
  }

  /** 201 `{ recipe }`; 422 `recipe_limit`, `brand_kit_not_found`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createRecipeSchema, 'clips/recipes/create')) body: CreateRecipeInput,
  ) {
    return this.recipes.create(org.id, user.id, body);
  }

  /** `{ recipe }`; 403 `recipe_built_in`; 404 `recipe_not_found`. */
  @Patch(':id')
  update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateRecipeSchema, 'clips/recipes/update')) body: UpdateRecipeInput,
  ) {
    return this.recipes.update(org.id, id, body);
  }

  /** `{ message }`; 403 `recipe_built_in`; 404 `recipe_not_found`. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.recipes.remove(org.id, id);
  }

  /** 201 `{ recipe }`: "<name> Copy", the workspace's own; 422 `recipe_limit`. */
  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  duplicate(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.recipes.duplicate(org.id, user.id, id);
  }
}

/** `POST /clips/:clipId/apply-recipe`: deeper than `/clips/:clipId`, so its place does not matter. */
@Controller('clips')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipApplyRecipeController {
  constructor(private readonly applier: ClipApplyRecipeService) {}

  /** `ApplyRecipeAnswer`; 404 `clip_not_found`, `recipe_not_found`. */
  @Post(':clipId/apply-recipe')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(applyRecipeSchema, 'clips/apply-recipe')) body: ApplyRecipeInput,
  ) {
    return this.applier.prepare(org.id, user.id, clipId, body.recipeId);
  }
}
