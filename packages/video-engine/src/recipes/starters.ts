/**
 * The five starter recipes (Module 10, D13-17): plain settings with stable
 * ids, built in, so a new workspace has something to pick on day one. They
 * have no database row, cannot be renamed or deleted, and Duplicate copies
 * one into the workspace. A starter whose caption style is gone falls back
 * as any recipe does (`missing`).
 */
import { SILENCE_DEFAULT_MS } from '../cleanup/silences';
import { RECIPE_VERSION, type RecipeSettings, type StarterRecipeId } from './schema';

export interface StarterRecipe {
  id: StarterRecipeId;
  /** Title Case. */
  name: string;
  /** One sentence-case line for the chip ("Removes silences and filler words, adds captions"). */
  help: string;
  settings: RecipeSettings;
}

function starter(
  id: StarterRecipeId,
  name: string,
  help: string,
  settings: RecipeSettings,
): StarterRecipe {
  return Object.freeze({ id, name, help, settings: Object.freeze(settings) });
}

export const STARTER_RECIPES: readonly StarterRecipe[] = Object.freeze([
  starter('starter-clean-up-recording', 'Clean Up Recording', 'Removes silences and filler words', {
    version: RECIPE_VERSION,
    silences: { on: true, minMs: SILENCE_DEFAULT_MS },
    fillers: { on: true },
  }),
  starter(
    'starter-auto-edit-talking-video',
    'Auto-Edit Talking Video',
    'Removes silences and filler words, adds captions',
    {
      version: RECIPE_VERSION,
      silences: { on: true, minMs: SILENCE_DEFAULT_MS },
      fillers: { on: true },
      captions: { on: true, styleId: 'clean' },
    },
  ),
  starter('starter-captions-only', 'Captions Only', 'Adds captions and changes nothing else', {
    version: RECIPE_VERSION,
    captions: { on: true, styleId: 'bold-pop' },
  }),
  starter('starter-reframe', 'Reframe', 'Makes the clip vertical and follows the speaker', {
    version: RECIPE_VERSION,
    ratio: '9:16',
    follow: { on: true, mode: 'speaker' },
  }),
  starter(
    'starter-social-edit',
    'Social Edit',
    'Makes the clip vertical, follows the speaker, adds captions and a hook title, removes silences',
    {
      version: RECIPE_VERSION,
      ratio: '9:16',
      follow: { on: true, mode: 'speaker' },
      captions: { on: true, styleId: 'bold-pop' },
      silences: { on: true, minMs: SILENCE_DEFAULT_MS },
      hookTitle: { on: true, look: 'hook-bold' },
    },
  ),
]);

export function starterRecipe(id: string): StarterRecipe | null {
  return STARTER_RECIPES.find((recipe) => recipe.id === id) ?? null;
}
