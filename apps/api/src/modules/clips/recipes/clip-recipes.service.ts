/**
 * Recipes (Sprint 13, Module 10): how a clip is set up, saved under a name
 * for the whole workspace.
 *
 * - **List**: the five starters first (`builtIn`, no row, no maker), then the
 *   workspace's own, newest first, each with `describeRecipe` read with the
 *   workspace's own caption style and saved layout names.
 * - **Create** and **Duplicate**: at most `RECIPES_MAX` of the workspace's
 *   own (counted in a serializable transaction; 422 `recipe_limit`). A
 *   duplicate of a starter or of an own recipe is the workspace's own,
 *   named "<name> Copy".
 * - **Update** and **Delete**: an own recipe only; a starter is 403
 *   `recipe_built_in`. Another workspace's id, an unknown one or a word is
 *   404 `recipe_not_found`, before any write.
 * - A `brandKitId` must be one of the workspace's live kits (422
 *   `brand_kit_not_found`). A kit deleted later stays named and is reported
 *   as missing when the recipe is applied.
 * - `resolve` answers a starter or an own recipe for the apply paths (the
 *   editor's Apply A Recipe, Auto-Edit, a Find Clips run).
 *
 * The settings are the engine's; nothing here reads into them beyond the
 * schema. Logs carry ids and counts only.
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ClipRecipe, Prisma } from '@postgear/db';
import {
  describeRecipe,
  isStarterRecipeId,
  type RecipeNames,
  type RecipeSettings,
  type RecipeView,
  RECIPES_MAX,
  recipeSettingsSchema,
  STARTER_RECIPES,
  type StarterRecipe,
  starterRecipe,
} from '@postgear/video-engine';
import { ClipBrandKitsService } from '../brand-kits/clip-brand-kits.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIP_RECIPES_MESSAGES } from './clip-recipes.messages';
import { ClipRecipesRepository, type RecipeWrite } from './clip-recipes.repository';
import type { CreateRecipeInput, UpdateRecipeInput } from './clip-recipes.schema';

export interface RecipesView {
  recipes: RecipeView[];
  own: number;
  max: number;
}

/** A recipe ready to apply: its view, its settings and the kit it names. */
export interface ResolvedRecipe {
  view: RecipeView;
  settings: RecipeSettings;
  brandKitId: string | null;
}

@Injectable()
export class ClipRecipesService {
  private readonly logger = new Logger(ClipRecipesService.name);

  constructor(
    private readonly repository: ClipRecipesRepository,
    private readonly kits: ClipBrandKitsService,
  ) {}

  /** `GET /clips/recipes`. */
  async list(orgId: string): Promise<RecipesView> {
    const [rows, names] = await Promise.all([this.repository.list(orgId), this.names(orgId)]);
    const makers = await this.repository.makerNames(
      rows.flatMap((row) => (row.createdById ? [row.createdById] : [])),
    );
    const own: RecipeView[] = [];
    for (const row of rows) {
      const view = this.rowView(row, names, makers);
      if (view) own.push(view);
    }
    return {
      recipes: [...STARTER_RECIPES.map((starter) => starterView(starter, names)), ...own],
      own: rows.length,
      max: RECIPES_MAX,
    };
  }

  /** 201 `{ recipe }`; 422 `recipe_limit`, `brand_kit_not_found`. */
  async create(
    orgId: string,
    userId: string,
    body: CreateRecipeInput,
  ): Promise<{ recipe: RecipeView }> {
    const brandKitId = await this.checkKit(orgId, body.brandKitId ?? null);
    return this.insert(orgId, userId, {
      name: body.name,
      settings: body.settings,
      brandKitId,
    });
  }

