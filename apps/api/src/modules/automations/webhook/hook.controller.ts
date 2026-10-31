/**
 * The Webhook trigger's private link (Module 13):
 * `POST /v1/automations/:id/hook`.
 *
 * `@Public()` because the caller is another app, not a signed-in person:
 * the `X-PostGear-Secret` header is the credential, checked in
 * `WebhookService.receive`. `HookThrottlerGuard` adds sixty calls a minute
 * per workflow on top of the global per-address limit. The body is read
 * twice: its raw length (`request.rawBody`, which `main.ts` keeps) for the
 * 256 KB cap, and the parsed object as the trigger's data.
 *
 * Answers: 202 `{ runId }` for a new run, 200 `{ runId }` for a repeated
 * `Idempotency-Key`, 401 with nothing else for any secret or id problem,
 * 409 when the workflow is not turned on (the data is still kept as test
 * data), 413, 415 and 429.
 */

import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  type RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { HookThrottlerGuard } from './hook-throttler.guard';
import { WEBHOOK_SECRET_HEADER, WebhookService } from './webhook.service';

/** Bytes received: the raw body when kept, else the declared length. */
export function requestSize(request: RawBodyRequest<Request>): number {
  if (request.rawBody) return request.rawBody.length;
  const declared = Number(request.headers['content-length']);
  return Number.isFinite(declared) && declared > 0 ? declared : 0;
}

function headerText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller('v1/automations')
@Public()
export class HookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post(':id/hook')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(HookThrottlerGuard)
  async hook(
    @Param('id') id: string,
    @Req() request: RawBodyRequest<Request>,
    @Res({ passthrough: true }) response: Response,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ runId: string }> {
    const answer = await this.webhooks.receive({
      automationId: id,
      secret: headerText(headers[WEBHOOK_SECRET_HEADER]),
      contentType: headerText(headers['content-type']),
      size: requestSize(request),
      body: request.body,
      idempotencyKey: headerText(headers['idempotency-key']),
    });
    response.status(answer.status);
    return { runId: answer.runId };
  }
}
