/**
 * What the operator's Library routes answer with (Sprint 12, Module 19
 * section 9). The credit line sentence is the spec's own copy, shown on the
 * screen beside the source too.
 */
export const OPERATOR_LIBRARY_MESSAGES = {
  RUN_NOT_FOUND: 'This ingest run is not here.',
  ITEM_NOT_FOUND: 'This item is not in the library.',
  SOURCE_NOT_FOUND: 'This source is not here.',
  NO_REPORT: 'This run has no licence report.',
  NOTHING_STAGED: 'This run has no staged items left to publish.',
  LICENCE_NOT_ALLOWED_SOUND:
    'This licence is not allowed for sounds. A sound can only be CC0, Public Domain or our own.',
  LICENCE_NOT_ALLOWED_STICKER: 'This licence is not on the list allowed for stickers.',
  UNKNOWN_SOURCE: 'This item did not come from one of the library sources, so it cannot go live.',
  CREDIT_LINE_MISSING: 'This source needs a credit line before its items are published.',
  ONLY_STAGED: 'Only a staged item can be published.',
  ONLY_HIDDEN: 'Only a hidden item can be restored.',
  REMOVED_FOR_GOOD: 'This item was removed. Its files are gone, so it cannot come back.',
  ALREADY_HIDDEN: 'This item is already hidden.',
  ITEM_CHANGED: 'This item changed while you were looking at it. Reload to see it, then try again.',
} as const;
