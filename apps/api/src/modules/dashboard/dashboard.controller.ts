/**
 * The home dashboard's routes (UI revamp, 2026-10-19).
 *
 * The read is open to every member; changing the weekly goal is an admin's
 * call, like every other workspace-wide setting. Both act on the workspace
 * `@CurrentOrg()` resolved from the cookie.
 */
import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { DashboardService } from './dashboard.service';
import {
  type DashboardQuery,
  dashboardQuerySchema,
  type WeeklyGoalInput,
  weeklyGoalSchema,
} from './dto/dashboard.schema';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  async summary(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(dashboardQuerySchema, 'dashboard/summary')) query: DashboardQuery,
  ) {
    return this.dashboard.summary(org.id, query.tz);
  }

  @Patch('goal')
  @Roles(Role.ADMIN)
  async setGoal(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(weeklyGoalSchema, 'dashboard/goal')) dto: WeeklyGoalInput,
  ) {
    return { goal: await this.dashboard.setGoal(org.id, dto.target) };
  }
}
