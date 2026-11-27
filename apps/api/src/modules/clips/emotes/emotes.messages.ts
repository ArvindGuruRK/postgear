/**
 * The Emote Maker's own sentences (Sprint 13, Module 14). The refusals that
 * a job can also carry (`emote_too_long`, `emote_range_invalid`,
 * `emote_too_big`, `emote_failed`) live in the engine's `CLIP_ERROR_MESSAGES`
 * so the card, the API and the worker read the same words.
 */
export const EMOTES_MESSAGES = {
  NOT_FOUND: 'We could not find this emote. Make it again.',
  EXPIRED: 'These emote files have expired. Make the emote again.',
  NOT_READY: 'This emote is still being made. Wait for it to finish.',
} as const;

/** A file's address lives five minutes: long enough to start a save, never a share link. */
export const EMOTE_LINK_SECONDS = 300;

/** How often `POST /clips/emotes/export` looks at its job while it waits. */
export const EMOTE_POLL_MS = 500;
