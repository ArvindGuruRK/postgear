/**
 * Sprint 13, Module 10: the browser's calls to the recipe, brand kit and
 * Auto-Edit routes. Kept beside `clips-api.ts` (same `api()` door, same
 * refusal codes) so the module's screens share one contract.
 */
import type { ClipBrandKit, RecipeSettings, RecipeView } from '@postgear/video-engine';
import type {
  ApplyRecipeAnswer,
  AutoEditPriceView,
  AutoEditStarted,
  ClipBrandKitPatch,
  ClipBrandKitsView,
  ClipBrandKitView,
  RecipesView,
} from '@/types/clips-recipes';
import { api } from './api';

const recipePath = (id: string) => `/clips/recipes/${encodeURIComponent(id)}`;
const kitPath = (id: string) => `/clips/brand-kits/${encodeURIComponent(id)}`;
const videoPath = (videoId: string) => `/clips/videos/${encodeURIComponent(videoId)}`;

export function listRecipes(options: { signal?: AbortSignal } = {}): Promise<RecipesView> {
  return api<RecipesView>('/clips/recipes', { signal: options.signal });
}

/** 422 `recipe_limit` at 50; 422 `invalid_body` for settings the engine refuses. */
export async function createRecipe(input: {
  name: string;
  settings: RecipeSettings;
  brandKitId?: string | null;
}): Promise<RecipeView> {
  const { recipe } = await api<{ recipe: RecipeView }>('/clips/recipes', {
    method: 'POST',
    body: input,
  });
  return recipe;
}

/** 403 `recipe_built_in` for a starter. */
export async function updateRecipe(
  id: string,
  input: { name?: string; settings?: RecipeSettings; brandKitId?: string | null },
): Promise<RecipeView> {
  const { recipe } = await api<{ recipe: RecipeView }>(recipePath(id), {
    method: 'PATCH',
    body: input,
  });
  return recipe;
}

/** 403 `recipe_built_in` for a starter. */
export function deleteRecipe(id: string): Promise<{ message: string }> {
  return api<{ message: string }>(recipePath(id), { method: 'DELETE' });
}

/** A starter or the workspace's own, copied as the workspace's own ("<name> Copy"). */
export async function duplicateRecipe(id: string): Promise<RecipeView> {
  const { recipe } = await api<{ recipe: RecipeView }>(`${recipePath(id)}/duplicate`, {
    method: 'POST',
  });
  return recipe;
}

/** See `ApplyRecipeAnswer`; 404 `recipe_not_found` for another workspace's recipe. */
export function applyRecipeToClip(clipId: string, recipeId: string): Promise<ApplyRecipeAnswer> {
  return api<ApplyRecipeAnswer>(`/clips/${encodeURIComponent(clipId)}/apply-recipe`, {
    method: 'POST',
    body: { recipeId },
  });
}

export function listClipBrandKits(
  options: { signal?: AbortSignal } = {},
): Promise<ClipBrandKitsView> {
  return api<ClipBrandKitsView>('/clips/brand-kits', { signal: options.signal });
}

/** 422 `brand_video_too_long` (over 5 seconds), `brand_video_not_ready`, `caption_style_not_found`. */
export async function updateClipBrandKit(
  id: string,
  patch: ClipBrandKitPatch,
): Promise<ClipBrandKitView> {
  const { brandKit } = await api<{ brandKit: ClipBrandKitView }>(kitPath(id), {
    method: 'PATCH',
    body: patch,
  });
  return brandKit;
}

/** The kit in the engine's shape, its logo copied into the clips space on first use. */
export async function useClipBrandKit(id: string): Promise<ClipBrandKit> {
  const { brandKit } = await api<{ brandKit: ClipBrandKit }>(`${kitPath(id)}/use`, {
    method: 'POST',
  });
  return brandKit;
}

export function autoEditPrice(
  videoId: string,
  input: { recipeId: string; range?: { fromMs: number; toMs: number } },
): Promise<AutoEditPriceView> {
  return api<AutoEditPriceView>(`${videoPath(videoId)}/auto-edit/price`, {
    method: 'POST',
    body: input,
  });
}

/**
 * 422 `auto_edit_too_long` ("Auto-Edit works on up to 30 minutes at a time.
 * Pick the part you want."), 409 `auto_edit_running`, 402
 * `clips_ai_minutes_used`.
 */
export function startAutoEdit(
  videoId: string,
  input: { recipeId: string; range?: { fromMs: number; toMs: number } },
): Promise<AutoEditStarted> {
  return api<AutoEditStarted>(`${videoPath(videoId)}/auto-edit`, {
    method: 'POST',
    body: input,
  });
}
