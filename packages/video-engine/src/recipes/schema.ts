/**
 * Recipes (Sprint 13, Module 10): how a clip is set up, saved under a name
 * and reused. Pure.
 *
 * A recipe's settings are versioned and every field is optional, so a recipe
 * can cover a little (Captions Only) or a lot (Social Edit). Applying one
 * touches only the fields it has (`apply.ts`). The five starter recipes are
 * data in `starters.ts` with stable ids; they have no database row.
 *
 * This file is the contract the API, the worker and the web share: the
 * settings shape, the ids, the outcome of an apply.
 */
import { z } from 'zod';
import { RATIOS } from '../canvas';
import { LAYOUT_KINDS, savedLayoutSchema } from '../document/schema';
import { HOOK_STYLE_IDS } from '../document/text';
import { CLIP_LENGTHS } from '../highlights/fit';
import { GENRES } from '../highlights/genre';
import { EXPORT_QUALITIES } from '../quality';
import { SILENCE_MAX_MS, SILENCE_MIN_MS } from '../cleanup/silences';
import { CAPTION_MAX_WORDS, CAPTION_SIZE_MAX, CAPTION_SIZE_MIN } from '../document/limits';

export const RECIPE_VERSION = 1 as const;

/** The most recipes a workspace keeps (the starters are not counted). */
export const RECIPES_MAX = 50;
export const RECIPE_NAME_MAX = 60;

/** The caption style a recipe falls back to when its own was deleted. */
export const RECIPE_FALLBACK_CAPTION_STYLE = 'clean';

export const STARTER_RECIPE_IDS = [
  'starter-clean-up-recording',
  'starter-auto-edit-talking-video',
  'starter-captions-only',
  'starter-reframe',
  'starter-social-edit',
] as const;
export type StarterRecipeId = (typeof STARTER_RECIPE_IDS)[number];

/** Auto-Edit Video's recipe when none is picked. */
export const DEFAULT_AUTO_EDIT_RECIPE: StarterRecipeId = 'starter-auto-edit-talking-video';

export function isStarterRecipeId(id: string): id is StarterRecipeId {
  return (STARTER_RECIPE_IDS as readonly string[]).includes(id);
}

const styleId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/i);
const uuid = z.string().uuid();

export const recipeSettingsSchema = z
  .object({
    version: z.literal(RECIPE_VERSION),
    ratio: z.enum(RATIOS).optional(),
    /**
     * A built-in layout (`kind`), a saved `ClipLayoutPreset` (`presetId`,
     * with `kind` what it was when saved), or a Custom layout carried whole
     * (`custom`, when it was never saved as a preset).
     */
    layout: z
      .object({
        kind: z.enum(LAYOUT_KINDS),
        presetId: uuid.optional(),
        custom: savedLayoutSchema.optional(),
      })
      .strict()
      .optional(),
    follow: z
      .object({ on: z.boolean(), mode: z.enum(['speaker', 'both']) })
      .strict()
      .optional(),
    /** `position`, `sizePx`, `maxWords` are the style's own when left out. */
    captions: z
      .object({
        on: z.boolean(),
        styleId,
        position: z
          .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
          .strict()
          .optional(),
        sizePx: z.number().min(CAPTION_SIZE_MIN).max(CAPTION_SIZE_MAX).optional(),
        maxWords: z.number().int().min(1).max(CAPTION_MAX_WORDS).optional(),
      })
      .strict()
      .optional(),
    silences: z
      .object({ on: z.boolean(), minMs: z.number().int().min(SILENCE_MIN_MS).max(SILENCE_MAX_MS) })
      .strict()
      .optional(),
    fillers: z.object({ on: z.boolean() }).strict().optional(),
    bleep: z
      .object({ on: z.boolean(), mode: z.enum(['bleep', 'mute']) })
      .strict()
      .optional(),
    hookTitle: z
      .object({ on: z.boolean(), look: z.enum(HOOK_STYLE_IDS) })
      .strict()
      .optional(),
    /** Clip Setup only (a run's clip length and genre); ignored on an open clip. */
    clipLength: z.enum(CLIP_LENGTHS).optional(),
    genre: z.enum(GENRES).optional(),
    /** Export All (Module 11) preselects it; the editor's export panel too. */
    exportQuality: z.enum(EXPORT_QUALITIES).optional(),
  })
  .strict();

export type RecipeSettings = z.infer<typeof recipeSettingsSchema>;

/** A recipe as the API answers it: a starter (`builtIn`) or the workspace's own. */
export interface RecipeView {
  id: string;
  name: string;
  /** One plain line for cards (`describeRecipe`). */
  description: string;
  settings: RecipeSettings;
  builtIn: boolean;
  brandKitId: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** What a caller must fetch before (or after) applying for the recipe to take full effect. */
export type RecipeNeed =
  /** Captions, silences, fillers or bleeps need the words of what the clip plays. */
  | 'transcript'
  /** Follow The Speaker needs the clip's face file (free). */
  | 'faces'
  /** A hook title needs its line (the caller asks the title writer, free). */
  | 'hookTitle';

/** A part the recipe names that no longer exists, and what was used instead. */
export interface RecipeMissing {
  part: 'captionStyle' | 'layoutPreset' | 'brandKit';
  /** The id the recipe named. */
  id: string;
  /** What was used instead: a caption style id, a layout kind, or null for nothing. */
  usedInstead: string | null;
}

/** A part that was not applied, and why (said under the clip and in a toast). */
export interface RecipeSkip {
  part: 'layout' | 'follow' | 'captions' | 'silences' | 'fillers' | 'bleep' | 'hookTitle';
  reason:
    /** The words are not there yet (see `needs`). */
    | 'no_transcript'
    /** Listened to, and nobody speaks. */
    | 'no_speech'
    /** The layout is not offered for this shape. */
    | 'not_offered'
    /** The cut would make the clip shorter than allowed. */
    | 'clip_too_short'
    /** Nothing was found to cut or bleep. */
    | 'nothing_found'
    /** The face file is not there yet, or no one was found. */
    | 'no_faces';
}
