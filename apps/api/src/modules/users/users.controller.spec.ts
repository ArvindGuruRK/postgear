/**
 * The notification-preference routes (Sprint 8): the two inherited columns
 * read and written under their API names, and a PATCH touching only what it
 * was sent.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      user: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
    },
  };
});

import { prisma } from '@postgear/db';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersController } from './users.controller';

const db = prisma as unknown as {
  user: Record<'findUniqueOrThrow' | 'update', jest.Mock>;
};

const current: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@postgear.local',
  isSuperAdmin: false,
  onboardingCompletedAt: new Date(),
};

describe('UsersController notification preferences', () => {
  const controller = new UsersController();

  it('reads the two columns under their API names', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ sendSuccessEmails: true, sendFailureEmails: false });

    const result = await controller.notificationPreferences(current);

    expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { sendSuccessEmails: true, sendFailureEmails: true },
    });
    expect(result).toEqual({ preferences: { successEmails: true, failureEmails: false } });
  });

  it('writes only the column that was sent', async () => {
    db.user.update.mockResolvedValue({ sendSuccessEmails: true, sendFailureEmails: false });

    const result = await controller.updateNotificationPreferences(current, { failureEmails: false });

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { sendFailureEmails: false },
      select: { sendSuccessEmails: true, sendFailureEmails: true },
    });
    expect(result).toEqual({ preferences: { successEmails: true, failureEmails: false } });
  });

  it('writes both when both were sent', async () => {
    db.user.update.mockResolvedValue({ sendSuccessEmails: false, sendFailureEmails: true });

    await controller.updateNotificationPreferences(current, {
      successEmails: false,
      failureEmails: true,
    });

    expect(db.user.update.mock.calls[0][0].data).toEqual({
      sendSuccessEmails: false,
      sendFailureEmails: true,
    });
  });
});