  /** `{ recipe }`; 403 `recipe_built_in`; 404 `recipe_not_found`; 422 `brand_kit_not_found`. */
  async update(
    orgId: string,
    id: string,
    body: UpdateRecipeInput,
  ): Promise<{ recipe: RecipeView }> {
    this.refuseStarter(id);
    if (!isUuid(id) || !(await this.repository.find(orgId, id))) throw recipeNotFound();
    const data: RecipeWrite = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.settings !== undefined) data.settings = body.settings as Prisma.InputJsonValue;
    if (body.brandKitId !== undefined)
      data.brandKitId = await this.checkKit(orgId, body.brandKitId);
    const row = await this.repository.update(orgId, id, data);
    if (!row) throw recipeNotFound();
    return { recipe: await this.oneView(orgId, row) };
  }

  /** `{ message }`; 403 `recipe_built_in`; 404 `recipe_not_found`. */
  async remove(orgId: string, id: string): Promise<{ message: string }> {
    this.refuseStarter(id);
    const removed = isUuid(id) ? await this.repository.remove(orgId, id) : false;
    if (!removed) throw recipeNotFound();
    this.logger.log(JSON.stringify({ event: 'clips.recipe.deleted', orgId, recipeId: id }));
    return { message: CLIP_RECIPES_MESSAGES.DELETED };
  }

  /** 201 `{ recipe }`: a starter or an own recipe copied as the workspace's own. */
  async duplicate(orgId: string, userId: string, id: string): Promise<{ recipe: RecipeView }> {
    const source = await this.resolve(orgId, id);
    // A kit the source named that is gone since is not copied: the copy starts clean.
    const brandKitId =
      source.brandKitId && (await this.kits.findLive(orgId, source.brandKitId))
        ? source.brandKitId
        : null;
    return this.insert(orgId, userId, {
      name: CLIP_RECIPES_MESSAGES.copyName(source.view.name),
      settings: source.settings,
      brandKitId,
    });
  }

  /** A starter or one of the workspace's own recipes; 404 `recipe_not_found` otherwise. */
  async resolve(orgId: string, id: string): Promise<ResolvedRecipe> {
    const starter = starterRecipe(id);
    if (starter) {
      return {
        view: starterView(starter, await this.names(orgId)),
        settings: starter.settings,
        brandKitId: null,
      };
    }
    const row = isUuid(id) ? await this.repository.find(orgId, id) : null;
    const settings = row ? readSettings(row) : null;
    if (!row || !settings) throw recipeNotFound();
    return { view: await this.oneView(orgId, row), settings, brandKitId: row.brandKitId };
  }

  private async insert(
    orgId: string,
    userId: string,
    data: { name: string; settings: RecipeSettings; brandKitId: string | null },
  ): Promise<{ recipe: RecipeView }> {
    const result = await this.repository.create(
      orgId,
      userId,
      {
        name: data.name,
        settings: data.settings as Prisma.InputJsonValue,
        brandKitId: data.brandKitId,
      },
      RECIPES_MAX,
    );
    if (result.outcome === 'limit') {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'recipe_limit');
    }
    this.logger.log(
      JSON.stringify({ event: 'clips.recipe.saved', orgId, recipeId: result.recipe.id }),
    );
    return { recipe: await this.oneView(orgId, result.recipe) };
  }

  private refuseStarter(id: string): void {
    if (isStarterRecipeId(id)) {
      throw new ClipErrorException(HttpStatus.FORBIDDEN, 'recipe_built_in');
    }
  }

  private async checkKit(orgId: string, kitId: string | null): Promise<string | null> {
    if (kitId === null) return null;
    if (!(await this.kits.findLive(orgId, kitId))) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'brand_kit_not_found');
    }
    return kitId;
  }

  private async oneView(orgId: string, row: ClipRecipe): Promise<RecipeView> {
    const [names, makers] = await Promise.all([
      this.names(orgId),
      this.repository.makerNames(row.createdById ? [row.createdById] : []),
    ]);
    const view = this.rowView(row, names, makers);
    if (!view) throw recipeNotFound();
    return view;
  }

  private async names(orgId: string): Promise<RecipeNames> {
    const { captionStyles, layoutPresets } = await this.repository.partNames(orgId);
    return {
      captionStyle: (id) => captionStyles.get(id) ?? null,
      layoutPreset: (id) => layoutPresets.get(id) ?? null,
    };
  }

  /** An own recipe's view; null (logged by id) when its stored settings no longer read. */
  private rowView(
    row: ClipRecipe,
    names: RecipeNames,
    makers: Map<string, string>,
  ): RecipeView | null {
    const settings = readSettings(row);
    if (!settings) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.recipe.unreadable',
          orgId: row.organizationId,
          recipeId: row.id,
        }),
      );
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      description: describeRecipe(settings, names),
      settings,
      builtIn: false,
      brandKitId: row.brandKitId,
      createdById: row.createdById,
      createdByName: row.createdById ? (makers.get(row.createdById) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function readSettings(row: Pick<ClipRecipe, 'settings'>): RecipeSettings | null {
  const parsed = recipeSettingsSchema.safeParse(row.settings);
  return parsed.success ? parsed.data : null;
}

function starterView(starter: StarterRecipe, names: RecipeNames): RecipeView {
  return {
    id: starter.id,
    name: starter.name,
    description: describeRecipe(starter.settings, names),
    settings: starter.settings,
    builtIn: true,
    brandKitId: null,
    createdById: null,
    createdByName: null,
    createdAt: null,
    updatedAt: null,
  };
}

export function recipeNotFound(): ClipErrorException {
  return new ClipErrorException(HttpStatus.NOT_FOUND, 'recipe_not_found');
}
