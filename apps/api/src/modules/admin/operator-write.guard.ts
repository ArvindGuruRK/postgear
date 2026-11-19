/**
 * The throttle on operator writes (Sprint 12, Module 19 section 7: "All
 * operator writes are throttled"). Keyed by the operator's user id, 20 writes
 * a minute across every operator route: plenty for a person at a table,
 * and a ceiling on a script or a stolen session doing damage in bulk.
 *
 * Put `@OperatorWrite()` on each write handler; it runs after
 * `PlatformAdminGuard` (class guards run first), so only an operator is
 * counted.
 */
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { securityLogger } from '../../common/logging/security-logger';
import { RedisService } from '../redis/redis.service';
import { OPERATOR_MESSAGES } from './operator.messages';

export const OPERATOR_WRITES_PER_MINUTE = 20;

@Injectable()
export class OperatorWriteGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const userId = request.user?.id;
    if (!userId) return true;
    const count = await this.redis.incrementWithTtl(`operator:writes:${userId}`, 60);
    if (count > OPERATOR_WRITES_PER_MINUTE) {
      securityLogger.warn('operator.denied', {
        userId,
        route: `${request.method} ${request.route?.path ?? request.path}`,
        reason: 'throttled',
        count,
      });
      throw new HttpException(
        { message: OPERATOR_MESSAGES.WRITES_THROTTLED, code: 'operator_throttled' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

export const OperatorWrite = () => applyDecorators(UseGuards(OperatorWriteGuard));
