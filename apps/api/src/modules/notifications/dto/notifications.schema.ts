/**
 * Request schemas for the notification routes.
 *
 * `.strict()` throughout, as every schema in this API is: an unknown key is
 * refused, not stripped.
 */
import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** `GET /notifications?limit=&before=`: a page of the feed, newest first. */
export const listNotificationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    /** Rows strictly older than this instant: the cursor for "load more". */
    before: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/**
 * `PATCH /users/me/notification-preferences`. Both keys optional so a toggle
 * can save just itself, but an empty body is a mistake, not a no-op.
 */
export const notificationPreferencesSchema = z
  .object({
    successEmails: z.boolean().optional(),
    failureEmails: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.successEmails !== undefined || value.failureEmails !== undefined,
    'Nothing to change',
  );

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
