/**
 * `GET /clips/status` (Sprint 12): any member of the workspace. The answer
 * names the workspace's own space only; tool state is the same for all.
 */
import { Controller, Get } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ClipsStatusService } from './clips-status.service';

@Controller('clips')
@Roles(Role.ADMIN, Role.USER)
export class ClipsStatusController {
  constructor(private readonly clipsStatus: ClipsStatusService) {}

  @Get('status')
  async status(@CurrentOrg() org: ActiveOrg) {
    return { status: await this.clipsStatus.status(org.id) };
  }
}
