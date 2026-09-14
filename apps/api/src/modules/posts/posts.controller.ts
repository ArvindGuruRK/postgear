/**
 * Posts.
 *
 * Addressed by **group** — the id of a post as a person thinks of it, spanning
 * every channel and every part — never by individual row. Rows are the
 * repository's business; see `posts.repository.ts`.
 *
 * `@Roles(ADMIN, USER)` makes an active membership mandatory while leaving
 * writing open to every member, as in the media controller.
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
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import {
  type CreatePostInput,
  createPostSchema,
  type ListPostsQuery,
  listPostsQuerySchema,
  type UpdatePostInput,
  updatePostSchema,
} from './dto/posts.schema';
import { POST_MESSAGES } from './posts.messages';
import { PostsService } from './posts.service';

@Controller('posts')
@Roles(Role.ADMIN, Role.USER)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  async list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listPostsQuerySchema, 'posts/list')) query: ListPostsQuery,
  ) {
    return { posts: await this.posts.list(org.id, query.state) };
  }

  @Get(':group')
  async get(@CurrentOrg() org: ActiveOrg, @Param('group') group: string) {
    return { post: await this.posts.get(org.id, group) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(createPostSchema, 'posts/create')) dto: CreatePostInput,
  ) {
    return { post: await this.posts.create(org.id, dto) };
  }

  /** Replaces the post's content, channels and state in one save. */
  @Put(':group')
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('group') group: string,
    @Body(new ZodBody(updatePostSchema, 'posts/update')) dto: UpdatePostInput,
  ) {
    return { post: await this.posts.update(org.id, group, dto) };
  }

  @Delete(':group')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('group') group: string) {
    await this.posts.remove(org.id, group);
    return { message: POST_MESSAGES.DELETED };
  }
}
