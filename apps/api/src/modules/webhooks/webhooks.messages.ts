/**
 * User-facing strings for outbound webhooks (Sprint 8).
 *
 * A caller here is an admin acting on their own workspace's hooks, so the
 * messages can be specific; the one thing they never carry is a receiver's
 * response body.
 */
export const WEBHOOK_MESSAGES = {
  NOT_FOUND: 'Webhook not found',
  CREATED: 'Webhook created',
  UPDATED: 'Webhook updated',
  DELETED: 'Webhook deleted',
  SECRET_ROTATED: 'Signing secret rotated',
  TEST_QUEUED: 'Test delivery queued',
  /** The limit is generous; it exists so a runaway script cannot fill the table. */
  TOO_MANY: 'A workspace can have at most 20 webhooks.',
  URL_SCHEME: 'Webhook URLs must start with https://',
  URL_SCHEME_LOCAL: 'Webhook URLs must start with http:// or https://',
  FOREIGN_CHANNEL: 'One of the selected channels is not connected to this workspace',
  SCHEDULER_UNAVAILABLE:
    'The test was queued but the scheduler could not be reached; it will be sent when the worker catches up.',
} as const;
