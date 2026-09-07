/**
 * User-facing strings for channel management.
 *
 * Separate from `auth.messages.ts` on purpose. That catalogue exists to stop
 * authentication leaking whether an account exists, and every string in it is
 * worded for sign-in — `OAUTH_FAILED` reads "We could not complete that
 * sign-in", which is simply wrong when a user was connecting an Instagram
 * account. Reusing it would have meant either a misleading message or loosening
 * a string whose exact wording is asserted by a test.
 *
 * Channel operations are also a different privacy problem. A caller here is
 * already an authenticated member of the workspace acting on a channel they can
 * already see, so these messages can be specific and useful — the
 * anti-enumeration constraint that shapes the auth catalogue does not apply.
 */
export const CHANNEL_MESSAGES = {
  CONNECT_FAILED: 'We could not connect that account. Please try again.',
  /**
   * Shown when a reconnect authorized a different account than the channel it
   * was meant to repair — the guard that stops credentials being silently
   * swapped between accounts.
   */
  WRONG_ACCOUNT:
    'That is a different account from the one this channel uses. Sign in to the original account and try again.',
  PROVIDER_UNKNOWN: 'PostGear does not support that platform.',
  PROVIDER_NOT_CONFIGURED: 'That platform is not set up on this PostGear instance yet.',
  NOT_FOUND: 'Channel not found',
  NO_WORKSPACE: 'Select a workspace first',
  DISCONNECTED: 'Channel disconnected',
  REFRESHED: 'Channel reconnected',
  RECONNECT_REQUIRED: 'This channel needs to be reconnected.',
  SETUP_REQUIRED: 'Finish setting up this channel before posting to it.',
} as const;

/** The `?error=` codes the callback can redirect with, and their copy. */
export const CHANNEL_ERROR_CODES = {
  channel_oauth: CHANNEL_MESSAGES.CONNECT_FAILED,
  wrong_account: CHANNEL_MESSAGES.WRONG_ACCOUNT,
  unknown_provider: CHANNEL_MESSAGES.PROVIDER_UNKNOWN,
  no_workspace: CHANNEL_MESSAGES.NO_WORKSPACE,
} as const;

export type ChannelErrorCode = keyof typeof CHANNEL_ERROR_CODES;
