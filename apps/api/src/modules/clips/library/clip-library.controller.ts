/**
 * The shared library (Module 12 section 4 stickers, Module 14 section 4 sounds):
 *
 * - `GET /clips/library/stickers`: search, a category, a kind, favourites.
 * - `GET /clips/library/sounds`: the same for sounds (`kind=sfx|music`).
 * - `GET /clips/library/categories?type=sticker|sound&kind=`: the chips, with counts.
 * - `PUT /clips/library/favourites` and `DELETE /clips/library/favourites/:type/:itemId`.
 * - `GET /clips/library/credits`: `@Public()`, for the credits page.
 *
 * The workspace comes from `@CurrentOrg()`. Registered before
 * `ClipItemModule`'s `GET /clips/:clipId` (see `clips.module.ts`).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import {
  type CategoriesQuery,
  categoriesQuerySchema,
  type FavouriteBody,
  favouriteBodySchema,
  type LibraryItemType,
  type SearchSoundsQuery,
  type SearchStickersQuery,
  searchSoundsQuerySchema,
  searchStickersQuerySchema,
} from './clip-library.schemas';
import { ClipLibraryService } from './clip-library.service';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';

@Controller('clips/library')
@Roles(Role.ADMIN, Role.USER)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipLibraryController {
  constructor(private readonly library: ClipLibraryService) {}

  /** `{ items, page, pageSize, total, hasMore, suggest? }`. */
  @Get('stickers')
  search(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(searchStickersQuerySchema, 'clips/library/stickers'))
    query: SearchStickersQuery,
  ) {
    return this.library.search(org.id, query);
  }

  /** `{ items, page, pageSize, total, hasMore, suggest? }` (Module 14). */
  @Get('sounds')
  searchSounds(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(searchSoundsQuerySchema, 'clips/library/sounds'))
    query: SearchSoundsQuery,
  ) {
    return this.library.searchSounds(org.id, query);
  }

  /** `{ categories: [{ slug, name, count }] }`. */
  @Get('categories')
  categories(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(categoriesQuerySchema, 'clips/library/categories')) query: CategoriesQuery,
  ) {
    return this.library.categories(org.id, query);
  }

  /** `{ favourite: true }`; 404 `sticker_not_found` or `sound_not_found`. */
  @Put('favourites')
  favourite(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(favouriteBodySchema, 'clips/library/favourites')) body: FavouriteBody,
  ) {
    return this.library.favourite(org.id, user.id, body);
  }

  /** 204, for `sticker` or `sound`. */
  @Delete('favourites/:type/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unfavourite(
    @CurrentOrg() org: ActiveOrg,
    @Param('type', new ParseEnumPipe({ sticker: 'sticker', sound: 'sound' })) type: LibraryItemType,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    await this.library.unfavourite(org.id, itemId, type);
  }

  /** Every source with stickers or sounds in use, in its credit group. Public: the credits page needs no login. */
  @Get('credits')
  @Public()
  credits() {
    return this.library.credits();
  }
}
