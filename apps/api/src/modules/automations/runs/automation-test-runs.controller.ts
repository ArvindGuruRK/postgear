/**
 * The run routes that hang off a workflow (Sprint 10, Module 07): Test
 * Workflow, Test Step and the workflow's run history.
 *
 * `@Roles(ADMIN, USER)`: any member tests, as any member edits. Every
 * handler scopes on `@CurrentOrg()`; the `:id` is only the workflow acted
 * on, and another workspace's is a 404. These paths sit under
 * `/automations` beside Module 03's routes, which never take a second path
 * segment after `:id` with these names, so the two controllers cannot clash.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { AutomationRunsService } from './automation-runs.service';
import {
  type ListRunsQuery,
  listRunsQuerySchema,
  type StartTestRunInput,
  type StepTestInput,
  startTestRunSchema,
  stepTestSchema,
} from './dto/automation-runs.schema';

@Controller('automations')
@Roles(Role.ADMIN, Role.USER)
export class AutomationTestRunsController {
  constructor(private readonly runs: AutomationRunsService) {}

  /** A TEST run of the saved draft. 422 `test_blocked` when it has problems; 429 past 3 a minute. */
  @Post(':id/test-runs')
  @HttpCode(HttpStatus.CREATED)
  async testRun(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodBody(startTestRunSchema, 'automation-runs/test-run'))
    dto: StartTestRunInput | undefined,
  ) {
    return { run: await this.runs.startTestRun(org.id, user.id, id, dto ?? {}) };
  }

  /** A TEST run of one step, the steps before it seeded. */
  @Post(':id/steps/:nodeKey/test')
  @HttpCode(HttpStatus.CREATED)
  async testStep(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('nodeKey') nodeKey: string,
    @Body(new ZodBody(stepTestSchema, 'automation-runs/step-test')) dto: StepTestInput | undefined,
  ) {
    return { run: await this.runs.startStepTest(org.id, user.id, id, nodeKey, dto ?? {}) };
  }

  @Get(':id/runs')
  listRuns(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Query(new ZodQuery(listRunsQuerySchema, 'automation-runs/list')) query: ListRunsQuery,
  ) {
    return this.runs.listRuns(org.id, id, query);
  }
}
