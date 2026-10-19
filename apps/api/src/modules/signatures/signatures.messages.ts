/**
 * User-facing strings for signatures. A caller here is acting on their own
 * workspace's settings, so the messages can be specific.
 */
export const SIGNATURE_MESSAGES = {
  NOT_FOUND: 'Signature not found',
  DELETED: 'Signature deleted',
  TOO_MANY: 'A workspace can have at most 50 signatures. Delete one you no longer use first.',
} as const;
