import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { AnswersStepDto } from './dto/onboarding.schema';
import {
  answersStepSchema,
  channelsStepSchema,
  workspaceStepSchema,
} from './dto/onboarding.schema';
import { OnboardingService } from './onboarding.service';

/**
 * The onboarding wizard's API.
 *
 * **No `@Roles()` on any route here, deliberately.** A user in this flow may
 * belong to no organization at all — that is the entire point of the flow —
 * and a role requirement resolves against an active workspace that does not
 * exist yet. These routes need authentication and nothing more.
 */
@Controller('onboarding')
export class OnboardingController {
  private readonly orgCookie: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly onboarding: OnboardingService,
    config: ConfigService,
  ) {
    this.orgCookie = config.get<string>('ORG_COOKIE_NAME', 'pg_org');
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  /** Everything the wizard needs to render, including where to resume. */
  @Get('state')
  async state(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.getState(user.id);
  }

  /**
   * Step 1 — create the workspace.
   *
   * The active-workspace cookie is set here, which is not incidental. The rest
   * of the API resolves the current workspace from that cookie (see
   * `@CurrentOrg()`), so without it a user who has just created their first
   * workspace reaches step 4 with an organization in the database but no active
   * one on the request — and connecting a channel fails with "Select a workspace
   * first". `POST /orgs` has always set it for the same reason; onboarding
   * creates workspaces by a different route and needs to do the same.
   */
  @Post('workspace')
  @HttpCode(HttpStatus.CREATED)
  async workspace(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(workspaceStepSchema, 'onboarding/workspace')) dto: { name: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const state = await this.onboarding.createWorkspace(user.id, dto.name);

    if (state.organizationId) {
      response.cookie(this.orgCookie, state.organizationId, this.cookieOptions());
    }

    return state;
  }

  /**
   * Mirrors `OrgController`'s options exactly.
   *
   * Readable by JavaScript on purpose — unlike the session cookie, this one only
   * names which workspace is selected, and the web app reads it to route. It is
   * never trusted for authorization: `RolesGuard` re-checks membership against
   * the database on every request.
   */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: false,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  /**
   * Steps 2, 3 and 5 all post here.
   *
   * The next step is derived from which questions the body carried rather than
   * trusted from the client: a client that could name its own next step could
   * skip step 5 and still be marked complete.
   */
  @Post('answers')
  @HttpCode(HttpStatus.OK)
  async answers(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(answersStepSchema, 'onboarding/answers')) dto: AnswersStepDto,
  ) {
    return this.onboarding.saveAnswers(user.id, dto, nextStepFor(dto));
  }

  /** Step 4. An empty array is a valid submission — that is "skip". */
  @Post('channels')
  @HttpCode(HttpStatus.OK)
  async channels(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(channelsStepSchema, 'onboarding/channels'))
    dto: { interestedChannels: string[] },
  ) {
    return this.onboarding.saveChannels(user.id, dto.interestedChannels);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async complete(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.complete(user.id);
  }
}

/**
 * Maps a set of submitted answers to the step that follows it.
 *
 * Step 2 asks role and team size; step 3 asks goal and frequency; step 5 asks
 * referral source. Anything unrecognised leaves the user where they are rather
 * than guessing.
 */
function nextStepFor(dto: AnswersStepDto): number {
  if (dto.role !== undefined || dto.teamSize !== undefined) {
    return 3;
  }
  if (dto.primaryGoal !== undefined || dto.postingFrequency !== undefined) {
    return 4;
  }
  return 5;
}
