import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { AnswersStepDto, ProfileStepDto, SkipStepDto } from './dto/onboarding.schema';
import {
  answersStepSchema,
  channelsStepSchema,
  profileStepSchema,
  skipStepSchema,
  workspaceStepSchema,
} from './dto/onboarding.schema';
import { OnboardingService, PROFILE_STEP } from './onboarding.service';

/**
 * The onboarding wizard's API.
 *
 * **No `@Roles()` on any route here, deliberately.** A user in this flow may
 * belong to no organization at all (that is the entire point of the flow)
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
   * Step 1: create the workspace.
   *
   * The active-workspace cookie is set here, which is not incidental. The rest
   * of the API resolves the current workspace from that cookie (see
   * `@CurrentOrg()`), so without it a user who has just created their first
   * workspace reaches step 4 with an organization in the database but no active
   * one on the request, and connecting a channel fails with "Select a workspace
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
   * Readable by JavaScript on purpose: unlike the session cookie, this one only
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
   * jump past steps it never saw.
   */
  @Post('answers')
  @HttpCode(HttpStatus.OK)
  async answers(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(answersStepSchema, 'onboarding/answers')) dto: AnswersStepDto,
  ) {
    return this.onboarding.saveAnswers(user.id, dto, nextStepFor(dto));
  }

  /** Step 4. An empty array is a valid submission: that is "skip". */
  @Post('channels')
  @HttpCode(HttpStatus.OK)
  async channels(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(channelsStepSchema, 'onboarding/channels'))
    dto: { interestedChannels: string[] },
  ) {
    return this.onboarding.saveChannels(user.id, dto.interestedChannels);
  }

  /** "Skip" on the last question of steps 2–5: moves on one step. */
  @Post('skip')
  @HttpCode(HttpStatus.OK)
  async skip(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(skipStepSchema, 'onboarding/skip')) dto: SkipStepDto,
  ) {
    return this.onboarding.skipStep(user.id, dto.step);
  }

  /**
   * Step 6: the name to be called by, and the end of onboarding. Replaces the
   * old `POST /onboarding/complete`, so there is no way to finish without
   * passing through this step.
   */
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  async profile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(profileStepSchema, 'onboarding/profile')) dto: ProfileStepDto,
  ) {
    return this.onboarding.completeProfile(user.id, dto.name);
  }
}

/**
 * Maps a set of submitted answers to the step that follows it.
 *
 * Step 2 asks role then team size; step 3 asks goal then frequency; step 5
 * asks referral source and leads to the profile step. The wizard shows one
 * question per screen (2026-10-19) and saves each as it is answered, so the
 * first question of a pair alone keeps the user on its step: resuming then
 * lands on the second question instead of skipping past it. Exported for its
 * unit test.
 */
export function nextStepFor(dto: AnswersStepDto): number {
  if (dto.teamSize !== undefined) {
    return 3;
  }
  if (dto.role !== undefined) {
    return 2;
  }
  if (dto.postingFrequency !== undefined) {
    return 4;
  }
  if (dto.primaryGoal !== undefined) {
    return 3;
  }
  return PROFILE_STEP;
}
