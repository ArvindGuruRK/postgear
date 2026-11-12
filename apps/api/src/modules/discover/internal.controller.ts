/**
 * Discover's internal routes (Sprint 11 Module 10), called by the worker's
 * maintenance workflow, never by a browser.
 *
 * Like the automation gateway: `@Public()` (there is no user session) and
 * `InternalTokenGuard` instead, which compares `X-PostGear-Internal` with
 * `AUTOMATION_INTERNAL_TOKEN` in constant time and refuses everything when
 * the token is not set. No body: each job decides what is due by itself.
 */
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../automations/gateway/internal-token.guard';
import { DiscoverMaintenanceService } from './maintenance.service';

@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/discover')
export class DiscoverInternalController {
  constructor(private readonly maintenance: DiscoverMaintenanceService) {}

  @Post('prewarm')
  @HttpCode(HttpStatus.OK)
  prewarm() {
    return this.maintenance.prewarm();
  }

  @Post('competitors/refresh')
  @HttpCode(HttpStatus.OK)
  refreshCompetitors() {
    return this.maintenance.refreshCompetitors();
  }

  @Post('digest')
  @HttpCode(HttpStatus.OK)
  digest() {
    return this.maintenance.sendDigests();
  }
}
