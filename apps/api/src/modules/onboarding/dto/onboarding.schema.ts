import {
  OnboardingGoal,
  OnboardingRole,
  OnboardingTeamSize,
  PostingFrequency,
  ReferralSource,
} from '@postgear/db';
import { z } from 'zod';
import { orgNameSchema } from '../../auth/dto/common.schema';

/**
 * The onboarding wizard's request bodies.
 *
 * The five survey answers are validated with `z.nativeEnum` against the Prisma
 * enums, so the allowed values are defined once — in `schema.prisma` — and
 * both the database and the API agree by construction. Adding a sixth option
 * to a question is a migration plus a UI change; the validation follows for
 * free and cannot drift out of sync.
 *
 * Every answer field is optional on the wire. A step submits only what it
 * collected, and the service merges rather than replacing, so a user who goes
 * back a step does not blank out answers they already gave.
 */

export const workspaceStepSchema = z.object({ name: orgNameSchema }).strict();

/** Steps 2, 3 and 5 all post into this one endpoint. */
export const answersStepSchema = z
  .object({
    role: z.nativeEnum(OnboardingRole).optional(),
    teamSize: z.nativeEnum(OnboardingTeamSize).optional(),
    primaryGoal: z.nativeEnum(OnboardingGoal).optional(),
    postingFrequency: z.nativeEnum(PostingFrequency).optional(),
    referralSource: z.nativeEnum(ReferralSource).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'no answers supplied');

export type AnswersStepDto = z.infer<typeof answersStepSchema>;

/**
 * Step 4's channel interest.
 *
 * A bounded array of short slugs rather than free text: the values are written
 * to a `String[]` column and rendered back into the UI, so an unbounded list
 * of arbitrary strings would be both a storage and an injection concern. The
 * slug pattern is deliberately narrow — Sprint 3 owns the real channel
 * registry, and this list only has to survive until then.
 */
export const channelsStepSchema = z
  .object({
    interestedChannels: z
      .array(z.string().regex(/^[a-z0-9-]{1,32}$/, 'invalid channel'))
      .max(20, 'too many'),
  })
  .strict();

/** The step number the client believes it is on, used to resume. */
export const stepSchema = z.object({ step: z.coerce.number().int().min(1).max(5) }).strict();
