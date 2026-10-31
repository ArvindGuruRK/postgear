/**
 * Internal step gateway routes for Module 10: Create Draft, Add To Queue,
 * Publish To {Platform} and Get Post. Only the worker calls them:
 * `@Public()` (no user session) plus `InternalTokenGuard`, and every body
 * is bound to a live run before anything happens (`GatewayPostsService`).
 * Each answers `{ output, credits }`.
 */
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import {
  type DraftBody,
  draftBodySchema,
  type GetPostBody,
  getPostBodySchema,
  type PublishBody,
  publishBodySchema,
  type QueueBody,
  queueBodySchema,
} from './gateway-posts.schema';
import { GatewayPostsService } from './gateway-posts.service';
import { InternalTokenGuard } from './internal-token.guard';

@Controller('internal/automation')
export class GatewayPostsController {
  constructor(private readonly posts: GatewayPostsService) {}

  @Public()
  @UseGuards(InternalTokenGuard)
  @HttpCode(200)
  @Post('posts/draft')
  draft(@Body(new ZodBody(draftBodySchema, 'gateway/posts/draft')) body: DraftBody) {
    return this.posts.draft(body);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @HttpCode(200)
  @Post('posts/queue')
  queue(@Body(new ZodBody(queueBodySchema, 'gateway/posts/queue')) body: QueueBody) {
    return this.posts.queue(body);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @HttpCode(200)
  @Post('posts/publish')
  publish(@Body(new ZodBody(publishBodySchema, 'gateway/posts/publish')) body: PublishBody) {
    return this.posts.publish(body);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @HttpCode(200)
  @Post('posts/get')
  get(@Body(new ZodBody(getPostBodySchema, 'gateway/posts/get')) body: GetPostBody) {
    return this.posts.get(body);
  }
}
