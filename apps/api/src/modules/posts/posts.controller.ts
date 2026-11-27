/**
 * Posts.
 *
 * Addressed by **group** (the id of a post as a person thinks of it, spanning
 * every channel and every part), never by individual row. Rows are the
 * repository's business; see `posts.repository.ts`.
 *
 * `@Roles(ADMIN, USER, EDITOR)` makes an active membership mandatory while
 * leaving writing open to every member, as in the media controller.
 *
 * Editors (Sprint 13, Module 14) are let in for drafts only: the two routes
 * that only schedule or publish carry their own `@Roles(ADMIN, USER)`, and
 * every write passes the caller to `PostsService`, whose
 * `assertEditorMayWrite` refuses anything but a draft whatever the body says.
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
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import {
  type CalendarQuery,
  type CreatePostInput,
  calendarQuerySchema,
  createPostSchema,
  type ListPostsQuery,
  listPostsQuerySchema,
  type QueueQuery,
  queueQuerySchema,
  type RescheduleInput,
  rescheduleSchema,
  type UpdatePostInput,
  updatePostSchema,
} from './dto/posts.schema';
import { POST_MESSAGES } from './posts.messages';
import { type PostActor, PostsService } from './posts.service';

/** The person behind a request, for `assertEditorMayWrite` and `createdById`. */
function actorOf(user: AuthenticatedUser, org: ActiveOrg): PostActor {
  return { userId: user.id, role: org.role };
}

@Controller('posts')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  async list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listPostsQuerySchema, 'posts/list')) query: ListPostsQuery,
  ) {
    return { posts: await this.posts.list(org.id, query.state) };
  }

  // The two literal routes are declared before `:group`: Nest matches in
  // declaration order, and "calendar" would otherwise be read as a group id.

  /** Sprint 5: every post scheduled inside a range, for the calendar. */
  @Get('calendar')
  async calendar(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(calendarQuerySchema, 'posts/calendar')) query: CalendarQuery,
  ) {
    return { posts: await this.posts.calendar(org.id, query) };
  }

  /** Sprint 5: the queue, paged and filtered. */
  @Get('queue')
  async queue(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(queueQuerySchema, 'posts/queue')) query: QueueQuery,
  ) {
    return this.posts.queue(org.id, query);
  }

  @Get(':group')
  async get(@CurrentOrg() org: ActiveOrg, @Param('group') group: string) {
    return { post: await this.posts.get(org.id, group) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(createPostSchema, 'posts/create')) dto: CreatePostInput,
  ) {
    return { post: await this.posts.create(org.id, dto, { actor: actorOf(user, org) }) };
  }

  /** Replaces the post's content, channels and state in one save. */
  @Put(':group')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Param('group') group: string,
    @Body(new ZodBody(updatePostSchema, 'posts/update')) dto: UpdatePostInput,
  ) {
    return { post: await this.posts.update(org.id, group, dto, actorOf(user, org)) };
  }

  @Delete(':group')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Param('group') group: string,
  ) {
    await this.posts.remove(org.id, group, actorOf(user, org));
    return { message: POST_MESSAGES.DELETED };
  }

  /** Sprint 5: moves the whole post to a new time (drag-and-drop lands here). */
  @Put(':group/schedule')
  @Roles(Role.ADMIN, Role.USER)
  async reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Param('group') group: string,
    @Body(new ZodBody(rescheduleSchema, 'posts/reschedule')) dto: RescheduleInput,
  ) {
    return {
      post: await this.posts.reschedule(
        org.id,
        group,
        new Date(dto.publishDate),
        actorOf(user, org),
      ),
    };
  }

  /** Sprint 5: publishes a queued or failed post right away. */
  @Post(':group/publish-now')
  @Roles(Role.ADMIN, Role.USER)
  @HttpCode(HttpStatus.OK)
  async publishNow(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Param('group') group: string,
  ) {
    return { post: await this.posts.publishNow(org.id, group, actorOf(user, org)) };
  }
}
