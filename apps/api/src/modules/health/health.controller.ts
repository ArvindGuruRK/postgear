/**
 * Health (Sprint 8, PRD 5.12): what an orchestrator or an uptime monitor
 * asks, and the one deliberate failure the Sentry wiring is proven with.
 *
 * `GET /health` is `@Public()` — a monitor has no session — and answers
 * `200 ok` only when the database answers; a `503 degraded` otherwise, so a
 * load balancer stops routing to an instance that cannot serve. It says
 * nothing about versions or hosts that would help someone mapping the
 * deployment.
 *
 * `GET /health/sentry-test` throws on purpose. It is restricted to
 * superadmins: an endpoint that anyone can make throw is an endpoint anyone
 * can use to fill the error quota.
 */
import { Controller, ForbiddenException, Get, HttpException, HttpStatus } from '@nestjs/common';
import { prisma } from '@postgear/db';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { isSentryEnabled } from '../../common/sentry/sentry';
import { AUTH_MESSAGES } from '../auth/auth.messages';

const STARTED_AT = Date.now();

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: 'ok' | 'down' };
  uptimeSeconds: number;
  sentry: boolean;
}

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  async health(): Promise<HealthReport> {
    const database = await prisma.$queryRaw`SELECT 1`
      .then(() => 'ok' as const)
      .catch(() => 'down' as const);

    const report: HealthReport = {
      status: database === 'ok' ? 'ok' : 'degraded',
      checks: { database },
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      sentry: isSentryEnabled(),
    };

    if (report.status !== 'ok') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return report;
  }

  /** Throws a plain Error so the global filter reports it; answers 500 by design. */
  @Get('sentry-test')
  sentryTest(@CurrentUser() user: AuthenticatedUser): never {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException(AUTH_MESSAGES.FORBIDDEN);
    }

    throw new Error(`Sentry test error from apps/api (${new Date().toISOString()})`);
  }
}
