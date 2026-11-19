/**
 * Every sentence the operator routes answer with (Sprint 12, Module 19). The
 * screens' own copy lives in the web app; these are the API's refusals.
 */
export const OPERATOR_MESSAGES = {
  VIDEO_NOT_FOUND: 'This video is not here, or it was already removed.',
  WRITES_THROTTLED: 'You are saving very quickly. Wait a minute, then try again.',
  REASON_TOO_SHORT: 'At least 10 characters. It goes in the Change Log.',
  NO_LINK_MATCH: 'No workspace has a video from this link.',
} as const;
