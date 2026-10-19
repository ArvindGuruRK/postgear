import { BadRequestException, Injectable } from '@nestjs/common';
import { type OnboardingResponse, prisma } from '@postgear/db';
import { OrgService } from '../org/org.service';
import type { AnswersStepDto } from './dto/onboarding.schema';

/**
 * The post-signup onboarding flow.
 *
 * ## Six steps, five questions
 *
 * | Step | Screen | Persists |
 * |---|---|---|
 * | 1 | Name your workspace | `Organization` + `UserOrganization(ADMIN)` |
 * | 2 | About you | Q1 role, Q2 team size |
 * | 3 | Your goals | Q3 primary goal, Q4 posting frequency |
 * | 4 | Channels | `interestedChannels`: skippable |
 * | 5 | One last thing | Q5 referral source |
 * | 6 | Profile | `User.name`, then `onboardingCompletedAt` (avatar via `/users/me/avatar/*`) |
 *
 * ## Every path ends on step 6 (UI revamp, 2026-10-17)
 *
 * Once the workspace exists, each question can be skipped (one question per
 * screen since 2026-10-19; `POST /onboarding/skip` moves past the step whose
 * last question was skipped), but nothing skips step 6: answering and
 * skipping both land on "What should we call you?", and only
 * `POST /onboarding/profile` marks onboarding complete. The name it saves is
 * the one the AI copilot addresses the user by, which is why it is asked even
 * of someone in a hurry.
 *
 * Completion used to happen at step 5 (`POST /onboarding/complete`, now
 * removed: nothing calls it). A user who stopped mid-flow under the old
 * five-step version resumes unchanged: their stored step is still 1–5, every
 * step below 6 means the same screen it did, and step 5's submit now advances
 * to 6 instead of finishing. Users with `onboardingCompletedAt` set are never
 * routed here at all.
 *
 * ## Why completion is a column and not a derived check
 *
 * SCHEMA_NOTES left this open for Sprint 2. It is now
 * `User.onboardingCompletedAt`, alongside `User.onboardingStep`.
 *
 * The cheap alternative ("onboarded means at least one `UserOrganization`")
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

export const TOTAL_STEPS = 6;

/** The step every path ends on: name + avatar, then completion. */
export const PROFILE_STEP = 6;

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
   * Returns the first workspace when there is one, but note this is the only
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
      // Not an error the user needs to see as a failure: just move them on.
      await this.advanceTo(userId, Math.max(state.step, 2));
      return this.getState(userId);
    }

    await this.orgs.create(userId, name);
    await this.advanceTo(userId, 2);

    return this.getState(userId);
  }

  /**
   * Steps 2, 3 and 5, one answer per call. Merges answers into the single
   * response row. Step 5 now advances to the profile step (6) rather than
   * completing.
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
   * merge: a multi-select that deselects everything has to be able to store
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
   * "Skip" on the last question of step 2–5: moves on to the step after it
   * (step 5 leads to the profile step). The first question of a pair needs no
   * call, since answering or skipping it leaves the user on the same step.
   *
   * Nothing is written to `OnboardingResponse`: a skipped question stays null,
   * which every reader of it already has to handle, and an answer given
   * earlier is kept. Refuses before the workspace exists: step 1 is the one
   * step that cannot be skipped.
   */
  async skipStep(userId: string, step: number): Promise<OnboardingState> {
    const state = await this.getState(userId);

    if (!state.hasWorkspace) {
      throw new BadRequestException('Create a workspace before skipping ahead');
    }

    await this.advanceTo(userId, Math.min(step + 1, PROFILE_STEP));
    return this.getState(userId);
  }

  /**
   * Step 6. Saves the name the user wants to be called, marks onboarding
   * finished, and returns where to send them. The avatar is not part of this
   * call: the picker saves it the moment it is chosen.
   *
   * Refuses if there is no workspace, because the destination is
   * `/{orgId}/calendar` and there would be no id to route with: exactly the
   * crash-on-first-load failure SCHEMA_NOTES warns about.
   */
  async completeProfile(userId: string, name: string): Promise<{ organizationId: string }> {
    const state = await this.getState(userId);

    if (!state.organizationId) {
      throw new BadRequestException('Create a workspace before finishing setup');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { name, onboardingCompletedAt: new Date(), onboardingStep: TOTAL_STEPS },
      select: { id: true },
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
