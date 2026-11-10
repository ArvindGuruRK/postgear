/**
 * Discover's routes: any member may read them, since nothing here belongs to the
 * workspace. The workspace comes from `@CurrentOrg()` and is used only to count
 * how fast it is asking; the answers are the same for everyone in a place.
 */
import { Controller, Get, NotImplementedException, Query } from '@nestjs/common';
import { Role } from '@postgear/db';
import { buildLocality, type Locality, WORLDWIDE } from '@postgear/discover-engine';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { DISCOVER_MESSAGES } from './discover.messages';
import { DiscoverService } from './discover.service';
import {
  type FeedQuery,
  feedQuerySchema,
  type LocalityQuery,
  type LocalitySearchQuery,
  localityQuerySchema,
  localitySearchQuerySchema,
} from './dto/discover.schema';
import { LocalityService, withNewsLanguages } from './locality.service';

function localityOf(query: FeedQuery): Locality {
  if (!query.country) return { ...WORLDWIDE };
  return buildLocality({
    countryCode: query.country,
    regionCode: query.region,
    regionName: query.regionName,
    city: query.city,
    timeZone: query.tz,
  });
}

@Controller('discover')
@Roles(Role.ADMIN, Role.USER)
export class DiscoverController {
  constructor(
    private readonly discover: DiscoverService,
    private readonly localities: LocalityService,
  ) {}

  @Get('status')
  status() {
    return { status: this.discover.status() };
  }

  @Get('locality')
  async locality(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(localityQuerySchema, 'discover/locality')) query: LocalityQuery,
  ) {
    const locality =
      'tz' in query
        ? this.localities.fromTimeZone(query.tz)
        : await this.localities.reverse(org.id, query.lat, query.lng);

    return { locality: withNewsLanguages(locality) };
  }

  @Get('locality/search')
  async search(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(localitySearchQuerySchema, 'discover/search')) query: LocalitySearchQuery,
  ) {
    const localities = await this.localities.search(org.id, query.q);

    return {
      localities: localities.map(withNewsLanguages),
      ...(localities.length === 0 ? { message: DISCOVER_MESSAGES.notFound(query.q) } : {}),
    };
  }

  @Get('feed')
  feed(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(feedQuerySchema, 'discover/feed')) query: FeedQuery,
  ) {
    if (query.kind !== 'trending' && query.kind !== 'news') {
      throw new NotImplementedException(DISCOVER_MESSAGES.kindNotReady);
    }

    const locality = localityOf(query);
    return this.discover.feed(org.id, {
      kind: query.kind,
      locality,
      language: query.lang ?? locality.languages[0],
      topic: query.topic,
    });
  }
}
