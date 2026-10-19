/**
 * The six-step onboarding flow (UI revamp, 2026-10-17): step 5 now leads to
 * the profile step instead of finishing, questions can be skipped once the
 * workspace exists (one at a time since 2026-10-19), and only the profile
 * step completes onboarding.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      user: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      onboardingResponse: { upsert: jest.fn() },
    },
  };
});

import { BadRequestException } from '@nestjs/common';
import { prisma } from '@postgear/db';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { OrgService } from '../org/org.service';
import {
  PROFILE_NAME_MAX,
  profileStepSchema,
  skipStepSchema,
  stepSchema,
} from './dto/onboarding.schema';
import { nextStepFor } from './onboarding.controller';
import { OnboardingService, PROFILE_STEP, TOTAL_STEPS } from './onboarding.service';

const db = prisma as unknown as {
  user: Record<'findUniqueOrThrow' | 'update' | 'updateMany', jest.Mock>;
  onboardingResponse: { upsert: jest.Mock };
};

function userRow(step: number, hasWorkspace: boolean) {
  return {
    onboardingStep: step,
    onboardingCompletedAt: null,
    onboarding: null,
    organizations: hasWorkspace ? [{ organizationId: 'org-1' }] : [],
  };
}

describe('OnboardingService', () => {
  const orgs = { create: jest.fn() } as unknown as OrgService;
  const service = new OnboardingService(orgs);

  beforeEach(() => {
    jest.clearAllMocks();
    db.user.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockResolvedValue({ id: 'u1' });
  });

  it('has six steps, the last being the profile step', () => {
    expect(TOTAL_STEPS).toBe(6);
    expect(PROFILE_STEP).toBe(6);
  });

  it('step 5 saves Q5 and advances to the profile step without completing', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue(userRow(6, true));

    const state = await service.saveAnswers(
      'u1',
      { referralSource: 'SEARCH' },
      nextStepFor({ referralSource: 'SEARCH' }),
    );

    expect(db.onboardingResponse.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: { referralSource: 'SEARCH' },
      create: { userId: 'u1', referralSource: 'SEARCH' },
    });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', onboardingStep: { lt: 6 } },
      data: { onboardingStep: 6 },
    });
    // Completion is the profile step's job only.
    expect(db.user.update).not.toHaveBeenCalled();
    expect(state).toMatchObject({ step: 6, completedAt: null });
  });

  describe('skipStep', () => {
    it('moves on one step once the workspace exists, without saving an answer', async () => {
      db.user.findUniqueOrThrow
        .mockResolvedValueOnce(userRow(2, true))
        .mockResolvedValueOnce(userRow(3, true));

      const state = await service.skipStep('u1', 2);

      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', onboardingStep: { lt: 3 } },
        data: { onboardingStep: 3 },
      });
      expect(db.onboardingResponse.upsert).not.toHaveBeenCalled();
      expect(state.step).toBe(3);
    });

    it('skipping the referral question leads to the profile step, not completion', async () => {
      db.user.findUniqueOrThrow.mockResolvedValue(userRow(6, true));

      await service.skipStep('u1', 5);

      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', onboardingStep: { lt: 6 } },
        data: { onboardingStep: 6 },
      });
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it('cannot skip the workspace step', async () => {
      db.user.findUniqueOrThrow.mockResolvedValue(userRow(1, false));

      await expect(service.skipStep('u1', 2)).rejects.toBeInstanceOf(BadRequestException);
      expect(db.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('completeProfile', () => {
    it('saves the name, completes onboarding and returns the workspace to route to', async () => {
      db.user.findUniqueOrThrow.mockResolvedValue(userRow(6, true));

      await expect(service.completeProfile('u1', 'Ada')).resolves.toEqual({
        organizationId: 'org-1',
      });

      const call = db.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'u1' });
      expect(call.data).toMatchObject({ name: 'Ada', onboardingStep: 6 });
      expect(call.data.onboardingCompletedAt).toBeInstanceOf(Date);
    });

    it('refuses without a workspace, since there would be nowhere to route', async () => {
      db.user.findUniqueOrThrow.mockResolvedValue(userRow(1, false));

      await expect(service.completeProfile('u1', 'Ada')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });

  it('resumes a user stopped at old step 5 on step 5', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue(userRow(5, true));

    await expect(service.getState('u1')).resolves.toMatchObject({ step: 5, completedAt: null });
  });
});

describe('nextStepFor', () => {
  it('maps each step’s answers to the step after it', () => {
    expect(nextStepFor({ role: 'AGENCY', teamSize: 'JUST_ME' })).toBe(3);
    expect(nextStepFor({ primaryGoal: 'SAVE_TIME', postingFrequency: 'DAILY' })).toBe(4);
    expect(nextStepFor({ referralSource: 'FRIEND' })).toBe(6);
  });

  it('keeps the user on the step after only the first question of a pair', () => {
    expect(nextStepFor({ role: 'AGENCY' })).toBe(2);
    expect(nextStepFor({ teamSize: 'JUST_ME' })).toBe(3);
    expect(nextStepFor({ primaryGoal: 'SAVE_TIME' })).toBe(3);
    expect(nextStepFor({ postingFrequency: 'DAILY' })).toBe(4);
  });
});

describe('POST /onboarding/skip body', () => {
  const pipe = new ZodBody(skipStepSchema, 'test');

  it.each([2, 3, 4, 5])('accepts step %i', (step) => {
    expect(pipe.transform({ step })).toEqual({ step });
  });

  it.each([[{ step: 1 }], [{ step: 6 }], [{ step: '3' }], [{ step: 3, extra: true }], [{}]])(
    'rejects %j',
    (body) => {
      expect(() => pipe.transform(body)).toThrow(BadRequestException);
    },
  );
});

describe('POST /onboarding/profile body', () => {
  const pipe = new ZodBody(profileStepSchema, 'test');

  it('trims and sanitizes the name', () => {
    expect(pipe.transform({ name: '  Ada   <b>Lovelace</b> ' })).toEqual({ name: 'Ada Lovelace' });
  });

  it(`accepts exactly ${PROFILE_NAME_MAX} characters`, () => {
    expect(pipe.transform({ name: 'a'.repeat(PROFILE_NAME_MAX) }).name).toHaveLength(50);
  });

  it.each([
    [{ name: '' }],
    [{ name: '    ' }],
    [{ name: '<script>x</script>' }],
    [{ name: 'a'.repeat(PROFILE_NAME_MAX + 1) }],
    [{ name: 'Ada', avatar: 'x' }],
    [{}],
  ])('rejects %j', (body) => {
    expect(() => pipe.transform(body)).toThrow(BadRequestException);
  });
});

describe('stepSchema', () => {
  it('allows resuming at step 6', () => {
    expect(stepSchema.parse({ step: '6' })).toEqual({ step: 6 });
    expect(() => stepSchema.parse({ step: 7 })).toThrow();
  });
});
