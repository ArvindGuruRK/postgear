/**
 * Workspace search.
 *
 * `@Roles(ADMIN, USER)`: any member, since every member can already open the
 * posts, channels and media this looks through. The workspace comes from
 * `@CurrentOrg()` only; the query string carries nothing but the words.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { type SearchQuery, searchQuerySchema } from './dto/search.schema';
import { SearchService } from './search.service';

@Controller('search')
@Roles(Role.ADMIN, Role.USER)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async find(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(searchQuerySchema, 'search/find')) query: SearchQuery,
  ) {
    return this.search.search(org.id, query.q);
  }
}
