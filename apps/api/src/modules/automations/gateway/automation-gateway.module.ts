import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { ChannelsModule } from '../../channels/channels.module';
import { MailModule } from '../../mail/mail.module';
import { MediaModule } from '../../media/media.module';
import { PostsModule } from '../../posts/posts.module';
import { AutomationAiService } from './automation-ai.service';
import { GatewayAiController } from './gateway-ai.controller';
import { GatewayBindingService } from './gateway-binding.service';
import { GatewayEmailController } from './gateway-email.controller';
import { GatewayEmailService } from './gateway-email.service';
import { GatewayPostsController } from './gateway-posts.controller';
import { GatewayPostsService } from './gateway-posts.service';
import { InternalTokenGuard } from './internal-token.guard';

/**
 * The internal step gateway (Sprint 10, Module 10): the worker runs every
 * workflow step, and the ones that need API services (posts, AI, mail) call
 * these routes instead of copying the services. One module of its own so it
 * can import posts, AI and mail without any of them importing workflows.
 *
 * Every route: `@Public()` (no user session), `InternalTokenGuard`, a body
 * bound to a live run (`GatewayBindingService.bind`) and the effect ledger
 * (`runEffect`) so a retried activity never acts twice.
 */
@Module({
  imports: [PostsModule, ChannelsModule, MediaModule, AiModule, MailModule],
  controllers: [GatewayPostsController, GatewayAiController, GatewayEmailController],
  providers: [
    GatewayBindingService,
    InternalTokenGuard,
    AutomationAiService,
    GatewayPostsService,
    GatewayEmailService,
  ],
})
export class AutomationGatewayModule {}
