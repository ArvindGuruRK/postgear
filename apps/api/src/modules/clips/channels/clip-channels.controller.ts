/**
 * `/clips/channels` (Module 03, section 5): My Channels.
 *
 * `@Roles(ADMIN, USER, EDITOR)`: any member of the workspace adds, browses and
 * removes channels. The workspace is `@CurrentOrg()`, never a value from the
 * request, and every row is read through it, so another workspace's channel
 * id answers 404 exactly like a missing one.
 *
 * | Route | Answer |
 * |---|---|
 * | `GET /clips/channels` | 200 `{ channels }` |
 * | `POST /clips/channels` `{ platform, handle }` | 201 `{ channel }`; 422 `channel_not_found`, `link_is_a_video`, `platform_paused`; 409 `channel_exists`; 402 `channel_limit`, `clips_not_in_plan`; 429 `channels_throttled`; 503 when no binding can answer |
 * | `POST /clips/channels/check` `{ platform, handle }` | 200 `{ channel: { platform, handle, displayName, avatarUrl } }`, nothing written; the same refusals as add (Module 06) |
 * | `GET /clips/channels/:id/streams?kind&cursor&sort&period&hidden` | 200 one page; 404; 422 `list_kind_unsupported`, `list_sort_unsupported`, `platform_paused`; 400 `list_cursor_invalid`; 429; 502 `platform_changed`; 503 |
 * | `PUT /clips/channels/:id/hidden/:externalId` | 200 `{ externalId, hidden: true }`; 404; 422 `hidden_limit` |
 * | `DELETE /clips/channels/:id/hidden/:externalId` | 200 `{ externalId, hidden: false }`; 404 |
 * | `DELETE /clips/channels/:id` | 200 `{ message }`; 404 |
 * | `POST /clips/channels/:id/refresh` | 200 `{ refreshedAt }`; 404; 429 `refresh_throttled` |
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import {
  type AddChannelInput,
  addChannelSchema,
  type ListStreamsQuery,
  listStreamsQuerySchema,
} from './clip-channels.schemas';
import { ClipChannelsService } from './clip-channels.service';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';

@Controller('clips/channels')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipChannelsController {
  constructor(private readonly channels: ClipChannelsService) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return { channels: await this.channels.list(org.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async add(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(addChannelSchema, 'clips/channels/add')) body: AddChannelInput,
  ) {
    return { channel: await this.channels.add(org.id, user.id, body) };
  }

  /** Module 06: add's checks and the platform's answer, nothing written. Declared before the `:id` routes. */
  @Post('check')
  @HttpCode(HttpStatus.OK)
  async check(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(addChannelSchema, 'clips/channels/check')) body: AddChannelInput,
  ) {
    return { channel: await this.channels.check(org.id, body) };
  }

  @Get(':id/streams')
  async streams(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Query(new ZodQuery(listStreamsQuerySchema, 'clips/channels/streams')) query: ListStreamsQuery,
  ) {
    return await this.channels.streams(org.id, id, query);
  }

  @Put(':id/hidden/:externalId')
  @HttpCode(HttpStatus.OK)
  async hide(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Param('externalId') externalId: string,
  ) {
    return await this.channels.hide(org.id, id, externalId);
  }

  @Delete(':id/hidden/:externalId')
  @HttpCode(HttpStatus.OK)
  async unhide(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Param('externalId') externalId: string,
  ) {
    return await this.channels.unhide(org.id, id, externalId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return await this.channels.remove(org.id, id);
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return await this.channels.refresh(org.id, id);
  }
}
