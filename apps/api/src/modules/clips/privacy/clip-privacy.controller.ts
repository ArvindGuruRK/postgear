/**
 * `/clips/privacy` (Sprint 13, Module 17 item 26): whether this workspace's
 * speech always stays on our own machine. Every member reads it; only an
 * admin changes it (the method's `@Roles` overrides the class's). Editors are
 * refused the change like every other workspace setting.
 */
import { Body, Controller, Get, Put } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { type ClipPrivacyInput, clipPrivacySchema } from './clip-privacy.schema';
import { ClipPrivacyService } from './clip-privacy.service';

@Controller('clips/privacy')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
export class ClipPrivacyController {
  constructor(private readonly privacy: ClipPrivacyService) {}

  /** `{ privacy: { speechStaysHere, hostedLane } }`. */
  @Get()
  async view(@CurrentOrg() org: ActiveOrg) {
    return { privacy: await this.privacy.view(org.id) };
  }

  /** `{ privacy }`; 403 for anyone but an admin. */
  @Put()
  @Roles(Role.ADMIN)
  async set(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(clipPrivacySchema, 'clips/privacy')) body: ClipPrivacyInput,
  ) {
    return { privacy: await this.privacy.set(org.id, body.speechStaysHere, user.id) };
  }
}
