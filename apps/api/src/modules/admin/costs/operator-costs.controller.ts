/**
 * `GET /operator/clips/costs?from&to` (Sprint 13, Module 15 section 3): what
 * Clips jobs cost us, by kind and by workspace, beside the Clips usage
 * totals by meter, workspace and person, for `[from, to)` (UTC days, at most
 * 92). Platform operators only (`@PlatformAdmin()`); a read, so it is not
 * throttled or recorded like a write. Nothing here reaches a workspace.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { PlatformAdmin } from '../../../common/decorators/platform-admin.decorator';
import { ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { type CostsQuery, costsQuerySchema } from './operator-costs.schema';
import { OperatorCostsService } from './operator-costs.service';

@Controller('operator/clips/costs')
@PlatformAdmin()
export class OperatorCostsController {
  constructor(private readonly costs: OperatorCostsService) {}

  @Get()
  summary(@Query(new ZodQuery(costsQuerySchema, 'operator/clips/costs')) query: CostsQuery) {
    return this.costs.costs(query);
  }
}
