/**
 * `/v1/posts`: list, read, create, delete (Sprint 8, contract §5.3).
 *
 * Every route hands `@CurrentOrg()`, set by `ApiKeyGuard`, to the same
 * `PostsService` the composer uses, so a post made through the API is held
 * to exactly the checks a person's is: the channel must be the workspace's,
 * the media must be in its library, a queued post must be in the future
 * and pass every platform rule. The service's own 400/422 messages pass
 * through unchanged; this controller only translates shapes.
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
  Query,
} from '@nestjs/common';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { PostsService } from '../../posts/posts.service';
import { ApiKeyAuth } from '../auth/api-key-auth.decorator';
import { PublicZodBody, PublicZodQuery } from './dto/public-zod.pipe';
import {
  type CreatePublicPostInput,
  createPublicPostSchema,
  type ListPublicPostsQuery,
  listPublicPostsQuerySchema,
} from './dto/v1.schema';
import {
  toCreatePostInput,
  toPublicPost,
  toPublicPostSummary,
  toStateFilter,
} from './public-posts.mapper';
import type { PublicPostPage } from './v1.types';

@Controller('v1/posts')
@ApiKeyAuth()
export class V1PostsController {
  constructor(private readonly posts: PostsService) {}

  /** The queue, newest first, twenty to a page. */
  @Get()
  async list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new PublicZodQuery(listPublicPostsQuerySchema, 'v1/posts/list')) query: ListPublicPostsQuery,
  ): Promise<PublicPostPage> {
    const page = await this.posts.queue(org.id, {
      page: query.page,
      state: toStateFilter(query.state),
      sort: 'desc',
    });

    return {
      posts: page.posts.map(toPublicPostSummary),
      page: page.page,
      pageCount: page.pageCount,
      total: page.total,
    };
  }

  @Get(':id')
  async get(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { post: toPublicPost(await this.posts.get(org.id, id)) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @Body(new PublicZodBody(createPublicPostSchema, 'v1/posts/create')) dto: CreatePublicPostInput,
  ) {
    const created = await this.posts.create(org.id, toCreatePostInput(dto, new Date()));

    return { post: toPublicPost(created) };
  }

  @Delete(':id')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.posts.remove(org.id, id);

    return { deleted: true };
  }
}
