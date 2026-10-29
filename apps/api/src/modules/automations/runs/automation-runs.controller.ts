/**
 * One run of a workflow (Sprint 10, Module 07): its detail, its live
 * progress, Cancel, and the answer to a Manual Review.
 *
 * `@Roles(ADMIN, USER)`: any member watches, cancels and reviews, as the
 * user stories ask ("the workspace gets a notification"). Every handler
 * scopes on `@CurrentOrg()`; another workspace's run is a 404.
 *
 * ## The events stream
 *
 * `GET /automation-runs/:runId/events` is server-sent events on a GET, like
 * the notification bell's. The run is checked before the stream opens, so a
 * foreign or unknown run is a normal 404 and not an empty stream. The
 * handler then awaits the stream's lifetime (`AutomationRunEventsService`).
 * `@SkipThrottle()` because one long request is not a burst.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { openSseStream } from '../../../common/sse';
import { AutomationRunEventsService } from './automation-run-events.service';
import { AutomationRunsService } from './automation-runs.service';
import { type ReviewDecisionInput, reviewDecisionSchema } from './dto/automation-runs.schema';

@Controller('automation-runs')
@Roles(Role.ADMIN, Role.USER)
export class AutomationRunsController {
  constructor(
    private readonly runs: AutomationRunsService,
    private readonly events: AutomationRunEventsService,
  ) {}

  @Get(':runId')
  async get(@CurrentOrg() org: ActiveOrg, @Param('runId') runId: string) {
    return { run: await this.runs.getRun(org.id, runId) };
  }

  @Get(':runId/events')
  @SkipThrottle()
  async stream(
    @CurrentOrg() org: ActiveOrg,
    @Param('runId') runId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.events.assertRun(org.id, runId);
    const stream = openSseStream(request, response);

    try {
      await this.events.stream(org.id, runId, stream);
    } finally {
      stream.close();
    }
  }

  /** 409 `run_finished` when the run already ended. */
  @Post(':runId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentOrg() org: ActiveOrg, @Param('runId') runId: string) {
    return { run: await this.runs.cancel(org.id, runId) };
  }

  /** 409 `review_not_waiting` or `review_answered`; 503 `engine_unavailable` when the run could not be told. */
  @Post(':runId/reviews/:nodeKey')
  @HttpCode(HttpStatus.OK)
  async review(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId') runId: string,
    @Param('nodeKey') nodeKey: string,
    @Body(new ZodBody(reviewDecisionSchema, 'automation-runs/review')) dto: ReviewDecisionInput,
  ) {
    return { review: await this.runs.review(org.id, user.id, runId, nodeKey, dto) };
  }
}
