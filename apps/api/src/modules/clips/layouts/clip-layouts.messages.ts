/**
 * What the saved layout routes say (Sprint 12, Module 10 section 6).
 * Sentence case, plain words.
 */
import { MAX_SAVED_LAYOUTS } from './clip-layouts.schema';

export const CLIP_LAYOUTS_MESSAGES = {
  NOT_FOUND: 'We could not find that saved layout.',
  DELETED: 'Layout deleted.',
  LIMIT: `This workspace has ${MAX_SAVED_LAYOUTS} saved layouts, the most it can keep. Delete one to save another.`,
} as const;
