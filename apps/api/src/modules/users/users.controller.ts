import { Body, Controller, Get, Patch } from '@nestjs/common';
import { prisma } from '@postgear/db';
import { z } from 'zod';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { nameSchema, timezoneSchema } from '../auth/dto/common.schema';

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
}
