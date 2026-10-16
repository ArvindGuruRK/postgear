/**
 * The notification request schemas: the page bounds, the cursor, and the
 * preference body that must change something.
 */
import { listNotificationsQuerySchema, notificationPreferencesSchema } from './notifications.schema';

describe('listNotificationsQuerySchema', () => {
  it('defaults the page size to 20', () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces the limit from the query string and caps it at 50', () => {
    expect(listNotificationsQuerySchema.parse({ limit: '35' })).toEqual({ limit: 35 });
    expect(listNotificationsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false);
  });

  it('takes an ISO instant as the cursor and refuses anything else', () => {
    expect(
      listNotificationsQuerySchema.parse({ before: '2026-10-16T12:00:00.000Z' }).before,
    ).toBe('2026-10-16T12:00:00.000Z');
    expect(listNotificationsQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false);
  });

  it('refuses unknown keys', () => {
    expect(listNotificationsQuerySchema.safeParse({ orgId: 'other' }).success).toBe(false);
  });
});

describe('notificationPreferencesSchema', () => {
  it('accepts either or both booleans', () => {
    expect(notificationPreferencesSchema.parse({ successEmails: false })).toEqual({
      successEmails: false,
    });
    expect(
      notificationPreferencesSchema.parse({ successEmails: true, failureEmails: false }),
    ).toEqual({ successEmails: true, failureEmails: false });
  });

  it('refuses an empty body, a non-boolean, and an unknown key', () => {
    expect(notificationPreferencesSchema.safeParse({}).success).toBe(false);
    expect(notificationPreferencesSchema.safeParse({ successEmails: 'yes' }).success).toBe(false);
    expect(notificationPreferencesSchema.safeParse({ sendStreakEmails: true }).success).toBe(
      false,
    );
  });
});
