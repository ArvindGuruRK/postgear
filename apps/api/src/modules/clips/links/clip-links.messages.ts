/**
 * Sentences only the link routes say (Module 03). Every refusal of a link
 * itself (`link_*`, `platform_*`, `probe_throttled`, `tools_offline`) is a
 * code with its sentence in `@postgear/video-engine`'s `CLIP_ERROR_MESSAGES`,
 * so the card, the job and the API read alike; this file adds the thumbnail
 * route's own answers. Sentence case, plain words, never a tool's output.
 */
export const CLIP_LINKS_MESSAGES = {
  /** A thumbnail link that is forged, malformed or past its six hours. */
  THUMBNAIL_LINK_INVALID: 'This picture link has expired. Check the link again to see it.',
  /** The platform's picture could not be fetched, or was not a picture. */
  THUMBNAIL_UNAVAILABLE: 'This picture is not available right now.',
} as const;
