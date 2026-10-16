/**
 * `/developers/api-keys` — the session side of the public API (Sprint 8).
 *
 * `@Roles(ADMIN)` on the class: a key is the workspace's credential, and
 * issuing one is an admin's call, as the contract (§5.3) says. The global
 * guards resolve the workspace; `@CurrentOrg()` scopes every query.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { type CreateApiKeyInput, createApiKeySchema } from './api-keys.schema';
import { ApiKeysService } from './api-keys.service';

@Controller('developers/api-keys')
@Roles(Role.ADMIN)
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return { keys: await this.keys.list(org.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createApiKeySchema, 'developers/api-keys/create')) dto: CreateApiKeyInput,
  ) {
    return this.keys.create(org.id, user.id, dto.name);
  }

  @Post(':id/rotate')
  @HttpCode(HttpStatus.OK)
  rotate(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.keys.rotate(org.id, user.id, id);
  }

  @Delete(':id')
  async revoke(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { key: await this.keys.revoke(org.id, id) };
  }
}
