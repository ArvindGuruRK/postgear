/**
 * User-facing strings for post tags.
 *
 * Specific, for the reason `posts.messages.ts` gives: the caller is a member
 * labelling their own workspace's posts.
 */
export const TAG_MESSAGES = {
  NOT_FOUND: 'Tag not found',
  DELETED: 'Tag deleted',
  NAME_TAKEN: 'A tag with that name already exists.',
  TOO_MANY: 'A workspace can have at most 200 tags. Delete one you no longer use first.',
} as const;
