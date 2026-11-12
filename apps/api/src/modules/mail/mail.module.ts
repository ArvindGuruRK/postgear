import { Global, Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailRepository } from './mail.repository';
import { MailService } from './mail.service';
import { MailWebhookService } from './mail-webhook.service';

@Global()
@Module({
  controllers: [MailController],
  providers: [MailService, MailRepository, MailWebhookService],
  exports: [MailService],
})
export class MailModule {}
