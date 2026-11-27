/**
 * What the recipe routes say (Sprint 13, Module 10) beyond the refusals,
 * whose sentences live with their codes in the engine's `errors.ts`.
 * Sentence case, plain words; names are Title Case.
 */
import { RECIPE_NAME_MAX } from '@postgear/video-engine';

export const CLIP_RECIPES_MESSAGES = {
  DELETED: 'Recipe deleted.',
  /** A duplicate's name: "<name> Copy", cut so it stays inside the limit. */
  copyName(name: string): string {
    const suffix = ' Copy';
    return `${name.slice(0, RECIPE_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  },
} as const;
