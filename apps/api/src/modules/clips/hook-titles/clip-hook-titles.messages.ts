/**
 * What `POST /clips/:clipId/hook-titles` says (Sprint 13, Module 09).
 * Sentence case, plain words.
 */
export const CLIP_HOOK_TITLES_MESSAGES = {
  /** 422 `hook_titles_no_words`. */
  NO_WORDS: 'This clip has no words yet. Listen to it first.',
  /** 429 `hook_titles_throttled`. */
  THROTTLED: 'You asked for hook titles too often. Try again in a minute.',
  /** 502 `hook_titles_failed`. */
  FAILED: 'We could not write hook titles this time. Try again.',
  /** 503 `hook_titles_off`. */
  OFF: 'Hook titles are not available right now.',
} as const;
