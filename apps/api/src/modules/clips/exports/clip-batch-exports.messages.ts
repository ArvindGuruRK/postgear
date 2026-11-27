/**
 * Export All's own sentences (Sprint 13, Module 11). The notice lines live
 * with the notice (`clip-batch-notice.service.ts`); a clip's refusal reuses
 * the single export's sentences.
 */
export const CLIP_BATCH_MESSAGES = {
  BATCH_NOT_FOUND: 'This export list is no longer available.',
} as const;
