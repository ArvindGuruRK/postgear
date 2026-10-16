/**
 * User-facing strings for the notifications module.
 *
 * Few, because the routes mostly succeed: a member reading their own feed has
 * nothing to be refused. What is here is the text the bell and the email
 * share, so the wording lives in one place.
 */
export const NOTIFICATION_MESSAGES = {
  /** The reconnect prompt the worker writes; the API's copy of it for tests and tools. */
  needsReconnect: (channelName: string): string =>
    `${channelName} needs reconnecting before PostGear can publish to it.`,
} as const;
