/**
 * What the entitlement routes say themselves. Refusal sentences for each
 * limit live in `@postgear/entitlements` (`refusalMessage`), shared with the
 * web app.
 */
export const CLIPS_ALLOWANCE_UNAVAILABLE =
  'We could not check your allowance. Please try again in a minute.';

export const ENTITLEMENT_MESSAGES = {
  ALLOWANCE_UNAVAILABLE: CLIPS_ALLOWANCE_UNAVAILABLE,
  ENTRY_NOT_FOUND: 'We could not find that usage entry.',
  REVERSAL_TOO_LARGE: 'That is more than was charged.',
  REVERSAL_OF_REVERSAL: 'A refund cannot be refunded.',
} as const;
