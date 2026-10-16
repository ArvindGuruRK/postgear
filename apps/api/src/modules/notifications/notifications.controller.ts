/**
 * The notification routes (Sprint 8, contract §5.2).
 *
 * `@Roles(ADMIN, USER)` makes an active membership mandatory while leaving
 * every member able to read the feed; the workspace is always the one
 * `@CurrentOrg()` resolved from the cookie.
 *
 * ## The stream
 *
 * `GET /notifications/stream` is server-sent events on a GET — the one place
 * `openSseStream` is used on a GET, since the bell has nothing to send and
 * the browser's own `EventSource` could in principle open it. The handler
 * takes `@Res()` so Nest sends nothing itself, registers the stream, and then
 * awaits the connection's lifetime: it returns when the client disconnects
 * or the process shuts down. `@SkipThrottle()` because one long request is
 * not a burst, and the per-address ceiling would otherwise count a tab's
 * reconnects against the person's real requests.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { openSseStream } from '../../common/sse';
import { type ListNotificationsQuery, listNotificationsQuerySchema } from './dto/notifications.schema';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@Roles(Role.ADMIN, Role.USER)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listNotificationsQuerySchema, 'notifications/list'))
    query: ListNotificationsQuery,
  ) {
    return this.notifications.list(user.id, org.id, query);
  }

  @Get('unread')
  async unread(@CurrentUser() user: AuthenticatedUser, @CurrentOrg() org: ActiveOrg) {
    return { unread: await this.notifications.unread(user.id, org.id) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async readAll(@CurrentUser() user: AuthenticatedUser, @CurrentOrg() org: ActiveOrg) {
    return this.notifications.readAll(user.id, org.id);
  }

  @Get('stream')
  @SkipThrottle()
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const stream = openSseStream(request, response);

    try {
      await this.notifications.openStream(user.id, org.id, stream);
    } finally {
      stream.close();
    }
  }
}
