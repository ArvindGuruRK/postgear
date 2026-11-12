/**
 * The place helpers of Sprint 11 Module 10. Any member may call every one:
 *
 * - `GET /discover/locality/countries` and `/regions?country=`: the lists the
 *   place picker offers when this PostGear has no place finder (backlog gap
 *   from Module 09), read from the engine's own tables, never the network.
 * - `GET /discover/locality/pick?country=&region=`: the place those two make,
 *   whole (languages, time zone, Google News editions), the same shape every
 *   other way of choosing answers. 404 for a pair the lists do not offer.
 * - `GET /discover/locality/guess`: a country for a first visit from the
 *   caller's address (backlog #13), or null. Off without the country table.
 * - `GET`, `PUT` and `DELETE /discover/my-place`: the place this member
 *   chose, kept for them in this workspace (backlog #6). Keyed by the
 *   session's user and `@CurrentOrg()`, so nobody reaches another's.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import {
  buildLocality,
  buildLocalityFromPicker,
  listCountries,
  listRegions,
} from '@postgear/discover-engine';
import type { Request } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { DISCOVER_MESSAGES } from './discover.messages';
import {
  type MyPlaceInput,
  myPlaceSchema,
  type PickQuery,
  pickQuerySchema,
  type RegionsQuery,
  regionsQuerySchema,
} from './dto/my-place.schema';
import { IpCountryService } from './ip-country.service';
import { withNewsLanguages } from './locality.service';
import { DiscoverMyPlaceService } from './my-place.service';

@Controller('discover')
@Roles(Role.ADMIN, Role.USER)
export class DiscoverPlacesController {
  constructor(
    private readonly ipCountry: IpCountryService,
    private readonly myPlace: DiscoverMyPlaceService,
  ) {}

  @Get('locality/countries')
  countries() {
    return { countries: listCountries('en') };
  }

  @Get('locality/regions')
  regions(@Query(new ZodQuery(regionsQuerySchema, 'discover/regions')) query: RegionsQuery) {
    return { regions: listRegions(query.country, 'en') };
  }

  @Get('locality/pick')
  pick(@Query(new ZodQuery(pickQuerySchema, 'discover/pick')) query: PickQuery) {
    const locality = buildLocalityFromPicker(query.country, query.region ?? null);
    if (!locality) throw new NotFoundException(DISCOVER_MESSAGES.placeNotListed);
    return { locality: withNewsLanguages(locality) };
  }

  @Get('locality/guess')
  async guess(@Req() request: Request) {
    const country = await this.ipCountry.countryOf(request.ip);
    return {
      locality: country ? withNewsLanguages(buildLocality({ countryCode: country })) : null,
    };
  }

  @Get('my-place')
  async get(@CurrentOrg() org: ActiveOrg, @CurrentUser() user: AuthenticatedUser) {
    return { place: await this.myPlace.get(user.id, org.id) };
  }

  @Put('my-place')
  async save(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(myPlaceSchema, 'discover/my-place')) body: MyPlaceInput,
  ) {
    return { place: await this.myPlace.save(user.id, org.id, body) };
  }

  @Delete('my-place')
  @HttpCode(HttpStatus.OK)
  async clear(@CurrentOrg() org: ActiveOrg, @CurrentUser() user: AuthenticatedUser) {
    await this.myPlace.clear(user.id, org.id);
    return { place: null };
  }
}
