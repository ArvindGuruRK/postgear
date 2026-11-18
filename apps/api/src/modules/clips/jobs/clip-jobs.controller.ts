/**
 * One clip job (Sprint 12, Module 02): its view, its live progress, Cancel.
 *
 * `@Roles(ADMIN, USER)`: any member of the workspace watches and stops the
 * work done in it. Every handler scopes on `@CurrentOrg()`; another
 * workspace's job is a 404, checked before a stream opens. The stream is
 * server-sent events on a GET, `@SkipThrottle()` because one long request
 * is not a burst.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { openSseStream } from '../../../common/sse';
import { ClipJobEventsService } from './clip-job-events.service';
import { ClipJobsService } from './clip-jobs.service';

@Controller('clips/jobs')
@Roles(Role.ADMIN, Role.USER)
export class ClipJobsController {
  constructor(
    private readonly jobs: ClipJobsService,
    private readonly events: ClipJobEventsService,
  ) {}

  @Get(':jobId')
  async get(@CurrentOrg() org: ActiveOrg, @Param('jobId') jobId: string) {
    return { job: await this.jobs.view(org.id, jobId) };
  }

  @Get(':jobId/events')
  @SkipThrottle()
  async stream(
    @CurrentOrg() org: ActiveOrg,
    @Param('jobId') jobId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.events.assertJob(org.id, jobId);
    const stream = openSseStream(request, response);
    try {
      await this.events.stream(org.id, jobId, stream);
    } finally {
      stream.close();
    }
  }

  /** 409 `job_finished` when it already ended; 503 `tools_offline` when Temporal is unreachable. */
  @Post(':jobId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentOrg() org: ActiveOrg, @Param('jobId') jobId: string) {
    return { job: await this.jobs.cancel(org.id, jobId) };
  }
}
