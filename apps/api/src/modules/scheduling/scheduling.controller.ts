/**
 * Scheduler status, for the calendar and queue pages.
 *
 * A post that never publishes because no worker is running is the one failure
 * that leaves no trace in the data: the row just sits in `QUEUE`. This lets
 * the UI say so, next to the posts it concerns.
 */
import { Controller, Get } from '@nestjs/common';
import { Role } from '@postgear/db';
import { Roles } from '../../common/decorators/roles.decorator';
import { SchedulingService } from './scheduling.service';

@Controller('scheduling')
@Roles(Role.ADMIN, Role.USER)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('status')
  async status() {
    return { status: await this.scheduling.status() };
  }
}
