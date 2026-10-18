/**
 * `GET /v1/analytics/overview`: the same overview the dashboard shows,
 * through the same service and the same query schema, so the numbers an
 * integrator pulls are the numbers the page shows.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { AnalyticsService } from '../../analytics/analytics.service';
import { type OverviewQuery, overviewQuerySchema } from '../../analytics/dto/analytics.schema';
import { ApiKeyAuth } from '../auth/api-key-auth.decorator';
import { PublicZodQuery } from './dto/public-zod.pipe';

@Controller('v1/analytics')
@ApiKeyAuth()
export class V1AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  async overview(
    @CurrentOrg() org: ActiveOrg,
    @Query(new PublicZodQuery(overviewQuerySchema, 'v1/analytics/overview')) query: OverviewQuery,
  ) {
    return { overview: await this.analytics.overview(org.id, query) };
  }
}
