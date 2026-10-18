/**
 * The analytics routes.
 *
 * `@Roles(ADMIN, USER)` makes an active membership mandatory while leaving
 * every member free to read the numbers, as the posts and media controllers
 * do. The literal routes are declared before `posts/:group` out of habit
 * rather than need (Nest matches in declaration order, and none of them
 * collides), so a later route cannot shadow one by accident.
 *
 * ## The export takes the response
 *
 * `GET /analytics/export` answers with a file, not JSON, so it takes
 * `@Res()` and writes the headers itself: the content type, and the
 * attachment name that carries the range so two downloads do not overwrite
 * each other. Nothing streams; the CSV is built whole and sent once.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';
import {
  type OverviewQuery,
  overviewQuerySchema,
  type SyncNowInput,
  syncNowSchema,
} from './dto/analytics.schema';

@Controller('analytics')
@Roles(Role.ADMIN, Role.USER)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(overviewQuerySchema, 'analytics/overview')) query: OverviewQuery,
  ) {
    return this.analytics.overview(org.id, query);
  }

  @Get('sync')
  sync(@CurrentOrg() org: ActiveOrg) {
    return this.analytics.syncOverview(org.id);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  syncNow(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(syncNowSchema, 'analytics/sync')) dto: SyncNowInput,
  ) {
    return this.analytics.syncNow(org.id, dto);
  }

  @Get('export')
  async exportCsv(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(overviewQuerySchema, 'analytics/export')) query: OverviewQuery,
    @Res() response: Response,
  ): Promise<void> {
    const { filename, csv } = await this.analytics.exportCsv(org.id, query);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.send(csv);
  }

  @Get('posts/:group')
  async post(@CurrentOrg() org: ActiveOrg, @Param('group') group: string) {
    return { post: await this.analytics.post(org.id, group) };
  }
}
