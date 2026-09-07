/**
 * Connected social channels.
 *
 * ## Every handler scopes on `@CurrentOrg()`, never on a route parameter
 *
 * The workspace comes from the resolved active org, and the `:id` in a path is
 * only ever the channel being acted on — it is never trusted to say which
 * workspace that channel belongs to. `current-org.decorator.ts` states the rule;
 * `org.controller.ts` demonstrates it.
 *
 * ## Which routes carry `@Roles()`
 *
 * Reading the channel list and starting a connection are open to any member,
 * because connecting a channel is part of onboarding and blocking it behind
 * `ADMIN` would stop a solo user finishing their own setup. Anything
 * destructive or configuration-changing — disconnect, rename, posting times,
 * publishing — requires `ADMIN`.
 *
 * A route without `@Roles()` gets its org resolved *opportunistically*, so
 * `@CurrentOrg()` can legitimately be undefined; those handlers check for it
 * explicitly rather than reading `.id` off nothing.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CHANNEL_MESSAGES } from './channels.messages';
import { ChannelsService } from './channels.service';
import {
  providerParamSchema,
  type SelectEntityInput,
  selectEntitySchema,
  type TestPostInput,
  testPostSchema,
  type UpdateChannelInput,
  updateChannelSchema,
} from './dto/channels.schema';

@Controller('channels')
export class ChannelsController {
  private readonly webUrl: string;

  constructor(
    private readonly channels: ChannelsService,
    config: ConfigService,
  ) {
    this.webUrl = config.get<string>('WEB_URL', 'http://localhost:3000');
  }

  /**
   * Every provider PostGear supports, and whether it is configured.
   *
   * Unconfigured providers are listed rather than filtered out, so the UI can
   * show them disabled with a reason — a missing client id is a deployment gap,
   * not evidence the platform is unsupported.
   */
  @Get('providers')
  listProviders() {
    return { providers: this.channels.listProviders() };
  }

  @Get()
  async list(@CurrentOrg() org: ActiveOrg | undefined) {
    if (!org) {
      return { channels: [] };
    }

    return { channels: await this.channels.list(org.id) };
  }

  /**
   * Starts an OAuth handshake.
   *
   * A redirect rather than JSON: the consent screen is a page the user has to
   * see, and the callback must arrive as a top-level navigation so the
   * `sameSite: lax` session cookie is still sent.
   */
  @Get('connect/:provider')
  async connect(
    @Param('provider') provider: string,
    @Query('reconnect') reconnect: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg | undefined,
    @Res() response: Response,
  ) {
    if (!org) {
      return response.redirect(`${this.webUrl}/?error=no_workspace`);
    }

    const parsed = providerParamSchema.safeParse(provider);

    if (!parsed.success) {
      return response.redirect(`${this.webUrl}/${org.id}/channels?error=unknown_provider`);
    }

    try {
      const url = await this.channels.beginConnect({
        provider: parsed.data,
        orgId: org.id,
        userId: user.id,
        reconnectChannelId: reconnect,
      });

      return response.redirect(url);
    } catch {
      return response.redirect(`${this.webUrl}/${org.id}/channels?error=channel_oauth`);
    }
  }

  /**
   * The OAuth callback.
   *
   * `@Public()` because the platform redirects the browser here and a missing or
   * slow session must not lose a completed authorization. Authorization comes
   * from the single-use state instead, which carries the workspace and user and
   * whose membership the service re-verifies before writing anything.
   */
  @Public()
  @Get('connect/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() response: Response,
  ) {
    const { path } = await this.channels.completeConnect({ provider, code, state });
    return response.redirect(`${this.webUrl}${path}`);
  }

  /** The pages / channels / boards a half-connected channel can be pointed at. */
  @Get(':id/entities')
  async listEntities(@CurrentOrg() org: ActiveOrg | undefined, @Param('id') id: string) {
    if (!org) {
      return { entities: [] };
    }

    return { entities: await this.channels.listEntities(org.id, id) };
  }

  @Post(':id/entities')
  @Roles(Role.ADMIN)
  async selectEntity(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(selectEntitySchema, 'channels/select-entity')) dto: SelectEntityInput,
  ) {
    return { channel: await this.channels.selectEntity(org.id, id, dto.entityId) };
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateChannelSchema, 'channels/update')) dto: UpdateChannelInput,
  ) {
    return {
      channel: await this.channels.updateSettings({
        orgId: org.id,
        id,
        name: dto.name,
        postingTimes: dto.postingTimes,
      }),
    };
  }

  /**
   * What disconnecting would affect.
   *
   * Exists so the confirmation dialog can name the number of queued posts
   * instead of asking the user to accept an unspecified consequence.
   */
  @Get(':id/disconnect-preview')
  @Roles(Role.ADMIN)
  async disconnectPreview(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.channels.previewDisconnect(org.id, id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async disconnect(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    const { draftedPosts } = await this.channels.disconnect(org.id, id);
    return { message: CHANNEL_MESSAGES.DISCONNECTED, draftedPosts };
  }

  /** Forces a token refresh now, rather than waiting for the scheduled one. */
  @Post(':id/refresh')
  @Roles(Role.ADMIN)
  async refresh(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    const refreshed = await this.channels.refresh(org.id, id);

    return {
      refreshed,
      message: refreshed ? CHANNEL_MESSAGES.REFRESHED : CHANNEL_MESSAGES.RECONNECT_REQUIRED,
    };
  }

  /**
   * Publishes a post immediately.
   *
   * The composer (Sprint 4) and scheduler (Sprint 5) will own real publishing;
   * this makes each provider's `post()` reachable so the sprint's test-post
   * requirement can be verified without them.
   */
  @Post(':id/test-post')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async testPost(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(testPostSchema, 'channels/test-post')) dto: TestPostInput,
  ) {
    const results = await this.channels.publish(org.id, id, [
      {
        id: `test-${Date.now()}`,
        message: dto.message,
        media: dto.media,
        settings: dto.settings,
      },
    ]);

    return { results };
  }
}
