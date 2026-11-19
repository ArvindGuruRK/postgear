/**
 * The abuse limits on the Clips routes that start work (Sprint 12, Module 19
 * section 4). Two fixed safety caps, not plan values, so they live here and
 * not in `EntitlementResolver`:
 *
 * - **Per signed-in person**: 30 starts a minute across every marked route
 *   (import, upload, new clip, export, preview, download, Find Clips, retry),
 *   429 `clips_throttled`. Keyed by the user id, not the address, so a shared
 *   office address never throttles a whole team, and a script cannot escape
 *   it by changing address.
 * - **Global**: when the jobs waiting across every workspace reach
 *   `CLIPS_QUEUE_CEILING`, new work is refused with 503 `clips_busy`
 *   ("Clips is very busy right now. Try again in a few minutes."), so a
 *   flood cannot queue hours of work the media boxes will never reach. The
 *   count reads the `(status, createdAt)` index and is cached for a few
 *   seconds per API process, so a burst of starts costs one query.
 *
 * Runs after the global `JwtAuthGuard` and `RolesGuard` and after
 * `ClipsEnabledGuard` (method guards run after class guards), so only a
 * signed-in member of a workspace with Clips reaches it. The plan limits of
 * each route still run in its service, through the resolver.
 */
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClipJobStatus, prisma } from '@postgear/db';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { securityLogger } from '../../../common/logging/security-logger';
import { RedisService } from '../../redis/redis.service';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';

/** Starts a person may make a minute, across every marked route. */
export const CLIP_STARTS_PER_MINUTE = 30;
/** How long one count of the waiting jobs is trusted, per API process. */
export const QUEUED_COUNT_CACHE_MS = 3_000;
const WINDOW_SECONDS = 60;

@Injectable()
export class ClipsCreateGuard implements CanActivate {
  private readonly ceiling: number;
  private cached: { count: number; at: number } | null = null;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ceiling = Number(config.get('CLIPS_QUEUE_CEILING') ?? 500);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const userId = request.user?.id;
    // JwtAuthGuard already refused a request with no session; nothing to count.
    if (!userId) return true;

    const route = `${request.method} ${request.route?.path ?? request.path}`;
    const count = await this.redis.incrementWithTtl(`clips:starts:${userId}`, WINDOW_SECONDS);
    if (count > CLIP_STARTS_PER_MINUTE) {
      securityLogger.warn('clips.throttled', {
        userId,
        route,
        count,
        limit: CLIP_STARTS_PER_MINUTE,
      });
      throw new ClipErrorException(HttpStatus.TOO_MANY_REQUESTS, 'clips_throttled');
    }

    const queued = await this.queuedJobs(Date.now());
    if (queued >= this.ceiling) {
      securityLogger.warn('clips.busy', { userId, route, queued, ceiling: this.ceiling });
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'clips_busy', {
        message: CLIPS_MESSAGES.BUSY,
      });
    }
    return true;
  }

  /** Jobs waiting across every workspace, counted at most once per cache window. */
  private async queuedJobs(now: number): Promise<number> {
    if (this.cached && now - this.cached.at < QUEUED_COUNT_CACHE_MS) return this.cached.count;
    const count = await prisma.clipJob.count({ where: { status: ClipJobStatus.QUEUED } });
    this.cached = { count, at: now };
    return count;
  }
}

/** Marks a route that starts Clips work: the per-person and the global caps. */
export const ClipStart = () => applyDecorators(UseGuards(ClipsCreateGuard));
