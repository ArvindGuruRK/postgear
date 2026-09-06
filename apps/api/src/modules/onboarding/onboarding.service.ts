import { BadRequestException, Injectable } from '@nestjs/common';
import { type OnboardingResponse, prisma } from '@postgear/db';
import { OrgService } from '../org/org.service';
import type { AnswersStepDto } from './dto/onboarding.schema';

/**
 * The post-signup onboarding flow.
 *
 * ## Five steps, five questions
 *
 * | Step | Screen | Persists |
 * |---|---|---|
 * | 1 | Name your workspace | `Organization` + `UserOrganization(ADMIN)` |
 * | 2 | About you | Q1 role, Q2 team size |
 * | 3 | Your goals | Q3 primary goal, Q4 posting frequency |
 * | 4 | Channels | `interestedChannels` — skippable |
 * | 5 | Finish | Q5 referral source, then `onboardingCompletedAt` |
 *
 * ## Why completion is a column and not a derived check
 *
 * SCHEMA_NOTES left this open for Sprint 2. It is now
 * `User.onboardingCompletedAt`, alongside `User.onboardingStep`.
 *
 * The cheap alternative — "onboarded means at least one `UserOrganization`" —
 * needs no migration but collapses "created a workspace" and "finished
 * onboarding" into the same event. With a five-step flow that is wrong on the
 * first step: the moment the workspace is created the derived check flips to
 * true, the route gate stops sending the user to `/onboarding`, and steps 2
 * through 5 become unreachable. Someone who closes the tab at step 3 would
 * never be asked the remaining questions.
 *
 * Storing the step explicitly also means resuming is exact rather than
 * inferred, which is what the sprint's "a user who abandons onboarding midway
 * can sign back in without hitting an error page" requirement actually needs.
 */

export const TOTAL_STEPS = 5;

export interface OnboardingState {
  step: number;
  completedAt: Date | null;
  hasWorkspace: boolean;
  organizationId: string | null;
  answers: Pick<
    OnboardingResponse,
    | 'role'
    | 'teamSize'
    | 'primaryGoal'
    | 'postingFrequency'
    | 'referralSource'
    | 'interestedChannels'
  > | null;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly orgs: OrgService) {}

  /**
   * Everything the wizard needs to render itself, in one round trip.
   *
   * Returns the first workspace when there is one — but note this is the only
   * place `[0]` is taken, and it is guarded by `hasWorkspace`. Nothing else in
   * the codebase may assume a user has an organization.
   */
  async getState(userId: string): Promise<OnboardingState> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboarding: true,
        organizations: {
          where: { disabled: false },
          select: { organizationId: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    const membership = user.organizations[0] ?? null;

    return {
      step: user.onboardingStep,
      completedAt: user.onboardingCompletedAt,
      hasWorkspace: membership !== null,
      organizationId: membership?.organizationId ?? null,
      answers: user.onboarding
        ? {
            role: user.onboarding.role,
            teamSize: user.onboarding.teamSize,
            primaryGoal: user.onboarding.primaryGoal,
            postingFrequency: user.onboarding.postingFrequency,
            referralSource: user.onboarding.referralSource,
            interestedChannels: user.onboarding.interestedChannels,
          }
        : null,
    };
  }

  /**
   * Step 1. Creates the workspace and advances to step 2.
   *
   * Idempotent by refusal rather than by silently creating a second workspace:
   * a double-submitted form would otherwise leave the user with two
   * near-identical workspaces and no obvious way to tell them apart.
   */
  async createWorkspace(userId: string, name: string): Promise<OnboardingState> {
    const state = await this.getState(userId);

    if (state.hasWorkspace) {
      // Not an error the user needs to see as a failure — just move them on.
      await this.advanceTo(userId, Math.max(state.step, 2));
      return this.getState(userId);
    }

    await this.orgs.create(userId, name);
    await this.advanceTo(userId, 2);

    return this.getState(userId);
  }

  /**
   * Steps 2, 3 and 5. Merges answers into the single response row.
   *
   * `upsert` with a partial `update` is what makes going back a step safe: the
   * fields this request did not mention keep their existing values instead of
   * being nulled out.
   */
  async saveAnswers(
    userId: string,
    answers: AnswersStepDto,
    nextStep: number,
  ): Promise<OnboardingState> {
    await prisma.onboardingResponse.upsert({
      where: { userId },
      update: answers,
      create: { userId, ...answers },
    });

    await this.advanceTo(userId, nextStep);
    return this.getState(userId);
  }

  /**
   * Step 4. Records which platforms the user is interested in.
   *
   * Separate from `saveAnswers` because this one *does* replace rather than
   * merge — a multi-select that deselects everything has to be able to store
   * an empty array, which a merge could not express.
   */
  async saveChannels(userId: string, interestedChannels: string[]): Promise<OnboardingState> {
    await prisma.onboardingResponse.upsert({
      where: { userId },
      update: { interestedChannels },
      create: { userId, interestedChannels },
    });

    await this.advanceTo(userId, 5);
    return this.getState(userId);
  }

  /**
   * Marks onboarding finished and returns where to send the user.
   *
   * Refuses if there is no workspace, because the destination is
   * `/{orgId}/calendar` and there would be no id to route with — exactly the
   * crash-on-first-load failure SCHEMA_NOTES warns about.
   */
  async complete(userId: string): Promise<{ organizationId: string }> {
    const state = await this.getState(userId);

    if (!state.organizationId) {
      throw new BadRequestException('Create a workspace before finishing setup');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: new Date(), onboardingStep: TOTAL_STEPS },
    });

    return { organizationId: state.organizationId };
  }

  /**
   * Moves the persisted step forward only.
   *
   * Never backwards: a user browsing back to step 2 to re-read their answer
   * should not lose the progress they already made past it. The UI is free to
   * *display* an earlier step; this column records the furthest point reached.
   */
  private async advanceTo(userId: string, step: number): Promise<void> {
    const clamped = Math.min(Math.max(step, 1), TOTAL_STEPS);

    await prisma.user.updateMany({
      where: { id: userId, onboardingStep: { lt: clamped } },
      data: { onboardingStep: clamped },
    });
  }
}
