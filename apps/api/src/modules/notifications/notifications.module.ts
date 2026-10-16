import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsDispatcher } from './notifications.dispatcher';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationStreamRegistry } from './notifications.stream';

/**
 * Notifications (Sprint 8, PRD 5.9): the in-app feed, the read cursor, the
 * SSE stream, the email outbox dispatcher and the per-user preferences.
 *
 * `MailService` arrives through the global `MailModule`; `ConfigService`
 * through the global `ConfigModule`. `NotificationsService` is exported for
 * the billing and webhooks modules, which write their rows through
 * `notify()`. The preference routes live on `UsersController`, since they
 * are columns of the user, not of a workspace.
 */
@Module({
  imports: [],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationStreamRegistry,
    NotificationsService,
    NotificationsDispatcher,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
