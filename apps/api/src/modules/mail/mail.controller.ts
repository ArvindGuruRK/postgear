/**
 * The mail module's public routes, both called by machines rather than the
 * web app, so both are `@Public()`:
 *
 * - `POST /mail/webhooks/resend`: Resend's bounce and complaint events,
 *   verified against `request.rawBody` (kept by `main.ts`), never throttled
 *   because Resend retries.
 * - `POST /mail/unsubscribe?token=...`: the one-click unsubscribe a mail
 *   client sends for a notification (RFC 8058). The signed token is the proof.
 *   `GET` on the same address changes nothing (link scanners open every link)
 *   and sends a person to their notification settings instead.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  type RawBodyRequest,
  Redirect,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { securityLogger } from '../../common/logging/security-logger';
import { MailRepository } from './mail.repository';
import { MailWebhookService } from './mail-webhook.service';
import { verifyUnsubscribe } from './mail.unsubscribe';

export const UNSUBSCRIBE_MESSAGES = {
  INVALID: 'This unsubscribe link is not valid.',
} as const;

@Controller('mail')
export class MailController {
  private readonly secret: string;
  private readonly webUrl: string;

  constructor(
    private readonly webhook: MailWebhookService,
    private readonly repository: MailRepository,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('JWT_SECRET') ?? '';
    this.webUrl = (config.get<string>('WEB_URL') || 'http://localhost:3000').replace(/\/+$/, '');
  }

  @Public()
  @SkipThrottle()
  @Post('webhooks/resend')
  @HttpCode(HttpStatus.OK)
  resendWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
  ) {
    return this.webhook.receive(request.rawBody, { id, timestamp, signature });
  }

  @Public()
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@Query('token') token: string | undefined) {
    const payload = this.secret ? verifyUnsubscribe(this.secret, token) : null;
    if (!payload) {
      securityLogger.warn('mail.unsubscribe_rejected', { hasToken: Boolean(token) });
      throw new BadRequestException(UNSUBSCRIBE_MESSAGES.INVALID);
    }

    await this.repository.unsubscribe(payload.email, payload.topic);
    securityLogger.log('mail.unsubscribed', { topic: payload.topic, orgId: payload.orgId });
    return { unsubscribed: true, topic: payload.topic };
  }

  @Public()
  @Get('unsubscribe')
  @Redirect()
  openUnsubscribe(@Query('token') token: string | undefined) {
    const payload = this.secret ? verifyUnsubscribe(this.secret, token) : null;
    return {
      url: payload
        ? `${this.webUrl}/${encodeURIComponent(payload.orgId)}/settings/notifications`
        : `${this.webUrl}/login`,
      statusCode: HttpStatus.FOUND,
    };
  }
}
