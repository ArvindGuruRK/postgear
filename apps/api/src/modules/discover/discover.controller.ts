/**
 * Discover's routes: any member may read them. A place's answers are the same
 * for everyone in it, and the workspace from `@CurrentOrg()` is used only to
 * count how fast it is asking and to leave out the groups it switched off.
 *
 * The settings are the one thing here that belongs to the workspace. Members
 * read them, because their page starts from them, and only admins save them.
 * That route still lets members through the role guard: the guard can only
 * refuse in its own general words, and this refusal has a sentence of its own,
 * which `DiscoverSettingsService` says.
 */
import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { Role } from '@postgear/db';
import { buildLocality, type Locality, WORLDWIDE } from '@postgear/discover-engine';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
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
import { type UpdateSettingsInput, updateSettingsSchema } from './dto/settings.schema';
import { LocalityService, withNewsLanguages } from './locality.service';
import { DiscoverSettingsService } from './settings.service';

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
    private readonly workspaceSettings: DiscoverSettingsService,
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
    const locality = localityOf(query);
    return this.discover.feed(org.id, {
      kind: query.kind,
      locality,
      language: query.lang ?? locality.languages[0],
      topic: query.topic,
      // Only when asked for: without it the answer is the whole tab, as it always was.
      ...(query.useWorkspaceSources ? { workspaceSources: true } : {}),
    });
  }

  @Get('settings')
  async settings(@CurrentOrg() org: ActiveOrg) {
    return { settings: await this.workspaceSettings.get(org.id) };
  }

  @Patch('settings')
  async saveSettings(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(updateSettingsSchema, 'discover/settings')) body: UpdateSettingsInput,
  ) {
    return { settings: await this.workspaceSettings.update(org, user, body) };
  }
}
