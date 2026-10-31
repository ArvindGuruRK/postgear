/**
 * Internal step gateway routes for Module 11: Generate Text, Generate Image,
 * Generate Hashtags and Rewrite In Brand Voice. The worker calls them; no
 * user session (`@Public()`), the internal token instead, and every body is
 * bound to a live run's step by `AutomationAiService`.
 *
 * A model call can take a minute. When the worker gives up first (its own
 * timeout, or the run was cancelled) the connection closes and the call is
 * aborted, so the step's credits are refunded rather than charged for an
 * answer nobody reads; the worker's retry then runs it again.
 */
import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { AutomationAiService } from './automation-ai.service';
import {
  type GatewayAiHashtagsInput,
  type GatewayAiImageInput,
  type GatewayAiRewriteInput,
  type GatewayAiTextInput,
  gatewayAiHashtagsSchema,
  gatewayAiImageSchema,
  gatewayAiRewriteSchema,
  gatewayAiTextSchema,
} from './gateway-ai.schema';
import { InternalTokenGuard } from './internal-token.guard';

/** Aborts when the caller hangs up before the answer was sent. */
export function abortOnHangUp(response: Pick<Response, 'on' | 'writableFinished'>): AbortSignal {
  const controller = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller.signal;
}

@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/automation')
export class GatewayAiController {
  constructor(private readonly ai: AutomationAiService) {}

  @Post('ai/text')
  @HttpCode(200)
  text(
    @Body(new ZodBody(gatewayAiTextSchema, 'internal/automation/ai/text')) body: GatewayAiTextInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.ai.text(body, abortOnHangUp(response));
  }

  @Post('ai/image')
  @HttpCode(200)
  image(
    @Body(new ZodBody(gatewayAiImageSchema, 'internal/automation/ai/image'))
    body: GatewayAiImageInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.ai.image(body, abortOnHangUp(response));
  }

  @Post('ai/hashtags')
  @HttpCode(200)
  hashtags(
    @Body(new ZodBody(gatewayAiHashtagsSchema, 'internal/automation/ai/hashtags'))
    body: GatewayAiHashtagsInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.ai.hashtags(body, abortOnHangUp(response));
  }

  @Post('ai/rewrite')
  @HttpCode(200)
  rewrite(
    @Body(new ZodBody(gatewayAiRewriteSchema, 'internal/automation/ai/rewrite'))
    body: GatewayAiRewriteInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.ai.rewrite(body, abortOnHangUp(response));
  }
}
