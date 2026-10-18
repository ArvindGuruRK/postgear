import { Body, Controller, Get, Patch } from '@nestjs/common';
import { prisma } from '@postgear/db';
import { z } from 'zod';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { nameSchema, timezoneSchema } from '../auth/dto/common.schema';
import {
  type NotificationPreferencesInput,
  notificationPreferencesSchema,
} from '../notifications/dto/notifications.schema';

/**
 * Profile reads and writes for the signed-in user.
 *
 * Deliberately narrow. `email` is not editable here: changing it has to
 * re-verify the new address, or it becomes a way to take over an account by
 * pointing it at an address you control. That belongs with the activation
 * flow, not with a profile PATCH, and it is recorded as a known gap.
 */
const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    lastName: nameSchema.optional(),
    timezone: timezoneSchema.optional(),
    bio: z.string().max(500).optional(),
  })
  .strict();

@Controller('users')
export class UsersController {
  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: current.id },
      // An explicit select, not the whole row. `findUnique` without one would
      // serialize `password`, `activationTokenHash` and every reset field
      // straight into the response.
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        bio: true,
        timezone: true,
        isSuperAdmin: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        createdAt: true,
      },
    });

    return { user };
  }

  @Patch('me')
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodBody(updateProfileSchema, 'users/update'))
    dto: { name?: string; lastName?: string; timezone?: number; bio?: string },
  ) {
    const user = await prisma.user.update({
      where: { id: current.id },
      data: dto,
      select: { id: true, email: true, name: true, lastName: true, bio: true, timezone: true },
    });

    return { user };
  }

  /**
   * Email preferences for notifications (Sprint 8, contract §5.2): the
   * inherited `sendSuccessEmails` / `sendFailureEmails` columns, which the
   * notifications dispatcher reads to pick who a `post.published` or a
   * `post.failed` mail goes to. Per user, not per workspace: the columns are
   * the user's, and the dispatcher applies them in every workspace they are in.
   */
  @Get('me/notification-preferences')
  async notificationPreferences(@CurrentUser() current: AuthenticatedUser) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: current.id },
      select: { sendSuccessEmails: true, sendFailureEmails: true },
    });

    return { preferences: toPreferences(user) };
  }

  @Patch('me/notification-preferences')
  async updateNotificationPreferences(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodBody(notificationPreferencesSchema, 'users/notification-preferences'))
    dto: NotificationPreferencesInput,
  ) {
    const user = await prisma.user.update({
      where: { id: current.id },
      data: {
        ...(dto.successEmails !== undefined ? { sendSuccessEmails: dto.successEmails } : {}),
        ...(dto.failureEmails !== undefined ? { sendFailureEmails: dto.failureEmails } : {}),
      },
      select: { sendSuccessEmails: true, sendFailureEmails: true },
    });

    return { preferences: toPreferences(user) };
  }
}

function toPreferences(user: { sendSuccessEmails: boolean; sendFailureEmails: boolean }) {
  return { successEmails: user.sendSuccessEmails, failureEmails: user.sendFailureEmails };
}
